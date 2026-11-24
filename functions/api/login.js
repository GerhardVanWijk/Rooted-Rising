import { json, readJson, normaliseEmail, verifyPassword, hashPassword, startSession,
  tooManyFailures, recordFailure, clearFailures } from '../_shared/auth.js';

const wrong = () => json({ error: 'That email and password don’t match.' }, 401);

export async function onRequestPost({ request, env }) {
  const body = await readJson(request);
  if (!body) return json({ error: 'Invalid request.' }, 400);
  const email = normaliseEmail(body.email);
  if (!email || typeof body.password !== 'string') return wrong();
  if (await tooManyFailures(env.DB, email)) {
    return json({ error: 'Too many attempts. Wait 15 minutes and try again.' }, 429);
  }
  const user = await env.DB.prepare('SELECT id, email, role, password_hash FROM users WHERE email = ?').bind(email).first();
  if (!user) {
    await hashPassword(body.password); // same work either way, so timing doesn't reveal which emails exist
    await recordFailure(env.DB, email);
    return wrong();
  }
  if (!(await verifyPassword(body.password, user.password_hash))) {
    await recordFailure(env.DB, email);
    return wrong();
  }
  await clearFailures(env.DB, email);
  // Each page only accepts its own kind of account.
  if (body.portal === 'admin' && user.role !== 'superuser') {
    return json({ error: 'This login is for administrators only. Customers log in on the main page.' }, 403);
  }
  if (body.portal !== 'admin' && user.role === 'superuser') {
    return json({ error: 'Administrators log in at /admin.' }, 403);
  }
  const setCookie = await startSession(env.DB, user.id, user.role === 'superuser' ? 'admin' : 'customer');
  return json({ user: { email: user.email, role: user.role } }, 200, { 'set-cookie': setCookie });
}
