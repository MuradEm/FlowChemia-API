import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';

test('calendar upgrade preserves issued feedback and archives former periodic deadlines',async()=>{
  const adminURL=new URL(process.env.DATABASE_URL);adminURL.pathname='/postgres';
  const admin=new pg.Client({connectionString:adminURL.toString()});await admin.connect();
  const name=`flowchemia_schedule_upgrade_${randomUUID().replaceAll('-','')}`;
  const url=new URL(process.env.DATABASE_URL);url.pathname=`/${name}`;let db;
  try{
    await admin.query(`CREATE DATABASE "${name}"`);db=new pg.Client({connectionString:url.toString()});await db.connect();
    const migrations=['202610160001_initial','202610160002_auth','202610170003_surveys','202610170004_participation'];
    for(const migration of migrations)await db.query(await readFile(new URL(`../prisma/migrations/${migration}/migration.sql`,import.meta.url),'utf8'));
    async function insert(table,fields){const values={id:randomUUID(),...fields};await db.query(`INSERT INTO "${table}" (${Object.keys(values).map(k=>`"${k}"`).join(',')}) VALUES (${Object.keys(values).map((_,i)=>`$${i+1}`).join(',')})`,Object.values(values));return values.id;}
    const orgId=await insert('Organization',{name:'Existing automation company'});
    const teamId=await insert('Team',{orgId,name:'Original team',startsAt:new Date('2026-01-01')});const members=[];
    for(const label of ['alice','bob']){const userId=await insert('User',{email:`${label}@example.test`,displayName:label});const membershipId=await insert('Membership',{orgId,userId});members.push(await insert('TeamMember',{orgId,teamId,membershipId,joinedAt:new Date('2026-01-01')}));}
    const questionVersionId=await insert('QuestionVersion',{orgId,questionKey:'original',version:1,text:'Original immutable question'});
    const deadline=new Date('2026-02-01T00:00:00Z');const surveyId=await insert('Survey',{orgId,teamId,kind:'PERIODIC',opensAt:new Date('2026-01-25'),closesAt:deadline});
    await insert('SurveyQuestion',{orgId,surveyId,questionVersionId,position:1});
    const completed=await insert('Assignment',{orgId,teamId,surveyId,respondentTeamMemberId:members[0],subjectTeamMemberId:members[1]});
    const pending=await insert('Assignment',{orgId,teamId,surveyId,respondentTeamMemberId:members[1],subjectTeamMemberId:members[0]});
    await insert('Answer',{orgId,surveyId,assignmentId:completed,questionVersionId,rating:4});
    const submittedAt=new Date('2026-01-26T10:00:00Z');await db.query('UPDATE "Assignment" SET "submittedAt"=$1 WHERE id=$2',[submittedAt,completed]);
    const policy=await insert('FeedbackPolicy',{orgId,effectiveFrom:new Date('2026-01-01'),periodDays:14,colleaguesPerPeriod:2});
    await db.query(await readFile(new URL('../prisma/migrations/202610170005_calendar_schedule/migration.sql',import.meta.url),'utf8'));
    const s=(await db.query('SELECT "closesAt","legacyClosesAt" FROM "Survey" WHERE id=$1',[surveyId])).rows[0];assert.equal(s.closesAt,null);assert.equal(s.legacyClosesAt.toISOString(),deadline.toISOString());
    const rows=(await db.query('SELECT id,status,"submittedAt" FROM "Assignment" WHERE id IN ($1,$2)',[completed,pending])).rows;
    assert.equal(rows.find(r=>r.id===completed).status,'COMPLETED');assert.equal(rows.find(r=>r.id===completed).submittedAt.toISOString(),submittedAt.toISOString());assert.equal(rows.find(r=>r.id===pending).status,'OPEN');
    assert.equal((await db.query('SELECT rating FROM "Answer" WHERE "assignmentId"=$1',[completed])).rows[0].rating,4);
    assert.equal((await db.query('SELECT text FROM "QuestionVersion" WHERE id=$1',[questionVersionId])).rows[0].text,'Original immutable question');
    const p=(await db.query('SELECT frequency,"automaticEnabled","questionVersionIds" FROM "FeedbackPolicy" WHERE id=$1',[policy])).rows[0];assert.equal(p.frequency,'FORTNIGHTLY');assert.equal(p.automaticEnabled,false);assert.deepEqual(p.questionVersionIds,[]);
    assert.equal((await db.query('SELECT count(*)::int n FROM "ParticipationCredit"')).rows[0].n,0);
    await assert.rejects(db.query('UPDATE "Survey" SET "closesAt"=$1 WHERE id=$2',[deadline,surveyId]),e=>e.code==='23514');
    await db.query(await readFile(new URL('../prisma/migrations/202610170006_question_approval/migration.sql',import.meta.url),'utf8'));
    const question=(await db.query('SELECT text,"approvalStatus","approvalOrigin","reviewedByMembershipId","reviewedAt" FROM "QuestionVersion" WHERE id=$1',[questionVersionId])).rows[0];
    assert.equal(question.text,'Original immutable question');assert.equal(question.approvalStatus,'APPROVED');assert.equal(question.approvalOrigin,'LEGACY');assert.equal(question.reviewedByMembershipId,null);assert.equal(question.reviewedAt,null);
    assert.equal((await db.query('SELECT rating FROM "Answer" WHERE "assignmentId"=$1',[completed])).rows[0].rating,4);
    await insert('Answer',{orgId,surveyId,assignmentId:pending,questionVersionId,rating:null});
    await db.query('UPDATE "Assignment" SET "submittedAt"=now() WHERE id=$1',[pending]);
    assert.equal((await db.query('SELECT rating FROM "Answer" WHERE "assignmentId"=$1',[pending])).rows[0].rating,null);
    assert.equal((await db.query('SELECT count(*)::int n FROM "ParticipationCredit"')).rows[0].n,0);
    await assert.rejects(db.query('UPDATE "Answer" SET rating=1 WHERE "assignmentId"=$1',[pending]),e=>e.code==='23514');

  }finally{if(db)await db.end();await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);await admin.end();}
});
