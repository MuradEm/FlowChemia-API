import {approvedQuestion, fiveQuestions, ratingAnswers} from './helpers/questions.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import pg from 'pg';
import {createApp} from '../dist/src/app.js';

test('private survey workflow across overlapping teams', async t => {
  const original=process.env.DATABASE_URL;
  assert.ok(original);
  const adminURL=new URL(original);adminURL.pathname='/postgres';
  const admin=new pg.Client({connectionString:adminURL.toString()});await admin.connect();
  const name=`flowchemia_survey_test_${randomUUID().replaceAll('-','')}`;
  const testURL=new URL(original);testURL.pathname=`/${name}`;
  let app,db;
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    process.env.DATABASE_URL=testURL.toString();
    function command(args,input) {
      const result=spawnSync(process.execPath,args,{env:process.env,input,encoding:'utf8'});
      assert.equal(result.status,0,result.stderr);
    }
    command(['node_modules/prisma/build/index.js','migrate','deploy']);
    const password='fictional-survey-password-2026';
    command(['dist/scripts/bootstrap.js'],JSON.stringify({email:'owner@example.test',displayName:'Owner',password}));
    db=new pg.Client({connectionString:testURL.toString()});await db.connect();
    app=await createApp(false);await app.listen(0,'127.0.0.1');
    const base=await app.getUrl();
    async function request(method,path,token,value,expected=200) {
      const response=await fetch(base+path,{method,headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(value!==undefined?{'Content-Type':'application/json'}:{})},body:value===undefined?undefined:JSON.stringify(value)});
      const json=await response.json();
      assert.equal(response.status,expected,`${method} ${path}: ${JSON.stringify(json)}`);
      return json;
    }
    const login=async email=>(await request('POST','/auth/login',null,{email,password})).token;
    const owner=await login('owner@example.test');
    const {organization:org}=await request('POST','/organizations',owner,{name:'Fictional Automation'},201);
    const root=`/organizations/${org.id}`;
    const people=[];
    for(const name of ['Alice','Bob','Charlie']) {
      const invitation=await request('POST',`${root}/invitations`,owner,{email:`${name.toLowerCase()}@example.test`},201);
      const accepted=await request('POST','/invitations/accept',null,{token:invitation.token,displayName:name,password},201);
      people.push({id:accepted.membership.id,token:await login(`${name.toLowerCase()}@example.test`)});
    }
    const [alice,bob,charlie]=people;
    const plc=await request('POST',`${root}/teams`,owner,{name:'PLC'},201);
    const robot=await request('POST',`${root}/teams`,owner,{name:'Robot'},201);
    for(const team of [plc,robot]) for(const person of people) await request('POST',`${root}/teams/${team.id}/members`,owner,{membershipId:person.id},201);
    const skill=await request('POST',`${root}/skills`,owner,{name:'Communication'},201);
    const question=await approvedQuestion(request,root,owner,{questionKey:'collaboration',text:'How was working together?',skillWeights:[{skillId:skill.id,weight:1}]},password);
    const second=await approvedQuestion(request,root,owner,{questionKey:'communication',text:'How clear was communication?'},password);
    const questions={questionVersionIds:await fiveQuestions(request,root,owner,[question,second])};
    let aliceAssignments;
    await t.test('question versions and skill mappings validate company scope',async()=>{
      await request('POST',`${root}/skills`,alice.token,{name:'Unauthorized'},403);
      await request('POST',`${root}/questions`,owner,{questionKey:'bad',text:'Bad',skillWeights:[{skillId:skill.id,weight:0.5}]},400);
      await request('POST',`${root}/questions`,owner,{questionKey:'bad',text:'Bad',skillWeights:[{skillId:randomUUID(),weight:1}]},400);
      const changed=await approvedQuestion(request,root,owner,{questionKey:'collaboration',text:'Revised question'},password);
      assert.equal(changed.version,2);
      const listed=await request('GET',`${root}/questions`,owner);
      assert.equal(listed.find(q=>q.id===question.id).text,'How was working together?');
      const outsider=await request('POST','/organizations',owner,{name:'Other Company'},201);
      const otherRoot=`/organizations/${outsider.organization.id}`;
      await request('GET',`${otherRoot}/questions`,alice.token,undefined,404);
      await request('POST',`${otherRoot}/questions`,owner,{questionKey:'bad',text:'Bad',skillWeights:[{skillId:skill.id,weight:1}]},400);
      await request('POST',`${otherRoot}/surveys/generate-periodic`,owner,questions,400);
    });
    await t.test('default schedule creates one distinct colleague per employee across both teams',async()=>{
      const policy=await request('GET',`${root}/feedback-policy`,alice.token);
      assert.equal(policy.policy.periodDays,7);assert.equal(policy.policy.colleaguesPerPeriod,1);
      await request('PATCH',`${root}/feedback-policy`,alice.token,{periodDays:14,colleaguesPerPeriod:2},403);
      await request('PATCH',`${root}/feedback-policy`,owner,{periodDays:0,colleaguesPerPeriod:3},400);
      const generated=await request('POST',`${root}/surveys/generate-periodic`,owner,questions);
      assert.equal(generated.createdAssignments,3);
      for(const person of people) assert.equal((await request('GET',`${root}/assignments/my-open`,person.token)).length,1);
      aliceAssignments=await request('GET',`${root}/assignments/my-open`,alice.token);
      assert.notEqual(aliceAssignments[0].subject.membershipId,alice.id);
      const concurrent=await Promise.all([request('POST',`${root}/surveys/generate-periodic`,owner,questions),request('POST',`${root}/surveys/generate-periodic`,owner,questions)]);
      assert.equal(concurrent.reduce((sum,r)=>sum+r.createdAssignments,0),0);
      await request('POST',`${root}/surveys/generate-periodic`,owner,{questionVersionIds:[...questions.questionVersionIds].reverse()},409);
    });
    await t.test('schedule changes wait for next cycle and managers cannot read raw assignments',async()=>{
      const changed=await request('PATCH',`${root}/feedback-policy`,owner,{periodDays:14,colleaguesPerPeriod:2});
      assert.ok(new Date(changed.effectiveFrom)>new Date());
      const policy=await request('GET',`${root}/feedback-policy`,owner);
      assert.equal(policy.policy.colleaguesPerPeriod,1);
      assert.equal(policy.pending.periodDays,14);assert.equal(policy.pending.colleaguesPerPeriod,2);
      const assignment=aliceAssignments[0];
      await request('GET',`${root}/assignments/${assignment.id}`,owner,undefined,404);
      await request('GET',`${root}/assignments/${assignment.id}`,bob.token,undefined,404);
      await request('POST',`${root}/assignments/${assignment.id}/submit`,bob.token,{answers:[{questionVersionId:question.id,rating:4}]},404);
      const details=await request('GET',`${root}/assignments/${assignment.id}`,alice.token);
      assert.equal(details.questions[0].text,'How was working together?');
      assert.ok(!JSON.stringify(details).includes('respondentTeamMemberId'));
    });
    await t.test('invalid submissions write nothing and concurrent submission succeeds exactly once',async()=>{
      const assignment=aliceAssignments[0];
      const path=`${root}/assignments/${assignment.id}/submit`;
      await request('POST',path,alice.token,{answers:[{questionVersionId:question.id,rating:6}]},400);
      await request('POST',path,alice.token,{answers:[{questionVersionId:question.id,rating:2}]},400);
      await request('POST',path,alice.token,{answers:[{questionVersionId:question.id,rating:2},{questionVersionId:question.id,rating:3}]},400);
      await request('POST',path,alice.token,{answers:[{questionVersionId:question.id,rating:2},{questionVersionId:randomUUID(),rating:3}]},400);
      const before=await db.query('SELECT count(*)::int n FROM "Answer" WHERE "assignmentId"=$1',[assignment.id]);assert.equal(before.rows[0].n,0);
      const answers=ratingAnswers(questions.questionVersionIds);
      const results=await Promise.all([fetch(base+path,{method:'POST',headers:{Authorization:`Bearer ${alice.token}`,'Content-Type':'application/json'},body:JSON.stringify(answers)}),fetch(base+path,{method:'POST',headers:{Authorization:`Bearer ${alice.token}`,'Content-Type':'application/json'},body:JSON.stringify(answers)})]);
      assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
      const after=await db.query('SELECT count(*)::int n FROM "Answer" WHERE "assignmentId"=$1',[assignment.id]);assert.equal(after.rows[0].n,5);
      assert.equal((await request('GET',`${root}/assignments/my-open`,alice.token)).length,0);
      const details=await request('GET',`${root}/assignments/${assignment.id}`,alice.token);
      assert.ok(details.submittedAt);assert.ok(!('answers' in details));
    });
    await t.test('historical question maps, survey composition and context cannot be rewritten',async()=>{
      const survey=(await db.query('SELECT "surveyId" FROM "Assignment" WHERE id=$1',[aliceAssignments[0].id])).rows[0].surveyId;
      await assert.rejects(db.query('UPDATE "QuestionVersion" SET text=$1 WHERE id=$2',['Changed',question.id]),e=>e.code==='23514');
      await assert.rejects(db.query('UPDATE "QuestionSkill" SET weight=0.5 WHERE "questionVersionId"=$1',[question.id]),e=>e.code==='23514');
      await assert.rejects(db.query('DELETE FROM "SurveyQuestion" WHERE "surveyId"=$1',[survey]),e=>e.code==='23514');
      await assert.rejects(db.query('UPDATE "Survey" SET "closesAt"=now()+interval \'1 day\' WHERE id=$1',[survey]),e=>e.code==='23514');
    });
    await t.test('a new company can choose a two-colleague, fourteen-day cycle',async()=>{
      const {organization:other}=await request('POST','/organizations',owner,{name:'Configurable Company'},201);
      const otherRoot=`/organizations/${other.id}`;
      const otherMembers=[];
      for(const person of people) {
        const id=randomUUID();
        await db.query('INSERT INTO "Membership" (id,"orgId","userId") SELECT $1,$2,"userId" FROM "Membership" WHERE id=$3',[id,other.id,person.id]);
        otherMembers.push(id);
      }
      const team=await request('POST',`${otherRoot}/teams`,owner,{name:'Combined'},201);
      for(const id of otherMembers)await request('POST',`${otherRoot}/teams/${team.id}/members`,owner,{membershipId:id},201);
      await request('PATCH',`${otherRoot}/feedback-policy`,owner,{periodDays:14,colleaguesPerPeriod:2});
      const q=await approvedQuestion(request,otherRoot,owner,{questionKey:'experience',text:'How was collaborating?'},password);
      const otherIds=await fiveQuestions(request,otherRoot,owner,[q]);
      const results=await Promise.all([request('POST',`${otherRoot}/surveys/generate-periodic`,owner,{questionVersionIds:otherIds}),request('POST',`${otherRoot}/surveys/generate-periodic`,owner,{questionVersionIds:otherIds})]);
      assert.equal(results.reduce((sum,r)=>sum+r.createdAssignments,0),6);
      assert.equal(new Date(results[0].periodEnd)-new Date(results[0].periodStart),14*86400000);
      for(const person of people)assert.equal((await request('GET',`${otherRoot}/assignments/my-open`,person.token)).length,2);
      await request('POST',`${otherRoot}/surveys/generate-periodic`,alice.token,{questionVersionIds:otherIds},403);
      const empty=await request('POST',`${otherRoot}/teams`,owner,{name:'Empty'},201);
      await request('POST',`${otherRoot}/teams/${empty.id}/surveys/milestone`,owner,{questionVersionIds:otherIds,participantMembershipIds:otherMembers,closesAt:new Date(Date.now()+86400000).toISOString()},400);
    });
    await t.test('milestones use scoped overlapping participants and capped colleague assignments',async()=>{
      const payload={questionVersionIds:questions.questionVersionIds,participantMembershipIds:people.map(p=>p.id),closesAt:new Date(Date.now()+86400000).toISOString()};
      await request('POST',`${root}/teams/${plc.id}/surveys/milestone`,alice.token,payload,403);
      await request('POST',`${root}/teams/${plc.id}/surveys/milestone`,owner,{...payload,participantMembershipIds:[alice.id,randomUUID()]},400);
      await request('POST',`${root}/teams/${plc.id}/surveys/milestone`,owner,{...payload,closesAt:'2020-01-01T00:00:00Z'},400);
      await request('POST',`${root}/teams/${plc.id}/access`,owner,{membershipId:charlie.id,role:'MANAGER'},201);
      const milestone=await request('POST',`${root}/teams/${plc.id}/surveys/milestone`,charlie.token,payload,201);
      assert.equal(milestone.createdAssignments,3);
      await db.query('UPDATE "Team" SET "endsAt"=now() WHERE id=$1',[plc.id]);
      const ended=await request('POST',`${root}/teams/${plc.id}/surveys/milestone`,owner,payload,201);
      assert.equal(ended.createdAssignments,3);
      const open=await request('GET',`${root}/assignments/my-open`,alice.token);
      const detail=await Promise.all(open.map(a=>request('GET',`${root}/assignments/${a.id}`,alice.token)));
      const target=detail.find(a=>a.type==='MILESTONE');assert.ok(target);
      await request('POST',`${root}/assignments/${target.id}/submit`,alice.token,ratingAnswers(questions.questionVersionIds,5));
    });
    await t.test('expired milestones reject submissions and retained periodic work survives team departure',async()=>{
      const source=(await db.query('SELECT * FROM "Assignment" WHERE "orgId"=$1 AND "respondentTeamMemberId" IN (SELECT id FROM "TeamMember" WHERE "membershipId"=$2) LIMIT 1',[org.id,bob.id])).rows[0];
      const survey=randomUUID(),assignment=randomUUID();
      await db.query('INSERT INTO "Survey" (id,"orgId","teamId",kind,"opensAt","closesAt") VALUES ($1,$2,$3,\'MILESTONE\',now()-interval \'2 days\',now()-interval \'1 day\')',[survey,org.id,source.teamId]);
      await db.query('INSERT INTO "SurveyQuestion" (id,"orgId","surveyId","questionVersionId",position) VALUES ($1,$2,$3,$4,1)',[randomUUID(),org.id,survey,question.id]);
      await db.query('INSERT INTO "Assignment" (id,"orgId","teamId","surveyId","respondentTeamMemberId","subjectTeamMemberId") VALUES ($1,$2,$3,$4,$5,$6)',[assignment,org.id,source.teamId,survey,source.respondentTeamMemberId,source.subjectTeamMemberId]);
      await request('POST',`${root}/assignments/${assignment}/submit`,bob.token,{answers:[{questionVersionId:question.id,rating:3}]},409);
      await db.query('UPDATE "TeamMember" SET "leftAt"=now() WHERE "orgId"=$1 AND "membershipId"=$2 AND "leftAt" IS NULL',[org.id,bob.id]);
      const open=await request('GET',`${root}/assignments/my-open`,bob.token);
      const retained=open.find(a=>a.type==='PERIODIC');assert.ok(retained);
      const details=await request('GET',`${root}/assignments/${retained.id}`,bob.token);assert.equal(details.closesAt,null);
      await request('POST',`${root}/assignments/${retained.id}/submit`,bob.token,{answers:details.questions.map(q=>({questionVersionId:q.id,rating:3}))});
    });
  } finally {
    if(app)await app.close();if(db)await db.end();process.env.DATABASE_URL=original;
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);await admin.end();
  }
});
