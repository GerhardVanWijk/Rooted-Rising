// Security core for Rooted & Rising: passwords, sessions, rate limits, Cloudflare Turnstile
// and the security log. Runs on Cloudflare Pages Functions with a D1 database.

const enc = new TextEncoder();
const toHex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const fromHex = hex => new Uint8Array((hex.match(/../g) || []).map(h => parseInt(h, 16)));
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// ---------- Responses and input ----------

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }
  });
}

const MAX_BODY_BYTES = 600000;

// Only JSON bodies are accepted (a cross-site HTML form can't send them), with a size cap.
export async function readJson(request) {
  if (!(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) return null;
  if (Number(request.headers.get('content-length') || 0) > MAX_BODY_BYTES) return null;
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return null;
  try { const value = JSON.parse(text); return value && typeof value === 'object' ? value : null; } catch { return null; }
}

export const clientIp = request => request.headers.get('cf-connecting-ip') || 'unknown';

export function normaliseEmail(email) {
  const value = String(email ?? '').trim().toLowerCase();
  return value.length <= 254 && /^[^\s@<>()[\]\\,;:"]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(value) ? value : null;
}

// ---------- Passwords ----------

export const MIN_PASSWORD = 10;
// Workers' PBKDF2 tops out at 100,000 iterations, so a secret pepper (kept in Cloudflare,
// never in the database) is mixed in too: a stolen database alone can't be cracked.
const PBKDF2_ITERATIONS = 100000;

// Rejects short, obvious and publicly breached passwords.
export async function passwordProblem(password, email) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters for your password.`;
  if (password.length > 200) return 'That password is too long.';
  const lower = password.toLowerCase();
  if (email && (lower === email || lower.includes(email.split('@')[0]) && email.split('@')[0].length >= 4)) {
    return 'Your password can’t contain your email address.';
  }
  if (/^(.)\1+$/.test(password)) return 'That password is too easy to guess.';
  if (await isBreached(password)) {
    return 'That password has appeared in a data breach elsewhere, so it isn’t safe. Please choose a different one.';
  }
  return null;
}

// Have I Been Pwned range check: only the first 5 characters of the SHA-1 hash leave Cloudflare.
async function isBreached(password) {
  try {
    const hash = toHex(await crypto.subtle.digest('SHA-1', enc.encode(password))).toUpperCase();
    const response = await fetch('https://api.pwnedpasswords.com/range/' + hash.slice(0, 5), {
      headers: { 'add-padding': 'true', 'user-agent': 'rootedrising-auth' },
      signal: AbortSignal.timeout(2500)
    });
    if (!response.ok) return false;
    const suffix = hash.slice(5);
    return (await response.text()).split('\n').some(line => {
      const [candidate, count] = line.trim().split(':');
      return candidate === suffix && Number(count) > 0;
    });
  } catch {
    return false; // never block sign-ups because the breach service is unreachable
  }
}

async function pepper(password, env) {
  if (!env.PASSWORD_PEPPER) throw new Error('PASSWORD_PEPPER secret is not configured');
  const key = await crypto.subtle.importKey('raw', enc.encode(env.PASSWORD_PEPPER), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(await crypto.subtle.sign('HMAC', key, enc.encode(password)));
}

async function pbkdf2(secret, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}

function sameBytes(a, b) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export async function hashPassword(password, env) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(await pepper(password, env), salt, PBKDF2_ITERATIONS);
  return `pbkdf2p$${PBKDF2_ITERATIONS}$${toHex(salt)}$${toHex(hash)}`;
}

// Returns { ok, upgrade }. "pbkdf2" hashes (no pepper) are only made by the owner's
// command-line tool and are upgraded to peppered hashes at the next login.
export async function verifyPassword(password, stored, env) {
  const [scheme, iterations, saltHex, hashHex] = String(stored).split('$');
  if (!['pbkdf2', 'pbkdf2p'].includes(scheme) || !saltHex || !hashHex) return { ok: false };
  const secret = scheme === 'pbkdf2p' ? await pepper(password, env) : password;
  const actual = await pbkdf2(secret, fromHex(saltHex), Number(iterations));
  const ok = sameBytes(actual, fromHex(hashHex));
  return { ok, upgrade: ok && (scheme !== 'pbkdf2p' || Number(iterations) < PBKDF2_ITERATIONS) };
}

// Burns the same time as a real check, so response times don't reveal which emails exist.
export async function dummyVerify(password, env) {
  await pbkdf2(await pepper(String(password), env), new Uint8Array(16), PBKDF2_ITERATIONS);
}

// ---------- Sessions ----------

// Customers and admins use separate cookies. "__Host-" cookies can only be set over HTTPS,
// for this exact site, and can't be overwritten by any other subdomain.
export const PORTALS = {
  customer: { cookie: '__Host-rr_session', role: 'customer', absolute: 30 * DAY, idle: 7 * DAY },
  admin: { cookie: '__Host-rr_admin', role: 'superuser', absolute: 12 * HOUR, idle: 30 * MINUTE }
};
export const portalFor = role => (role === 'superuser' ? 'admin' : 'customer');
const sha256 = async text => toHex(await crypto.subtle.digest('SHA-256', enc.encode(text)));

function readCookie(request, portal) {
  const name = PORTALS[portal].cookie;
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

const cookie = (portal, value, maxAgeSeconds) =>
  `${PORTALS[portal].cookie}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;

export async function startSession(db, userId, portal) {
  const token = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const now = Date.now();
  await db.batch([
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),
    db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)')
      .bind(await sha256(token), userId, now, now, now + PORTALS[portal].absolute),
    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(now, userId)
  ]);
  return cookie(portal, token, Math.floor(PORTALS[portal].absolute / 1000));
}

