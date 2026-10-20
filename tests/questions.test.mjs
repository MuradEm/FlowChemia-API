import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import pg from 'pg';
import {createApp} from '../dist/src/app.js';

test('standard library, HR approval, and unobserved answers', async t => {
  const original = process.env.DATABASE_URL;
  const adminURL = new URL(original); adminURL.pathname = '/postgres';
  const admin = new pg.Client({connectionString: adminURL.toString()}); await admin.connect();
  const name = `flowchemia_questions_${randomUUID().replaceAll('-', '')}`;
  const url = new URL(original); url.pathname = `/${name}`;
  let app, db;
  try {
    await admin.query(`CREATE DATABASE "${name}"`); process.env.DATABASE_URL = url.toString();
    function command(args, input) { const r = spawnSync(process.execPath, args, {env: process.env, input, encoding: 'utf8'}); assert.equal(r.status, 0, r.stderr); }
    command(['node_modules/prisma/build/index.js', 'migrate', 'deploy']);
    const password = 'fictional-question-password-2026';
    command(['dist/scripts/bootstrap.js'], JSON.stringify({email: 'owner@example.test', displayName: 'Owner', password}));
    db = new pg.Client({connectionString: url.toString()}); await db.connect();
    app = await createApp(false); await app.listen(0, '127.0.0.1'); const base = await app.getUrl();
    async function request(method, path, token, value, expected = 200) {
      const response = await fetch(base + path, {method, headers: {...(token ? {Authorization: `Bearer ${token}`} : {}), ...(value !== undefined ? {'Content-Type': 'application/json'} : {})}, body: value === undefined ? undefined : JSON.stringify(value)});
      const json = await response.json(); assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(json)}`); return json;
    }
    const login = async email => (await request('POST', '/auth/login', null, {email, password})).token;
    const owner = await login('owner@example.test');
    const {organization: org, membership: ownerMember} = await request('POST', '/organizations', owner, {name: 'Automation'}, 201);
    const root = `/organizations/${org.id}`;
    async function person(label, role = 'EMPLOYEE') {
      const email = `${label}@example.test`;
      const invitation = await request('POST', `${root}/invitations`, owner, {email, role}, 201);
      const {membership} = await request('POST', '/invitations/accept', null, {token: invitation.token, displayName: label, password}, 201);
      return {id: membership.id, token: await login(email)};
    }
    const hr = await person('hr', 'HR_ADMIN'), leader = await person('leader'), manager = await person('manager'), employee = await person('employee');
    const team = await request('POST', `${root}/teams`, owner, {name: 'PLC'}, 201);
    for (const person of [leader, employee]) await request('POST', `${root}/teams/${team.id}/members`, owner, {membershipId: person.id}, 201);
    for (const [person, role] of [[leader, 'TEAM_LEADER'], [manager, 'MANAGER']]) await request('POST', `${root}/teams/${team.id}/access`, owner, {membershipId: person.id, role}, 201);
    const communication = await request('POST', `${root}/skills`, owner, {name: 'Communication'}, 201);
    const technical = await request('POST', `${root}/skills`, owner, {name: 'Technical Problem Solving'}, 201);
    const payload = {questionKey: 'technical-explanation', text: 'How clearly did this colleague explain a technical problem and help others resolve it?', skillWeights: [{skillId: communication.id, weight: 0.6}, {skillId: technical.id, weight: 0.4}]};
    let draft, managerDraft, rejected, imported, standardSkills, standardChemistry;
    await t.test('library contains the agreed skill questions and six chemistry questions', async () => {
      await request('GET', `${root}/questions/standard-library`, null, undefined, 401);
      const library = await request('GET', `${root}/questions/standard-library`, employee.token);
      assert.equal(library.questions.length, 21); assert.equal(new Set(library.questions.filter(q => q.dimension === 'SKILL').map(q => q.skillName)).size, 5);
      assert.equal(library.notObservedRating, null);
      assert.equal(library.questions.filter(q => q.dimension === 'CHEMISTRY_ENJOYMENT').length, 3);
      assert.equal(library.questions.filter(q => q.dimension === 'CHEMISTRY_EFFECTIVENESS').length, 3);
      assert.ok(library.questions.filter(q => q.dimension.startsWith('CHEMISTRY_')).every(q => q.skillWeights.length === 0 && q.skillName === null));
      assert.ok(library.questions.filter(q => q.dimension === 'SKILL').every(q => q.skillWeights.length === 1 && q.skillWeights[0].weight === 1));
    });
    await t.test('capabilities match author, reviewer and skill-management permissions', async () => {
      await request('GET',`${root}/questions/capabilities`,null,undefined,401);
      assert.deepEqual(await request('GET',`${root}/questions/capabilities`,employee.token),{canPropose:false,canReview:false,canManageSkills:false,canImportStandard:false});
      assert.deepEqual(await request('GET',`${root}/questions/capabilities`,owner),{canPropose:true,canReview:false,canManageSkills:true,canImportStandard:false});
      assert.deepEqual(await request('GET',`${root}/questions/capabilities`,hr.token),{canPropose:true,canReview:true,canManageSkills:true,canImportStandard:true});
      for(const token of [leader.token,manager.token])assert.deepEqual(await request('GET',`${root}/questions/capabilities`,token),{canPropose:true,canReview:false,canManageSkills:false,canImportStandard:false});
    });
    await t.test('leaders and managers propose drafts; regular employees cannot, and visibility is scoped', async () => {
      await request('POST', `${root}/questions`, employee.token, payload, 403);
      draft = await request('POST', `${root}/questions`, leader.token, payload, 201);
      assert.equal(draft.approvalStatus, 'DRAFT'); assert.equal(draft.createdByMembershipId, leader.id); assert.equal(draft.reviewedAt, null);
      managerDraft = await request('POST', `${root}/questions`, manager.token, {...payload, questionKey: 'manager-proposal'}, 201);
      assert.equal((await request('GET', `${root}/questions`, employee.token)).length, 0);
      assert.deepEqual((await request('GET', `${root}/questions`, leader.token)).map(q => q.id), [draft.id]);
      assert.equal((await request('GET', `${root}/questions`, hr.token)).length, 2);
      await request('POST', `${root}/questions`, leader.token, {...payload, skillWeights: [{skillId: randomUUID(), weight: 1}]}, 400);
      const {organization: other} = await request('POST', '/organizations', owner, {name: 'Other'}, 201);
      await request('GET', `/organizations/${other.id}/questions`, leader.token, undefined, 404);
      await request('GET', `/organizations/${other.id}/questions/capabilities`, leader.token, undefined, 404);
      await request('POST', `/organizations/${other.id}/questions/${draft.id}/review`, hr.token, {decision: 'APPROVED'}, 404);
    });
    await t.test('unapproved versions cannot enter manual, milestone, or automatic survey configuration', async () => {
      const selection = {questionVersionIds: [draft.id]};
      await request('POST', `${root}/surveys/generate-periodic`, owner, selection, 400);
      await request('PATCH', `${root}/feedback-policy`, owner, {...selection, automaticEnabled: true}, 400);
      await request('POST', `${root}/teams/${team.id}/surveys/milestone`, manager.token, {...selection, participantMembershipIds: [leader.id, employee.id], closesAt: new Date(Date.now() + 86400000).toISOString()}, 400);
      assert.equal((await db.query('SELECT count(*)::int n FROM "Survey"')).rows[0].n, 0);
      const surveyId = randomUUID();
      await db.query('INSERT INTO "Survey" (id,"orgId","teamId",kind,"opensAt") VALUES ($1,$2,$3,\'PERIODIC\',now())', [surveyId, org.id, team.id]);
      await assert.rejects(db.query('INSERT INTO "SurveyQuestion" (id,"orgId","surveyId","questionVersionId",position) VALUES ($1,$2,$3,$4,1)', [randomUUID(), org.id, surveyId, draft.id]), e => e.code === '23514');
      await db.query('DELETE FROM "Survey" WHERE id=$1', [surveyId]);
    });
    await t.test('only HR reviews, concurrent review wins once, and rejected versions stay unusable', async () => {
      for (const token of [owner, leader.token, manager.token, employee.token]) await request('POST', `${root}/questions/${draft.id}/review`, token, {decision: 'APPROVED'}, 403);
      await request('POST', `${root}/questions/${draft.id}/review`, hr.token, {decision: 'DRAFT'}, 400);
      const review = await request('POST', `${root}/questions/${draft.id}/review`, hr.token, {decision: 'APPROVED', note: 'Suitable for recent shared work.'});
      assert.equal(review.approvalOrigin, 'HR'); assert.equal(review.reviewedByMembershipId, hr.id); assert.ok(review.reviewedAt);
      assert.deepEqual(review.QuestionSkill_question.map(w => Number(w.weight)).sort(), [0.4, 0.6]);
      assert.ok((await request('GET', `${root}/questions`, employee.token)).some(q => q.id === draft.id));
      const path = `${root}/questions/${managerDraft.id}/review`;
      const results = await Promise.all([1, 2].map(() => fetch(base + path, {method: 'POST', headers: {Authorization: `Bearer ${hr.token}`, 'Content-Type': 'application/json'}, body: JSON.stringify({decision: 'REJECTED', note: 'Please clarify the wording.'})})));
      assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
      rejected = (await request('GET', `${root}/questions`, hr.token)).find(q => q.id === managerDraft.id);
      assert.equal(rejected.approvalStatus, 'REJECTED');
      await request('POST', `${root}/surveys/generate-periodic`, owner, {questionVersionIds: [rejected.id]}, 400);
      await assert.rejects(db.query('UPDATE "QuestionVersion" SET "reviewNote"=\'changed\' WHERE id=$1', [draft.id]), e => e.code === '23514');
      await assert.rejects(db.query('UPDATE "QuestionSkill" SET weight=0.5 WHERE "questionVersionId"=$1', [draft.id]), e => e.code === '23514');
    });
    await t.test('revisions require a fresh review and preserve old wording and mappings', async () => {
      const revision = await request('POST', `${root}/questions`, leader.token, {...payload, text: 'Revised wording', skillWeights: [{skillId: technical.id, weight: 1}]}, 201);
      assert.equal(revision.version, 2); assert.equal(revision.approvalStatus, 'DRAFT');
      await request('POST', `${root}/surveys/generate-periodic`, owner, {questionVersionIds: [revision.id]}, 400);
      const old = (await request('GET', `${root}/questions`, hr.token)).find(q => q.id === draft.id);
      assert.equal(old.text, payload.text); assert.equal(old.approvalStatus, 'APPROVED');
      await assert.rejects(db.query('UPDATE "QuestionVersion" SET text=\'rewrite\' WHERE id=$1', [revision.id]), e => e.code === '23514');
      await assert.rejects(db.query('UPDATE "QuestionVersion" SET "approvalStatus"=\'APPROVED\' WHERE id=$1', [revision.id]), e => e.code === '23514');
      await assert.rejects(db.query('UPDATE "QuestionVersion" SET "approvalStatus"=\'APPROVED\',"approvalOrigin"=\'HR\',"reviewedByMembershipId"=$1,"reviewedAt"=now() WHERE id=$2', [ownerMember.id, revision.id]), e => e.code === '23514');
      await db.query('UPDATE "Skill" SET active=false WHERE id=$1', [technical.id]);
      await request('POST', `${root}/questions/${revision.id}/review`, hr.token, {decision: 'APPROVED'}, 400);
      await db.query('UPDATE "Skill" SET active=true WHERE id=$1', [technical.id]);
    });
    await t.test('HR imports the standard library once, reusing skills without automatic activation', async () => {
      for (const token of [owner, leader.token, manager.token, employee.token]) await request('POST', `${root}/questions/import-standard`, token, {}, 403);
      const results = await Promise.all([request('POST', `${root}/questions/import-standard`, hr.token, {}), request('POST', `${root}/questions/import-standard`, hr.token, {})]);
      assert.deepEqual(results.map(r => r.createdQuestions).sort((a, b) => a - b), [0, 21]); imported = results[0].questions;
      assert.equal((await request('GET', `${root}/skills`, owner)).length, 5);
      const standards = (await request('GET', `${root}/questions`, hr.token)).filter(q => q.standardTemplateKey);
      standardSkills=standards.filter(q=>q.dimension==='SKILL').map(q=>q.id);
      standardChemistry=['CHEMISTRY_ENJOYMENT','CHEMISTRY_EFFECTIVENESS'].map(d=>standards.find(q=>q.dimension===d).id);
      assert.equal(standards.length, 21); assert.ok(standards.every(q => q.approvalStatus === 'APPROVED' && q.approvalOrigin === 'STANDARD' && q.reviewedByMembershipId === hr.id));
      assert.equal((await request('GET', `${root}/feedback-policy`, owner)).policy.automaticEnabled, false);
      assert.equal((await request('POST', `${root}/questions/import-standard`, hr.token, {})).createdQuestions, 0);
      await db.query('UPDATE "Skill" SET active=false WHERE id=$1', [technical.id]);
      const before = await db.query('SELECT count(*)::int n FROM "QuestionVersion"');
      // All existing imports are retained; retrying never mutates their skill or content.
      await request('POST', `${root}/questions/import-standard`, hr.token, {});
      assert.equal((await db.query('SELECT count(*)::int n FROM "QuestionVersion"')).rows[0].n, before.rows[0].n);
      assert.equal((await db.query('SELECT active FROM "Skill" WHERE id=$1', [technical.id])).rows[0].active, false);
      await db.query('UPDATE "Skill" SET active=true WHERE id=$1', [technical.id]);
    });
    await t.test('a failed standard import rolls back all new questions and skills', async () => {
      const {organization: other} = await request('POST', '/organizations', owner, {name: 'Atomic imports'}, 201);
      const otherRoot = `/organizations/${other.id}`;
      const invitation = await request('POST', `${otherRoot}/invitations`, owner, {email: 'hr@example.test', role: 'HR_ADMIN'}, 201);
      await request('POST', '/invitations/accept', hr.token, {token: invitation.token}, 201);
      const skill = await request('POST', `${otherRoot}/skills`, owner, {name: 'Reliability'}, 201);
      await db.query('UPDATE "Skill" SET active=false WHERE id=$1', [skill.id]);
      await request('POST', `${otherRoot}/questions/import-standard`, hr.token, {}, 400);
      assert.equal((await request('GET', `${otherRoot}/questions`, hr.token)).length, 0);
      assert.equal((await request('GET', `${otherRoot}/skills`, hr.token)).length, 1);
      await db.query('UPDATE "Skill" SET active=true WHERE id=$1', [skill.id]);
      const imported = await request('POST', `${otherRoot}/questions/import-standard`, hr.token, {});
      assert.equal(imported.createdQuestions, 21);
      assert.equal((await request('GET', `${otherRoot}/skills`, hr.token)).length, 5);
      await request('POST', `${otherRoot}/questions/${draft.id}/review`, hr.token, {decision: 'APPROVED'}, 404);
    });
    await t.test('unobserved answers store null, complete surveys once, and earn normal participation', async () => {
      const ids = [draft.id, ...standardSkills.slice(0,2), ...standardChemistry];
      assert.equal((await request('POST', `${root}/surveys/generate-periodic`, owner, {questionVersionIds: ids})).createdAssignments, 2);
      for (const [index, respondent] of [employee, leader].entries()) {
        const [assignment] = await request('GET', `${root}/assignments/my-open`, respondent.token);
        const path = `${root}/assignments/${assignment.id}/submit`;
        await request('POST', path, respondent.token, {answers: [{questionVersionId: ids[0]}, {questionVersionId: ids[1], rating: null}]}, 400);
        await request('POST', path, respondent.token, {answers: [{questionVersionId: ids[0], rating: 'NOT_OBSERVED'}, {questionVersionId: ids[1], rating: null}]}, 400);
        const result = await request('POST', path, respondent.token, {answers: ids.map((id, i) => ({questionVersionId: id, rating: index === 1 && i === 0 ? 5 : null}))});
        assert.equal(result.participationPercentage, 100);
        const rows = (await db.query('SELECT count(*)::int n,count(rating)::int rated,avg(rating)::float average FROM "Answer" WHERE "assignmentId"=$1', [assignment.id])).rows[0];
        assert.equal(rows.n, 5); assert.equal(rows.rated, index); assert.equal(rows.average, index ? 5 : null);
        await request('POST', path, respondent.token, {answers: ids.map(id => ({questionVersionId: id, rating: null}))}, 409);
        await assert.rejects(db.query('UPDATE "Answer" SET rating=1 WHERE "assignmentId"=$1', [assignment.id]), e => e.code === '23514');
      }
      const report = await request('GET', `${root}/reports/completion`, hr.token);
      assert.ok(!JSON.stringify(report).includes('rating'));
    });
    await t.test('company chemistry questions require HR review and cannot carry skill weights', async () => {
      await request('POST', `${root}/questions`, leader.token, {questionKey: 'bad-dimension', text: 'Bad', dimension: 'FRIENDSHIP'}, 400);
      await request('POST', `${root}/questions`, leader.token, {...payload, dimension: 'CHEMISTRY_ENJOYMENT'}, 400);
      await request('POST', `${root}/questions`, leader.token, {questionKey: 'missing-mapping', text: 'Skill', dimension: 'SKILL'}, 400);
      const question = await request('POST', `${root}/questions`, leader.token, {questionKey: 'company-enjoyment', text: 'How comfortable was working together?', dimension: 'CHEMISTRY_ENJOYMENT'}, 201);
      assert.equal(question.approvalStatus, 'DRAFT'); assert.equal(question.dimension, 'CHEMISTRY_ENJOYMENT');
      const effectiveness = (await request('GET', `${root}/questions`, hr.token)).find(q => q.dimension === 'CHEMISTRY_EFFECTIVENESS');
      await request('PATCH', `${root}/feedback-policy`, owner, {questionVersionIds: [...standardSkills.slice(0,3), question.id, effectiveness.id]}, 400);
      await assert.rejects(db.query('INSERT INTO "QuestionSkill" (id,"orgId","questionVersionId","skillId",weight) VALUES ($1,$2,$3,$4,1)', [randomUUID(),org.id,question.id,technical.id]), e => e.code === '23514');
      const approved = await request('POST', `${root}/questions/${question.id}/review`, hr.token, {decision: 'APPROVED'});
      assert.equal(approved.dimension, 'CHEMISTRY_ENJOYMENT'); assert.deepEqual(approved.QuestionSkill_question, []);
      await assert.rejects(db.query('UPDATE "QuestionVersion" SET dimension=\'SKILL\' WHERE id=$1', [question.id]), e => e.code === '23514');
      const revision = await request('POST', `${root}/questions`, leader.token, {questionKey: question.questionKey, text: 'Revised company enjoyment', dimension: 'CHEMISTRY_ENJOYMENT'}, 201);
      assert.equal(revision.version, 2); assert.equal(revision.approvalStatus, 'DRAFT');
    });
    await t.test('five-question selections enforce the agreed skill and chemistry compositions', async () => {
      const questions = await request('GET', `${root}/questions`, hr.token);
      const enjoyment = questions.filter(q => q.dimension === 'CHEMISTRY_ENJOYMENT' && q.approvalStatus === 'APPROVED');
      const effectiveness = questions.find(q => q.dimension === 'CHEMISTRY_EFFECTIVENESS');
      for (const ids of [[enjoyment[0].id], [effectiveness.id], standardSkills.slice(0,5), [...standardSkills.slice(0,3), enjoyment[0].id, enjoyment[1].id], [...standardSkills.slice(0,2), enjoyment[0].id, enjoyment[1].id, effectiveness.id]]) {
        await request('POST', `${root}/surveys/generate-periodic`, owner, {questionVersionIds: ids}, 400);
        await request('PATCH', `${root}/feedback-policy`, owner, {questionVersionIds: ids}, 400);
        await request('POST', `${root}/teams/${team.id}/surveys/milestone`, manager.token, {questionVersionIds: ids, participantMembershipIds: [leader.id, employee.id], closesAt: new Date(Date.now()+86400000).toISOString()}, 400);
      }
      await request('PATCH', `${root}/feedback-policy`, owner, {questionVersionIds: [...standardSkills.slice(0,3), enjoyment[0].id, effectiveness.id]});
    });
    await t.test('chemistry responses retain both perspectives and derive combined reported effectiveness', async () => {
      const questions = await request('GET', `${root}/questions`, hr.token);
      const enjoyment = questions.find(q => q.dimension === 'CHEMISTRY_ENJOYMENT' && q.standardTemplateKey);
      const effectiveness = questions.find(q => q.dimension === 'CHEMISTRY_EFFECTIVENESS' && q.standardTemplateKey);
      const ids = [...standardSkills.slice(0,3), enjoyment.id, effectiveness.id];
      const survey = await request('POST', `${root}/teams/${team.id}/surveys/milestone`, manager.token, {questionVersionIds: ids, participantMembershipIds: [leader.id,employee.id], closesAt: new Date(Date.now()+86400000).toISOString()}, 201);
      assert.equal(survey.createdAssignments, 2);
      for (const [index, respondent] of [employee,leader].entries()) {
        const [assignment] = (await request('GET', `${root}/assignments/my-open`, respondent.token)).filter(a => a.type === 'MILESTONE');
        const detail = await request('GET', `${root}/assignments/${assignment.id}`, respondent.token);
        assert.deepEqual(detail.questions.map(q => q.dimension), ['SKILL','SKILL','SKILL','CHEMISTRY_ENJOYMENT','CHEMISTRY_EFFECTIVENESS']);
        assert.ok(detail.questions.every(q => q.notObservedRating === null));
        await request('GET', `${root}/assignments/${assignment.id}`, manager.token, undefined, 404);
        assert.equal(detail.surveyFormat.questionCount,5);assert.equal(detail.surveyFormat.targetDurationSeconds,120);assert.equal(detail.surveyFormat.writtenAnswers,false);
        const ratings = index === 0 ? [3,3,3,2,5] : [3,3,3,5,2];
        await request('POST', `${root}/assignments/${assignment.id}/submit`, respondent.token, {answers: ids.map((id,i) => ({questionVersionId:id,rating:ratings[i]}))});
        const saved = (await db.query('SELECT a.rating,q.dimension FROM "Answer" a JOIN "QuestionVersion" q ON q.id=a."questionVersionId" WHERE a."assignmentId"=$1 AND q.dimension IN (\'CHEMISTRY_ENJOYMENT\',\'CHEMISTRY_EFFECTIVENESS\') ORDER BY q.dimension',[assignment.id])).rows;
        assert.deepEqual(saved.map(a => a.rating), ratings.slice(3));
        assert.ok(!(await request('GET', `${root}/assignments/${assignment.id}`, respondent.token)).answers);
      }
      const summaries=(await db.query('SELECT * FROM "PairInsight" WHERE "orgId"=$1 AND "modelVersion"=$2',[org.id,'baseline-70-v1'])).rows;
      const pair=summaries.find(p=>[p.firstMembershipId,p.secondMembershipId].includes(leader.id)&&[p.firstMembershipId,p.secondMembershipId].includes(employee.id));
      assert.ok(pair);assert.equal(pair.combinedScore,(pair.firstToSecondScore+pair.secondToFirstScore)/2);
      assert.notEqual(pair.details.firstEnjoyment.score,pair.details.secondEnjoyment.score);
      assert.ok((await db.query('SELECT count(*)::int n FROM "SkillInsight" WHERE "orgId"=$1',[org.id])).rows[0].n>0);
    });
    await t.test('five rating questions also support four skills and one chemistry dimension without written answers', async () => {
      const ids=[...standardSkills.slice(0,4),standardChemistry[0]];
      await request('PATCH',`${root}/feedback-policy`,owner,{questionVersionIds:ids});
      const policy=await request('GET',`${root}/feedback-policy`,owner);
      assert.equal(policy.surveyFormat.questionCount,5);assert.equal(policy.surveyFormat.targetDurationSeconds,120);assert.equal(policy.surveyFormat.writtenAnswers,false);
      const survey=await request('POST',`${root}/teams/${team.id}/surveys/milestone`,manager.token,{questionVersionIds:ids,participantMembershipIds:[leader.id,employee.id],closesAt:new Date(Date.now()+86400000).toISOString()},201);
      assert.equal(survey.createdAssignments,2);
      const [assignment]=await request('GET',`${root}/assignments/my-open`,employee.token);
      const detail=await request('GET',`${root}/assignments/${assignment.id}`,employee.token);
      assert.equal(detail.questions.length,5);assert.equal(detail.questions.filter(q=>q.dimension==='SKILL').length,4);
      const answers=ids.map(questionVersionId=>({questionVersionId,rating:4}));
      await request('POST',`${root}/assignments/${assignment.id}/submit`,employee.token,{answers,comment:'A written response'},400);
      await request('POST',`${root}/assignments/${assignment.id}/submit`,employee.token,{answers:answers.map(a=>({...a,text:'Writing'}))},400);
      await request('POST',`${root}/assignments/${assignment.id}/submit`,employee.token,{answers});
      await request('PATCH',`${root}/feedback-policy`,owner,{questionVersionIds:[...standardSkills.slice(0,4),standardChemistry[1]]});
      for(const questionVersionIds of [ids.slice(0,4),[...ids,standardSkills[4]]])await request('POST',`${root}/surveys/generate-periodic`,owner,{questionVersionIds},400);
    });
    await t.test('revoked team roles and inactive HR accounts lose question privileges', async () => {
      await request('DELETE', `${root}/teams/${team.id}/access/${leader.id}`, owner);
      await request('POST', `${root}/questions`, leader.token, payload, 403);
      assert.equal((await request('GET',`${root}/questions/capabilities`,leader.token)).canPropose,false);
      await db.query('UPDATE "Team" SET "endsAt"=now() WHERE id=$1', [team.id]);
      await request('POST', `${root}/questions`, manager.token, payload, 403);
      assert.equal((await request('GET',`${root}/questions/capabilities`,manager.token)).canPropose,false);
      await db.query('UPDATE "Membership" SET active=false WHERE id=$1', [hr.id]);
      await request('GET',`${root}/questions/capabilities`,hr.token,undefined,404);
      await request('POST', `${root}/questions/import-standard`, hr.token, {}, 404);
      await request('POST', `${root}/questions/${draft.id}/review`, hr.token, {decision: 'APPROVED'}, 404);
    });
  } finally {
    if (app) await app.close(); if (db) await db.end(); process.env.DATABASE_URL = original;
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`); await admin.end();
  }
});
