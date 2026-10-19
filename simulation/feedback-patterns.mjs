import {skillEvidence} from './evidence.mjs';
import {STANDARD_QUESTIONS} from '../src/standard-questions.ts';
import {BASE_DATE,DAY,DEFAULTS,SKILLS,seedData,skill,surveyEvents,points} from './model.mjs';

export const PATTERNS=[
 {id:'usual',name:'Usual feedback continues',kind:'control',note:'A reference path with the usual rating distribution.'},
 {id:'isolated',name:'One unusual report, then usual feedback',kind:'primary',note:'Carla gives one unusual technical rating; following weekly reports return to the usual range.'},
 {id:'one-reviewer',name:'Repeated unusual reports from Carla',kind:'primary',note:'Carla gives the unusual technical rating once per week. The synthetic skill is held stable here; her reports are a persistent difference of experience, not independent corroboration.'},
 {id:'several-reviewers',name:'Repeated unusual reports from three colleagues',kind:'primary',note:'Carla, Bob and Dan take turns giving one report per week. This scenario assumes a real skill change. Dates, ratings and counts match the Carla-only case; only reviewer identities differ.'},
 {id:'one-with-peers',name:'Carla differs; three peers continue usual feedback',kind:'context',note:'All four colleagues report each week. Only Carla gives the unusual rating; the others continue the usual range. Skill is assumed stable for evaluation.'},
 {id:'three-with-peers',name:'Three colleagues change; one continues usual feedback',kind:'context',note:'All four colleagues report each week. Carla, Bob and Dan give the unusual rating; Elias continues the usual range. A real change is assumed for evaluation.'},
];
const PEERS=['Carla','Bob','Dan','Elias'];
const TECH=SKILLS[0];
export function patternHistory(direction){
 if(!['low','high'].includes(direction))throw new Error('Direction must be low or high');
 return seedData(STANDARD_QUESTIONS).map(e=>direction==='high'&&e.subject==='Alice'&&e.key===TECH?{...e,rating:6-e.rating}:e);
}
export function makePattern(direction,patternId,weeks=8){
 const pattern=PATTERNS.find(p=>p.id===patternId);if(!pattern)throw new Error('Unknown pattern');
 if(!Number.isInteger(weeks)||weeks<1||weeks>26)throw new Error('Use one to 26 weekly rounds');
 const history=patternHistory(direction),surveys=[],events=[];
 const unusualRating=direction==='low'?1:5;
 const usual=week=>{const rating=week%3===1?4:5;return direction==='low'?rating:6-rating;};
 for(let week=0;week<weeks;week++){
  const time=BASE_DATE+week*7*DAY;
  const authors=pattern.kind==='context'?PEERS:[patternId==='several-reviewers'?PEERS[week%3]:'Carla'];
  for(const author of authors){
   const changed=patternId==='isolated'?week===0:patternId==='one-reviewer'||patternId==='several-reviewers'?true:patternId==='one-with-peers'?author==='Carla':patternId==='three-with-peers'?author!=='Elias':false;
   const rating=changed?unusualRating:usual(week);
   const id=`pattern-${direction}-${patternId}-${week}-${author}`;
   const answers=surveyEvents(STANDARD_QUESTIONS,author,'Alice',[TECH,SKILLS[1],SKILLS[4]],[rating,null,null,null,null],time,id).map(e=>({...e,changedTechnical:e.key===TECH&&changed}));
   events.push(...answers);surveys.push({id,week:week+1,author,subject:'Alice',time,rating,changed,answers});
  }
 }
 const changedTruth=['several-reviewers','three-with-peers'].includes(patternId);
 const originalAbility=direction==='low'?4.5:1.5;
 return {direction,pattern,history,events,surveys,weeks,assumedSkill:changedTruth?unusualRating:originalAbility,truthChanges:changedTruth};
}
export function evaluatePattern(direction,patternId,weeks=8){
 const scenario=makePattern(direction,patternId,weeks),all=[...scenario.history,...scenario.events];
 const baseline=skill(scenario.history,'Alice',TECH,BASE_DATE,DEFAULTS);
 const checkpoints=[{round:0,time:BASE_DATE-1,plain:baseline.plain,current:baseline.score,plainDelta:0,currentDelta:0,reports:0,changedReports:0,changedReviewers:0,currentChangedFactors:[],evidence:skillEvidence(scenario.history,'Alice',TECH,BASE_DATE-1),truth:points(direction==='low'?4.5:1.5)}];
 for(let week=0;week<weeks;week++){
  const now=BASE_DATE+week*7*DAY,result=skill(all,'Alice',TECH,now,DEFAULTS);
  const soFar=scenario.surveys.filter(s=>s.time<=now),changed=soFar.filter(s=>s.changed);
  checkpoints.push({round:week+1,time:now,plain:result.plain,current:result.score,plainDelta:result.plain-baseline.plain,currentDelta:result.score-baseline.score,reports:soFar.length,changedReports:changed.length,changedReviewers:new Set(changed.map(s=>s.author)).size,evidence:skillEvidence(all,'Alice',TECH,now),median:result.median,discountedHistoricalUnits:result.rows.filter(r=>r.time<BASE_DATE&&r.factor<1).length,historicalUnits:result.rows.filter(r=>r.time<BASE_DATE).length,currentChangedFactors:result.rows.filter(r=>r.changedTechnical).map(r=>({id:r.id,author:r.author,time:r.time,factor:r.factor,supporters:r.supporters})),truth:points(scenario.assumedSkill),plainError:Math.abs(result.plain-points(scenario.assumedSkill)),currentError:Math.abs(result.score-points(scenario.assumedSkill))});
 }
 return {id:`${direction}:${patternId}`,direction,patternId,name:scenario.pattern.name,kind:scenario.pattern.kind,note:scenario.pattern.note,weeks,baseline:{plain:baseline.plain,current:baseline.score},assumedSkill:scenario.assumedSkill,truthChanges:scenario.truthChanges,checkpoints,surveys:scenario.surveys};
}
export function runPatternStudy(){
 return {version:'feedback-patterns-0.2',seed:17026,settings:{...DEFAULTS,reviewerCalibration:false},weeks:8,subject:'Alice',skill:TECH,mirroredPositiveHistory:true,results:['low','high'].flatMap(direction=>PATTERNS.map(pattern=>evaluatePattern(direction,pattern.id)))};
}
