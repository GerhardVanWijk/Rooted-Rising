import { json, currentUser } from '../_shared/auth.js';

export async function onRequestGet({ request, env }) {
  const user = await currentUser(env.DB, request);
  return json({ user: user ? { email: user.email, role: user.role } : null });
}
