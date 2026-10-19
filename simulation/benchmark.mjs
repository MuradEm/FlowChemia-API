import {BASE_DATE,DAY,DEFAULTS,PEOPLE,SKILLS,skill,points} from './model.mjs';
import {CALIBRATION_DEFAULTS,reviewerAdjustments,calibratedSkill} from './calibration.mjs';

export const SCENARIOS=[
 {id:'neutral',name:'Different skills, no systematic reviewer bias',note:'Tests whether adjustment introduces error when it is unnecessary.'},
 {id:'severity',name:'Harsh and generous reviewers',note:'Reviewer offsets affect every colleague, independently of their skill.'},
 {id:'pair',name:'Friendship and dislike specific to each pair',note:'Pair effects are not assumed to be reviewer severity.'},
 {id:'mixed',name:'Reviewer tendencies plus pair effects',note:'Both sources of bias are present.'},
 {id:'halo',name:'Relationship impressions overwhelm skill ratings',note:'This deliberately tests the feared collapse toward average. Reviewer calibration cannot recover information absent from the answers.'},
 {id:'improvement',name:'Real technical improvement',note:'Alice improves from 2.1 to 4.3 stars during the last four weeks.'},
 {id:'deterioration',name:'Real technical deterioration',note:'Alice deteriorates from 4.3 to 2.1 stars during the last four weeks.'},
 {id:'outliers',name:'Occasional extreme answers',note:'Two percent of skill answers are independently replaced by 1 or 5 stars.'},
 {id:'common',name:'Everyone uses a harsher scale',note:'A shared −0.8-star bias has no external anchor; relative calibration cannot identify it.'},
 {id:'sparse',name:'Sparse and overlapping evidence',note:'Only three weeks of answers; half of the skill answers are unobserved.'},
];
export function makeScenario(id,seed=1){
 if(!SCENARIOS.some(s=>s.id===id))throw new Error('Unknown scenario');
 let state=seed>>>0;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
 const truth=[[4.2,3.5,4,3.1,4.3],[2.1,4.2,3.6,2.8,3.8],[3.5,2.4,4.4,4.1,3.7],[4,3.7,2.3,2.5,4.1],[2.8,4.3,3.8,4.2,3.3]];
 const offsets=[-0.9,0.8,-0.6,0.5,0.2];
 if(id==='improvement')truth[0][0]=4.3;if(id==='deterioration')truth[0][0]=2.1;
 const events=[];const weeks=id==='sparse'?3:16;
 for(let week=0;week<weeks;week++)for(let a=0;a<5;a++)for(let slot=0;slot<2;slot++){
  const s=(a+1+((week*2+slot)%4))%5,time=BASE_DATE-(weeks-1-week)*7*DAY;
  const friend=((a+s)%2===0),pairOffset=friend?0.9:-0.9;
  const keys=[0,1,2].map(i=>SKILLS[(week+a+slot+i)%5]);keys.push('CHEMISTRY_ENJOYMENT','CHEMISTRY_EFFECTIVENESS');
  for(const key of keys){
   const k=SKILLS.indexOf(key);let rating;
   if(k>=0){
    let ability=truth[s][k];
    if(s===0&&k===0&&week<weeks-4){if(id==='improvement')ability=2.1;if(id==='deterioration')ability=4.3;}
    let observed=ability;
    if(['severity','mixed','improvement','deterioration'].includes(id))observed+=offsets[a];
    if(['pair','mixed'].includes(id))observed+=pairOffset;
    if(id==='halo')observed=0.35*ability+0.65*(friend?4.5:1.5);
    if(id==='common')observed-=0.8;
    rating=Math.max(1,Math.min(5,Math.round(observed+(random()+random()-1)*1.1)));
    if(id==='outliers'&&random()<0.02)rating=random()<0.5?1:5;
    if(id==='sparse'&&random()<0.5)rating=null;
   }else rating=Math.max(1,Math.min(5,Math.round((key==='CHEMISTRY_ENJOYMENT'?(friend?4.5:2):(friend?3.2:3.5))+(random()+random()-1)*0.7)));
   events.push({id:`${id}-${week}-${a}-${slot}-${key}`,author:PEOPLE[a],subject:PEOPLE[s],key,questionId:`benchmark:${key}`,time,rating});
  }
 }
 return {events,truth,now:BASE_DATE,changeBaseline:BASE_DATE-28*DAY};
}
const mean=input=>{const xs=input.filter(Number.isFinite);return xs.length?xs.reduce((n,x)=>n+x,0)/xs.length:null;};
const spread=xs=>{if(xs.length<2)return null;const avg=mean(xs);return Math.sqrt(mean(xs.map(x=>(x-avg)**2)));};
export function evaluateScenario(id,seed){
 const {events,truth,now,changeBaseline}=makeScenario(id,seed);
 const cells=[];const errors={plain:[],current:[],calibration:[],combined:[]},movements={plain:[],current:[],calibration:[],combined:[]};
 for(let s=0;s<5;s++){
  const learned=reviewerAdjustments(events,PEOPLE[s],now),pastLearned=reviewerAdjustments(events,PEOPLE[s],changeBaseline);
  for(let k=0;k<5;k++){
   const current=skill(events,PEOPLE[s],SKILLS[k],now),adjusted=calibratedSkill(events,PEOPLE[s],SKILLS[k],now,{},learned);
   const expected=points(truth[s][k]);const values={plain:current.plain,current:current.score,calibration:adjusted.plain,combined:adjusted.score};
   for(const [name,value] of Object.entries(values))if(value!==null)errors[name].push(Math.abs(value-expected));
   cells.push({employee:PEOPLE[s],skill:SKILLS[k],truth:expected,...values});
   if(s===0&&k===0&&['improvement','deterioration'].includes(id)){
    const before=skill(events,PEOPLE[s],SKILLS[k],changeBaseline),adjustedBefore=calibratedSkill(events,PEOPLE[s],SKILLS[k],changeBaseline,{},pastLearned);
    for(const [name,value] of Object.entries(values)){const initial={plain:before.plain,current:before.score,calibration:adjustedBefore.plain,combined:adjustedBefore.score}[name];movements[name].push(value-initial);}
   }
  }
 }
 const skillSpread=Object.fromEntries(['truth',...Object.keys(errors)].map(name=>[name,mean(SKILLS.map(key=>spread(cells.filter(c=>c.skill===key).map(c=>c[name]).filter(x=>x!==null))))]));
 return {mae:Object.fromEntries(Object.entries(errors).map(([name,xs])=>[name,mean(xs)])),coverage:errors.current.length,cells,spread:skillSpread,movement:Object.fromEntries(Object.entries(movements).map(([name,xs])=>[name,mean(xs)]))};
}
export function runBenchmark(seeds=20){
 const results=SCENARIOS.map(s=>{
  const runs=Array.from({length:seeds},(_,i)=>evaluateScenario(s.id,17026+i));
  const models=['plain','current','calibration','combined'];
  return {...s,mae:Object.fromEntries(models.map(m=>[m,mean(runs.map(r=>r.mae[m]))])),spread:Object.fromEntries(['truth',...models].map(m=>[m,mean(runs.map(r=>r.spread[m]))])),movement:Object.fromEntries(models.map(m=>[m,runs[0].movement[m]===null?null:mean(runs.map(r=>r.movement[m]))])),seeds:seeds,cellsScored:runs.reduce((n,r)=>n+r.coverage,0),calibratedBetterSeeds:runs.filter(r=>r.mae.combined<r.mae.current).length,example:runs[0].cells};
 });
 return {version:'reviewer-calibration-0.1',settings:{...DEFAULTS,...CALIBRATION_DEFAULTS},seedStart:17026,seeds,description:'Mean absolute error against known synthetic current skill, in 0–100 points. Lower is better. No truth labels are passed to a scoring function.',models:{plain:'Recency only',current:'Current model',calibration:'Reviewer adjustment + recency',combined:'Reviewer adjustment + current model'},results};
}
