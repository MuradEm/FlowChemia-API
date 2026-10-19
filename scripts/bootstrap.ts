import 'dotenv/config';
import { Database } from '../src/database.js';
import { hashPassword } from '../src/password.js';
import * as input from '../src/input.js';

// Operator-only bootstrap: JSON via stdin, never a password command-line argument.
let db: Database | undefined;
try {
  let raw='';
  for await (const chunk of process.stdin) {
    raw+=chunk;
    if (raw.length>4096) throw new Error('Input too large');
  }
  const value=input.body(JSON.parse(raw),['email','displayName','password']);
  const connection=new Database();
  db=connection;
  await connection.$transaction(async tx=>{
    // Exactly one bootstrap identity; later accounts enter through invitations.
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(57193021)`;
    if (await tx.user.count()) throw new Error('Bootstrap is only allowed on an empty user table');
    await tx.user.create({data:{email:input.email(value.email),displayName:input.text(value.displayName,'display name'),credential:{create:{passwordHash:await hashPassword(input.password(value.password))}}}});
  });
  console.log('Bootstrap account created. Sign in and create the company.');
} catch(error) {
  console.error(error instanceof Error && error.message==='Bootstrap is only allowed on an empty user table'?error.message:'Bootstrap failed; check input and database configuration.');
  process.exitCode=1;
} finally {await db?.$disconnect();}
