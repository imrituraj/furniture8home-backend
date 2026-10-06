const encoder = new TextEncoder();

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Thrown for anything the visitor typed wrong; always shown to them as-is (HTTP 400)
export class ValidationError extends HttpError {
  constructor(message) {
    super(400, message);
  }
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...SECURITY_HEADERS, ...headers },
  });
}

export function empty(status = 204) {
  return new Response(null, { status, headers: SECURITY_HEADERS });
}

/**
 * Parse a JSON body, refusing anything larger than `limit` bytes.
 */
export async function readJson(request, limit) {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > limit) throw new HttpError(413, 'Request is too large');
  const text = await request.text();
  if (encoder.encode(text).length > limit) throw new HttpError(413, 'Request is too large');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'Invalid request');
  }
}

export function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || 'local';
}

export function randomHex(bytes) {
  return toHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(value) {
  return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(String(value))));
}

export async function hmacSha256Hex(secret, data) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = typeof data === 'string' ? encoder.encode(data) : data;
  return toHex(await crypto.subtle.sign('HMAC', key, bytes));
}

/**
 * Constant-time string comparison (Workers' crypto.subtle.timingSafeEqual needs equal lengths).
 */
export function safeEqual(expected, received) {
  if (typeof expected !== 'string' || typeof received !== 'string') return false;
  const a = encoder.encode(expected);
  const b = encoder.encode(received);
  return a.length === b.length && crypto.subtle.timingSafeEqual(a, b);
}
