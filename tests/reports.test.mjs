import {approvedQuestion} from './helpers/questions.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import pg from 'pg';
import {createApp} from '../dist/src/app.js';

test('scoped aggregate completion reports',async t=>{
  const original=process.env.DATABASE_URL;assert.ok(original);
  const adminURL=new URL(original);adminURL.pathname='/postgres';
  const admin=new pg.Client({connectionString:adminURL.toString()});await admin.connect();
  const name=`flowchemia_reports_${randomUUID().replaceAll('-','')}`;
  const url=new URL(original);url.pathname=`/${name}`;
  let app,db;
  try{
    await admin.query(`CREATE DATABASE "${name}"`);process.env.DATABASE_URL=url.toString();
    function command(args,input){const r=spawnSync(process.execPath,args,{env:process.env,input,encoding:'utf8'});assert.equal(r.status,0,r.stderr);}
    command(['node_modules/prisma/build/index.js','migrate','deploy']);
    const password='fictional-reporting-password-2026';
    command(['dist/scripts/bootstrap.js'],JSON.stringify({email:'owner@example.test',displayName:'Owner',password}));
    db=new pg.Client({connectionString:url.toString()});await db.connect();
    app=await createApp(false);await app.listen(0,'127.0.0.1');const base=await app.getUrl();
    async function request(method,path,token,value,expected=200){
      const response=await fetch(base+path,{method,headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(value!==undefined?{'Content-Type':'application/json'}:{})},body:value===undefined?undefined:JSON.stringify(value)});
      const json=await response.json();assert.equal(response.status,expected,`${method} ${path}: ${JSON.stringify(json)}`);assert.equal(response.headers.get('cache-control'),'no-store');return json;
    }
    const login=async email=>(await request('POST','/auth/login',null,{email,password})).token;
    const owner=await login('owner@example.test');
    const {organization:org}=await request('POST','/organizations',owner,{name:'Fictional Reporting Company'},201);
    const root=`/organizations/${org.id}`;
    async function person(name,role='EMPLOYEE'){
      const email=`${name.toLowerCase()}@example.test`;
      const invite=await request('POST',`${root}/invitations`,owner,{email,role},201);
      const accepted=await request('POST','/invitations/accept',null,{token:invite.token,displayName:name,password},201);
      return {id:accepted.membership.id,token:await login(email)};
    }
    const alice=await person('Alice');const leader=await person('Leader');const manager=await person('Manager');const bob=await person('Bob');const hr=await person('HR','HR_ADMIN');
    const plc=await request('POST',`${root}/teams`,owner,{name:'PLC'},201);
    const robot=await request('POST',`${root}/teams`,owner,{name:'Robot'},201);
    const empty=await request('POST',`${root}/teams`,owner,{name:'Unissued'},201);
    const aPLC=await request('POST',`${root}/teams/${plc.id}/members`,owner,{membershipId:alice.id},201);
    const lPLC=await request('POST',`${root}/teams/${plc.id}/members`,owner,{membershipId:leader.id},201);
    const aRobot=await request('POST',`${root}/teams/${robot.id}/members`,owner,{membershipId:alice.id},201);
    const bRobot=await request('POST',`${root}/teams/${robot.id}/members`,owner,{membershipId:bob.id},201);
    await request('POST',`${root}/teams/${plc.id}/access`,owner,{membershipId:manager.id,role:'MANAGER'},201);
    await request('POST',`${root}/teams/${plc.id}/access`,owner,{membershipId:leader.id,role:'TEAM_LEADER'},201);
    const question=await approvedQuestion(request,root,owner,{questionKey:'experience',text:'Private question wording'},password);
    const now=new Date();let sequence=0;
    async function slot({team=plc,respondent=aPLC,subject=lPLC,kind='MILESTONE',opensAt,closesAt,createdAt}={}){
      const survey=randomUUID(),id=randomUUID();sequence++;
      await db.query('INSERT INTO "Survey" (id,"orgId","teamId",kind,"opensAt","closesAt") VALUES ($1,$2,$3,$4,$5,$6)',[survey,org.id,team.id,kind,opensAt??new Date(now.getTime()-60000+sequence),closesAt??new Date(now.getTime()+86400000)]);
      await db.query('INSERT INTO "SurveyQuestion" (id,"orgId","surveyId","questionVersionId",position) VALUES ($1,$2,$3,$4,1)',[randomUUID(),org.id,survey,question.id]);
      await db.query('INSERT INTO "Assignment" (id,"orgId","teamId","surveyId","respondentTeamMemberId","subjectTeamMemberId","createdAt") VALUES ($1,$2,$3,$4,$5,$6,$7)',[id,org.id,team.id,survey,respondent.id,subject.id,createdAt??new Date(now.getTime()-10000)]);
      return id;
    }
    const completed=await slot();
    await request('POST',`${root}/assignments/${completed}/submit`,alice.token,{answers:[{questionVersionId:question.id,rating:2}]});
    const skipped=await slot({respondent:lPLC,subject:aPLC});await request('POST',`${root}/assignments/${skipped}/skip`,leader.token,{});
    const noOpportunity=await slot();await request('POST',`${root}/assignments/${noOpportunity}/replace`,alice.token,{});
    const pending=await slot();
    const expired=await slot({opensAt:new Date(now.getTime()-2*86400000),closesAt:new Date(now.getTime()-86400000)});
    await slot({opensAt:new Date(now.getTime()+86400000),closesAt:new Date(now.getTime()+2*86400000)});
    const inactiveUser=randomUUID(),inactiveMember=randomUUID();
    await db.query('INSERT INTO "User" (id,email,"displayName") VALUES ($1,$2,$3)',[inactiveUser,'former@example.test','Former']);
    await db.query('INSERT INTO "Membership" (id,"orgId","userId",active) VALUES ($1,$2,$3,false)',[inactiveMember,org.id,inactiveUser]);
    const formerId=randomUUID();
    await db.query('INSERT INTO "TeamMember" (id,"orgId","teamId","membershipId","joinedAt","leftAt") VALUES ($1,$2,$3,$4,$5,$6)',[formerId,org.id,plc.id,inactiveMember,new Date(now.getTime()-2*86400000),new Date(now.getTime()-86400000)]);
    await slot({respondent:{id:formerId},kind:'PERIODIC'});
    const originalReplacement=await slot({kind:'PERIODIC'});
    const replaced=await request('POST',`${root}/assignments/${originalReplacement}/replace`,alice.token,{});
    const replacement=await request('GET',`${root}/assignments/${replaced.replacementAssignmentId}`,alice.token);assert.equal(replacement.team.id,robot.id);
    await request('POST',`${root}/assignments/${replacement.id}/submit`,alice.token,{answers:[{questionVersionId:question.id,rating:5}]});
    await slot({team:robot,respondent:aRobot,subject:bRobot,kind:'PERIODIC'});
    const old=await slot({createdAt:new Date(now.getTime()-60*86400000)});
    await request('POST',`${root}/assignments/${old}/submit`,alice.token,{answers:[{questionVersionId:question.id,rating:3}]});
    const companyReport=`${root}/reports/completion`;
    const teamReport=`${root}/teams/${plc.id}/reports/completion`;
    const expected={issuedSlots:8,completed:2,skipped:1,insufficientOpportunity:1,pending:1,scheduled:1,expired:1,unavailable:1,completionRate:0.25};
    await t.test('original slots count once and cross-team replacements retain original-team attribution',async()=>{
      const report=await request('GET',teamReport,manager.token);
      assert.deepEqual(report.totals,expected);
      assert.equal(report.teams.length,1);assert.equal(report.teams[0].teamId,plc.id);
      assert.equal(report.teams[0].issuedSlots,8);
      const whole=await request('GET',companyReport,owner);
      assert.equal(whole.totals.issuedSlots,9);assert.equal(whole.totals.completed,2);assert.equal(whole.totals.pending,2);
      const robotReport=whole.teams.find(t=>t.teamId===robot.id);assert.equal(robotReport.issuedSlots,1);assert.equal(robotReport.completed,0);
      const buckets=['completed','skipped','insufficientOpportunity','pending','scheduled','expired','unavailable'];
      assert.equal(buckets.reduce((sum,key)=>sum+whole.totals[key],0),whole.totals.issuedSlots);
    });
    await t.test('roles limit company and team visibility and ordinary employees cannot read reports',async()=>{
      await request('GET',teamReport,null,undefined,401);
      await request('GET',companyReport,manager.token,undefined,403);
      await request('GET',companyReport,leader.token,undefined,403);
      assert.deepEqual((await request('GET',teamReport,leader.token)).totals,expected);
      assert.equal((await request('GET',companyReport,hr.token)).totals.issuedSlots,9);
      await request('GET',teamReport,alice.token,undefined,403);
      await request('GET',`${root}/teams/${robot.id}/reports/completion`,manager.token,undefined,404);
      const other=await request('POST','/organizations',owner,{name:'Other Company'},201);
      await request('GET',`/organizations/${other.organization.id}/reports/completion`,manager.token,undefined,404);
      await request('GET',`/organizations/${other.organization.id}/teams/${plc.id}/reports/completion`,owner,undefined,404);
    });
    await t.test('responses contain aggregate counts without respondent, subject or answer data',async()=>{
      const report=await request('GET',teamReport,manager.token);
      assert.deepEqual(Object.keys(report).sort(),['from','to','asOf','kind','totals','teams'].sort());
      assert.deepEqual(Object.keys(report.teams[0]).sort(),[...Object.keys(expected),'teamId','teamName'].sort());
      const json=JSON.stringify(report);
      for(const value of [alice.id,leader.id,bob.id,question.id,completed,replacement.id,'Private question wording','rating','percentage','password','token'])assert.ok(!json.includes(value),`Unexpected report data: ${value}`);
    });
    await t.test('bounded issuance windows and survey-kind filters do not count completion activity as new work',async()=>{
      const params=new URLSearchParams({from:new Date(now.getTime()-65000).toISOString(),to:new Date(now.getTime()-5000).toISOString()});
      const cohort=await request('GET',`${teamReport}?${params}`,manager.token);assert.deepEqual(cohort.totals,expected);
      const past=new URLSearchParams({from:new Date(now.getTime()-65*86400000).toISOString(),to:new Date(now.getTime()-55*86400000).toISOString()});
      const oldCohort=await request('GET',`${teamReport}?${past}`,manager.token);assert.equal(oldCohort.totals.issuedSlots,1);assert.equal(oldCohort.totals.completed,1);assert.equal(oldCohort.totals.completionRate,1);
      const periodic=await request('GET',`${companyReport}?kind=PERIODIC`,owner);assert.equal(periodic.totals.issuedSlots,3);assert.equal(periodic.totals.completed,1);
      const milestone=await request('GET',`${companyReport}?kind=MILESTONE`,owner);assert.equal(milestone.totals.issuedSlots,6);assert.equal(milestone.totals.completed,1);
      for(const query of ['from=not-a-date','from=2026-01-01T00:00:00Z','from=2026-02-01T00:00:00Z&to=2026-01-01T00:00:00Z','from=2020-01-01T00:00:00Z&to=2026-01-01T00:00:00Z','kind=UNKNOWN','kind=PERIODIC&kind=MILESTONE','subjectId='+bob.id])await request('GET',`${teamReport}?${query}`,manager.token,undefined,400);
    });
    await t.test('empty authorized teams and companies return zero counts and no invented completion rate',async()=>{
      const report=await request('GET',`${root}/teams/${empty.id}/reports/completion`,owner);
      assert.equal(report.totals.issuedSlots,0);assert.equal(report.totals.completionRate,null);assert.equal(report.teams[0].teamName,'Unissued');
      const {organization:org2}=await request('POST','/organizations',owner,{name:'Empty company'},201);
      const company=await request('GET',`/organizations/${org2.id}/reports/completion`,owner);assert.equal(company.totals.issuedSlots,0);assert.equal(company.totals.completionRate,null);assert.deepEqual(company.teams,[]);
    });
    await t.test('deadlines and participation affect operational status without mutating assignments or credit',async()=>{
      const before=(await db.query('SELECT count(*)::int n FROM "ParticipationCredit"')).rows[0].n;
      await db.query('UPDATE "Team" SET "endsAt"=now() WHERE id IN ($1,$2)',[plc.id,robot.id]);
      const main=await request('GET',teamReport,owner);assert.equal(main.totals.pending,1);assert.equal(main.totals.expired,1);
      const robotState=await request('GET',`${root}/teams/${robot.id}/reports/completion`,owner);assert.equal(robotState.totals.pending,1);assert.equal(robotState.totals.unavailable,0);
      assert.equal((await db.query('SELECT status FROM "Assignment" WHERE id=$1',[expired])).rows[0].status,'OPEN');
      assert.equal((await db.query('SELECT status FROM "Assignment" WHERE id=$1',[pending])).rows[0].status,'OPEN');
      assert.equal((await db.query('SELECT count(*)::int n FROM "ParticipationCredit"')).rows[0].n,before);
    });
    await t.test('revoked roles, departed team leaders and inactive memberships immediately lose report access',async()=>{
      await request('DELETE',`${root}/teams/${plc.id}/access/${manager.id}`,owner);
      await request('GET',teamReport,manager.token,undefined,404);
      await request('DELETE',`${root}/teams/${plc.id}/members/${leader.id}`,owner);
      await request('GET',teamReport,leader.token,undefined,404);
      await db.query('UPDATE "Membership" SET active=false WHERE id=$1',[hr.id]);
      await request('GET',companyReport,hr.token,undefined,404);
    });
  }finally{
    if(app)await app.close();if(db)await db.end();process.env.DATABASE_URL=original;
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);await admin.end();
  }
});