export async function endSession(db, request, portal) {
  const token = readCookie(request, portal);
  if (token) await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  return cookie(portal, '', 0);
}

// Returns { id, email, role, tokenHash } for the user logged in to this portal, or null.
// Sessions end at their absolute expiry or after the portal's idle time, whichever is first.
export async function currentUser(db, request, portal) {
  const token = readCookie(request, portal);
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const tokenHash = await sha256(token);
  const now = Date.now();
  const user = await db.prepare(
    `SELECT u.id, u.email, u.role, s.last_seen_at FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ? AND s.last_seen_at > ?`
  ).bind(tokenHash, now, now - PORTALS[portal].idle).first();
  if (!user || user.role !== PORTALS[portal].role) return null;
  if (now - user.last_seen_at > MINUTE) {
    await db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?').bind(now, tokenHash).run();
  }
  return { id: user.id, email: user.email, role: user.role, tokenHash };
}

export async function endOtherSessions(db, userId, keepTokenHash) {
  await db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').bind(userId, keepTokenHash).run();
}

// ---------- Rate limiting ----------

// Counts attempts for a key (for example "login-ip:1.2.3.4") within a time window.
export async function attempts(db, key, windowMs) {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM attempts WHERE key = ? AND at > ?').bind(key, Date.now() - windowMs).first();
  return row.n;
}

export async function recordAttempt(db, key) {
  const now = Date.now();
  await db.batch([
    db.prepare('DELETE FROM attempts WHERE at < ?').bind(now - DAY),
    db.prepare('INSERT INTO attempts (key, at) VALUES (?, ?)').bind(key, now)
  ]);
}

export async function clearAttempts(db, key) {
  await db.prepare('DELETE FROM attempts WHERE key = ?').bind(key).run();
}

export const LIMITS = {
  loginPerIp: { max: 30, window: 15 * MINUTE }, // failed logins from one IP
  failuresPerEmail: { max: 8, window: 15 * MINUTE },
  signupPerIp: { max: 10, window: HOUR }, // accounts created from one IP
  passwordFailuresPerUser: { max: 5, window: 15 * MINUTE }
};

export const tooMany = () => json({ error: 'Too many attempts. Please wait 15 minutes and try again.' }, 429, { 'retry-after': '900' });

// ---------- Cloudflare Turnstile (bot protection) ----------

export async function turnstileOk(token, request, env, action) {
  if (!env.TURNSTILE_SECRET) throw new Error('TURNSTILE_SECRET is not configured');
  if (typeof token !== 'string' || !token || token.length > 2048) return false;
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', token);
  form.append('remoteip', clientIp(request));
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', body: form, signal: AbortSignal.timeout(5000)
    });
    const result = await response.json();
    // Cloudflare's local test keys don't report an action; real keys must match the form used.
    return result.success === true && (!result.action || result.action === action);
  } catch {
    return false;
  }
}

export const botCheckFailed = () => json({ error: 'We couldn’t confirm you’re not a bot. Please try again.' }, 403);

// ---------- Security log ----------

export async function audit(db, request, event, email = null) {
  const now = Date.now();
  await db.batch([
    db.prepare('DELETE FROM audit_log WHERE at < ?').bind(now - 90 * DAY),
    db.prepare('INSERT INTO audit_log (at, event, email, ip, user_agent) VALUES (?, ?, ?, ?, ?)')
      .bind(now, event, email, clientIp(request), (request.headers.get('user-agent') || '').slice(0, 200))
  ]);
}
