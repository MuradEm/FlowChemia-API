import {STANDARD_QUESTIONS as library} from '../src/standard-questions.ts';
import {DAY,DEFAULTS,SKILLS,allocate,skill,direction} from './model.mjs';
import {skillEvidence} from './evidence.mjs';

export const FRESH_PEOPLE=['Alice','Bob','Carla','Dan','Elias'];
function openRound(session,round){
  const time=session.startTime+round*7*DAY;
  for(const survey of session.surveys.filter(s=>s.round===round)){
    const reservations=session.surveys.filter(s=>s.status==='OPEN').map(s=>({author:s.author,subject:s.subject,questions:s.questions,active:true}));
    survey.questions=allocate(session.events,reservations,library,survey.author,survey.subject,time,session.settings.halfLifeDays).map(q=>({...q}));
    survey.status='OPEN';
  }
  session.currentRound=round;
}
export function createFreshTeam({id='fresh-team-001',startTime=Date.UTC(2026,9,19,12)}={}){
  const session={id,version:'fresh-team-0.1',startTime,currentRound:0,people:[...FRESH_PEOPLE],settings:{...DEFAULTS,scoreMode:'RECENCY_ONLY',reviewerCalibration:false},events:[],surveys:[]};
  for(let round=0;round<3;round++)for(let author=0;author<5;author++)for(let slot=0;slot<2;slot++){
    const subject=(author+1+(round*2+slot)%4)%5;
    session.surveys.push({id:`${id}-${session.surveys.length+1}`,round,author:FRESH_PEOPLE[author],subject:FRESH_PEOPLE[subject],time:startTime+round*7*DAY,status:'PLANNED',questions:null,answers:null});
  }
  openRound(session,0);return session;
}
export function nextFreshSurvey(session){return session.surveys.find(s=>s.status==='OPEN')??null;}
export function submitFreshSurvey(session,id,ratings){
  const survey=session.surveys.find(s=>s.id===id);if(!survey)throw new Error('Unknown survey');
  if(!Array.isArray(ratings)||ratings.length!==5||ratings.some(r=>r!==null&&(!Number.isInteger(r)||r<1||r>5)))throw new Error('Provide five answers: 1–5 or null for unobserved');
  if(survey.status==='COMPLETED'){
    if(JSON.stringify(survey.answers)!==JSON.stringify(ratings))throw new Error('Completed answers cannot be changed');
    return session;
  }
  if(survey.status!=='OPEN')throw new Error('This round has not been generated yet');
  const copy=structuredClone(session),target=copy.surveys.find(s=>s.id===id);
  target.answers=[...ratings];target.status='COMPLETED';
  copy.events.push(...target.questions.map((q,i)=>({id:`${target.id}:${i+1}`,author:target.author,subject:target.subject,time:target.time,key:q.skillName??q.dimension,questionId:q.templateKey,rating:ratings[i]})));
  if(!copy.surveys.some(s=>s.round===copy.currentRound&&s.status==='OPEN')&&copy.currentRound<2)openRound(copy,copy.currentRound+1);
  return copy;
}
export function freshTeamCards(session){
  const now=session.startTime+session.currentRound*7*DAY;
  return session.people.map(person=>({person,skills:Object.fromEntries(SKILLS.map(key=>{const s=skill(session.events,person,key,now,session.settings);return [key,{score:s.plain,comparisonOutlierScore:s.score,evidence:skillEvidence(session.events,person,key,now,session.settings)}];})),chemistry:session.people.filter(p=>p!==person).map(colleague=>({colleague,enjoyment:direction(session.events,person,colleague,'CHEMISTRY_ENJOYMENT',now,session.settings).plain,effectiveness:direction(session.events,person,colleague,'CHEMISTRY_EFFECTIVENESS',now,session.settings).plain,combinedReportedEffectiveness:(()=>{
    // Equal directional means, using recency-only scoring for this exercise.
    const a=direction(session.events,person,colleague,'CHEMISTRY_EFFECTIVENESS',now,session.settings).plain,b=direction(session.events,colleague,person,'CHEMISTRY_EFFECTIVENESS',now,session.settings).plain;
    return a===null||b===null?null:(a+b)/2;
  })()}))}));
}
