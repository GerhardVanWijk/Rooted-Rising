// Creates (or resets the password of) the super admin account. Admins can only be made here,
// never through the website. The password pepper lives only in Cloudflare, so this writes an
// unpeppered PBKDF2 hash that is upgraded to a peppered one automatically at the first login.
// Usage: SUPERUSER_PASSWORD='...' node scripts/create-superuser.mjs you@example.com [--remote]
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normaliseEmail, passwordProblem } from '../functions/_shared/auth.js';

const email = normaliseEmail(process.argv[2]);
const password = process.env.SUPERUSER_PASSWORD;
const remote = process.argv.includes('--remote');
if (!email) throw new Error('Give a valid email address as the first argument.');
const problem = await passwordProblem(password, email);
if (problem) throw new Error('SUPERUSER_PASSWORD: ' + problem);

const salt = crypto.getRandomValues(new Uint8Array(16));
const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256);
const hex = bytes => Buffer.from(bytes).toString('hex');
const hash = `pbkdf2$100000$${hex(salt)}$${hex(new Uint8Array(bits))}`;
const q = v => "'" + String(v).replaceAll("'", "''") + "'";
const sql = `INSERT INTO users (id, email, password_hash, role, created_at)
VALUES (${q(crypto.randomUUID())}, ${q(email)}, ${q(hash)}, 'superuser', ${Date.now()})
ON CONFLICT(email) DO UPDATE SET password_hash = excluded.password_hash, role = 'superuser';
DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = ${q(email)});`;

const dir = mkdtempSync(join(tmpdir(), 'rr-'));
try {
  writeFileSync(join(dir, 'superuser.sql'), sql);
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'rootedrising-db', remote ? '--remote' : '--local',
    '--file', join(dir, 'superuser.sql')], { stdio: 'inherit' });
  console.log(`Superuser ${email} is ready (${remote ? 'live site' : 'local preview'}).`);
} finally { rmSync(dir, { recursive: true, force: true }); }
