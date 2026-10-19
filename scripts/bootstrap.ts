import 'dotenv/config';
import { Database } from '../src/database.js';
import { hashPassword } from '../src/password.js';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { BOOTSTRAP_INPUT_LIMIT, BootstrapAlreadyExists, BootstrapInputError, bootstrapFailureMessage, parseBootstrapInput, validateBootstrapInput, type BootstrapValues } from '../src/bootstrap-input.js';

async function interactiveInput(): Promise<BootstrapValues> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new BootstrapInputError('Interactive setup requires a terminal. Otherwise provide JSON on stdin.');
  let muted = false;
  const output = new Writable({write(chunk, encoding, callback) { if (!muted) process.stdout.write(chunk, encoding); callback(); }});
  const readline = createInterface({input: process.stdin, output, terminal: true, historySize: 0});
  const cancel = new AbortController();
  readline.on('SIGINT', () => cancel.abort());
  async function secret(prompt: string) {
    process.stdout.write(prompt); muted = true;
    try { return await readline.question('', {signal: cancel.signal}); }
    finally { muted = false; process.stdout.write('\n'); }
  }
  try {
    const email = await readline.question('Your email: ', {signal: cancel.signal});
    const displayName = await readline.question('Your display name: ', {signal: cancel.signal});
    const companyName = await readline.question('Company name: ', {signal: cancel.signal});
    const password = await secret('Password (12–128 characters; hidden): ');
    const confirmation = await secret('Confirm password (hidden): ');
    if (password !== confirmation) throw new BootstrapInputError('Passwords did not match. No account was created. Run setup again.');
    return validateBootstrapInput({email, displayName, companyName, password});
  } catch (error) {
    if (cancel.signal.aborted) throw new BootstrapInputError('Setup cancelled. No account was created.');
    throw error;
  } finally { readline.close(); }
}

// Operator only. Passwords are read from stdin/hidden prompts, never arguments.
let db: Database | undefined;
try {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--interactive')) throw new BootstrapInputError('Use --interactive or provide JSON on stdin. Credentials must not be passed as arguments.');
  let value: BootstrapValues;
  if (args.includes('--interactive')) value = await interactiveInput();
  else {
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of process.stdin) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > BOOTSTRAP_INPUT_LIMIT) throw new BootstrapInputError('Setup input is too large.');
      chunks.push(buffer);
    }
    value = parseBootstrapInput(Buffer.concat(chunks));
  }
  const passwordHash = await hashPassword(value.password);
  const connection=new Database();
  db=connection;
  await connection.$transaction(async tx=>{
    // Exactly one bootstrap identity; later accounts enter through invitations.
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(57193021)`;
    if (await tx.user.count()) throw new BootstrapAlreadyExists();
    const user = await tx.user.create({data:{email:value.email,displayName:value.displayName,credential:{create:{passwordHash}}}});
    if (value.companyName) await tx.organization.create({data:{name:value.companyName, Membership_organization:{create:{userId:user.id,role:'OWNER'}}}});
  });
  console.log(value.companyName ? 'Account and company created. You can now sign in to FlowChemia.' : 'Bootstrap account created. Sign in and create the company.');
} catch(error) {
  console.error(bootstrapFailureMessage(error));
  process.exitCode=1;
} finally {await db?.$disconnect();}
