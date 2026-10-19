import {BASE_DATE,DAY,SKILLS,decay,units} from './model.mjs';

// Descriptive lab diagnostics only: never used to change a rating or its weight.
export function skillEvidence(events,subject,key,now=BASE_DATE,options={}) {
  if(!SKILLS.includes(key))throw new Error('Cross-reviewer diversity applies to skill evidence, not directional chemistry');
  const {windowDays=42,halfLifeDays=42}=options;
  if(!Number.isFinite(windowDays)||windowDays<=0||!Number.isFinite(halfLifeDays)||halfLifeDays<=0)throw new Error('Evidence window and half-life must be positive');
  const rows=units(events,now).filter(e=>e.subject===subject&&e.key===key&&e.time>=now-windowDays*DAY);
  const groups=new Map();
  for(const row of rows){const group=groups.get(row.author)??{reviewer:row.author,units:0,weight:0,sum:0,latestAt:row.time};const w=decay(row.time,now,halfLifeDays);group.units++;group.weight+=w;group.sum+=w*row.rating;group.latestAt=Math.max(group.latestAt,row.time);groups.set(row.author,group);}
  const totalWeight=[...groups.values()].reduce((n,g)=>n+g.weight,0);
  const byReviewer=[...groups.values()].map(g=>({reviewer:g.reviewer,units:g.units,share:g.weight/totalWeight,meanRating:g.sum/g.weight,latestAt:g.latestAt})).sort((a,b)=>b.share-a.share||a.reviewer.localeCompare(b.reviewer));
  const meanRating=totalWeight?[...groups.values()].reduce((n,g)=>n+g.sum,0)/totalWeight:null;
  const disagreement=byReviewer.length<2?null:Math.sqrt(byReviewer.reduce((n,g)=>n+g.share*(g.meanRating-meanRating)**2,0));
  const latestAt=rows.length?Math.max(...rows.map(r=>r.time)):null;
  return {windowDays,units:rows.length,reviewers:byReviewer.length,largestReviewerShare:byReviewer[0]?.share??null,betweenReviewerSpreadStars:disagreement,latestAgeDays:latestAt===null?null:(now-latestAt)/DAY,byReviewer,description:byReviewer.length===0?'No recent rated evidence':byReviewer.length===1?'One recent reviewer':`${byReviewer.length} recent reviewers`};
}
