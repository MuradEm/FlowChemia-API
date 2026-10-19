import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createFreshTeam,nextFreshSurvey,submitFreshSurvey,freshTeamCards} from './fresh-team.mjs';
test('fresh team starts with no answers, no skill scores and no chemistry scores',()=>{
 const s=createFreshTeam();assert.equal(s.events.length,0);assert.equal(s.people.length,5);
 for(const card of freshTeamCards(s)){assert.ok(Object.values(card.skills).every(v=>v.score===null&&v.evidence.units===0));assert.ok(card.chemistry.every(c=>c.enjoyment===null&&c.effectiveness===null&&c.combinedReportedEffectiveness===null));}
});
test('thirty surveys mean six per person, two per round, covering all other colleagues',()=>{
 const s=createFreshTeam();assert.equal(s.surveys.length,30);assert.equal(s.surveys.filter(x=>x.status==='OPEN').length,10);
 for(const person of s.people){const own=s.surveys.filter(x=>x.author===person);assert.equal(own.length,6);assert.equal(new Set(own.map(x=>x.subject)).size,4);assert.ok(own.every(x=>x.subject!==person));for(let round=0;round<3;round++)assert.equal(own.filter(x=>x.round===round).length,2);}
 assert.ok(s.surveys.filter(x=>x.status==='OPEN').every(x=>x.questions.length===5));assert.ok(s.surveys.filter(x=>x.round>0).every(x=>x.questions===null));
});
test('first answer establishes only observed target skills and the respondent direction',()=>{
 const s=createFreshTeam(),survey=nextFreshSurvey(s),after=submitFreshSurvey(s,survey.id,[4,3,null,2,5]);
 assert.equal(s.events.length,0);assert.equal(after.events.length,5);
 const target=freshTeamCards(after).find(c=>c.person===survey.subject),author=freshTeamCards(after).find(c=>c.person===survey.author);
 assert.equal(target.skills[survey.questions[0].skillName].score,75);assert.equal(target.skills[survey.questions[1].skillName].score,50);assert.equal(target.skills[survey.questions[2].skillName].score,null);
 assert.equal(author.chemistry.find(c=>c.colleague===survey.subject).enjoyment,25);assert.equal(author.chemistry.find(c=>c.colleague===survey.subject).effectiveness,100);
 assert.equal(target.chemistry.find(c=>c.colleague===survey.author).enjoyment,null);assert.equal(author.chemistry.find(c=>c.colleague===survey.subject).combinedReportedEffectiveness,null);
});
test('invalid, future or conflicting answers are rejected and exact retries never duplicate evidence',()=>{
 const s=createFreshTeam(),q=nextFreshSurvey(s);for(const a of [[1],[0,2,3,4,5],[1,2,3,4,'5']])assert.throws(()=>submitFreshSurvey(s,q.id,a));
 assert.throws(()=>submitFreshSurvey(s,s.surveys[10].id,[1,2,3,4,5]));
 const after=submitFreshSurvey(s,q.id,[1,2,3,4,5]);assert.equal(submitFreshSurvey(after,q.id,[1,2,3,4,5]).events.length,5);assert.throws(()=>submitFreshSurvey(after,q.id,[5,4,3,2,1]));
});
test('only finishing the ten current surveys generates the next adaptive round',()=>{
 let s=createFreshTeam();for(let i=0;i<9;i++)s=submitFreshSurvey(s,nextFreshSurvey(s).id,[null,null,null,null,null]);assert.equal(s.currentRound,0);s=submitFreshSurvey(s,nextFreshSurvey(s).id,[null,null,null,null,null]);assert.equal(s.currentRound,1);assert.equal(s.surveys.filter(x=>x.status==='OPEN').length,10);assert.ok(Object.values(freshTeamCards(s)[0].skills).every(x=>x.score===null));
});
test('pending reservations spread wording across simultaneous surveys without adding evidence',()=>{
 const s=createFreshTeam();const surveys=s.surveys.filter(x=>x.status==='OPEN'&&x.subject==='Bob');assert.equal(surveys.length,2);assert.notDeepEqual(surveys[0].questions.map(q=>q.templateKey),surveys[1].questions.map(q=>q.templateKey));assert.equal(s.events.length,0);
});
