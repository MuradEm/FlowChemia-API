import {test} from 'node:test';
import assert from 'node:assert/strict';
import {selectQuestions} from '../dist/src/question-selection.js';

const now=Date.UTC(2027,0,18,12), DAY=86400000;
const pool=Array.from({length:5},(_,i)=>['a','b','c'].map(word=>({id:`s${i}${word}`,questionKey:`s${i}${word}`,dimension:'SKILL',weights:[{skillId:`skill${i}`,weight:1}]}))).flat();
for(const dimension of ['CHEMISTRY_ENJOYMENT','CHEMISTRY_EFFECTIVENESS'])for(const word of ['a','b'])pool.push({id:dimension+word,questionKey:dimension+word,dimension,weights:[]});
const event=(q,author='A',subject='B',time=now)=>({author,subject,time,question:q});
const select=(e=[],p=[],author='A',subject='B',library=pool)=>selectQuestions(library,e,p,author,subject,now);
const skills=ids=>ids.map(id=>pool.find(q=>q.id===id)).filter(q=>q.dimension==='SKILL').map(q=>q.weights[0].skillId);

test('empty history chooses five distinct questions across three skills and both chemistry dimensions',()=>{
  const ids=select();assert.equal(new Set(ids).size,5);assert.equal(new Set(skills(ids)).size,3);
  assert.ok(ids.some(id=>id.startsWith('CHEMISTRY_ENJOYMENT')));assert.ok(ids.some(id=>id.startsWith('CHEMISTRY_EFFECTIVENESS')));
  assert.deepEqual(select(),ids);
});
test('pending feedback about the same subject spreads skill and wording coverage across respondents',()=>{
  const first=select();const second=select([],first.map(id=>event(pool.find(q=>q.id===id),'C')));
  assert.notDeepEqual(skills(second),skills(first));
  assert.ok(second.filter(id=>id.startsWith('s')).every(id=>!first.includes(id)));
});
test('skill evidence carries across colleagues but chemistry coverage stays directional',()=>{
  const evidence=pool.filter(q=>q.id==='s0a'||q.id==='CHEMISTRY_ENJOYMENTa').map(q=>event(q,'C'));
  assert.ok(!skills(select(evidence)).includes('skill0'));
  assert.ok(select(evidence).includes('CHEMISTRY_ENJOYMENTa'));
  assert.ok(select(evidence,[],'C').includes('CHEMISTRY_ENJOYMENTb'));
});
test('old evidence has less coverage than recent evidence',()=>{
  const e=pool.filter(q=>q.dimension==='SKILL'&&q.id.endsWith('a')).map(q=>event(q,'C','B',now-(q.id==='s4a'?84:0)*DAY));
  assert.equal(skills(select(e))[0],'skill4');
});
test('same-week duplicates do not multiply answered coverage and other subjects do not count',()=>{
  const q=pool.find(q=>q.id==='s0a');const one=[event(q)];
  assert.deepEqual(select(one),select([...one,...one,...one]));
  assert.deepEqual(select(),select([event(q,'A','Elsewhere')]));
});
test('custom multi-skill questions reserve weighted coverage for both skills',()=>{
  const custom={id:'custom',questionKey:'custom',dimension:'SKILL',weights:[{skillId:'skill0',weight:0.5},{skillId:'skill1',weight:0.5}]};
  const ids=selectQuestions([custom,...pool],[],[], 'A','B',now);
  assert.equal(ids[0],'custom');assert.deepEqual(skills(ids.slice(1)),['skill2','skill3']);
});
