import { json, readJson, normaliseEmail, passwordProblem, hashPassword, startSession,
  tooManyFailures, recordFailure } from '../_shared/auth.js';

// One-time creation of the super admin account from the /admin page.
// Needs the SETUP_CODE secret stored in Cloudflare, and stops working for good
// once a super admin exists.
const superuserExists = async db => !!(await db.prepare("SELECT 1 FROM users WHERE role = 'superuser' LIMIT 1").first());

function sameText(a, b) {
  const x = new TextEncoder().encode(String(a)), y = new TextEncoder().encode(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export async function onRequestGet({ env }) {
  return json({ needed: !(await superuserExists(env.DB)) });
}

export async function onRequestPost({ request, env }) {
  if (await superuserExists(env.DB)) return json({ error: 'The admin account has already been set up. Please log in.' }, 403);
  if (!env.SETUP_CODE) return json({ error: 'Setup isn’t switched on for this site.' }, 503);
  const body = await readJson(request);
  if (!body) return json({ error: 'Invalid request.' }, 400);
  if (await tooManyFailures(env.DB, 'setup')) return json({ error: 'Too many attempts. Wait 15 minutes and try again.' }, 429);
  if (!sameText(String(body.code ?? '').trim(), env.SETUP_CODE)) {
    await recordFailure(env.DB, 'setup');
    return json({ error: 'That setup code isn’t right.' }, 403);
  }
  const email = normaliseEmail(body.email);
  if (!email) return json({ error: 'Enter a valid email address.' }, 400);
  const problem = passwordProblem(body.password);
  if (problem) return json({ error: problem }, 400);

  const id = crypto.randomUUID();
  // Only inserts if there is still no superuser, so two setups at once can't both succeed.
  const result = await env.DB.prepare(
    `INSERT INTO users (id, email, password_hash, role, created_at)
     SELECT ?, ?, ?, 'superuser', ? WHERE NOT EXISTS (SELECT 1 FROM users WHERE role = 'superuser')`
  ).bind(id, email, await hashPassword(body.password), Date.now()).run().catch(err => {
    if (String(err).includes('UNIQUE')) return { conflict: true };
    throw err;
  });
  if (result.conflict) return json({ error: 'That email already has a customer account. Use a different email for the admin.' }, 409);
  if (!result.meta.changes) return json({ error: 'The admin account has already been set up. Please log in.' }, 403);
  const setCookie = await startSession(env.DB, id);
  return json({ user: { email, role: 'superuser' } }, 201, { 'set-cookie': setCookie });
}
