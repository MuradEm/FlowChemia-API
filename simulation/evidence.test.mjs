import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BASE_DATE,DAY,SKILLS,skill} from './model.mjs';
import {skillEvidence} from './evidence.mjs';
import {makePattern,evaluatePattern} from './feedback-patterns.mjs';
const row=(author,rating,time=BASE_DATE)=>({author,subject:'Alice',key:SKILLS[0],time,rating});
test('missing, unobserved, old and future evidence are not converted into reliability scores',()=>{
 const data=[row('Carla',null),row('Bob',5,BASE_DATE-43*DAY),row('Dan',1,BASE_DATE+DAY)];
 const result=skillEvidence(data,'Alice',SKILLS[0]);assert.equal(result.reviewers,0);assert.equal(result.units,0);assert.equal(result.largestReviewerShare,null);assert.equal(result.betweenReviewerSpreadStars,null);assert.equal(result.latestAgeDays,null);
 assert.equal(skillEvidence([row('Bob',4,BASE_DATE-42*DAY)],'Alice',SKILLS[0]).reviewers,1);
});
test('many weekly reports by one person remain one source without an agreement claim',()=>{
 const result=evaluatePattern('low','one-reviewer').checkpoints.at(-1).evidence;
 assert.equal(result.reviewers,1);assert.equal(result.units,7);assert.equal(result.largestReviewerShare,1);assert.equal(result.betweenReviewerSpreadStars,null);
});
test('identical score trajectories can expose one versus several contributing reviewers',()=>{
 const one=evaluatePattern('low','one-reviewer').checkpoints.at(-1),many=evaluatePattern('low','several-reviewers').checkpoints.at(-1);
 assert.equal(one.plain,many.plain);assert.equal(one.current,many.current);
 assert.equal(one.evidence.reviewers,1);assert.equal(many.evidence.reviewers,3);assert.ok(many.evidence.largestReviewerShare<0.5);assert.equal(many.evidence.betweenReviewerSpreadStars,0);
});
test('continuing disagreement among four sources is visible even when a mean conceals it',()=>{
 const evidence=evaluatePattern('low','one-with-peers').checkpoints.at(-1).evidence;
 assert.equal(evidence.reviewers,4);assert.equal(evidence.largestReviewerShare,0.25);assert.ok(evidence.betweenReviewerSpreadStars>1);
});
test('diagnostics preserve all scores and answers; same-week duplicates add no coverage',()=>{
 const scenario=makePattern('low','one-with-peers'),events=[...scenario.history,...scenario.events],snapshot=structuredClone(events),now=BASE_DATE+49*DAY;
 const before=skill(events,'Alice',SKILLS[0],now);const signal=skillEvidence(events,'Alice',SKILLS[0],now);
 assert.deepEqual(skill(events,'Alice',SKILLS[0],now),before);assert.deepEqual(events,snapshot);
 assert.deepEqual(skillEvidence([...events,...events],'Alice',SKILLS[0],now),signal);
});
test('source summaries stay metric-scoped and never penalize single-person chemistry',()=>{
 const events=[row('Bob',2),{...row('Carla',5),key:SKILLS[1]},{...row('Dan',1),subject:'Bob'}];
 assert.equal(skillEvidence(events,'Alice',SKILLS[0]).reviewers,1);
 assert.throws(()=>skillEvidence(events,'Alice','CHEMISTRY_ENJOYMENT'));
 assert.throws(()=>skillEvidence(events,'Alice',SKILLS[0],BASE_DATE,{windowDays:0}));
});
