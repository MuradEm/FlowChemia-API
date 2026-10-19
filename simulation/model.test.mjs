import {test} from 'node:test';
import assert from 'node:assert/strict';
import {STANDARD_QUESTIONS as library} from '../src/standard-questions.ts';
import {BASE_DATE,DAY,DEFAULTS,PEOPLE,SKILLS,seedData,estimate,skill,direction,combinedEffectiveness,surveyEvents,allocate,units} from './model.mjs';
const data=seedData(library);
test('deterministic five-person fixture respects two five-question surveys per person per week',()=>{
  assert.deepEqual(data,seedData(library));assert.equal(data.length,600);
  assert.ok(data.every(e=>e.author!==e.subject&&e.rating>=1&&e.rating<=5));
  assert.equal(new Set(data.map(e=>e.author)).size,5);
});
test('null and missing evidence never become neutral or negative scores; zero is not a valid rating',()=>{
  assert.equal(estimate([],()=>true).score,null);
  assert.equal(estimate([{author:'A',subject:'B',key:'X',time:BASE_DATE,rating:null}],()=>true).units,0);
  assert.throws(()=>estimate([{author:'A',subject:'B',key:'X',time:BASE_DATE,rating:0}],()=>true));
});
test('recent evidence has greater weight and duplicate reviewer-weeks do not multiply confirmations',()=>{
  const rows=[{author:'A',subject:'B',key:'X',time:BASE_DATE-84*DAY,rating:1},{author:'C',subject:'B',key:'X',time:BASE_DATE,rating:5}];
  assert.ok(estimate(rows,()=>true).score>50);
  assert.equal(units([...rows,...rows],BASE_DATE).length,2);assert.equal(estimate([...rows,...rows],()=>true).score,estimate(rows,()=>true).score);
});
for(const [previous,unusual] of [[5,1],[1,5]])test(`isolated ${unusual}-star rating is bounded; repeated changes regain influence after a ${previous}-star history`,()=>{
  const old=Array.from({length:12},(_,i)=>({author:PEOPLE[i%4],subject:'Elias',key:SKILLS[0],time:BASE_DATE-(12-i)*7*DAY,rating:previous}));
  const one={author:'Alice',subject:'Elias',key:SKILLS[0],time:BASE_DATE,rating:unusual};
  const first=estimate([...old,one],()=>true);assert.equal(first.rows.find(r=>r.time===BASE_DATE).factor,0.25);
  assert.ok(Math.abs(first.score-estimate(old,()=>true).score)<Math.abs(first.plain-estimate(old,()=>true).plain));
  const repeat=[...old,...[0,1,2].map(i=>({...one,time:BASE_DATE+i*7*DAY}))];
  const last=estimate(repeat,()=>true,BASE_DATE+14*DAY);assert.ok(last.rows.filter(r=>r.rating===unusual).every(r=>r.factor===1));
  assert.ok(Math.abs(last.score-estimate(old,()=>true).score)>Math.abs(first.score-estimate(old,()=>true).score));
});
test('one person spamming a rating in the same week cannot restore its weight',()=>{
  const old=Array.from({length:12},(_,i)=>({author:PEOPLE[i%4],subject:'Elias',key:SKILLS[0],time:BASE_DATE-(12-i)*7*DAY,rating:5}));
  const recent=Array.from({length:20},()=>({author:'Alice',subject:'Elias',key:SKILLS[0],time:BASE_DATE,rating:1}));
  const result=estimate([...old,...recent],()=>true);assert.equal(result.rows.find(r=>r.time===BASE_DATE).factor,0.25);
});
test('skill changes do not alter other employees; directional chemistry does not overwrite the reverse report',()=>{
  const added=surveyEvents(library,'Alice','Bob',SKILLS.slice(0,3),[1,2,3,1,5],BASE_DATE);
  assert.equal(skill([...data,...added],'Carla',SKILLS[0]).score,skill(data,'Carla',SKILLS[0]).score);
  assert.equal(direction([...data,...added],'Bob','Alice','CHEMISTRY_ENJOYMENT').score,direction(data,'Bob','Alice','CHEMISTRY_ENJOYMENT').score);
  assert.notEqual(direction([...data,...added],'Alice','Bob','CHEMISTRY_ENJOYMENT').score,direction(data,'Alice','Bob','CHEMISTRY_ENJOYMENT').score);
  assert.equal(combinedEffectiveness([],'Alice','Bob'),null);
});
test('pending reservations diversify simultaneous questionnaires but never affect scores',()=>{
  const pending=[];const before=skill(data,'Alice',SKILLS[0]).score;
  for(const author of PEOPLE.slice(1,4)){const questions=allocate(data,pending,library,author,'Alice');assert.equal(questions.length,5);pending.push({author,subject:'Alice',questions,active:true});}
  assert.ok(new Set(pending.map(r=>r.questions.map(q=>q.templateKey).join(','))).size>1);
  assert.equal(skill(data,'Alice',SKILLS[0]).score,before);
  assert.deepEqual(allocate(data,pending.map(r=>({...r,active:false})),library,'Bob','Alice'),allocate(data,[],library,'Bob','Alice'));
});
