import { json, currentUser } from '../../_shared/auth.js';

const ONLINE_MS = 5 * 60 * 1000;

// Read-only overview for superusers. There is deliberately no endpoint that
// lets a superuser change, suspend, delete or log in as another account,
// and customers' car data is not included.
export async function onRequestGet({ request, env }) {
  const user = await currentUser(env.DB, request, 'admin');
  if (!user) return json({ error: 'Please log in.' }, 401);
  if (user.role !== 'superuser') return json({ error: 'Not allowed.' }, 403);
  const now = Date.now();
  const { results } = await env.DB.prepare(
    `SELECT u.email, u.role, u.created_at, u.last_login_at,
            MAX(s.last_seen_at) AS last_seen_at,
            COUNT(s.token_hash) AS active_sessions
     FROM users u LEFT JOIN sessions s ON s.user_id = u.id AND s.expires_at > ?
     GROUP BY u.id ORDER BY last_seen_at IS NULL, last_seen_at DESC, u.created_at DESC`
  ).bind(now).all();
  return json({
    now,
    users: results.map(r => ({ ...r, online: !!r.last_seen_at && now - r.last_seen_at < ONLINE_MS }))
  });
}
