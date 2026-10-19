import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { createApp } from '../dist/src/app.js';

// A disposable database isolates HTTP tests from development data.
test('authenticated company and team API', async t => {
  const originalURL=process.env.DATABASE_URL;
  assert.ok(originalURL,'DATABASE_URL is required');
  const adminURL=new URL(originalURL);adminURL.pathname='/postgres';
  const admin=new pg.Client({connectionString:adminURL.toString()});
  await admin.connect();
  const name=`flowchemia_api_test_${randomUUID().replaceAll('-','')}`;
  const url=new URL(originalURL);url.pathname=`/${name}`;
  const connectionString=url.toString();
  let app;let db;
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    process.env.DATABASE_URL=connectionString;
    const command=(args,input)=>{
      const result=spawnSync(process.execPath,args,{env:{...process.env,DATABASE_URL:connectionString},input,encoding:'utf8'});
      assert.equal(result.status,0,result.stderr);
    };
    command(['node_modules/prisma/build/index.js','migrate','deploy']);
    const password='fictional-test-password-2026';
    const malformed=spawnSync(process.execPath,['dist/scripts/bootstrap.js'],{env:process.env,input:'not-json-with-sensitive-input',encoding:'utf8'});
    assert.equal(malformed.status,1);
    assert.ok(!malformed.stderr.includes('not-json-with-sensitive-input'));

    command(['dist/scripts/bootstrap.js'],JSON.stringify({email:'owner@example.test',displayName:'Owner',password}));
    // The bootstrap command cannot be used to create arbitrary later accounts.
    const secondBootstrap=spawnSync(process.execPath,['dist/scripts/bootstrap.js'],{env:process.env,input:JSON.stringify({email:'other@example.test',displayName:'Other',password}),encoding:'utf8'});
    assert.equal(secondBootstrap.status,1);
    db=new pg.Client({connectionString});await db.connect();
    app=await createApp(false);await app.listen(0,'127.0.0.1');
    const base=await app.getUrl();
    async function request(method,path,token,body,expected=200) {
      const response=await fetch(`${base}${path}`,{method,headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body!==undefined?{'Content-Type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body)});
      const json=await response.json();
      assert.equal(response.status,expected,`${method} ${path}: ${JSON.stringify(json)}`);
      assert.equal(response.headers.get('cache-control'),'no-store');
      return json;
    }
    const login=async email=>(await request('POST','/auth/login',undefined,{email,password})).token;
    const owner=await login('OWNER@example.test');
    const {organization}=await request('POST','/organizations',owner,{name:'Fictional Automation'},201);
    const root=`/organizations/${organization.id}`;
    const plc=await request('POST',`${root}/teams`,owner,{name:'PLC'},201);
    const robot=await request('POST',`${root}/teams`,owner,{name:'Robot'},201);
    async function invite(email,role='EMPLOYEE') {
      const invite=await request('POST',`${root}/invitations`,owner,{email,role},201);
      const accepted=await request('POST','/invitations/accept',undefined,{token:invite.token,displayName:email.split('@')[0],password},201);
      return {id:accepted.membership.id,token:await login(email),invitationToken:invite.token};
    }
    const alice=await invite('alice@example.test');
    const bob=await invite('bob@example.test');
    const leader=await invite('leader@example.test');
    const manager=await invite('manager@example.test');
    const hr=await invite('hr@example.test','HR_ADMIN');

    await t.test('login, input validation and response data are restricted',async()=>{
      await request('GET','/me',undefined,undefined,401);
      await db.query('INSERT INTO "User" (id,email,"displayName") VALUES ($1,$2,$3)',[randomUUID(),'no-password@example.test','No password']);
      await request('POST','/auth/login',undefined,{email:'no-password@example.test',password:'not-a-real-account-password'},401);
      await request('POST','/auth/login',undefined,{email:'owner@example.test',password:'incorrect-password'},401);
      await request('POST','/auth/login',undefined,{email:'unknown@example.test',password:'incorrect-password'},401);
      const me=await request('GET','/me',alice.token);
      assert.equal(me.memberships.length,1);
      assert.ok(!JSON.stringify(me).includes('passwordHash'));
      assert.ok(!JSON.stringify(me).includes('tokenHash'));
      await request('POST',`${root}/teams`,owner,{name:'Bad',orgId:randomUUID()},400);
      await request('GET','/organizations/not-a-uuid',owner,undefined,400);
      await request('POST',`${root}/teams`,owner,{name:'Bad dates',startsAt:'2026-02-01T00:00:00Z',endsAt:'2026-01-01T00:00:00Z'},400);
    });
    await t.test('employees participate in overlapping teams and see only their teams',async()=>{
      await request('POST',`${root}/teams/${plc.id}/members`,owner,{membershipId:alice.id},201);
      await request('POST',`${root}/teams/${robot.id}/members`,owner,{membershipId:alice.id},201);
      await request('POST',`${root}/teams/${plc.id}/members`,owner,{membershipId:bob.id},201);
      assert.equal((await request('GET',`${root}/teams`,alice.token)).length,2);
      assert.equal((await request('GET',`${root}/teams`,bob.token)).length,1);
      await request('GET',`${root}/teams/${robot.id}`,bob.token,undefined,404);
      await request('GET',`${root}/members`,alice.token,undefined,403);
      const detail=await request('GET',`${root}/teams/${plc.id}`,alice.token);
      assert.ok(detail.members.some(m=>m.displayName==='bob'));
      assert.ok(!JSON.stringify(detail).includes('@example.test'));
      await request('POST',`${root}/teams/${plc.id}/members`,owner,{membershipId:alice.id},409);
    });
    await t.test('administrators assign roles; managers have scoped roster authority',async()=>{
      await request('POST',`${root}/teams/${plc.id}/access`,owner,{membershipId:leader.id,role:'TEAM_LEADER'},400);
      await request('POST',`${root}/teams/${plc.id}/members`,owner,{membershipId:leader.id},201);
      await request('POST',`${root}/teams/${plc.id}/access`,owner,{membershipId:leader.id,role:'TEAM_LEADER'},201);
      await request('POST',`${root}/teams/${plc.id}/access`,owner,{membershipId:manager.id,role:'MANAGER'},201);
      await request('GET',`${root}/teams/${plc.id}`,leader.token);
      await request('POST',`${root}/teams/${plc.id}/access`,leader.token,{membershipId:leader.id,role:'MANAGER'},403);
      await request('POST',`${root}/teams/${robot.id}/members`,manager.token,{membershipId:bob.id},403);
      await request('POST',`${root}/teams/${plc.id}/members`,leader.token,{membershipId:manager.id},403);
      await request('DELETE',`${root}/teams/${plc.id}/members/${bob.id}`,manager.token);
      await request('GET',`${root}/teams/${plc.id}`,bob.token,undefined,404);
      await request('POST',`${root}/teams/${plc.id}/members`,manager.token,{membershipId:bob.id},201);
      await request('DELETE',`${root}/teams/${plc.id}/members/${leader.id}`,owner);
      await request('GET',`${root}/teams/${plc.id}`,leader.token,undefined,404);
    });
    await t.test('HR administration stays outside team participation',async()=>{
      assert.equal((await request('GET',`${root}/teams`,hr.token)).length,2);
      await request('POST',`${root}/teams/${plc.id}/members`,owner,{membershipId:hr.id},400);
      await request('POST',`${root}/teams/${plc.id}/access`,owner,{membershipId:hr.id,role:'MANAGER'},400);
      await request('POST',`${root}/invitations`,hr.token,{email:'another-hr@example.test',role:'HR_ADMIN'},403);
      await request('POST',`${root}/invitations`,alice.token,{email:'outsider@example.test'},403);
    });
    await t.test('company scope is enforced on reads, membership writes and role grants',async()=>{
      const other=await request('POST','/organizations',alice.token,{name:'Another Company'},201);
      const otherRoot=`/organizations/${other.organization.id}`;
      const otherTeam=await request('POST',`${otherRoot}/teams`,alice.token,{name:'Other Team'},201);
      await request('GET',otherRoot,owner,undefined,404);
      await request('GET',`${root}/teams/${otherTeam.id}`,owner,undefined,404);
      await request('POST',`${root}/teams/${plc.id}/members`,owner,{membershipId:other.membership.id},404);
      await request('POST',`${root}/teams/${plc.id}/access`,owner,{membershipId:other.membership.id,role:'MANAGER'},404);
    });
    await t.test('invites are single use, expire, and cannot reset an existing account',async()=>{
      await request('POST','/invitations/accept',undefined,{token:alice.invitationToken,displayName:'Alice',password},400);
      const expired=await request('POST',`${root}/invitations`,owner,{email:'expired@example.test'},201);
      await db.query('UPDATE "Invitation" SET "expiresAt"=now()-interval \'1 second\' WHERE id=$1',[expired.invitation.id]);
      await request('POST','/invitations/accept',undefined,{token:expired.token,displayName:'Expired',password},400);
      const other=await request('POST','/organizations',owner,{name:'Second Organization'},201);
      const invitation=await request('POST',`/organizations/${other.organization.id}/invitations`,owner,{email:'alice@example.test'},201);
      await request('POST','/invitations/accept',undefined,{token:invitation.token,displayName:'Imposter',password},401);
      await request('POST','/invitations/accept',alice.token,{token:invitation.token},201);
    });
    await t.test('expired sessions, inactive memberships and logout remove access',async()=>{
      await db.query('UPDATE "Membership" SET active=false WHERE id=$1',[bob.id]);
      await request('GET',root,bob.token,undefined,404);
      await db.query('UPDATE "Session" SET "expiresAt"=now()-interval \'1 second\' WHERE "userId"=(SELECT "userId" FROM "Membership" WHERE id=$1)',[leader.id]);
      await request('GET','/me',leader.token,undefined,401);
      await request('POST','/auth/logout',manager.token,{});
      await request('GET','/me',manager.token,undefined,401);
    });
    await t.test('login attempts are throttled',async()=>{
      let limited=false;
      for (let i=0;i<12;i++) {
        const response=await fetch(`${base}/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'unknown@example.test',password})});
        if (response.status===429) {limited=true;break;}
        assert.equal(response.status,401);
      }
      assert.ok(limited);
    });
  } finally {
    if(app)await app.close();
    if(db)await db.end();
    process.env.DATABASE_URL=originalURL;
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.end();
  }
});
