import { json, currentUser } from '../_shared/auth.js';

export async function onRequestGet({ request, env }) {
  const portal = new URL(request.url).searchParams.get('portal') === 'admin' ? 'admin' : 'customer';
  const user = await currentUser(env.DB, request, portal);
  return json({ user: user ? { email: user.email, role: user.role } : null });
}
