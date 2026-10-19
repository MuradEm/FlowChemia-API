import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import pg from 'pg';
import {verifyPassword} from '../dist/src/password.js';

test('operator setup validates, diagnoses and creates the first account/company atomically',async()=>{
  const original=process.env.DATABASE_URL;
  const adminURL=new URL(original);adminURL.pathname='/postgres';
  const admin=new pg.Client({connectionString:adminURL.toString()});await admin.connect();
  const name=`flowchemia_bootstrap_${randomUUID().replaceAll('-','')}`;
  const url=new URL(original);url.pathname=`/${name}`;let db;
  const value={email:'operator@example.test',displayName:'Élias',companyName:'Automação',password:'fictional-東京-é-1234'};
  const env={...process.env,DATABASE_URL:url.toString()};
  const run=bytes=>spawnSync(process.execPath,['dist/scripts/bootstrap.js'],{env,input:bytes,encoding:'utf8'});
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    const missing=run(JSON.stringify(value));assert.equal(missing.status,1);assert.match(missing.stderr,/tables are missing|Database setup/);assert.ok(!missing.stderr.includes(value.password));
    const migration=spawnSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{env,encoding:'utf8'});assert.equal(migration.status,0,migration.stderr);
    db=new pg.Client({connectionString:url.toString()});await db.connect();
    const invalid=run(JSON.stringify({...value,password:'short'}));assert.equal(invalid.status,1);assert.match(invalid.stderr,/12–128/);
    assert.equal((await db.query('SELECT count(*)::int n FROM "User"')).rows[0].n,0);
    await db.query(`CREATE FUNCTION reject_bootstrap_company() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Fixture rejection' USING ERRCODE='23514'; END; $$; CREATE TRIGGER reject_bootstrap_company BEFORE INSERT ON "Organization" FOR EACH ROW EXECUTE FUNCTION reject_bootstrap_company();`);
    const rejected=run(JSON.stringify(value));assert.equal(rejected.status,1);
    assert.equal((await db.query('SELECT count(*)::int n FROM "User"')).rows[0].n,0);
    await db.query('DROP TRIGGER reject_bootstrap_company ON "Organization"; DROP FUNCTION reject_bootstrap_company()');
    const encoded=Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from(JSON.stringify(value),'utf16le')]);
    const created=run(encoded);assert.equal(created.status,0,created.stderr);assert.match(created.stdout,/Account and company created/);assert.ok(!created.stdout.includes(value.password));
    const before=(await db.query('SELECT u.id,u.email,u."displayName",c."passwordHash",m.role,o.name FROM "User" u JOIN "PasswordCredential" c ON c."userId"=u.id JOIN "Membership" m ON m."userId"=u.id JOIN "Organization" o ON o.id=m."orgId"')).rows;
    assert.equal(before.length,1);assert.equal(before[0].role,'OWNER');assert.equal(before[0].displayName,value.displayName);assert.equal(before[0].name,value.companyName);assert.equal(await verifyPassword(value.password,before[0].passwordHash),true);
    const again=run(JSON.stringify({...value,password:'different-fictional-password'}));assert.equal(again.status,1);assert.match(again.stderr,/already exists/);
    const after=(await db.query('SELECT u.id,u.email,u."displayName",c."passwordHash",m.role,o.name FROM "User" u JOIN "PasswordCredential" c ON c."userId"=u.id JOIN "Membership" m ON m."userId"=u.id JOIN "Organization" o ON o.id=m."orgId"')).rows;
    assert.deepEqual(after,before);
  }finally{if(db)await db.end();await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);await admin.end();}
});
