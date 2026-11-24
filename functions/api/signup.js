import { json, readJson, normaliseEmail, passwordProblem, hashPassword, startSession } from '../_shared/auth.js';

// Customers create their own accounts. Superusers can never be created here.
export async function onRequestPost({ request, env }) {
  const body = await readJson(request);
  if (!body) return json({ error: 'Invalid request.' }, 400);
  const email = normaliseEmail(body.email);
  if (!email) return json({ error: 'Enter a valid email address.' }, 400);
  const problem = passwordProblem(body.password);
  if (problem) return json({ error: problem }, 400);

  const id = crypto.randomUUID();
  try {
    await env.DB.prepare('INSERT INTO users (id, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(id, email, await hashPassword(body.password), 'customer', Date.now()).run();
  } catch (err) {
    if (String(err).includes('UNIQUE')) return json({ error: 'An account with that email already exists. Try logging in.' }, 409);
    throw err;
  }
  const setCookie = await startSession(env.DB, id, 'customer');
  return json({ user: { email, role: 'customer' } }, 201, { 'set-cookie': setCookie });
}
