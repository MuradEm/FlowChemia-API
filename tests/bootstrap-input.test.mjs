import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BOOTSTRAP_INPUT_LIMIT, BootstrapAlreadyExists, BootstrapInputError, bootstrapFailureMessage, parseBootstrapInput} from '../src/bootstrap-input.ts';

const values={email:'elias@example.test',displayName:'Élias',companyName:'Automação',password:'fictional-東京-é-1234'};
const raw=JSON.stringify(values);
test('operator input preserves Unicode with UTF-8 and common Windows BOM encodings',()=>{
  const le=Buffer.from(raw,'utf16le');const be=Buffer.from(le).swap16();
  for(const bytes of [Buffer.from(raw),Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from(raw)]),Buffer.concat([Buffer.from([0xff,0xfe]),le]),Buffer.concat([Buffer.from([0xfe,0xff]),be])])assert.deepEqual(parseBootstrapInput(bytes),values);
});
test('invalid operator fields produce specific messages without revealing submitted values',()=>{
  for(const [change,expected] of [[{email:'invalid'},/valid email/],[{displayName:''},/Display name/],[{password:'short'},/12–128/],[{companyName:''},/Company name/],[{unexpected:'secret'},/JSON object/]]){
    assert.throws(()=>parseBootstrapInput(Buffer.from(JSON.stringify({...values,...change}))),error=>error instanceof BootstrapInputError&&expected.test(error.message)&&!error.message.includes(values.password));
  }
});
test('empty, malformed, undecodable and oversized input fail safely',()=>{
  for(const bytes of [Buffer.alloc(0),Buffer.from('{bad json private-value'),Buffer.from([0xff]),Buffer.alloc(BOOTSTRAP_INPUT_LIMIT+1,32)])assert.throws(()=>parseBootstrapInput(bytes),error=>error instanceof BootstrapInputError&&!error.message.includes('private-value'));
});
test('old JSON input without a company stays supported and passwords are not trimmed',()=>{
  const value={email:' Elias@Example.test ',displayName:' Elias ',password:'  fictional-password  '};
  assert.deepEqual(parseBootstrapInput(Buffer.from(JSON.stringify(value))),{email:'elias@example.test',displayName:'Elias',password:'  fictional-password  '});
});
test('database diagnostic messages never include raw ORM errors or connection credentials',()=>{
  for(const code of ['P1000','P1001','P2021','P2022','28P01','ECONNREFUSED','unknown']){
    const message=bootstrapFailureMessage({code,message:'postgresql://private-user:private-password@host/db'});
    assert.ok(!message.includes('private-user')&&!message.includes('private-password')&&!message.includes('postgresql://'));
  }
  assert.match(bootstrapFailureMessage(new BootstrapAlreadyExists()),/already exists/);
});
