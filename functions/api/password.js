import { json, readJson, currentUser, verifyPassword, passwordProblem, hashPassword, endOtherSessions,
  attempts, recordAttempt, clearAttempts, LIMITS, tooMany, audit } from '../_shared/auth.js';

// Change your own password. Every other device is logged out afterwards.
export async function onRequestPost({ request, env }) {
  const db = env.DB;
  const body = await readJson(request);
  if (!body) return json({ error: 'Invalid request.' }, 400);
  const user = await currentUser(db, request, body.portal === 'admin' ? 'admin' : 'customer');
  if (!user) return json({ error: 'Please log in.' }, 401);

  const key = 'password-user:' + user.id;
  if (await attempts(db, key, LIMITS.passwordFailuresPerUser.window) >= LIMITS.passwordFailuresPerUser.max) return tooMany();
  const row = await db.prepare('SELECT password_hash FROM users WHERE id = ?').bind(user.id).first();
  if (typeof body.current !== 'string' || !(await verifyPassword(body.current, row.password_hash, env)).ok) {
    await recordAttempt(db, key);
    await audit(db, request, 'password-change-failed', user.email);
    return json({ error: 'Your current password isn’t right.' }, 403);
  }
  if (body.next === body.current) return json({ error: 'Choose a new password that’s different from your current one.' }, 400);
  const problem = await passwordProblem(body.next, user.email);
  if (problem) return json({ error: problem }, 400);

  await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(await hashPassword(body.next, env), user.id).run();
  await endOtherSessions(db, user.id, user.tokenHash);
  await clearAttempts(db, key);
  await audit(db, request, 'password-changed', user.email);
  return json({ ok: true });
}
