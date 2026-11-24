import { json, readJson, normaliseEmail, passwordProblem, hashPassword, startSession, clientIp,
  attempts, recordAttempt, LIMITS, tooMany, turnstileOk, botCheckFailed, audit } from '../_shared/auth.js';

// Customers create their own accounts. Admin accounts can never be created here.
export async function onRequestPost({ request, env }) {
  const db = env.DB;
  const ipKey = 'signup-ip:' + clientIp(request);
  if (await attempts(db, ipKey, LIMITS.signupPerIp.window) >= LIMITS.signupPerIp.max) return tooMany();
  const body = await readJson(request);
  if (!body) return json({ error: 'Invalid request.' }, 400);
  if (!(await turnstileOk(body.turnstile, request, env, 'signup'))) return botCheckFailed();

  const email = normaliseEmail(body.email);
  if (!email) return json({ error: 'Enter a valid email address.' }, 400);
  const problem = await passwordProblem(body.password, email);
  if (problem) return json({ error: problem }, 400);

  const id = crypto.randomUUID();
  try {
    await db.prepare('INSERT INTO users (id, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(id, email, await hashPassword(body.password, env), 'customer', Date.now()).run();
  } catch (err) {
    if (String(err).includes('UNIQUE')) return json({ error: 'An account with that email already exists. Try logging in.' }, 409);
    throw err;
  }
  await recordAttempt(db, ipKey); // counts accounts created from this IP
  await audit(db, request, 'signup', email);
  return json({ user: { email, role: 'customer' } }, 201, { 'set-cookie': await startSession(db, id, 'customer') });
}
