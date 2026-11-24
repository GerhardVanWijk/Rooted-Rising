// Creates (or resets the password of) a superuser account. Superusers can only be made here,
// never through the website.
// Usage: SUPERUSER_PASSWORD='...' node scripts/create-superuser.mjs you@example.com [--remote]
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashPassword, normaliseEmail, passwordProblem } from '../functions/_shared/auth.js';

const email = normaliseEmail(process.argv[2]);
const password = process.env.SUPERUSER_PASSWORD;
const remote = process.argv.includes('--remote');
if (!email) throw new Error('Give a valid email address as the first argument.');
const problem = passwordProblem(password);
if (problem) throw new Error('SUPERUSER_PASSWORD: ' + problem);

const hash = await hashPassword(password);
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
