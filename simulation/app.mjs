const byId=id=>document.getElementById(id);
const escapeHTML=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=value=>value===null?'—':value.toFixed(1);
const change=(from,to)=>from===null||to===null?'—':`${to-from>=0?'+':''}${(to-from).toFixed(1)}`;
const initial=seedData(LIBRARY);let events=[...initial],now=BASE_DATE,log=[],snapshots=[];
function options(items,selected){return items.map(value=>`<option value="${escapeHTML(value)}"${value===selected?' selected':''}>${escapeHTML(value)}</option>`).join('');}
byId('author').innerHTML=options(PEOPLE,'Alice');byId('subject').innerHTML=options(PEOPLE,'Bob');
byId('question-inputs').innerHTML=[0,1,2].map((i)=>`<div class="row"><div><label for="skill-${i}">Skill question ${i+1}</label><select id="skill-${i}">${options(SKILLS,SKILLS[[0,1,4][i]])}</select><p id="skill-prompt-${i}" class="small"></p></div><div><label for="rating-${i}">Rating</label><select id="rating-${i}">${options(['1','2','3','4','5','Unobserved'],'4')}</select></div></div>`).join('')+['Enjoyment','Effectiveness'].map((name,i)=>`<label for="rating-${i+3}">${name}: ${escapeHTML(LIBRARY.find(q=>q.dimension===`CHEMISTRY_${name.toUpperCase()}`).text)}</label><select id="rating-${i+3}">${options(['1','2','3','4','5','Unobserved'],'4')}</select>`).join('');
function config(){return {...DEFAULTS,halfLifeDays:Number(byId('half-life').value),unusualWeight:Number(byId('discount').value)/100,maxAdjustment:Number(byId('calibration-cap').value),reviewerCalibration:byId('calibration-enabled').checked};}
const adjustmentCache=new WeakMap();
function learned(data,subject,time,cfg){
  const cacheKey=`${data.length}:${subject}:${time}:${cfg.halfLifeDays}:${cfg.maxAdjustment}`;
  let cache=adjustmentCache.get(data);if(!cache){cache=new Map();adjustmentCache.set(data,cache);}
  if(!cache.has(cacheKey))cache.set(cacheKey,reviewerAdjustments(data,subject,time,cfg));
  return cache.get(cacheKey);
}
function skillInLab(data,subject,key,time,cfg){return cfg.reviewerCalibration?calibratedSkill(data,subject,key,time,cfg,learned(data,subject,time,cfg)):skill(data,subject,key,time,cfg);}
function metricInLab(data,metric,subject,time,cfg){return SKILLS.includes(metric.key)?skillInLab(data,subject,metric.key,time,cfg):estimate(data,metric.filter,time,cfg);}
function formEvents(){return surveyEvents(LIBRARY,byId('author').value,byId('subject').value,[0,1,2].map(i=>byId(`skill-${i}`).value),[0,1,2,3,4].map(i=>byId(`rating-${i}`).value==='Unobserved'?null:Number(byId(`rating-${i}`).value)),now,`trial-${log.length}`);}
function drawChart(subject,key,cfg){
  const series=[{data:initial,time:BASE_DATE},...snapshots];
  const values=series.map(s=>skillInLab(s.data,subject,key,s.time,cfg));const width=640,height=165,left=35,right=15,top=12,bottom=24;
  const x=i=>left+i*(width-left-right)/Math.max(1,values.length-1),y=n=>top+(100-n)*(height-top-bottom)/100;
  const line=field=>values.filter(v=>v[field]!==null).map((v,i)=>`${x(i)},${y(v[field])}`).join(' ');
  byId('history-chart').innerHTML=`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Candidate and unadjusted technical skill points over applied survey steps">${[0,50,100].map(v=>`<line x1="${left}" y1="${y(v)}" x2="${width-right}" y2="${y(v)}" stroke="#e0e9eb"/><text x="0" y="${y(v)+4}" fill="#607b83" font-size="11">${v}</text>`).join('')}<polyline fill="none" stroke="#e49b28" stroke-width="2" points="${line('plain')}"/><polyline fill="none" stroke="#0f4c5c" stroke-width="3" points="${line('score')}"/>${values.map((v,i)=>v.score===null?'':`<circle cx="${x(i)}" cy="${y(v.score)}" r="3" fill="#0f4c5c"/>`).join('')}<text x="${left}" y="${height-3}" fill="#607b83" font-size="11">Seeded team</text><text x="${width-right}" y="${height-3}" text-anchor="end" fill="#607b83" font-size="11">${snapshots.length} applied surveys</text></svg>`;
}
function render(){
  const cfg=config(),author=byId('author').value,subject=byId('subject').value;
  for(const i of [0,1,2])byId(`skill-prompt-${i}`).textContent=LIBRARY.find(q=>q.skillName===byId(`skill-${i}`).value).text;
  byId('half-life-label').textContent=cfg.halfLifeDays;byId('discount-label').textContent=Math.round(cfg.unusualWeight*100);
  byId('clock').textContent=`Simulation date: ${new Date(now).toISOString().slice(0,10)} · ${log.length} applied surveys`;
  let additions=[];try{additions=formEvents();byId('error').textContent='';byId('apply').disabled=false;byId('next').disabled=false;}catch(error){byId('error').textContent=error.message;byId('apply').disabled=true;byId('next').disabled=true;}
  const preview=[...events,...additions];
  byId('team').innerHTML=`<thead><tr><th>Employee</th>${SKILLS.map(s=>`<th>${escapeHTML(s)}</th>`).join('')}</tr></thead><tbody>${PEOPLE.map(person=>`<tr><td>${person}</td>${SKILLS.map(key=>{const s=skillInLab(events,person,key,now,cfg);return `<td class="num${person===subject?' selected':''}" title="${s.units} reviewer-week units from ${s.reviewers} colleagues">${number(s.score)}</td>`;}).join('')}</tr>`).join('')}</tbody>`;
  byId('skill-evidence').innerHTML='<thead><tr><th>Skill</th><th>Recent reviewers</th><th>Reviewer-week units</th><th>Largest share</th><th>Spread (stars)</th></tr></thead><tbody>'+SKILLS.map(key=>{
    const e=skillEvidence(events,subject,key,now,{halfLifeDays:cfg.halfLifeDays});
    return `<tr><td>${escapeHTML(key)}</td><td>${e.reviewers}</td><td>${e.units}</td><td>${e.largestReviewerShare===null?'—':(100*e.largestReviewerShare).toFixed(1)+'%'}</td><td>${number(e.betweenReviewerSpreadStars)}</td></tr>`;
  }).join('')+'</tbody>';
  byId('detail-title').textContent=`${author} → ${subject}: survey preview`;
  const metrics=[...SKILLS.map(key=>({label:key,key,filter:e=>e.subject===subject&&e.key===key})),...['CHEMISTRY_ENJOYMENT','CHEMISTRY_EFFECTIVENESS'].map(key=>({label:key==='CHEMISTRY_ENJOYMENT'?'Your enjoyment with colleague':'Your reported effectiveness together',key,filter:e=>e.author===author&&e.subject===subject&&e.key===key}))];
  byId('preview').innerHTML='<thead><tr><th>Metric</th><th>Current</th><th>Preview</th><th>Change</th><th>Without outlier adjustment</th></tr></thead><tbody>'+metrics.map(m=>{const before=metricInLab(events,m,subject,now,cfg),after=metricInLab(preview,m,subject,now,cfg);return `<tr><td>${m.label}</td><td class="num">${number(before.score)}</td><td class="num">${number(after.score)}</td><td class="num ${after.score>=before.score?'positive':'negative'}">${change(before.score,after.score)}</td><td class="num">${number(after.plain)}</td></tr>`;}).join('')+'</tbody>';
  const tech=skillInLab(preview,subject,SKILLS[0],now,cfg);
  byId('diagnostic').textContent=`Technical evidence after preview: ${tech.units} reviewer-week units, ${tech.reviewers} distinct colleagues; ${tech.discounted} units currently discounted. Effective weight: ${tech.effectiveEvidence.toFixed(2)}. These counts are not a calibrated confidence score.`;
  drawChart(subject,SKILLS[0],cfg);
  byId('calibration-cap-label').textContent=cfg.maxAdjustment.toFixed(2);
  const adjustments=learned(events,subject,now,cfg);
  byId('reviewer-adjustments').innerHTML='<thead><tr><th>Reviewer</th><th>Correction (stars)</th><th>Matched units</th><th>Other colleagues</th></tr></thead><tbody>'+Object.entries(adjustments).map(([author,value])=>`<tr><td>${escapeHTML(author)}</td><td>${cfg.reviewerCalibration?value.adjustment.toFixed(3):'Off ('+value.adjustment.toFixed(3)+' available)'}</td><td>${value.matchedUnits}</td><td>${value.subjects}</td></tr>`).join('')+'</tbody>';
  byId('pair').innerHTML='<thead><tr><th>Perspective</th><th>Enjoyment current → preview</th><th>Effectiveness current → preview</th></tr></thead><tbody>'+[[author,subject],[subject,author]].map(([a,b])=>`<tr><td>${a} → ${b}</td>${['CHEMISTRY_ENJOYMENT','CHEMISTRY_EFFECTIVENESS'].map(key=>`<td class="num">${number(direction(events,a,b,key,now,cfg).score)} → ${number(direction(preview,a,b,key,now,cfg).score)}</td>`).join('')}</tr>`).join('')+'</tbody>';
  byId('combined').textContent=`Combined reported effectiveness: ${number(combinedEffectiveness(events,author,subject,now,cfg))} → ${number(combinedEffectiveness(preview,author,subject,now,cfg))}. Both directions are required.`;
  const reservations=[],authors=PEOPLE.filter(p=>p!==subject).slice(0,3),planned=[];
  for(const a of authors){const questions=allocate(events,byId('reserve').checked?reservations:[],LIBRARY,a,subject,now,cfg.halfLifeDays);planned.push({author:a,questions});reservations.push({author:a,subject,questions,active:true});}
  byId('planner').innerHTML=`<thead><tr>${planned.map(r=>`<th>${r.author} → ${subject}</th>`).join('')}</tr></thead><tbody><tr>${planned.map(r=>`<td><ol>${r.questions.map(q=>`<li><span class="skill">${escapeHTML(q.skillName??q.dimension.replace('CHEMISTRY_',''))}</span><br>${escapeHTML(q.text)}</li>`).join('')}</ol></td>`).join('')}</tr></tbody>`;
  const used=planned.flatMap(r=>r.questions.map(q=>q.templateKey));byId('planner-note').textContent=`${new Set(used).size} distinct question wordings across 15 planned questions. Some overlap is expected: only five skills and three wordings per category are available. Reservations have added no scoring evidence.`;
  byId('log').innerHTML=log.length?log.slice().reverse().map(row=>`<p>${row.date} · ${row.author} → ${row.subject}: ${row.ratings.map(r=>r===null?'unobserved':r).join(', ')}</p>`).join(''):'No trial surveys applied yet. Try a low or high outlier, apply it, then repeat next week twice.';
}
function apply(advance){try{formEvents();if(advance)now+=7*DAY;const added=formEvents();events.push(...added);log.push({date:new Date(now).toISOString().slice(0,10),author:byId('author').value,subject:byId('subject').value,ratings:added.map(e=>e.rating),events:added});snapshots.push({time:now,data:[...events]});render();}catch(error){byId('error').textContent=error.message;}}
byId('apply').addEventListener('click',()=>apply(false));byId('next').addEventListener('click',()=>apply(true));
byId('reset').addEventListener('click',()=>{events=[...initial];now=BASE_DATE;log=[];snapshots=[];render();});
for(const type of ['low','high'])byId(type).addEventListener('click',()=>{byId('author').value='Carla';byId('subject').value=type==='low'?'Alice':'Bob';byId('skill-0').value=SKILLS[0];byId('skill-1').value=SKILLS[1];byId('skill-2').value=SKILLS[4];byId('rating-0').value=type==='low'?'1':'5';for(const i of [1,2,3,4])byId(`rating-${i}`).value='Unobserved';render();});
for(const id of ['author','subject','skill-0','skill-1','skill-2','rating-0','rating-1','rating-2','rating-3','rating-4','half-life','discount','reserve','calibration-enabled','calibration-cap'])byId(id).addEventListener('input',render);
byId('export').addEventListener('click',()=>{const payload={modelVersion:config().reviewerCalibration?'experimental-calibration-0.1':'experimental-0.1',seed:17026,settings:config(),now:new Date(now).toISOString(),events,appliedSurveys:log};const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='flowchemia-experiment.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
function renderBenchmark(){
  byId('benchmark-table').innerHTML='<thead><tr><th>Scenario · average error ↓</th><th>Recency only</th><th>Current model</th><th>Adjustment + recency</th><th>Adjustment + current</th></tr></thead><tbody>'+BENCHMARK.results.map(r=>`<tr><td>${escapeHTML(r.name)}</td>${['plain','current','calibration','combined'].map(name=>`<td class="num">${number(r.mae[name])}</td>`).join('')}</tr>`).join('')+'</tbody>';
  const row=BENCHMARK.results.find(r=>r.id===byId('benchmark-scenario').value),key=byId('benchmark-skill').value;
  if(!row)return;
  byId('benchmark-note').textContent=`${row.note} ${row.calibratedBetterSeeds}/${row.seeds} seeds had lower overall error with adjustment + current than with the current model. ${row.cellsScored} skill estimates were scored in total; unavailable estimates stay missing.`;
  byId('benchmark-example').innerHTML='<thead><tr><th>Employee</th><th>Known fictional skill</th><th>Recency only</th><th>Current model</th><th>Adjustment + current</th></tr></thead><tbody>'+row.example.filter(c=>c.skill===key).map(c=>`<tr><td>${c.employee}</td>${['truth','plain','current','combined'].map(name=>`<td class="num">${number(c[name])}</td>`).join('')}</tr>`).join('')+'</tbody>';
  byId('benchmark-spread').textContent=`Average spread across employees (standard deviation in points, averaged over skills/seeds): known skill ${number(row.spread.truth)}, current model ${number(row.spread.current)}, adjustment + current ${number(row.spread.combined)}. A low spread can mean lost information; no model forces a ranking.`;
  byId('benchmark-movement').textContent=row.movement.current===null?'':`Alice’s true technical change is ${row.id==='improvement'?'+55':'−55'} points. After four weekly survey rounds: current model moved ${row.movement.current.toFixed(1)}, adjustment + current moved ${row.movement.combined.toFixed(1)}, recency only moved ${row.movement.plain.toFixed(1)} points. These are mean movements, not the final scores.`;
}
byId('benchmark-scenario').innerHTML=BENCHMARK.results.map(r=>`<option value="${r.id}">${escapeHTML(r.name)}</option>`).join('');byId('benchmark-scenario').value='severity';
byId('benchmark-skill').innerHTML=options(SKILLS,SKILLS[0]);
byId('benchmark-scenario').addEventListener('input',renderBenchmark);byId('benchmark-skill').addEventListener('input',renderBenchmark);renderBenchmark();
function renderPatterns(){
  const item=PATTERN_STUDY.results.find(r=>r.direction===byId('pattern-direction').value&&r.patternId===byId('pattern-case').value);
  if(!item)return;
  byId('pattern-description').textContent=`${item.note} Starting score: ${number(item.baseline.current)}. ${item.direction==='high'?'Positive counterfactual with a mirrored low history.':'Original seeded high technical history.'}`;
  const rows=item.checkpoints,w=640,h=205,left=35,right=14,top=15,bottom=34,x=i=>left+i*(w-left-right)/(rows.length-1),y=n=>top+(100-n)*(h-top-bottom)/100;
  const poly=(key,color,dash='')=>`<polyline fill="none" stroke="${color}" stroke-width="${key==='current'?3:2}" ${dash?'stroke-dasharray="'+dash+'"':''} points="${rows.map((r,i)=>`${x(i)},${y(r[key])}`).join(' ')}"/>`;
  byId('pattern-chart').innerHTML=`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Alice technical score across eight feedback rounds, comparing current outlier discount with recency alone">${[0,25,50,75,100].map(v=>`<line x1="${left}" y1="${y(v)}" x2="${w-right}" y2="${y(v)}" stroke="#e0e9eb"/><text x="0" y="${y(v)+4}" font-size="11" fill="#607b83">${v}</text>`).join('')}${poly('truth','#7d8e94','4 4')}${poly('plain','#e49b28')}${poly('current','#0f4c5c')}${rows.map((r,i)=>`<circle cx="${x(i)}" cy="${y(r.current)}" r="3" fill="#0f4c5c"/><text x="${x(i)}" y="${h-10}" text-anchor="middle" font-size="11" fill="#607b83">${i===0?'Before':i}</text>`).join('')}</svg>`;
  byId('pattern-timeline').innerHTML='<thead><tr><th>Round</th><th>Date</th><th>Recency alone</th><th>Outlier rule</th><th>Unusual reports</th><th>Distinct unusual reviewers</th></tr></thead><tbody>'+rows.map(r=>`<tr><td>${r.round===0?'Before':r.round}</td><td>${r.round===0?'Before first survey':new Date(r.time).toISOString().slice(0,10)}</td><td class="num">${number(r.plain)}</td><td class="num">${number(r.current)}</td><td>${r.changedReports}</td><td>${r.changedReviewers}</td></tr>`).join('')+'</tbody>';
  const last=rows.at(-1),third=rows[3];
  const source=last.evidence;
  byId('pattern-source-summary').textContent=`${source.reviewers} recent reviewer(s), ${source.units} reviewer-week units. Largest contributor: ${source.largestReviewerShare===null?'—':(source.largestReviewerShare*100).toFixed(1)+'%'}. Between-reviewer spread: ${source.betweenReviewerSpreadStars===null?'not assessable with one reviewer':source.betweenReviewerSpreadStars.toFixed(2)+' stars'}.`;
  byId('pattern-sources').innerHTML='<thead><tr><th>Reviewer</th><th>Recent units</th><th>Share of recent evidence</th><th>Mean rating (stars)</th></tr></thead><tbody>'+source.byReviewer.map(r=>`<tr><td>${escapeHTML(r.reviewer)}</td><td>${r.units}</td><td>${(r.share*100).toFixed(1)}%</td><td>${r.meanRating.toFixed(2)}</td></tr>`).join('')+'</tbody>';
  byId('pattern-diagnostic').textContent=`After three rounds: recency ${number(third.plain)}, outlier rule ${number(third.current)}. After eight: recency ${number(last.plain)}, outlier rule ${number(last.current)}. At the last round, ${last.discountedHistoricalUnits} of ${last.historicalUnits} original technical evidence units are discounted. Total new surveys: ${last.reports}.`;
}
byId('pattern-case').innerHTML=PATTERN_STUDY.results.filter(r=>r.direction==='low').map(r=>`<option value="${r.patternId}">${escapeHTML(r.name)}</option>`).join('');byId('pattern-case').value='one-reviewer';
byId('pattern-direction').addEventListener('input',renderPatterns);byId('pattern-case').addEventListener('input',renderPatterns);renderPatterns();
render();
