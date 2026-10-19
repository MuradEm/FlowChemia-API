import {approvedQuestion, fiveQuestions, ratingAnswers} from './helpers/questions.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import pg from 'pg';
import {createApp} from '../dist/src/app.js';

test('skip, replacement and normalized participation credit', async t=>{
  const original=process.env.DATABASE_URL;assert.ok(original);
  const adminURL=new URL(original);adminURL.pathname='/postgres';
  const admin=new pg.Client({connectionString:adminURL.toString()});await admin.connect();
  const name=`flowchemia_participation_${randomUUID().replaceAll('-','')}`;
  const url=new URL(original);url.pathname=`/${name}`;
  let app,db;
  try {
    await admin.query(`CREATE DATABASE "${name}"`);process.env.DATABASE_URL=url.toString();
    function command(args,input){const r=spawnSync(process.execPath,args,{env:process.env,input,encoding:'utf8'});assert.equal(r.status,0,r.stderr);}
    command(['node_modules/prisma/build/index.js','migrate','deploy']);
    const password='fictional-participation-password';
    command(['dist/scripts/bootstrap.js'],JSON.stringify({email:'owner@example.test',displayName:'Owner',password}));
    db=new pg.Client({connectionString:url.toString()});await db.connect();
    app=await createApp(false);await app.listen(0,'127.0.0.1');const base=await app.getUrl();
    async function raw(method,path,token,value){
      return fetch(base+path,{method,headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(value!==undefined?{'Content-Type':'application/json'}:{})},body:value===undefined?undefined:JSON.stringify(value)});
    }
    async function request(method,path,token,value,expected=200){const r=await raw(method,path,token,value);const json=await r.json();assert.equal(r.status,expected,`${method} ${path}: ${JSON.stringify(json)}`);return json;}
    const login=async email=>(await request('POST','/auth/login',null,{email,password})).token;
    const owner=await login('owner@example.test');
    const {organization}=await request('POST','/organizations',owner,{name:'Fictional Automation'},201);
    const root=`/organizations/${organization.id}`;
    const people=[];
    for(const name of ['Alice','Bob','Charlie','Dana']){
      const email=`${name.toLowerCase()}@example.test`;
      const invite=await request('POST',`${root}/invitations`,owner,{email},201);
      const accepted=await request('POST','/invitations/accept',null,{token:invite.token,displayName:name,password},201);
      people.push({id:accepted.membership.id,token:await login(email)});
    }
    const [alice,bob,charlie,dana]=people;
    const team=await request('POST',`${root}/teams`,owner,{name:'PLC'},201);
    for(const p of people)await request('POST',`${root}/teams/${team.id}/members`,owner,{membershipId:p.id},201);
    const q=await approvedQuestion(request,root,owner,{questionKey:'collaboration',text:'How was working together?'},password);
    const questionIds=await fiveQuestions(request,root,owner,[q]);
    await request('POST',`${root}/surveys/generate-periodic`,owner,{questionVersionIds:questionIds});
    const open=async(p,r=root)=>request('GET',`${r}/assignments/my-open`,p.token);
    const credits=async(p,r=root)=>request('GET',`${r}/participation/my`,p.token);
    const answer=ratingAnswers(questionIds);
    const originals=await Promise.all(people.map(async p=>(await open(p))[0]));
    await t.test('only the respondent can skip or replace, and clients cannot choose credit',async()=>{
      for(const action of ['skip','replace']){
        await request('POST',`${root}/assignments/${originals[0].id}/${action}`,owner,{},404);
        await request('POST',`${root}/assignments/${originals[0].id}/${action}`,bob.token,{},404);
      }
      await request('POST',`${root}/assignments/${originals[0].id}/skip`,alice.token,{percentage:100},400);
      const other=await request('POST','/organizations',owner,{name:'Other company'},201);
      await request('GET',`/organizations/${other.organization.id}/participation/my`,alice.token,undefined,404);
    });
    await t.test('voluntary skip closes only its slot and earns exactly sixty percent once',async()=>{
      const path=`${root}/assignments/${originals[1].id}`;
      const result=await request('POST',`${path}/skip`,bob.token,{});
      assert.equal(result.participationPercentage,60);assert.equal(result.status,'SKIPPED');
      await request('POST',`${path}/skip`,bob.token,{},409);
      await request('POST',`${path}/replace`,bob.token,{},409);
      await request('POST',`${path}/submit`,bob.token,answer,409);
      const ledger=await credits(bob);assert.equal(ledger.length,1);assert.equal(ledger[0].percentage,60);
      assert.equal((await open(bob)).length,0);
      const count=await db.query('SELECT count(*)::int n FROM "Answer" WHERE "assignmentId"=$1',[originals[1].id]);assert.equal(count.rows[0].n,0);
      const rerun=await request('POST',`${root}/surveys/generate-periodic`,owner,{questionVersionIds:questionIds});assert.equal(rerun.createdAssignments,0);
    });
    await t.test('replacement preserves wording and deadline and completion credits only the chain once',async()=>{
      const before=await request('GET',`${root}/assignments/${originals[0].id}`,alice.token);
      const replaced=await request('POST',`${root}/assignments/${before.id}/replace`,alice.token,{});
      assert.equal(replaced.outcome,'REPLACED');assert.equal(replaced.participationPercentage,null);
      const next=await request('GET',`${root}/assignments/${replaced.replacementAssignmentId}`,alice.token);
      assert.equal(next.closesAt,before.closesAt);assert.deepEqual(next.questions,before.questions);
      assert.notEqual(next.subject.membershipId,before.subject.membershipId);assert.notEqual(next.subject.membershipId,alice.id);
      assert.equal((await credits(alice)).length,0);assert.equal((await open(alice)).length,1);
      await request('POST',`${root}/assignments/${before.id}/submit`,alice.token,answer,409);
      const submitted=await request('POST',`${root}/assignments/${next.id}/submit`,alice.token,answer);assert.equal(submitted.participationPercentage,100);
      const ledger=await credits(alice);assert.equal(ledger.length,1);assert.equal(ledger[0].percentage,100);assert.equal(ledger[0].assignmentId,next.id);
      const record=(await db.query('SELECT "rootAssignmentId" FROM "ParticipationCredit" WHERE "assignmentId"=$1',[next.id])).rows[0];assert.equal(record.rootAssignmentId,before.id);
    });
    await t.test('concurrent replacements cannot branch and exhausted candidates stay uncredited',async()=>{
      const start=originals[2];
      const responses=await Promise.all([raw('POST',`${root}/assignments/${start.id}/replace`,charlie.token,{}),raw('POST',`${root}/assignments/${start.id}/replace`,charlie.token,{})]);
      assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
      const first=await responses.find(r=>r.status===200).json();
      const second=await request('POST',`${root}/assignments/${first.replacementAssignmentId}/replace`,charlie.token,{});assert.equal(second.outcome,'REPLACED');
      const exhausted=await request('POST',`${root}/assignments/${second.replacementAssignmentId}/replace`,charlie.token,{});
      assert.equal(exhausted.outcome,'NO_REPLACEMENT');assert.equal(exhausted.participationPercentage,null);
      assert.equal((await credits(charlie)).length,0);assert.equal((await open(charlie)).length,0);
      const targets=await db.query('SELECT t."membershipId" FROM "Assignment" a JOIN "TeamMember" r ON r.id=a."respondentTeamMemberId" JOIN "TeamMember" t ON t.id=a."subjectTeamMemberId" WHERE a."orgId"=$1 AND r."membershipId"=$2',[organization.id,charlie.id]);
      assert.equal(targets.rowCount,3);assert.equal(new Set(targets.rows.map(r=>r.membershipId)).size,3);
      const rerun=await request('POST',`${root}/surveys/generate-periodic`,owner,{questionVersionIds:questionIds});assert.equal(rerun.createdAssignments,0);
    });
    await t.test('a simultaneous skip and completion yields a single consistent credit',async()=>{
      const id=originals[3].id;
      const results=await Promise.all([raw('POST',`${root}/assignments/${id}/skip`,dana.token,{}),raw('POST',`${root}/assignments/${id}/submit`,dana.token,answer)]);
      assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
      const ledger=await credits(dana);assert.equal(ledger.length,1);
      const assignment=(await db.query('SELECT status FROM "Assignment" WHERE id=$1',[id])).rows[0];
      assert.equal(ledger[0].percentage,assignment.status==='COMPLETED'?100:60);assert.equal(ledger[0].outcome,assignment.status);
      await assert.rejects(db.query('UPDATE "ParticipationCredit" SET percentage=100 WHERE "assignmentId"=$1',[id]),e=>e.code==='23514');
      await assert.rejects(db.query('INSERT INTO "ParticipationCredit" (id,"orgId","membershipId","assignmentId","rootAssignmentId",outcome,percentage) SELECT $1,"orgId","membershipId","assignmentId","rootAssignmentId",outcome,percentage FROM "ParticipationCredit" WHERE "assignmentId"=$2',[randomUUID(),id]),e=>e.code==='23505');
    });
    // Existing identities join isolated fixture companies without extra login/invite traffic.
    async function company(label,cap){
      const {organization:org}=await request('POST','/organizations',owner,{name:label},201);
      const r=`/organizations/${org.id}`;
      const members=[];
      for(const p of people){const id=randomUUID();await db.query('INSERT INTO "Membership" (id,"orgId","userId") SELECT $1,$2,"userId" FROM "Membership" WHERE id=$3',[id,org.id,p.id]);members.push({...p,id});}
      if(cap===2)await request('PATCH',`${r}/feedback-policy`,owner,{periodDays:7,colleaguesPerPeriod:2});
      const question=await approvedQuestion(request,r,owner,{questionKey:'experience',text:'How was working together?'},password);
      const questionIds=await fiveQuestions(request,r,owner,[question]);
      return {org,r,members,question,questionIds};
    }
    await t.test('cross-team replacements preserve their slot and same-cycle generation never tops up',async()=>{
      const c=await company('Cross-team replacement',2);const [a,b,x,y]=c.members;
      const first=await request('POST',`${c.r}/teams`,owner,{name:'PLC'},201);
      for(const p of [a,b])await request('POST',`${c.r}/teams/${first.id}/members`,owner,{membershipId:p.id},201);
      await request('POST',`${c.r}/surveys/generate-periodic`,owner,{questionVersionIds:c.questionIds});
      const previous=(await open(a,c.r))[0];assert.equal(previous.subject.membershipId,b.id);
      const other=await request('POST',`${c.r}/teams`,owner,{name:'Robot'},201);
      for(const p of [a,x,y])await request('POST',`${c.r}/teams/${other.id}/members`,owner,{membershipId:p.id},201);
      const replaced=await request('POST',`${c.r}/assignments/${previous.id}/replace`,a.token,{});
      const detail=await request('GET',`${c.r}/assignments/${replaced.replacementAssignmentId}`,a.token);assert.equal(detail.team.id,other.id);assert.equal(detail.closesAt,previous.closesAt);
      await request('POST',`${c.r}/surveys/generate-periodic`,owner,{questionVersionIds:c.questionIds});
      const current=await open(a,c.r);assert.equal(current.length,1);assert.equal(new Set(current.map(p=>p.subject.membershipId)).size,1);
      assert.ok(current.every(p=>p.subject.membershipId!==b.id));
      const roots=await db.query('SELECT count(*)::int n FROM "Assignment" z JOIN "TeamMember" tm ON tm.id=z."respondentTeamMemberId" WHERE z."orgId"=$1 AND tm."membershipId"=$2 AND z."replacesAssignmentId" IS NULL',[c.org.id,a.id]);assert.equal(roots.rows[0].n,1);
    });
    await t.test('a two-colleague cycle cannot recycle an already assigned colleague',async()=>{
      const c=await company('No spare colleagues',2);const selected=c.members.slice(0,3);
      const team=await request('POST',`${c.r}/teams`,owner,{name:'Small team'},201);
      for(const p of selected)await request('POST',`${c.r}/teams/${team.id}/members`,owner,{membershipId:p.id},201);
      await request('POST',`${c.r}/surveys/generate-periodic`,owner,{questionVersionIds:c.questionIds});
      const assignments=await open(selected[0],c.r);assert.equal(assignments.length,2);
      const result=await request('POST',`${c.r}/assignments/${assignments[0].id}/replace`,selected[0].token,{});assert.equal(result.outcome,'NO_REPLACEMENT');
      assert.equal((await open(selected[0],c.r)).length,1);assert.equal((await credits(selected[0],c.r)).length,0);
    });
    await t.test('milestone replacements stay in the selected project group after the team ends',async()=>{
      const milestone=await request('POST',`${root}/teams/${team.id}/surveys/milestone`,owner,{questionVersionIds:questionIds,participantMembershipIds:[alice.id,bob.id,charlie.id],closesAt:new Date(Date.now()+86400000).toISOString()},201);
      await db.query('UPDATE "Team" SET "endsAt"=now() WHERE id=$1',[team.id]);
      const assignments=await open(alice);
      let previous;
      for(const candidate of assignments){const row=await request('GET',`${root}/assignments/${candidate.id}`,alice.token);if(row.type==='MILESTONE'){previous=row;break;}}
      assert.ok(previous);
      const replaced=await request('POST',`${root}/assignments/${previous.id}/replace`,alice.token,{});
      assert.equal(replaced.outcome,'REPLACED');
      const next=await request('GET',`${root}/assignments/${replaced.replacementAssignmentId}`,alice.token);
      assert.ok([bob.id,charlie.id].includes(next.subject.membershipId));assert.notEqual(next.subject.membershipId,previous.subject.membershipId);assert.equal(next.closesAt,milestone.closesAt);
      const skip=await request('POST',`${root}/assignments/${next.id}/skip`,alice.token,{});assert.equal(skip.participationPercentage,60);
      const count=await db.query('SELECT count(*)::int n FROM "Answer" a JOIN "Assignment" z ON z.id=a."assignmentId" WHERE z."surveyId"=$1',[milestone.id]);assert.equal(count.rows[0].n,0);
    });
    await t.test('closed deadlines and inactive memberships cannot earn credit or request replacements',async()=>{
      const source=(await db.query('SELECT * FROM "Assignment" WHERE id=$1',[originals[1].id])).rows[0];
      const survey=randomUUID(),assignment=randomUUID();
      await db.query('INSERT INTO "Survey" (id,"orgId","teamId",kind,"opensAt","closesAt") VALUES ($1,$2,$3,\'MILESTONE\',now()-interval \'2 days\',now()-interval \'1 day\')',[survey,organization.id,source.teamId]);
      await db.query('INSERT INTO "SurveyQuestion" (id,"orgId","surveyId","questionVersionId",position) VALUES ($1,$2,$3,$4,1)',[randomUUID(),organization.id,survey,q.id]);
      await db.query('INSERT INTO "Assignment" (id,"orgId","teamId","surveyId","respondentTeamMemberId","subjectTeamMemberId") VALUES ($1,$2,$3,$4,$5,$6)',[assignment,organization.id,source.teamId,survey,source.respondentTeamMemberId,source.subjectTeamMemberId]);
      for(const action of ['skip','replace'])await request('POST',`${root}/assignments/${assignment}/${action}`,bob.token,{},409);
      await db.query('UPDATE "Membership" SET active=false WHERE id=$1',[bob.id]);
      await request('GET',`${root}/participation/my`,bob.token,undefined,404);
      await request('POST',`${root}/assignments/${assignment}/skip`,bob.token,{},404);
      const counts=await db.query('SELECT (SELECT count(*) FROM "PairInsight")::int pairs,(SELECT count(*) FROM "SkillInsight")::int skills');assert.equal(counts.rows[0].pairs,0);assert.equal(counts.rows[0].skills,0);
    });
  } finally {
    if(app)await app.close();if(db)await db.end();process.env.DATABASE_URL=original;
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);await admin.end();
  }
});
