import { json, currentUser } from '../../_shared/auth.js';

// Read-only security log for the super admin (last 100 events).
export async function onRequestGet({ request, env }) {
  const user = await currentUser(env.DB, request, 'admin');
  if (!user) return json({ error: 'Please log in.' }, 401);
  const { results } = await env.DB.prepare(
    'SELECT at, event, email, ip FROM audit_log ORDER BY at DESC LIMIT 100'
  ).all();
  return json({ events: results });
}
