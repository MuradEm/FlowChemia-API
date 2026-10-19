import * as input from './input.ts';

export type BootstrapValues = {email: string; displayName: string; password: string; companyName?: string};
export const BOOTSTRAP_INPUT_LIMIT = 8192;

export class BootstrapInputError extends Error {}
export class BootstrapAlreadyExists extends Error {}

export function validateBootstrapInput(raw: unknown): BootstrapValues {
  let value: Record<string, unknown>;
  try { value = input.body(raw, ['email', 'displayName', 'password', 'companyName']); }
  catch { throw new BootstrapInputError('Setup input must be a JSON object containing email, displayName, password and optionally companyName.'); }
  let email: string, displayName: string, password: string, companyName: string | undefined;
  try { email = input.email(value.email); }
  catch { throw new BootstrapInputError('Enter a valid email address.'); }
  try { displayName = input.text(value.displayName, 'display name'); }
  catch { throw new BootstrapInputError('Display name must contain 1–120 characters.'); }
  try { password = input.password(value.password); }
  catch { throw new BootstrapInputError('Password must contain 12–128 characters.'); }
  if (value.companyName !== undefined) {
    try { companyName = input.text(value.companyName, 'company name'); }
    catch { throw new BootstrapInputError('Company name must contain 1–120 characters.'); }
  }
  return {email, displayName, password, ...(companyName === undefined ? {} : {companyName})};
}

export function parseBootstrapInput(bytes: Uint8Array): BootstrapValues {
  if (bytes.byteLength > BOOTSTRAP_INPUT_LIMIT) throw new BootstrapInputError('Setup input is too large.');
  if (!bytes.byteLength) throw new BootstrapInputError('No setup input received. Run npm run bootstrap -- --interactive in a terminal, or provide JSON on stdin.');
  let raw: string;
  try {
    // Accept common Windows encodings without altering non-ASCII credentials.
    const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
    raw = new TextDecoder(encoding, {fatal: true}).decode(bytes).replace(/^\uFEFF/, '');
  } catch { throw new BootstrapInputError('Setup input could not be decoded. Use interactive setup or UTF-8 JSON.'); }
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch { throw new BootstrapInputError('Setup input is not valid JSON. Use npm run bootstrap -- --interactive to avoid shell-pipe formatting issues.'); }
  return validateBootstrapInput(value);
}

export function bootstrapFailureMessage(error: unknown): string {
  if (error instanceof BootstrapInputError) return error.message;
  if (error instanceof BootstrapAlreadyExists) return 'An account already exists. Bootstrap will not overwrite it. Sign in with your existing account; do not reset the database.';
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  if (code === 'P2021' || code === 'P2022') return 'Database tables are missing or outdated. Run npm run db:migrate, then retry setup.';
  if (code === 'P1000' || code === '28P01') return 'Database authentication failed. Check the DATABASE_URL in your local .env without sharing its credentials.';
  if (['P1001', 'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT'].includes(String(code))) return 'Database is unreachable. Start PostgreSQL with docker compose up -d --wait and check your local DATABASE_URL.';
  // Never print raw exceptions: ORM messages can contain connection details.
  return 'Database setup could not complete. Check PostgreSQL, your local .env and npm run db:status. No existing accounts will be overwritten.';
}
