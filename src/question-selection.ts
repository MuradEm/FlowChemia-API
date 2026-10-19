// Coverage is independent of ratings and scoring baselines. Pending questions
// reserve coverage, but never become answered evidence or performance scores.
export type SelectionQuestion = {
  id: string; questionKey: string; dimension: string;
  weights: {skillId: string; weight: number}[];
};
export type SelectionEvidence = {
  author: string; subject: string; time: number; question: SelectionQuestion;
};
const DAY = 86400000;
const week = (time: number) => Math.floor((time - Date.UTC(1970, 0, 5)) / (7 * DAY));

export function selectQuestions(pool: SelectionQuestion[], evidence: SelectionEvidence[], pending: SelectionEvidence[], author: string, subject: string, now: number): string[] {
  const skills = pool.filter(q=>q.dimension==='SKILL');
  const chemistry = ['CHEMISTRY_ENJOYMENT', 'CHEMISTRY_EFFECTIVENESS'];
  if (skills.length<3 || chemistry.some(d=>!pool.some(q=>q.dimension===d))) throw new Error('Adaptive selection needs three skill questions and both chemistry dimensions');
  const coverage = new Map<string, number>(), wording = new Map<string, number>();
  // Cap each reviewer's coverage of a dimension/skill in one calendar week.
  const units = new Map<string, {key:string; amount:number; time:number}>();
  for (const e of evidence.filter(e=>e.subject===subject && e.time<=now)) {
    const keys = e.question.dimension==='SKILL' ? e.question.weights.map(w=>({key:w.skillId,amount:w.weight})) : e.author===author ? [{key:e.question.dimension,amount:1}] : [];
    keys.push(...(e.question.dimension==='SKILL'||e.author===author ? [{key:`word:${e.question.questionKey}`,amount:1}] : []));
    for (const k of keys) {
      const id=JSON.stringify([e.author,week(e.time),k.key]);
      const old=units.get(id);
      units.set(id,{key:k.key,amount:Math.min(1,(old?.amount??0)+k.amount),time:Math.max(old?.time??0,e.time)});
    }
  }
  const add=(key:string,amount:number)=>{
    const target=key.startsWith('word:')?wording:coverage;
    target.set(key,(target.get(key)??0)+amount);
  };
  for(const u of units.values()) add(u.key,u.amount*2**(-Math.max(0,now-u.time)/DAY/42));
  const reserve=(e:SelectionEvidence)=>{
    if(e.subject!==subject)return;
    if(e.question.dimension==='SKILL')for(const w of e.question.weights)add(w.skillId,w.weight);
    else if(e.author===author)add(e.question.dimension,1);
    if(e.question.dimension==='SKILL'||e.author===author)add(`word:${e.question.questionKey}`,1);
  };
  pending.forEach(reserve);
  const selected:SelectionQuestion[]=[];
  const need=(q:SelectionQuestion)=>q.dimension==='SKILL' ? q.weights.reduce((sum,w)=>sum+(coverage.get(w.skillId)??0)*w.weight,0) : coverage.get(q.dimension)??0;
  const choose=(choices:SelectionQuestion[])=>{
    const q=[...choices].sort((a,b)=>need(a)-need(b)||(wording.get(`word:${a.questionKey}`)??0)-(wording.get(`word:${b.questionKey}`)??0)||a.questionKey.localeCompare(b.questionKey)||a.id.localeCompare(b.id))[0]!;
    selected.push(q);reserve({author,subject,time:now,question:q});
  };
  for(let i=0;i<3;i++)choose(skills.filter(q=>!selected.some(s=>s.id===q.id)));
  for(const dimension of chemistry)choose(pool.filter(q=>q.dimension===dimension));
  return selected.map(q=>q.id);
}
