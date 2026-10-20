import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {Database} from '../dist/src/database.js';
import {Clock} from '../dist/src/clock.js';
import {WorkspaceService} from '../dist/src/workspace.js';
import {InsightService} from '../dist/src/insights.js';
import {SurveyService} from '../dist/src/surveys.js';
import {QuestionService} from '../dist/src/questions.js';
import {STANDARD_QUESTIONS} from '../dist/src/standard-questions.js';

test('chemistry and five-question upgrades preserve history, imports and pending legacy surveys',async()=>{
  const original=process.env.DATABASE_URL;
  const adminURL=new URL(original);adminURL.pathname='/postgres';
  const admin=new pg.Client({connectionString:adminURL.toString()});await admin.connect();
  const name=`flowchemia_chemistry_upgrade_${randomUUID().replaceAll('-','')}`;
  const url=new URL(original);url.pathname=`/${name}`;
  let db,client;
  try{
    await admin.query(`CREATE DATABASE "${name}"`);process.env.DATABASE_URL=url.toString();
    db=new pg.Client({connectionString:url.toString()});await db.connect();
    for(const migration of ['202610160001_initial','202610160002_auth','202610170003_surveys','202610170004_participation','202610170005_calendar_schedule','202610170006_question_approval'])await db.query(await readFile(new URL(`../prisma/migrations/${migration}/migration.sql`,import.meta.url),'utf8'));
    async function insert(table,fields){const values={id:randomUUID(),...fields};await db.query(`INSERT INTO "${table}" (${Object.keys(values).map(k=>`"${k}"`).join(',')}) VALUES (${Object.keys(values).map((_,i)=>`$${i+1}`).join(',')})`,Object.values(values));return values.id;}
    const orgId=await insert('Organization',{name:'Previously imported company'});
    const userId=await insert('User',{email:'hr@example.test',displayName:'HR'});
    const reviewerId=await insert('Membership',{orgId,userId,role:'HR_ADMIN'});
    const before=[];const skills=new Map();
    for(const template of STANDARD_QUESTIONS.filter(q=>q.dimension==='SKILL')){
      let skillId=skills.get(template.skillName);
      if(!skillId){skillId=await insert('Skill',{orgId,name:template.skillName});skills.set(template.skillName,skillId);}
      const id=await insert('QuestionVersion',{orgId,questionKey:template.questionKey,version:1,text:template.text,standardTemplateKey:template.templateKey,createdByMembershipId:reviewerId});
      await insert('QuestionSkill',{orgId,questionVersionId:id,skillId,weight:1});
      await db.query('UPDATE "QuestionVersion" SET "approvalStatus"=\'APPROVED\',"approvalOrigin"=\'STANDARD\',"reviewedByMembershipId"=$1,"reviewedAt"=\'2026-10-17T12:00:00Z\' WHERE id=$2',[reviewerId,id]);
      before.push((await db.query('SELECT * FROM "QuestionVersion" WHERE id=$1',[id])).rows[0]);
    }
    const unclassified=await insert('QuestionVersion',{orgId,questionKey:'old-unmapped',version:1,text:'Previous unmapped question'});
    const teamId=await insert('Team',{orgId,name:'Previous PLC project',startsAt:new Date('2026-01-01')});const members=[];
    for(const label of ['alice','bob']){
      const person=await insert('User',{email:`${label}@example.test`,displayName:label});
      const membershipId=await insert('Membership',{orgId,userId:person});
      members.push(await insert('TeamMember',{orgId,teamId,membershipId,joinedAt:new Date('2026-01-01')}));
    }
    const surveyId=await insert('Survey',{orgId,teamId,kind:'PERIODIC',opensAt:new Date('2026-10-01')});
    const questionVersionId=before[0].id;
    await insert('SurveyQuestion',{orgId,surveyId,questionVersionId,position:1});
    const assignmentId=await insert('Assignment',{orgId,teamId,surveyId,respondentTeamMemberId:members[0],subjectTeamMemberId:members[1]});
    await insert('Answer',{orgId,surveyId,assignmentId,questionVersionId,rating:4});
    await db.query('UPDATE "Assignment" SET "submittedAt"=\'2026-10-02T12:00:00Z\' WHERE id=$1',[assignmentId]);
    await db.query(await readFile(new URL('../prisma/migrations/202610180007_chemistry_questions/migration.sql',import.meta.url),'utf8'));
    for(const expected of before){const {dimension,...actual}=(await db.query('SELECT * FROM "QuestionVersion" WHERE id=$1',[expected.id])).rows[0];assert.equal(dimension,'SKILL');assert.deepEqual(actual,expected);}
    assert.equal((await db.query('SELECT dimension FROM "QuestionVersion" WHERE id=$1',[unclassified])).rows[0].dimension,'UNSPECIFIED');
    assert.equal((await db.query('SELECT rating FROM "Answer" WHERE "assignmentId"=$1',[assignmentId])).rows[0].rating,4);
    await db.query(await readFile(new URL('../prisma/migrations/20261020120000_employee_profiles/migration.sql',import.meta.url),'utf8'));
    client=new Database();const library=new QuestionService(client,new WorkspaceService(client),new Clock());
    const imported=await library.importStandard(userId,orgId);assert.equal(imported.createdQuestions,6);assert.equal(imported.questions.length,21);
    assert.equal((await library.importStandard(userId,orgId)).createdQuestions,0);
    assert.equal((await db.query('SELECT count(*)::int n FROM "Skill" WHERE "orgId"=$1',[orgId])).rows[0].n,5);
    for(const originalQuestion of before)assert.ok(imported.questions.some(q=>q.id===originalQuestion.id));
    const chemistry=(await db.query('SELECT q.dimension,count(w.id)::int mappings FROM "QuestionVersion" q LEFT JOIN "QuestionSkill" w ON w."questionVersionId"=q.id WHERE q.dimension IN (\'CHEMISTRY_ENJOYMENT\',\'CHEMISTRY_EFFECTIVENESS\') GROUP BY q.id')).rows;
    assert.equal(chemistry.length,6);assert.ok(chemistry.every(q=>q.mappings===0));
    await assert.rejects(db.query('UPDATE "QuestionVersion" SET dimension=\'CHEMISTRY_EFFECTIVENESS\' WHERE id=$1',[questionVersionId]),e=>e.code==='23514');
    const legacyIds=before.slice(0,2).map(q=>q.id);
    const policyId=await insert('FeedbackPolicy',{orgId,effectiveFrom:new Date('2000-01-01'),automaticEnabled:true,automaticStartsAt:new Date('2026-10-01'),questionVersionIds:legacyIds});
    const generationId=await insert('SurveyGeneration',{orgId,policyId,scheduledFor:new Date('2026-10-01'),questionVersionIds:legacyIds});
    const pendingId=await insert('Assignment',{orgId,teamId,surveyId,respondentTeamMemberId:members[1],subjectTeamMemberId:members[0]});
    await db.query(await readFile(new URL('../prisma/migrations/202610180008_five_question_surveys/migration.sql',import.meta.url),'utf8'));
    await db.query(await readFile(new URL('../prisma/migrations/202610190009_adaptive_questions/migration.sql',import.meta.url),'utf8'));
    assert.equal((await db.query('SELECT "questionSelection" FROM "Survey" WHERE id=$1',[surveyId])).rows[0].questionSelection,'MANUAL');
    assert.deepEqual((await db.query('SELECT "questionVersionIds" FROM "Assignment" WHERE id=$1',[pendingId])).rows[0].questionVersionIds,[]);
    const policy=(await db.query('SELECT * FROM "FeedbackPolicy" WHERE id=$1',[policyId])).rows[0];
    assert.equal(policy.automaticEnabled,false);assert.equal(policy.automaticStartsAt,null);assert.deepEqual(policy.questionVersionIds,legacyIds);
    assert.deepEqual((await db.query('SELECT "questionVersionIds" FROM "SurveyGeneration" WHERE id=$1',[generationId])).rows[0].questionVersionIds,legacyIds);
    await db.query(await readFile(new URL('../prisma/migrations/20261020090000_insight_details/migration.sql',import.meta.url),'utf8'));
    await db.query(await readFile(new URL('../prisma/migrations/20261020100000_company_test_mode/migration.sql',import.meta.url),'utf8'));
    const workspace=new WorkspaceService(client), clock=new Clock();
    const surveys=new SurveyService(client,workspace,clock,new InsightService(client,workspace,clock));
    assert.equal((await surveys.schedule(userId,orgId)).requiresQuestionSetUpdate,true);
    await assert.rejects(surveys.setSchedule(userId,orgId,{automaticEnabled:true}),e=>e.getStatus?.()===400);
    await assert.rejects(db.query('UPDATE "FeedbackPolicy" SET "automaticEnabled"=true,"automaticStartsAt"=now() WHERE id=$1',[policyId]),e=>e.code==='23514');
    const respondent=(await db.query('SELECT m."userId" FROM "TeamMember" t JOIN "Membership" m ON m.id=t."membershipId" WHERE t.id=$1',[members[1]])).rows[0].userId;
    const detail=await surveys.detail(respondent,orgId,pendingId);assert.equal(detail.questions.length,1);assert.equal(detail.surveyFormat.questionCount,1);
    assert.equal((await surveys.submit(respondent,orgId,pendingId,[{questionVersionId,rating:null}])).participationPercentage,100);
    assert.equal((await db.query('SELECT rating FROM "Answer" WHERE "assignmentId"=$1',[pendingId])).rows[0].rating,null);
    assert.equal((await db.query('SELECT rating FROM "Answer" WHERE "assignmentId"=$1',[assignmentId])).rows[0].rating,4);
    const selected=[...before.slice(0,3).map(q=>q.id), ...['enjoyment','effectiveness'].map(d=>imported.questions.find(q=>q.templateKey===`standard-v2:chemistry-${d}:1`).id)];
    const updated=await surveys.setSchedule(userId,orgId,{questionVersionIds:selected,automaticEnabled:true});
    assert.equal(updated.automaticEnabled,true);assert.equal(updated.questionVersionIds.length,5);
    assert.equal((await surveys.schedule(userId,orgId)).requiresQuestionSetUpdate,false);
  }finally{if(client)await client.$disconnect();if(db)await db.end();process.env.DATABASE_URL=original;await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);await admin.end();}
});
