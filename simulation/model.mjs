// Experimental lab only. The production survey API does not import this module.
export const PEOPLE = ['Alice', 'Bob', 'Carla', 'Dan', 'Elias'];
export const SKILLS = ['Technical Problem Solving', 'Communication', 'Teamwork', 'Leadership', 'Reliability'];
export const DAY = 86400000;
export const BASE_DATE = Date.parse('2026-10-18T12:00:00Z');
export const DEFAULTS = {halfLifeDays: 42, outlierGap: 1.5, unusualWeight: 0.25, restoreAfter: 3, supportWindowDays: 42, minimumHistory: 6};
export const weekOf = time => Math.floor((time - Date.UTC(1970, 0, 5)) / (7 * DAY));
export const points = mean => mean === null ? null : (mean - 1) * 25;
export function decay(time, now, halfLifeDays) { return Math.pow(0.5, Math.max(0, now - time) / DAY / halfLifeDays); }

export function seedData(library, seed = 17026) {
  let state = seed >>> 0;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const skills = [[4.5,3.7,4,3.3,4.3],[2.2,4.1,3.6,3,4],[3.7,3,4.5,4.2,3.8],[4,3.5,3.1,2.7,4.4],[3.2,4.4,4,4.1,3.6]];
  const events = [];
  for (let week = 0; week < 12; week++) for (let author = 0; author < 5; author++) for (let slot = 0; slot < 2; slot++) {
    const subject = (author + 1 + ((week * 2 + slot) % 4)) % 5;
    const when = BASE_DATE - (12 - week) * 7 * DAY;
    const dimensions = [0,1,2].map(i => SKILLS[(week + author + slot + i) % 5]);
    const questions = dimensions.map(skill => library.filter(q => q.skillName === skill)[(week + author) % 3]);
    questions.push(...['CHEMISTRY_ENJOYMENT', 'CHEMISTRY_EFFECTIVENESS'].map(d => library.filter(q => q.dimension === d)[(week + author) % 3]));
    for (const q of questions) {
      const key = q.skillName ?? q.dimension;
      let centre = q.skillName ? skills[subject][SKILLS.indexOf(q.skillName)] : 3.1 + ((author * 7 + subject * 3 + (key === 'CHEMISTRY_ENJOYMENT' ? 2 : 0)) % 7) / 5;
      // Deliberately asymmetric, and friendship can coexist with weak effectiveness.
      if (author === 0 && subject === 1) centre = key === 'CHEMISTRY_ENJOYMENT' ? 4.7 : key === 'CHEMISTRY_EFFECTIVENESS' ? 2.4 : centre;
      if (author === 1 && subject === 0) centre = key === 'CHEMISTRY_ENJOYMENT' ? 2.1 : key === 'CHEMISTRY_EFFECTIVENESS' ? 3.4 : centre;
      const rating = Math.max(1, Math.min(5, Math.round(centre + (random() + random() - 1) * 1.3)));
      events.push({id:`seed-${week}-${author}-${slot}-${q.templateKey}`, author:PEOPLE[author], subject:PEOPLE[subject], key, questionId:q.templateKey, time:when, rating});
    }
  }
  return events;
}

