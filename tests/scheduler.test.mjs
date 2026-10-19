import {approvedQuestion, fiveQuestions, ratingAnswers} from './helpers/questions.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import pg from 'pg';
import {createApp} from '../dist/src/app.js';
import {Clock} from '../dist/src/clock.js';
import {SurveyService} from '../dist/src/surveys.js';
import {SurveyScheduler} from '../dist/src/scheduler.js';

test('automatic calendar generation and persistent outstanding batches',async t=>{
  const original=process.env.DATABASE_URL;assert.ok(original);
  const adminURL=new URL(original);adminURL.pathname='/postgres';
  const admin=new pg.Client({connectionString:adminURL.toString()});await admin.connect();
  const name=`flowchemia_scheduler_${randomUUID().replaceAll('-','')}`;
  const url=new URL(original);url.pathname=`/${name}`;
  let app,db;
  try{
    await admin.query(`CREATE DATABASE "${name}"`);process.env.DATABASE_URL=url.toString();
    function command(args,input){const r=spawnSync(process.execPath,args,{env:process.env,input,encoding:'utf8'});assert.equal(r.status,0,r.stderr);}
    command(['node_modules/prisma/build/index.js','migrate','deploy']);
    const password='fictional-scheduling-password-2026';
    command(['dist/scripts/bootstrap.js'],JSON.stringify({email:'owner@example.test',displayName:'Owner',password}));
    db=new pg.Client({connectionString:url.toString()});await db.connect();
    app=await createApp(false);await app.listen(0,'127.0.0.1');const base=await app.getUrl();
    let now=new Date('2027-01-03T12:00:00Z');app.get(Clock).now=()=>new Date(now);
    const at=value=>{now=new Date(value);};
    const worker=app.get(SurveyScheduler);const surveys=app.get(SurveyService);
    async function request(method,path,token,value,expected=200){const response=await fetch(base+path,{method,headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(value!==undefined?{'Content-Type':'application/json'}:{})},body:value===undefined?undefined:JSON.stringify(value)});const json=await response.json();assert.equal(response.status,expected,`${method} ${path}: ${JSON.stringify(json)}`);return json;}
    const login=async email=>(await request('POST','/auth/login',null,{email,password})).token;
    const owner=await login('owner@example.test');
    const {organization:org}=await request('POST','/organizations',owner,{name:'Scheduled Automation'},201);
    const root=`/organizations/${org.id}`;
    const people=[];
    for(const name of ['Alice','Bob','Charlie']){const email=`${name.toLowerCase()}@example.test`;const invite=await request('POST',`${root}/invitations`,owner,{email},201);const accepted=await request('POST','/invitations/accept',null,{token:invite.token,displayName:name,password},201);people.push({id:accepted.membership.id,token:await login(email)});}
    const [alice,bob,charlie]=people;
    const team=await request('POST',`${root}/teams`,owner,{name:'Original project'},201);
    for(const p of people)await request('POST',`${root}/teams/${team.id}/members`,owner,{membershipId:p.id},201);
    const question=await approvedQuestion(request,root,owner,{questionKey:'collaboration',text:'How was working together?'},password);
    const questionIds=await fiveQuestions(request,root,owner,[question]);
    const open=async(p,r=root)=>request('GET',`${r}/assignments/my-open`,p.token);
    const settle=async(p,r=root)=>{for(const a of await open(p,r))await request('POST',`${r}/assignments/${a.id}/skip`,p.token,{});};
    await t.test('company administrators select presets, timezone, time and question set before opting in',async()=>{
      const settings=await request('GET',`${root}/feedback-policy`,owner);assert.equal(settings.policy.automaticEnabled,false);
      await request('PATCH',`${root}/feedback-policy`,alice.token,{frequency:'WEEKLY'},403);
      await request('PATCH',`${root}/feedback-policy`,owner,{automaticEnabled:true},400);
      for(const change of [{frequency:'DAILY'},{periodDays:17},{colleaguesPerPeriod:3},{timeZone:'Invalid/Zone'},{generationTime:'25:10'},{weekday:8},{monthDay:0},{automaticEnabled:'yes'},{questionVersionIds:[randomUUID()],automaticEnabled:true}])await request('PATCH',`${root}/feedback-policy`,owner,change,400);
      const configured=await request('PATCH',`${root}/feedback-policy`,owner,{frequency:'WEEKLY',colleaguesPerPeriod:2,timeZone:'UTC',weekday:1,generationTime:'09:00',questionVersionIds:questionIds,automaticEnabled:true});
      assert.equal(configured.automaticStartsAt,'2027-01-04T09:00:00.000Z');
      const ready=await request('GET',`${root}/feedback-policy`,owner);assert.equal(ready.nextGenerationAt,configured.automaticStartsAt);
      assert.equal((await worker.runDue()).generationsCreated,0);
    });
    let firstBatch;
    await t.test('the due cycle generates one batch, persists its receipt and gives surveys no expiry',async()=>{
      at('2027-01-04T09:00:00Z');
      const runs=await Promise.all([surveys.generateAutomatic(org.id),surveys.generateAutomatic(org.id)]);
      assert.equal(runs.reduce((n,r)=>n+r.createdAssignments,0),6);assert.equal(runs.filter(r=>!r.alreadyProcessed).length,1);
      assert.equal((await worker.runDue()).generationsCreated,0);
      firstBatch=await open(alice);assert.equal(firstBatch.length,2);assert.ok(firstBatch.every(a=>a.closesAt===null));
      assert.equal(new Set(firstBatch.map(a=>a.subject.membershipId)).size,2);
      const record=(await request('GET',`${root}/feedback-policy`,owner)).lastGeneration;assert.equal(record.createdAssignments,6);
    });
    await t.test('either unfinished survey blocks the entire following batch, even after the team changes',async()=>{
      at('2027-01-04T10:00:00Z');
      await request('POST',`${root}/assignments/${firstBatch[0].id}/skip`,alice.token,{});await settle(bob);await settle(charlie);
      at('2027-01-06T12:00:00Z');
      await db.query('UPDATE "Team" SET "endsAt"=$1 WHERE id=$2',[now,team.id]);
      await db.query('UPDATE "TeamMember" SET "leftAt"=$1 WHERE "teamId"=$2',[now,team.id]);
      const nextTeam=await request('POST',`${root}/teams`,owner,{name:'Next project'},201);
      for(const p of people)await request('POST',`${root}/teams/${nextTeam.id}/members`,owner,{membershipId:p.id},201);
      at('2027-01-11T09:00:00Z');const run=await worker.runDue();assert.equal(run.generationsCreated,1);
      assert.equal((await open(alice)).length,1);assert.equal((await open(alice))[0].id,firstBatch[1].id);
      assert.equal((await open(bob)).length,2);assert.equal((await open(charlie)).length,2);
      const last=(await request('GET',`${root}/feedback-policy`,owner)).lastGeneration;assert.equal(last.blockedEmployees,1);assert.equal(last.createdAssignments,4);
    });
    await t.test('finishing an old survey mid-cycle waits for the next scheduled generation',async()=>{
      at('2027-01-13T12:00:00Z');
      await request('POST',`${root}/assignments/${firstBatch[1].id}/submit`,alice.token,ratingAnswers(questionIds));
      assert.equal((await open(alice)).length,0);
      await worker.runDue();assert.equal((await open(alice)).length,0);
      const manual=await request('POST',`${root}/surveys/generate-periodic`,owner,{questionVersionIds:questionIds});assert.equal(manual.createdAssignments,0);
      at('2027-01-18T09:00:00Z');assert.equal((await worker.runDue()).generationsCreated,1);assert.equal((await open(alice)).length,2);
    });
    await t.test('late restarts skip missed cycles and do not give a newly finished employee an immediate catch-up batch',async()=>{
      at('2027-02-10T12:00:00Z');await settle(alice);assert.equal((await open(alice)).length,0);
      at('2027-02-11T12:00:00Z');const late=await worker.runDue();assert.equal(late.generationsCreated,1);assert.equal((await open(alice)).length,0);
      const history=await db.query('SELECT "scheduledFor","createdAssignments","blockedEmployees" FROM "SurveyGeneration" WHERE "orgId"=$1 ORDER BY "scheduledFor"',[org.id]);
      assert.deepEqual(history.rows.map(r=>r.scheduledFor.toISOString()),['2027-01-04T09:00:00.000Z','2027-01-11T09:00:00.000Z','2027-01-18T09:00:00.000Z','2027-02-08T09:00:00.000Z']);
      assert.equal(history.rows.at(-1).createdAssignments,0);assert.equal(history.rows.at(-1).blockedEmployees,3);
      at('2027-02-15T09:00:00Z');await worker.runDue();assert.equal((await open(alice)).length,2);
    });
    await t.test('pausing automatic generation takes effect immediately and outstanding work stays available',async()=>{
      at('2027-02-15T10:00:00Z');await request('PATCH',`${root}/feedback-policy`,owner,{automaticEnabled:false});
      at('2027-02-22T12:00:00Z');assert.equal((await worker.runDue()).generationsCreated,0);assert.equal((await open(alice)).length,2);
      const state=await request('GET',`${root}/feedback-policy`,owner);assert.equal(state.policy.automaticEnabled,false);assert.equal(state.nextGenerationAt,null);
    });
    async function company(label,settings){
      const {organization:org}=await request('POST','/organizations',owner,{name:label},201);const r=`/organizations/${org.id}`;const members=[];
      for(const p of people){const id=randomUUID();await db.query('INSERT INTO "Membership" (id,"orgId","userId") SELECT $1,$2,"userId" FROM "Membership" WHERE id=$3',[id,org.id,p.id]);members.push({...p,id});}
      const team=await request('POST',`${r}/teams`,owner,{name:'Project'},201);for(const p of members)await request('POST',`${r}/teams/${team.id}/members`,owner,{membershipId:p.id},201);
      const q=await approvedQuestion(request,r,owner,{questionKey:'experience',text:'How was collaborating?'},password);
      const questionIds=await fiveQuestions(request,r,owner,[q]);
      const policy=await request('PATCH',`${r}/feedback-policy`,owner,{...settings,questionVersionIds:questionIds,automaticEnabled:true});return {org,r,members,q,policy};
    }
    await t.test('monthly generation uses calendar month-end and company wall time through DST',async()=>{
      const c=await company('Calendar months',{frequency:'MONTHLY',monthDay:31,timeZone:'Europe/Berlin',generationTime:'09:00'});
      assert.equal(c.policy.automaticStartsAt,'2027-02-28T08:00:00.000Z');
      at('2027-02-28T07:59:00Z');assert.equal((await worker.runDue()).generationsCreated,0);
      at('2027-02-28T08:00:00Z');await worker.runDue();assert.equal((await open(c.members[0],c.r)).length,1);
      at('2027-03-01T12:00:00Z');for(const p of c.members)await settle(p,c.r);
      at('2027-03-30T12:00:00Z');assert.equal((await worker.runDue()).generationsCreated,0);
      at('2027-03-31T07:00:00Z');assert.equal((await worker.runDue()).generationsCreated,1);assert.equal((await open(c.members[0],c.r)).length,1);
      const records=await db.query('SELECT "scheduledFor" FROM "SurveyGeneration" WHERE "orgId"=$1 ORDER BY "scheduledFor"',[c.org.id]);assert.deepEqual(records.rows.map(r=>r.scheduledFor.toISOString()),['2027-02-28T08:00:00.000Z','2027-03-31T07:00:00.000Z']);
    });
    await t.test('a failed company generation rolls back and retries without blocking another company',async()=>{
      const bad=await company('Retry company',{frequency:'WEEKLY',weekday:3,timeZone:'UTC',generationTime:'08:00'});
      const good=await company('Independent company',{frequency:'WEEKLY',weekday:3,timeZone:'UTC',generationTime:'08:00'});
      await db.query('UPDATE "QuestionVersion" SET active=false WHERE id=$1',[bad.q.id]);
      at('2027-04-07T08:00:00Z');const result=await worker.runDue();assert.equal(result.failures,1);assert.equal(result.generationsCreated,1);
      assert.equal((await open(good.members[0],good.r)).length,1);assert.equal((await open(bad.members[0],bad.r)).length,0);
      assert.equal((await db.query('SELECT count(*)::int n FROM "SurveyGeneration" WHERE "orgId"=$1',[bad.org.id])).rows[0].n,0);
      await db.query('UPDATE "QuestionVersion" SET active=true WHERE id=$1',[bad.q.id]);assert.equal((await worker.runDue()).generationsCreated,1);
      assert.equal((await open(bad.members[0],bad.r)).length,1);assert.equal((await worker.runDue()).generationsCreated,0);
      const assigned=(await open(good.members[0],good.r))[0];
      await db.query('UPDATE "Membership" SET active=false WHERE id=$1',[assigned.subject.membershipId]);
      const visible=await open(good.members[0],good.r);assert.equal(visible.length,1);assert.equal(visible[0].requiresReplacement,true);
      await request('POST',`${good.r}/assignments/${assigned.id}/submit`,good.members[0].token,{answers:[{questionVersionId:good.q.id,rating:3}]},409);
      const replacement=await request('POST',`${good.r}/assignments/${assigned.id}/replace`,good.members[0].token,{});
      assert.equal(replacement.outcome,'REPLACED');assert.equal((await open(good.members[0],good.r))[0].requiresReplacement,false);

    });
  }finally{if(app)await app.close();if(db)await db.end();process.env.DATABASE_URL=original;await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);await admin.end();}
});
