import { HttpError, randomHex, safeEqual, sha256Hex } from './util.js';

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_SESSIONS = 50;

// ---------- Rate limiting (fixed window, stored in D1 so it holds across Worker instances) ----------

export async function hits(db, key) {
  const row = await db.prepare('SELECT count, reset_at FROM counters WHERE key = ?').bind(key).first();
  return row && row.reset_at > Date.now() ? row.count : 0;
}

export function addHit(db, key, windowMs) {
  const now = Date.now();
  return db
    .prepare(
      `INSERT INTO counters (key, count, reset_at) VALUES (?1, 1, ?2)
       ON CONFLICT (key) DO UPDATE SET
         count = CASE WHEN reset_at <= ?3 THEN 1 ELSE count + 1 END,
         reset_at = CASE WHEN reset_at <= ?3 THEN ?2 ELSE reset_at END`,
    )
    .bind(key, now + windowMs, now);
}

// ---------- Admin password + sessions ----------

// A deployed Worker refuses all admin logins until a long enough password is set
export const MIN_PASSWORD_LENGTH = 10;

/**
 * The admin password: the ADMIN_PASSWORD secret (at least 10 characters). Until it's set, the
 * older ADMIN_PIN (6–8 digits) still works as the password. Local dev falls back to "password1234".
 */
export function adminPassword(env) {
  const dev = env.ENVIRONMENT === 'development';
  if (env.ADMIN_PASSWORD) return env.ADMIN_PASSWORD.length >= MIN_PASSWORD_LENGTH || dev ? env.ADMIN_PASSWORD : null;
  if (env.ADMIN_PIN) return /^\d{6,8}$/.test(env.ADMIN_PIN) || dev ? env.ADMIN_PIN : null;
  return dev ? 'password1234' : null;
}

/**
 * The admin's email address (ADMIN_EMAIL). Local dev falls back to admin@example.com.
 */
export function adminEmail(env) {
  const email = String(env.ADMIN_EMAIL || '').trim().toLowerCase();
  if (email) return email;
  return env.ENVIRONMENT === 'development' ? 'admin@example.com' : null;
}

/**
 * Both the admin email (any capitalisation) and the password must match.
 */
export async function credentialsMatch(env, enteredEmail, enteredPassword) {
  const password = adminPassword(env);
  const email = adminEmail(env);
  if (!password || !email) return false;
  if (typeof enteredEmail !== 'string' || (typeof enteredPassword !== 'string' && typeof enteredPassword !== 'number')) return false;
  // Compare fixed-length digests so neither value nor its length leaks through timing.
  // Check both before deciding, so the response time doesn't reveal which one was wrong.
  const emailOk = safeEqual(await sha256Hex(email), await sha256Hex(enteredEmail.trim().toLowerCase()));
  // Passwords are compared exactly (spaces and capitals count)
  const passwordOk = safeEqual(await sha256Hex(password), await sha256Hex(String(enteredPassword)));
  return emailOk && passwordOk;
}

/**
 * Sessions are stored as a hash of the token *and* the current admin email + password.
 * Changing ADMIN_PASSWORD (or ADMIN_EMAIL) therefore logs out every device at once.
 */
async function sessionKey(env, token) {
  return sha256Hex(`${token}|${await sha256Hex(`${adminEmail(env)}|${adminPassword(env)}`)}`);
}

export async function createSession(env) {
  const db = env.DB;
  const token = randomHex(32);
  const now = Date.now();
  await db.batch([
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now),
    db.prepare('INSERT INTO sessions (token_hash, expires_at) VALUES (?, ?)').bind(await sessionKey(env, token), now + SESSION_TTL_MS),
    // Keep only the newest sessions
    db.prepare('DELETE FROM sessions WHERE token_hash NOT IN (SELECT token_hash FROM sessions ORDER BY expires_at DESC LIMIT ?)').bind(MAX_SESSIONS),
  ]);
  return token;
}

function bearer(request) {
  const header = request.headers.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

export async function requireAdmin(env, request) {
  const token = bearer(request);
  if (token && adminPassword(env) && adminEmail(env)) {
    const row = await env.DB.prepare('SELECT expires_at FROM sessions WHERE token_hash = ?').bind(await sessionKey(env, token)).first();
    if (row && row.expires_at > Date.now()) return token;
  }
  throw new HttpError(401, 'Session expired. Please log in again.');
}

export async function endSession(env, token) {
  await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sessionKey(env, token)).run();
}