// One reviewer/subject/dimension/calendar-week unit. Duplicate answers in that
// unit are averaged, rather than becoming independent confirmations.
export function units(events, now) {
  const map = new Map();
  for (const e of events) {
    if (e.time > now || e.rating === null) continue;
    if (!Number.isInteger(e.rating) || e.rating < 1 || e.rating > 5) throw new Error('Ratings must be 1–5 or null');
    const id = JSON.stringify([e.author,e.subject,e.key,weekOf(e.time)]);
    const unit = map.get(id) ?? {...e, rating:0, count:0};
    unit.rating += e.rating; unit.count++; unit.time = Math.max(unit.time,e.time); map.set(id,unit);
  }
  return [...map.values()].map(u => ({...u,rating:u.rating/u.count}));
}
function average(rows) {
  const weight = rows.reduce((n,r) => n+r.weight,0);
  return weight ? rows.reduce((n,r) => n+r.rating*r.weight,0)/weight : null;
}
export function estimate(events, filter, now=BASE_DATE, settings=DEFAULTS) {
  return summarizeUnits(units(events,now).filter(filter),now,settings);
}
export function summarizeUnits(input, now=BASE_DATE, settings=DEFAULTS) {
  const cfg={...DEFAULTS,...settings};
  const rows=input.map(e=>({...e,weight:decay(e.time,now,cfg.halfLifeDays)}));
  if (!rows.length) return {score:null,plain:null,units:0,reviewers:0,discounted:0,effectiveEvidence:0,rows:[]};
  const sorted=[...rows].sort((a,b)=>a.rating-b.rating);const total=rows.reduce((n,r)=>n+r.weight,0);let accum=0,median=sorted.at(-1).rating;
  for(const row of sorted){accum+=row.weight;if(accum>=total/2){median=row.rating;break;}}
  let discounted=0;
  const adjusted=rows.map(row=>{
    const unusual=rows.length>=cfg.minimumHistory && Math.abs(row.rating-median)>=cfg.outlierGap;
    const supporters=rows.filter(other=>other.time>=now-cfg.supportWindowDays*DAY && Math.abs(other.rating-row.rating)<=0.75).length;
    const factor=unusual && supporters<cfg.restoreAfter ? cfg.unusualWeight : 1;
    if(factor<1)discounted++;
    return {...row,factor,supporters,weight:row.weight*factor};
  });
  return {score:points(average(adjusted)),plain:points(average(rows)),units:rows.length,reviewers:new Set(rows.map(r=>r.author)).size,discounted,effectiveEvidence:adjusted.reduce((n,r)=>n+r.weight,0),rows:adjusted,median};
}
export function skill(events, subject, key, now, cfg) {return estimate(events,e=>e.subject===subject&&e.key===key,now,cfg);}
export function direction(events, author, subject, key, now, cfg) {return estimate(events,e=>e.author===author&&e.subject===subject&&e.key===key,now,cfg);}
export function combinedEffectiveness(events, a, b, now, cfg) {
  const forward=direction(events,a,b,'CHEMISTRY_EFFECTIVENESS',now,cfg).score;
  const reverse=direction(events,b,a,'CHEMISTRY_EFFECTIVENESS',now,cfg).score;
  return forward===null||reverse===null ? null : (forward+reverse)/2;
}
export function surveyEvents(library, author, subject, skills, ratings, now, id='trial') {
  if(author===subject)throw new Error('Choose two different employees');
  if(skills.length!==3||new Set(skills).size!==3)throw new Error('Choose three different skills');
  if(ratings.length!==5)throw new Error('Answer five questions');
  const selected=[...skills.map(name=>library.find(q=>q.skillName===name)),...['CHEMISTRY_ENJOYMENT','CHEMISTRY_EFFECTIVENESS'].map(d=>library.find(q=>q.dimension===d))];
  return selected.map((q,i)=>{
    if(ratings[i]!==null&&(!Number.isInteger(ratings[i])||ratings[i]<1||ratings[i]>5))throw new Error('Ratings must be 1–5 or null');
    return {id:`${id}-${i}`,author,subject,key:q.skillName??q.dimension,questionId:q.templateKey,time:now,rating:ratings[i]};
  });
}

// Reservations affect coverage/wording choice only. No pending answer enters
// estimate(). Call sequentially under a company transaction in a future API.
export function allocate(events, reservations, library, author, subject, now=BASE_DATE, halfLifeDays=42) {
  const pending=reservations.filter(r=>r.active!==false&&r.subject===subject);
  const eligibleUnits=units(events,now);
  const coverage=key=>eligibleUnits.filter(e=>e.subject===subject&&e.key===key&&(SKILLS.includes(key)||e.author===author)).reduce((n,e)=>n+decay(e.time,now,halfLifeDays),0)
    +pending.reduce((n,r)=>n+(SKILLS.includes(key)||r.author===author?r.questions.filter(q=>(q.skillName??q.dimension)===key).length:0),0);
  const chosenSkills=[...SKILLS].sort((a,b)=>coverage(a)-coverage(b)||SKILLS.indexOf(a)-SKILLS.indexOf(b)).slice(0,3);
  const candidates=[...chosenSkills,'CHEMISTRY_ENJOYMENT','CHEMISTRY_EFFECTIVENESS'];
  return candidates.map(key=>{
    const choices=library.filter(q=>(q.skillName??q.dimension)===key);
    const wordingCoverage=q=>eligibleUnits.filter(e=>e.subject===subject&&e.questionId===q.templateKey&&(SKILLS.includes(key)||e.author===author)).reduce((n,e)=>n+decay(e.time,now,halfLifeDays),0)
      +pending.reduce((n,r)=>n+r.questions.filter(other=>other.templateKey===q.templateKey).length,0);
    return [...choices].sort((a,b)=>wordingCoverage(a)-wordingCoverage(b)||a.templateKey.localeCompare(b.templateKey))[0];
  });
}
