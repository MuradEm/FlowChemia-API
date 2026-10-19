import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, newToken, tokenHash } from '../src/password.ts';

test('scrypt uses independent salts and verifies only the correct password',async()=>{
  const password='fictional-password-for-tests';
  const first=await hashPassword(password);
  const second=await hashPassword(password);
  assert.notEqual(first,second);
  assert.ok(!first.includes(password));
  assert.equal(await verifyPassword(password,first),true);
  assert.equal(await verifyPassword('wrong-password',first),false);
  assert.equal(await verifyPassword(password,'not-a-valid-hash'),false);
});
test('session and invitation tokens are random and stored by digest',()=>{
  const first=newToken();const second=newToken();
  assert.match(first,/^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first,second);
  assert.match(tokenHash(first),/^[0-9a-f]{64}$/);
  assert.notEqual(tokenHash(first),first);
  assert.notEqual(tokenHash(first),tokenHash(second));
});
