// Shared helpers for email/password auth on Cloudflare Pages Functions + D1.

// Customers and admins get separate session cookies, so both can be logged in
// in the same browser without one replacing the other.
const COOKIES = { customer: 'rr_session', admin: 'rr_admin' };
const ROLES = { customer: 'customer', admin: 'superuser' };
const cookieName = portal => COOKIES[portal] ?? COOKIES.customer;
const SESSION_DAYS = 30;
const PBKDF2_ITERATIONS = 100000; // Cloudflare Workers' maximum for PBKDF2
const MAX_FAILURES = 10; // failed logins per email...
const FAILURE_WINDOW_MS = 15 * 60 * 1000; // ...within 15 minutes

const enc = new TextEncoder();
const toHex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const fromHex = hex => new Uint8Array(hex.match(/../g).map(h => parseInt(h, 16)));

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers }
  });
}

// Reject cross-site form posts: browsers can't send application/json cross-origin without CORS.
export async function readJson(request) {
  if (!(request.headers.get('content-type') || '').includes('application/json')) return null;
  try { return await request.json(); } catch { return null; }
}

export function normaliseEmail(email) {
  const value = String(email ?? '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254 ? value : null;
}

export function passwordProblem(password) {
  if (typeof password !== 'string' || password.length < 8) return 'Use at least 8 characters for your password.';
  if (password.length > 200) return 'That password is too long.';
  return null;
}

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toHex(salt)}$${toHex(hash)}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, iterations, saltHex, hashHex] = String(stored).split('$');
  if (scheme !== 'pbkdf2') return false;
  const actual = new Uint8Array(await pbkdf2(password, fromHex(saltHex), Number(iterations)));
  const expected = fromHex(hashHex);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

const sha256 = async text => toHex(await crypto.subtle.digest('SHA-256', enc.encode(text)));

function readCookie(request, portal) {
  const match = (request.headers.get('cookie') || '').match(new RegExp('(?:^|;\\s*)' + cookieName(portal) + '=([^;]+)'));
  return match ? match[1] : null;
}

function cookie(portal, value, maxAge) {
  return `${cookieName(portal)}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export async function startSession(db, userId, portal) {
  const token = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const now = Date.now();
  await db.batch([
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),
    db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)')
      .bind(await sha256(token), userId, now, now, now + SESSION_DAYS * 86400000),
    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(now, userId)
  ]);
  return cookie(portal, token, SESSION_DAYS * 86400);
}

export async function endSession(db, request, portal) {
  const token = readCookie(request, portal);
  if (token) await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  return cookie(portal, '', 0);
}

// Returns { id, email, role } for the user logged in to this portal ('customer' or 'admin'), or null.
export async function currentUser(db, request, portal) {
  const token = readCookie(request, portal);
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const tokenHash = await sha256(token);
  const now = Date.now();
  const user = await db.prepare(
    `SELECT u.id, u.email, u.role, s.last_seen_at FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`
  ).bind(tokenHash, now).first();
  if (!user || user.role !== ROLES[portal]) return null;
  // Record activity at most once a minute, so the superuser can see who is online.
  if (now - user.last_seen_at > 60000) {
    await db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?').bind(now, tokenHash).run();
  }
  return { id: user.id, email: user.email, role: user.role };
}

export async function tooManyFailures(db, email) {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM login_failures WHERE email = ? AND at > ?')
    .bind(email, Date.now() - FAILURE_WINDOW_MS).first();
  return row.n >= MAX_FAILURES;
}

export async function recordFailure(db, email) {
  const now = Date.now();
  await db.batch([
    db.prepare('DELETE FROM login_failures WHERE at < ?').bind(now - FAILURE_WINDOW_MS),
    db.prepare('INSERT INTO login_failures (email, at) VALUES (?, ?)').bind(email, now)
  ]);
}

export async function clearFailures(db, email) {
  await db.prepare('DELETE FROM login_failures WHERE email = ?').bind(email).run();
}
