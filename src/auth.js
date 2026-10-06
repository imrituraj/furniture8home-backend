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

// ---------- Admin PIN + sessions ----------

/**
 * The admin PIN comes from the ADMIN_PIN secret. Local dev (wrangler dev) falls back to 8888;
 * a deployed Worker refuses to log anyone in until a 6–8 digit PIN is set.
 */
export function adminPin(env) {
  if (env.ADMIN_PIN) return /^\d{6,8}$/.test(env.ADMIN_PIN) || env.ENVIRONMENT === 'development' ? env.ADMIN_PIN : null;
  return env.ENVIRONMENT === 'development' ? '8888' : null;
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
 * Both the admin email (any capitalisation) and the passcode must match.
 */
export async function credentialsMatch(env, enteredEmail, enteredPin) {
  const pin = adminPin(env);
  const email = adminEmail(env);
  if (!pin || !email) return false;
  if (typeof enteredEmail !== 'string' || (typeof enteredPin !== 'string' && typeof enteredPin !== 'number')) return false;
  // Compare fixed-length digests so neither value nor its length leaks through timing.
  // Check both before deciding, so the response time doesn't reveal which one was wrong.
  const emailOk = safeEqual(await sha256Hex(email), await sha256Hex(enteredEmail.trim().toLowerCase()));
  const pinOk = safeEqual(await sha256Hex(pin), await sha256Hex(String(enteredPin).trim()));
  return emailOk && pinOk;
}

export async function createSession(db) {
  const token = randomHex(32);
  const now = Date.now();
  await db.batch([
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now),
    db.prepare('INSERT INTO sessions (token_hash, expires_at) VALUES (?, ?)').bind(await sha256Hex(token), now + SESSION_TTL_MS),
    // Keep only the newest sessions
    db.prepare('DELETE FROM sessions WHERE token_hash NOT IN (SELECT token_hash FROM sessions ORDER BY expires_at DESC LIMIT ?)').bind(MAX_SESSIONS),
  ]);
  return token;
}

function bearer(request) {
  const header = request.headers.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

export async function requireAdmin(db, request) {
  const token = bearer(request);
  if (token) {
    const row = await db.prepare('SELECT expires_at FROM sessions WHERE token_hash = ?').bind(await sha256Hex(token)).first();
    if (row && row.expires_at > Date.now()) return token;
  }
  throw new HttpError(401, 'Session expired. Please log in again.');
}

export async function endSession(db, token) {
  await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run();
}
