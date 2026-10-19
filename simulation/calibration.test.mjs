import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BASE_DATE,DAY,SKILLS,skill,direction,seedData} from './model.mjs';
import {STANDARD_QUESTIONS as library} from '../src/standard-questions.ts';
import {CALIBRATION_DEFAULTS,learnReviewerAdjustment,reviewerAdjustments,calibratedSkill} from './calibration.mjs';
import {makeScenario,evaluateScenario,runBenchmark} from './benchmark.mjs';
function history(offset=1){const events=[];for(const subject of ['Alice','Bob','Carla','Dan'])for(let week=0;week<8;week++)for(const [author,bias] of [['Harsh',-offset],['Generous',offset],['Peer1',0],['Peer2',0]])events.push({id:`${subject}-${week}-${author}`,author,subject,key:SKILLS[0],time:BASE_DATE-week*7*DAY,rating:3+bias});return events;}
test('matched reviewer tendencies shrink toward zero and remain bounded',()=>{
 const events=history();const harsh=learnReviewerAdjustment(events,'Harsh','Alice'),generous=learnReviewerAdjustment(events,'Generous','Alice');
 assert.ok(harsh.adjustment<0&&generous.adjustment>0);assert.ok(Math.abs(harsh.adjustment)<=CALIBRATION_DEFAULTS.maxAdjustment);assert.ok(generous.adjustment<=0.5);
 assert.ok(Math.abs(harsh.adjustment)<Math.abs(harsh.rawResidual));assert.equal(harsh.subjects,3);
});
test('current colleague and their pair-specific feedback cannot train their own reviewer adjustment',()=>{
 const events=history();const before=learnReviewerAdjustment(events,'Harsh','Alice');
 const changed=events.map(e=>e.subject==='Alice'?{...e,rating:5}:e);assert.deepEqual(learnReviewerAdjustment(changed,'Harsh','Alice'),before);
 const future=events.map(e=>({...e,time:BASE_DATE+7*DAY,rating:5}));assert.deepEqual(learnReviewerAdjustment([...events,...future],'Harsh','Alice'),before);
});
test('few colleagues, few samples and unmatched skill contexts produce no correction',()=>{
 assert.equal(learnReviewerAdjustment(history().filter(e=>e.subject==='Bob'),'Harsh','Alice').adjustment,0);
 assert.equal(learnReviewerAdjustment(history().filter(e=>e.time===BASE_DATE),'Harsh','Alice').adjustment,0);
 const unmatched=history().map(e=>e.author==='Harsh'?{...e,key:SKILLS[1]}:e);assert.equal(learnReviewerAdjustment(unmatched,'Harsh','Alice').matchedUnits,0);
});
test('a single repeated week cannot supply enough evidence by duplication',()=>{
 const oneWeek=history().filter(e=>e.time===BASE_DATE);const repeated=Array.from({length:20},()=>oneWeek).flat();
 assert.equal(learnReviewerAdjustment(repeated,'Harsh','Alice').adjustment,0);
});
test('calibration preserves raw answers, missing scores, chemistry and equal-skill teams',()=>{
 const events=history(0);const snapshot=structuredClone(events);
 assert.equal(calibratedSkill([], 'Alice',SKILLS[0]).score,null);
 assert.ok(Math.abs(calibratedSkill(events,'Alice',SKILLS[0]).score-50)<1e-9);assert.ok(Math.abs(skill(events,'Alice',SKILLS[0]).score-50)<1e-9);
 const initial=seedData(library),reverse=direction(initial,'Bob','Alice','CHEMISTRY_ENJOYMENT');
 calibratedSkill(initial,'Alice',SKILLS[0]);assert.deepEqual(direction(initial,'Bob','Alice','CHEMISTRY_ENJOYMENT'),reverse);
 assert.deepEqual(events,snapshot);assert.throws(()=>calibratedSkill(initial,'Alice','CHEMISTRY_ENJOYMENT'));
});
test('scores stay bounded; zero adjustment reproduces the existing model exactly',()=>{
 const initial=seedData(library);const learned=Object.fromEntries(Object.keys(reviewerAdjustments(initial,'Alice')).map(a=>[a,{adjustment:0}]));
 assert.equal(calibratedSkill(initial,'Alice',SKILLS[0],BASE_DATE,{},learned).score,skill(initial,'Alice',SKILLS[0]).score);
 for(const person of ['Alice','Bob','Carla','Dan']){const result=calibratedSkill(history(),person,SKILLS[0]);assert.ok(result.score>=0&&result.score<=100);}
});
test('known-truth scenarios are deterministic and truth labels are not used for calibration',()=>{
 assert.deepEqual(makeScenario('severity',17),makeScenario('severity',17));
 const scenario=makeScenario('severity',17);const before=calibratedSkill(scenario.events,'Alice',SKILLS[0]);scenario.truth[0][0]=1;
 assert.deepEqual(calibratedSkill(scenario.events,'Alice',SKILLS[0]),before);
});
test('benchmark includes all scenarios, comparable coverage, and both real change directions',()=>{
 const report=runBenchmark(1);assert.equal(report.results.length,10);assert.ok(report.results.filter(r=>r.id!=='sparse').every(r=>r.cellsScored===25));assert.ok(report.results.find(r=>r.id==='sparse').cellsScored>0&&report.results.find(r=>r.id==='sparse').cellsScored<=25);
 for(const row of report.results)for(const value of Object.values(row.mae))assert.ok(Number.isFinite(value)&&value>=0);
 assert.ok(report.results.find(r=>r.id==='improvement').movement.combined>0);
 assert.ok(report.results.find(r=>r.id==='deterioration').movement.combined<0);
 const common=evaluateScenario('common',17026);assert.ok(common.mae.combined>5,'Shared bias must not be reported as solved');
});
