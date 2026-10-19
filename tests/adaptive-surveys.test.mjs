import {approvedQuestion, fiveQuestions} from './helpers/questions.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import pg from 'pg';
import {createApp} from '../dist/src/app.js';
import {Clock} from '../dist/src/clock.js';
import {SurveyService} from '../dist/src/surveys.js';

test('adaptive surveys preserve private assignments and historical answers',async t=>{
  const original=process.env.DATABASE_URL;
  const adminURL=new URL(original);adminURL.pathname='/postgres';
  const admin=new pg.Client({connectionString:adminURL.toString()});await admin.connect();
  const name=`flowchemia_adaptive_${randomUUID().replaceAll('-','')}`;
  const url=new URL(original);url.pathname=`/${name}`;
  let app,db;
  try {
    await admin.query(`CREATE DATABASE "${name}"`);process.env.DATABASE_URL=url.toString();
    const command=(args,input)=>{const r=spawnSync(process.execPath,args,{env:process.env,input,encoding:'utf8'});assert.equal(r.status,0,r.stderr);};
    command(['node_modules/prisma/build/index.js','migrate','deploy']);
    const password='fictional-adaptive-password-2027';
    command(['dist/scripts/bootstrap.js'],JSON.stringify({email:'owner@example.test',displayName:'Owner',password}));
    db=new pg.Client({connectionString:url.toString()});await db.connect();
    app=await createApp(false);await app.listen(0,'127.0.0.1');const base=await app.getUrl();
    let now=new Date('2027-01-03T12:00:00Z');app.get(Clock).now=()=>new Date(now);
    async function request(method,path,token,value,expected=200){
      const response=await fetch(base+path,{method,headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(value!==undefined?{'Content-Type':'application/json'}:{})},body:value===undefined?undefined:JSON.stringify(value)});
      const json=await response.json();assert.equal(response.status,expected,`${method} ${path}: ${JSON.stringify(json)}`);return json;
    }
    const owner=(await request('POST','/auth/login',null,{email:'owner@example.test',password})).token;
    const {organization:org}=await request('POST','/organizations',owner,{name:'Adaptive company'},201);
    const root=`/organizations/${org.id}`;
    const people=[];
    for(const name of ['Alice','Bob','Carla','Dan','Elias']){
      const email=`${name.toLowerCase()}@example.test`;
      const invite=await request('POST',`${root}/invitations`,owner,{email},201);
      const accepted=await request('POST','/invitations/accept',null,{token:invite.token,displayName:name,password},201);
      people.push({id:accepted.membership.id,token:(await request('POST','/auth/login',null,{email,password})).token});
    }
    const team=await request('POST',`${root}/teams`,owner,{name:'PLC project'},201);
    for(const p of people)await request('POST',`${root}/teams/${team.id}/members`,owner,{membershipId:p.id},201);
    let fixedIds,library,firstAssignment,firstDetail;
    const open=p=>request('GET',`${root}/assignments/my-open`,p.token);
    const detail=(p,id)=>request('GET',`${root}/assignments/${id}`,p.token);
    await t.test('adaptive policy requires an approved library and administrator access',async()=>{
      await request('PATCH',`${root}/feedback-policy`,people[0].token,{questionSelection:'ADAPTIVE'},403);
      await request('PATCH',`${root}/feedback-policy`,owner,{questionSelection:'OTHER'},400);
      await request('PATCH',`${root}/feedback-policy`,owner,{questionSelection:'ADAPTIVE'},400);
      const fixture=await approvedQuestion(request,root,owner,{questionKey:'fixture',text:'Fixture skill question'},password);
      fixedIds=await fiveQuestions(request,root,owner,[fixture]);
      library=await request('GET',`${root}/questions`,owner);
      const {organization:other}=await request('POST','/organizations',owner,{name:'Separate company'},201);
      await request('PATCH',`/organizations/${other.id}/feedback-policy`,owner,{questionSelection:'ADAPTIVE'},400);
      await request('POST',`${root}/questions`,owner,{questionKey:'unapproved',text:'Must not be used',dimension:'CHEMISTRY_ENJOYMENT'},201);
      await request('PATCH',`${root}/feedback-policy`,owner,{questionSelection:'ADAPTIVE',questionVersionIds:fixedIds},400);
      const policy=await request('PATCH',`${root}/feedback-policy`,owner,{questionSelection:'ADAPTIVE',colleaguesPerPeriod:2,automaticEnabled:true});
      assert.equal(policy.questionSelection,'ADAPTIVE');assert.deepEqual(policy.questionVersionIds,[]);
      assert.equal(policy.automaticStartsAt,'2027-01-04T09:00:00.000Z');
    });
    await t.test('concurrent scheduled generation issues ten frozen personalized question sets once',async()=>{
      now=new Date('2027-01-04T09:00:00Z');
      await request('POST',`${root}/surveys/generate-periodic`,owner,{questionVersionIds:fixedIds},400);
      const service=app.get(SurveyService);
      const runs=await Promise.all([service.generateAutomatic(org.id),service.generateAutomatic(org.id)]);
      assert.equal(runs.reduce((n,r)=>n+r.createdAssignments,0),10);
      const sets=[];
      for(const p of people){
        const assignments=await open(p);assert.equal(assignments.length,2);
        for(const a of assignments){
          const d=await detail(p,a.id);assert.equal(d.questions.length,5);assert.equal(d.surveyFormat.questionCount,5);
          assert.equal(d.questions.filter(q=>q.dimension==='SKILL').length,3);
          assert.equal(d.questions.filter(q=>q.dimension==='CHEMISTRY_ENJOYMENT').length,1);
          assert.equal(d.questions.filter(q=>q.dimension==='CHEMISTRY_EFFECTIVENESS').length,1);
          assert.ok(d.questions.every(q=>library.some(l=>l.id===q.id&&l.approvalStatus==='APPROVED')));
          sets.push({subject:a.subject.membershipId,ids:d.questions.filter(q=>q.dimension==='SKILL').map(q=>q.id).sort().join(',')});
        }
      }
      assert.ok(sets.some((a,i)=>sets.some((b,j)=>i!==j&&a.subject===b.subject&&a.ids!==b.ids)),'pending reservations should spread incoming skill coverage');
      firstAssignment=(await open(people[0]))[0];firstDetail=await detail(people[0],firstAssignment.id);
      await request('GET',`${root}/assignments/${firstAssignment.id}`,owner,undefined,404);
      await request('POST',`${root}/surveys/generate-periodic`,people[0].token,{},403);
      assert.equal((await request('POST',`${root}/surveys/generate-periodic`,owner,{})).alreadyProcessed,true);
    });
    await t.test('library changes and retries never rewrite issued assignments',async()=>{
      const id=firstDetail.questions[0].id;
      await db.query('UPDATE "QuestionVersion" SET active=false WHERE id=$1',[id]);
      assert.deepEqual((await detail(people[0],firstAssignment.id)).questions,firstDetail.questions);
      assert.equal((await request('POST',`${root}/surveys/generate-periodic`,owner,{})).createdAssignments,0);
      await assert.rejects(db.query('UPDATE "Assignment" SET "questionVersionIds"=$1 WHERE id=$2',[[...firstDetail.questions.map(q=>q.id)].reverse(),firstAssignment.id]),e=>e.code==='23514');
      await db.query('UPDATE "QuestionVersion" SET active=true WHERE id=$1',[id]);
    });
    await t.test('only the five assigned questions can be submitted, including explicit unobserved answers',async()=>{
      const wrong=library.find(q=>!firstDetail.questions.some(a=>a.id===q.id));
      const answers=firstDetail.questions.map((q,i)=>({questionVersionId:q.id,rating:i===0?null:4}));
      await request('POST',`${root}/assignments/${firstAssignment.id}/submit`,people[0].token,{answers:[{...answers[0],questionVersionId:wrong.id},...answers.slice(1)]},400);
      const surveyId=(await db.query('SELECT "surveyId" FROM "Assignment" WHERE id=$1',[firstAssignment.id])).rows[0].surveyId;
      await assert.rejects(db.query('INSERT INTO "Answer" (id,"orgId","surveyId","assignmentId","questionVersionId",rating) VALUES ($1,$2,$3,$4,$5,4)',[randomUUID(),org.id,surveyId,firstAssignment.id,wrong.id]),e=>e.code==='23514');
      const result=await request('POST',`${root}/assignments/${firstAssignment.id}/submit`,people[0].token,{answers});assert.equal(result.participationPercentage,100);
      assert.equal((await db.query('SELECT count(*)::int n FROM "Answer" WHERE "assignmentId"=$1',[firstAssignment.id])).rows[0].n,5);
      await request('POST',`${root}/assignments/${firstAssignment.id}/submit`,people[0].token,{answers},409);
    });
    await t.test('colleague replacement selects five questions for the replacement and preserves credit rules',async()=>{
      const p=people[1],a=(await open(p))[0];
      const result=await request('POST',`${root}/assignments/${a.id}/replace`,p.token,{});
      assert.equal(result.outcome,'REPLACED');assert.equal(result.participationPercentage,null);
      const d=await detail(p,result.replacementAssignmentId);assert.equal(d.questions.length,5);assert.notEqual(d.subject.membershipId,a.subject.membershipId);
      await request('POST',`${root}/assignments/${d.id}/submit`,p.token,{answers:d.questions.map(q=>({questionVersionId:q.id,rating:3}))});
      assert.equal((await request('GET',`${root}/participation/my`,p.token)).filter(c=>c.outcome==='COMPLETED').length,1);
    });
    await t.test('milestones support adaptive selection without changing existing periodic assignments',async()=>{
      now=new Date('2027-01-05T12:00:00Z');
      const m=await request('POST',`${root}/teams/${team.id}/surveys/milestone`,owner,{participantMembershipIds:people.map(p=>p.id),closesAt:'2027-01-08T12:00:00Z'},201);
      assert.equal(m.createdAssignments,10);
      const milestone=(await open(people[0])).find(a=>a.type==='MILESTONE');const d=await detail(people[0],milestone.id);
      assert.equal(d.questions.length,5);assert.equal(d.closesAt,'2027-01-08T12:00:00.000Z');
      await request('POST',`${root}/assignments/${d.id}/submit`,people[0].token,{answers:d.questions.map(q=>({questionVersionId:q.id,rating:5}))});
      assert.deepEqual((await detail(people[0],firstAssignment.id)).questions,firstDetail.questions);
    });
    await t.test('new periods retain outstanding-batch rules and do not duplicate skipped cycles',async()=>{
      now=new Date('2027-01-11T09:00:00Z');
      const run=await app.get(SurveyService).generateAutomatic(org.id);assert.equal(run.createdAssignments,0);assert.equal(run.blockedEmployees,5);
      const retry=await app.get(SurveyService).generateAutomatic(org.id);assert.equal(retry.alreadyProcessed,true);
    });
    await t.test('automation can be paused even if the active library has become unusable',async()=>{
      await db.query('UPDATE "QuestionVersion" SET active=false WHERE "orgId"=$1',[org.id]);
      const result=await request('PATCH',`${root}/feedback-policy`,owner,{automaticEnabled:false});assert.equal(result.automaticEnabled,false);
      await request('PATCH',`${root}/feedback-policy`,owner,{automaticEnabled:true},400);
      assert.equal((await detail(people[0],firstAssignment.id)).questions.length,5);
    });
  } finally {
    if(app)await app.close();if(db)await db.end();process.env.DATABASE_URL=original;
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);await admin.end();
  }
});
