import { json, readJson, normaliseEmail, verifyPassword, dummyVerify, hashPassword, startSession, portalFor,
  clientIp, attempts, recordAttempt, clearAttempts, LIMITS, tooMany, turnstileOk, botCheckFailed, audit } from '../_shared/auth.js';

const wrong = () => json({ error: 'That email and password don’t match.' }, 401);

export async function onRequestPost({ request, env }) {
  const db = env.DB;
  const ipKey = 'login-ip:' + clientIp(request);
  if (await attempts(db, ipKey, LIMITS.loginPerIp.window) >= LIMITS.loginPerIp.max) return tooMany();
  const body = await readJson(request);
  if (!body) return json({ error: 'Invalid request.' }, 400);
  const portal = body.portal === 'admin' ? 'admin' : 'customer';
  if (!(await turnstileOk(body.turnstile, request, env, portal === 'admin' ? 'admin-login' : 'login'))) return botCheckFailed();

  const email = normaliseEmail(body.email);
  if (!email || typeof body.password !== 'string' || body.password.length > 200) { await recordAttempt(db, ipKey); return wrong(); }
  const emailKey = 'login-email:' + email;
  if (await attempts(db, emailKey, LIMITS.failuresPerEmail.window) >= LIMITS.failuresPerEmail.max) {
    await audit(db, request, 'login-locked', email);
    return tooMany();
  }

  const user = await db.prepare('SELECT id, email, role, password_hash FROM users WHERE email = ?').bind(email).first();
  const check = user ? await verifyPassword(body.password, user.password_hash, env) : (await dummyVerify(body.password, env), { ok: false });
  if (!check.ok) {
    await recordAttempt(db, emailKey);
    await recordAttempt(db, ipKey);
    await audit(db, request, portal === 'admin' ? 'admin-login-failed' : 'login-failed', email);
    return wrong();
  }
  // Each page only accepts its own kind of account.
  if (portalFor(user.role) !== portal) {
    return json({ error: portal === 'admin'
      ? 'This login is for administrators only. Customers log in on the main page.'
      : 'Administrators log in at /admin.' }, 403);
  }
  await clearAttempts(db, emailKey);
  if (check.upgrade) {
    await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(await hashPassword(body.password, env), user.id).run();
  }
  await audit(db, request, portal === 'admin' ? 'admin-login' : 'login', email);
  return json({ user: { email: user.email, role: user.role } }, 200, { 'set-cookie': await startSession(db, user.id, portal) });
}
