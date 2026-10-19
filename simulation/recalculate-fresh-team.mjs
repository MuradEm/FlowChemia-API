import {readFile, writeFile} from 'node:fs/promises';
import {DAY, SKILLS, decay, weekOf} from './model.mjs';

// An alternative scoring experiment. The original answers/session stay intact.
const session = JSON.parse(await readFile(new URL('./sessions/fresh-team-001.json', import.meta.url), 'utf8'));
const starPoints = {1:30, 2:50, 3:65, 4:80, 5:100};
const now = session.startTime + session.currentRound * 7 * DAY;
const prior = {score:70, units:5, time:session.startTime};
const grouped = new Map();
for (const event of session.events) {
  if (event.rating === null || event.time > now) continue;
  const key = JSON.stringify([event.author, event.subject, event.key, weekOf(event.time)]);
  const unit = grouped.get(key) ?? {...event, total:0, count:0};
  unit.total += starPoints[event.rating];
  unit.count++;
  unit.time = Math.max(unit.time, event.time);
  grouped.set(key, unit);
}
const units = [...grouped.values()];
function score(filter) {
  const rows = units.filter(filter);
  const priorWeight = prior.units * decay(prior.time, now, session.settings.halfLifeDays);
  let sum = prior.score * priorWeight, weight = priorWeight;
  for (const row of rows) {
    const w = decay(row.time, now, session.settings.halfLifeDays);
    sum += row.total / row.count * w;
    weight += w;
  }
  return {score:sum/weight, realUnits:rows.length, realReviewers:new Set(rows.map(r=>r.author)).size};
}
const cards = session.people.map(person=>({person,
  skills:Object.fromEntries(SKILLS.map(key=>[key,score(e=>e.subject===person && e.key===key)])),
  chemistry:session.people.filter(p=>p!==person).map(colleague=>({colleague,
    enjoyment:score(e=>e.author===person && e.subject===colleague && e.key==='CHEMISTRY_ENJOYMENT'),
    effectiveness:score(e=>e.author===person && e.subject===colleague && e.key==='CHEMISTRY_EFFECTIVENESS'),
    combinedReportedEffectiveness:(score(e=>e.author===person && e.subject===colleague && e.key==='CHEMISTRY_EFFECTIVENESS').score + score(e=>e.author===colleague && e.subject===person && e.key==='CHEMISTRY_EFFECTIVENESS').score)/2,
  })),
}));
const report = {sessionId:session.id, starPoints, prior, halfLifeDays:session.settings.halfLifeDays, cards};
await writeFile(new URL('./sessions/fresh-team-001-prior-comparison.json', import.meta.url), JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
