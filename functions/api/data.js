import { json, readJson, currentUser } from '../_shared/auth.js';

const MAX_BYTES = 500000;

// Each customer can read and save only their own Car Companion data.
export async function onRequestGet({ request, env }) {
  const user = await currentUser(env.DB, request);
  if (!user) return json({ error: 'Please log in.' }, 401);
  const row = await env.DB.prepare('SELECT data FROM user_data WHERE user_id = ?').bind(user.id).first();
  return json({ data: row ? JSON.parse(row.data) : null });
}

export async function onRequestPut({ request, env }) {
  const user = await currentUser(env.DB, request);
  if (!user) return json({ error: 'Please log in.' }, 401);
  if (user.role !== 'customer') return json({ error: 'Only customer accounts store car data.' }, 403);
  const body = await readJson(request);
  const data = body?.data;
  if (!data || typeof data !== 'object' || !Array.isArray(data.records) || !Array.isArray(data.reminders)) {
    return json({ error: 'Invalid data.' }, 400);
  }
  const text = JSON.stringify({ car: data.car ?? null, records: data.records, reminders: data.reminders });
  if (text.length > MAX_BYTES) return json({ error: 'Too much data to save.' }, 413);
  await env.DB.prepare(
    `INSERT INTO user_data (user_id, data, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
  ).bind(user.id, text, Date.now()).run();
  return json({ ok: true });
}
