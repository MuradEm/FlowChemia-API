import {BASE_DATE, DAY, DEFAULTS, SKILLS, decay, units, summarizeUnits} from './model.mjs';

// Experimental relative rater-severity correction. No truth labels, chemistry,
// current-target feedback, or person's overall mean is used for learning it.
export const CALIBRATION_DEFAULTS = {maxAdjustment:0.5, priorEvidence:12, minUnits:8, minSubjects:3, matchWindowDays:21, minPeerReviewers:2};
export function learnReviewerAdjustment(events, reviewer, excludedSubject, now=BASE_DATE, options={}) {
  const cfg={...DEFAULTS,...CALIBRATION_DEFAULTS,...options};
  const data=units(events,now).filter(e=>SKILLS.includes(e.key)&&e.subject!==excludedSubject);
  const groups=new Map();
  for(const e of data){const key=JSON.stringify([e.subject,e.key]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(e);}
  const comparisons=[];
  for(const e of data.filter(e=>e.author===reviewer)){
    const peers=(groups.get(JSON.stringify([e.subject,e.key]))??[]).filter(p=>p.author!==reviewer&&Math.abs(p.time-e.time)<=cfg.matchWindowDays*DAY);
    if(new Set(peers.map(p=>p.author)).size<cfg.minPeerReviewers)continue;
    // Give each peer reviewer one comparison vote, regardless of survey count.
    const peerGroups=new Map();
    for(const p of peers){const value=peerGroups.get(p.author)??{sum:0,weight:0};const w=decay(p.time,e.time,cfg.halfLifeDays);value.sum+=w*p.rating;value.weight+=w;peerGroups.set(p.author,value);}
    const reference=[...peerGroups.values()].reduce((n,p)=>n+p.sum/p.weight,0)/peerGroups.size;
    comparisons.push({subject:e.subject,residual:e.rating-reference,weight:decay(e.time,now,cfg.halfLifeDays)});
  }
  const subjects=new Set(comparisons.map(e=>e.subject));
  const count=comparisons.length,effectiveEvidence=comparisons.reduce((n,e)=>n+e.weight,0);
  if(count<cfg.minUnits||subjects.size<cfg.minSubjects)return {adjustment:0,rawResidual:0,matchedUnits:count,subjects:subjects.size,effectiveEvidence,reason:'Insufficient matched history'};
  // Equal subject weighting prevents one frequently reviewed colleague dominating.
  const bySubject=[...subjects].map(subject=>{const rows=comparisons.filter(e=>e.subject===subject),weight=rows.reduce((n,e)=>n+e.weight,0);return rows.reduce((n,e)=>n+e.residual*e.weight,0)/weight;});
  const rawResidual=bySubject.reduce((n,r)=>n+r,0)/bySubject.length;
  const shrinkage=effectiveEvidence/(effectiveEvidence+cfg.priorEvidence);
  const adjustment=Math.max(-cfg.maxAdjustment,Math.min(cfg.maxAdjustment,rawResidual*shrinkage));
  return {adjustment,rawResidual,shrinkage,matchedUnits:count,subjects:subjects.size,effectiveEvidence,reason:'Matched history on other colleagues'};
}
export function reviewerAdjustments(events, subject, now=BASE_DATE, options={}) {
  return Object.fromEntries([...new Set(events.filter(e=>e.time<=now&&e.subject===subject&&SKILLS.includes(e.key)&&e.rating!==null).map(e=>e.author))].map(author=>[author,learnReviewerAdjustment(events,author,subject,now,options)]));
}
export function calibratedSkill(events, subject, key, now=BASE_DATE, options={}, learned=null) {
  if(!SKILLS.includes(key))throw new Error('Reviewer adjustment applies to skills only');
  const adjustments=learned??reviewerAdjustments(events,subject,now,options);
  const data=units(events,now).filter(e=>e.subject===subject&&e.key===key).map(e=>({...e,rawRating:e.rating,reviewerAdjustment:adjustments[e.author]?.adjustment??0,rating:Math.max(1,Math.min(5,e.rating-(adjustments[e.author]?.adjustment??0)))}));
  return {...summarizeUnits(data,now,options),reviewerAdjustments:adjustments};
}
