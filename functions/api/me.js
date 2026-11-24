import { json, currentUser } from '../_shared/auth.js';

const portalOf = request => new URL(request.url).searchParams.get('portal') === 'admin' ? 'admin' : 'customer';

export async function onRequestGet({ request, env }) {
  const user = await currentUser(env.DB, request, portalOf(request));
  return json({ user: user ? { email: user.email, role: user.role } : null });
}
