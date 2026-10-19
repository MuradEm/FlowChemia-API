import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BASE_DATE,DAY,SKILLS,skill,seedData,units} from './model.mjs';
import {STANDARD_QUESTIONS as library} from '../src/standard-questions.ts';
import {PATTERNS,makePattern,evaluatePattern,runPatternStudy,patternHistory} from './feedback-patterns.mjs';
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
test('positive counterfactual mirrors only Alice technical ratings and preserves the actual seed',()=>{
 const original=seedData(library),mirrored=patternHistory('high');
 for(let i=0;i<original.length;i++){if(original[i].subject==='Alice'&&original[i].key===SKILLS[0])assert.equal(mirrored[i].rating,6-original[i].rating);else assert.deepEqual(mirrored[i],original[i]);}
 close(skill(original,'Alice',SKILLS[0]).score+skill(mirrored,'Alice',SKILLS[0]).score,100);
 assert.deepEqual(seedData(library),original);
});
test('all primary patterns have equal weekly dates/counts and complete five-answer survey records',()=>{
 for(const direction of ['low','high'])for(const id of ['usual','isolated','one-reviewer','several-reviewers']){
  const scenario=makePattern(direction,id);assert.equal(scenario.surveys.length,8);assert.equal(scenario.events.length,40);
  for(const [i,s]of scenario.surveys.entries()){assert.equal(s.time,BASE_DATE+i*7*DAY);assert.equal(s.answers.length,5);assert.equal(s.answers.filter(e=>e.rating!==null).length,1);assert.notEqual(s.author,s.subject);}
 }
});
test('one-reviewer and several-reviewer cases differ only in identities, not rating/time or volume',()=>{
 for(const direction of ['low','high']){
  const one=makePattern(direction,'one-reviewer'),many=makePattern(direction,'several-reviewers');
  assert.deepEqual(one.surveys.map(s=>[s.time,s.rating]),many.surveys.map(s=>[s.time,s.rating]));
  assert.equal(new Set(one.surveys.map(s=>s.author)).size,1);assert.equal(new Set(many.surveys.map(s=>s.author)).size,3);
  const a=evaluatePattern(direction,'one-reviewer'),b=evaluatePattern(direction,'several-reviewers');
  for(let i=0;i<a.checkpoints.length;i++){close(a.checkpoints[i].plain,b.checkpoints[i].plain);close(a.checkpoints[i].current,b.checkpoints[i].current);}
 }
});
test('current rule restores weight after three reports even when all come from Carla',()=>{
 const result=evaluatePattern('low','one-reviewer');
 assert.ok(result.checkpoints[1].currentChangedFactors.every(r=>r.factor===0.25));
 assert.ok(result.checkpoints[2].currentChangedFactors.every(r=>r.factor===0.25));
 assert.ok(result.checkpoints[3].currentChangedFactors.every(r=>r.factor===1));
 assert.equal(result.checkpoints[3].changedReviewers,1);
 const last=result.checkpoints.at(-1);assert.equal(last.discountedHistoricalUnits,last.historicalUnits);assert.ok(last.current<last.plain,'The current rule can amplify a sustained one-reviewer change by discounting older evidence');
});
test('isolated unusual ratings are discounted and have less end impact than repeated reports',()=>{
 for(const direction of ['low','high']){
  const isolated=evaluatePattern(direction,'isolated'),repeated=evaluatePattern(direction,'one-reviewer');
  assert.ok(Math.abs(isolated.checkpoints[1].currentDelta)<Math.abs(isolated.checkpoints[1].plainDelta));
  const control=evaluatePattern(direction,'usual').checkpoints.at(-1);
  assert.ok(Math.abs(isolated.checkpoints.at(-1).current-control.current)<Math.abs(repeated.checkpoints.at(-1).current-control.current));
 }
});
test('low and high pattern trajectories are symmetric under mirrored history',()=>{
 for(const p of PATTERNS){const low=evaluatePattern('low',p.id),high=evaluatePattern('high',p.id);for(let i=0;i<low.checkpoints.length;i++){close(low.checkpoints[i].plain+high.checkpoints[i].plain,100);close(low.checkpoints[i].current+high.checkpoints[i].current,100);}}
});
test('context comparisons have equal volume and no same-reviewer same-week duplicate confirmations',()=>{
 for(const id of ['one-with-peers','three-with-peers']){
  const s=makePattern('low',id);assert.equal(s.surveys.length,32);assert.equal(units(s.events,BASE_DATE+49*DAY).length,32);
  assert.equal(new Set(s.surveys.map(r=>`${r.author}:${r.week}`)).size,32);
 }
});
test('checkpoints exclude future responses and scoring never uses assumed truth labels',()=>{
 const scenario=makePattern('low','one-reviewer'),result=evaluatePattern('low','one-reviewer');
 const first=[...scenario.history,...scenario.surveys[0].answers];close(skill(first,'Alice',SKILLS[0],BASE_DATE).score,result.checkpoints[1].current);
 const before=skill([...scenario.history,...scenario.events],'Alice',SKILLS[0],BASE_DATE+49*DAY);scenario.assumedSkill=5;assert.deepEqual(skill([...scenario.history,...scenario.events],'Alice',SKILLS[0],BASE_DATE+49*DAY),before);
 const report=runPatternStudy();assert.equal(report.results.length,12);assert.equal(report.settings.reviewerCalibration,false);assert.ok(report.results.every(r=>r.checkpoints.length===9));
});
