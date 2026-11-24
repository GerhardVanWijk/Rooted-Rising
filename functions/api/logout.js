import { json, endSession } from '../_shared/auth.js';

export async function onRequestPost({ request, env }) {
  return json({ ok: true }, 200, { 'set-cookie': await endSession(env.DB, request) });
}
