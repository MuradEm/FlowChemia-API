import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

// Every test runs in a rolled-back transaction, including failed statements.
async function fixture(run) {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  await db.query('BEGIN');
  const insert = async (table, fields) => {
    const values = { id: randomUUID(), ...fields };
    await db.query(`INSERT INTO "${table}" (${Object.keys(values).map(k => `"${k}"`).join(',')}) VALUES (${Object.keys(values).map((_,i)=>`$${i+1}`).join(',')})`, Object.values(values));
    return values.id;
  };
  const reject = async (sql, values, code) => {
    await db.query('SAVEPOINT invalid_operation');
    await assert.rejects(db.query(sql, values), e => e.code === code);
    await db.query('ROLLBACK TO SAVEPOINT invalid_operation');
  };
  try {
    const orgId = await insert('Organization', {name:'Fictional Automation'});
    const teamId = await insert('Team', {orgId,name:'Commissioning',startsAt:new Date('2026-01-01')});
    const members=[]; const enrollments=[];
    for (const name of ['Alice','Bob']) {
      const userId=await insert('User',{email:`${randomUUID()}@example.test`,displayName:name});
      members.push(await insert('Membership',{orgId,userId}));
      enrollments.push(await insert('TeamMember',{orgId,teamId,membershipId:members.at(-1),joinedAt:new Date('2026-01-01')}));
    }
    const questionVersionId=await insert('QuestionVersion',{orgId,approvalStatus:'APPROVED',approvalOrigin:'LEGACY',questionKey:'collaboration',version:1,text:'How was working together?'});
    const surveyId=await insert('Survey',{orgId,teamId,kind:'WEEKLY',opensAt:new Date('2026-01-02'),closesAt:new Date('2026-01-09')});
    await insert('SurveyQuestion',{orgId,surveyId,questionVersionId,position:1});
    const assignmentId=await insert('Assignment',{orgId,teamId,surveyId,respondentTeamMemberId:enrollments[0],subjectTeamMemberId:enrollments[1]});
    await run({db,insert,reject,orgId,teamId,members,enrollments,questionVersionId,surveyId,assignmentId});
  } finally { await db.query('ROLLBACK'); await db.end(); }
}

test('feedback workflow preserves context, submits once, and protects answers',()=>fixture(async f=>{
  const answer=await f.insert('Answer',{orgId:f.orgId,surveyId:f.surveyId,assignmentId:f.assignmentId,questionVersionId:f.questionVersionId,rating:4});
  await f.db.query('UPDATE "Assignment" SET "submittedAt"=now() WHERE id=$1',[f.assignmentId]);
  const result=await f.db.query('SELECT a.rating, s."teamId", x."submittedAt" FROM "Answer" a JOIN "Assignment" x ON x.id=a."assignmentId" JOIN "Survey" s ON s.id=x."surveyId" WHERE a.id=$1',[answer]);
  assert.equal(result.rows[0].rating,4); assert.equal(result.rows[0].teamId,f.teamId); assert.ok(result.rows[0].submittedAt);
  await f.reject('UPDATE "Answer" SET rating=1 WHERE id=$1',[answer],'23514');
  await f.reject('UPDATE "Assignment" SET "submittedAt"=NULL WHERE id=$1',[f.assignmentId],'23514');
}));
test('an employee can belong to overlapping teams',()=>fixture(async f=>{
  const other=await f.insert('Team',{orgId:f.orgId,name:'Robot integration',startsAt:new Date('2026-01-01')});
  await f.insert('TeamMember',{orgId:f.orgId,teamId:other,membershipId:f.members[0],joinedAt:new Date()});
  const r=await f.db.query('SELECT count(*)::int AS n FROM "TeamMember" WHERE "membershipId"=$1',[f.members[0]]);
  assert.equal(r.rows[0].n,2);
}));
test('cross-company references are rejected',()=>fixture(async f=>{
  const other=await f.insert('Organization',{name:'Other company'});
  await f.reject('INSERT INTO "TeamMember" (id,"orgId","teamId","membershipId","joinedAt") VALUES ($1,$2,$3,$4,now())',[randomUUID(),other,f.teamId,f.members[0]],'23503');
}));
test('self feedback, invalid ratings, and incomplete submission are rejected',()=>fixture(async f=>{
  await f.reject('UPDATE "Assignment" SET "subjectTeamMemberId"="respondentTeamMemberId" WHERE id=$1',[f.assignmentId],'23514');
  await f.reject('INSERT INTO "Answer" (id,"orgId","surveyId","assignmentId","questionVersionId",rating) VALUES ($1,$2,$3,$4,$5,6)',[randomUUID(),f.orgId,f.surveyId,f.assignmentId,f.questionVersionId],'23514');
  await f.reject('UPDATE "Assignment" SET "submittedAt"=now() WHERE id=$1',[f.assignmentId],'23514');
}));
test('answers must reference a question assigned to that survey',()=>fixture(async f=>{
  const other=await f.insert('QuestionVersion',{orgId:f.orgId,questionKey:'other',version:1,text:'Not assigned'});
  await f.reject('INSERT INTO "Answer" (id,"orgId","surveyId","assignmentId","questionVersionId",rating) VALUES ($1,$2,$3,$4,$5,4)',[randomUUID(),f.orgId,f.surveyId,f.assignmentId,other],'23503');
  await f.reject('UPDATE "QuestionVersion" SET text=$1 WHERE id=$2',['Changed history',f.questionVersionId],'23514');
}));
test('pair history is independent of teams and retains both directions',()=>fixture(async f=>{
  const [firstMembershipId,secondMembershipId]=[...f.members].sort();
  const id=await f.insert('PairInsight',{orgId:f.orgId,firstMembershipId,secondMembershipId,combinedScore:60,firstToSecondScore:80,secondToFirstScore:40,confidence:0.6,observationCount:4,modelVersion:'test-only'});
  await f.db.query('UPDATE "Team" SET "endsAt"=$1 WHERE id=$2',[new Date('2026-02-01'),f.teamId]);
  const r=await f.db.query('SELECT * FROM "PairInsight" WHERE id=$1',[id]);
  assert.equal(r.rows[0].firstToSecondScore,80);assert.equal(r.rows[0].secondToFirstScore,40);
  await f.reject('UPDATE "PairInsight" SET "firstMembershipId"=$1,"secondMembershipId"=$2 WHERE id=$3',[secondMembershipId,firstMembershipId,id],'23514');
}));
