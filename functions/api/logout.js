import { json, endSession } from '../_shared/auth.js';

export async function onRequestPost({ request, env }) {
  const portal = new URL(request.url).searchParams.get('portal') === 'admin' ? 'admin' : 'customer';
  return json({ ok: true }, 200, { 'set-cookie': await endSession(env.DB, request, portal) });
}
