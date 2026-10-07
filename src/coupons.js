import { ValidationError } from './util.js';
import { formatPrice, text } from './catalog.js';

const MAX_COUPONS = 500;
const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{2,19}$/;

export function normalizeCode(code) {
  return text(code, 40).toUpperCase().replace(/\s+/g, '');
}

function wholeRupees(value) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 10_000_000) : 0;
}

function dateOnly(value) {
  const v = text(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
}

/**
 * A discount code. `used` is maintained by the server; everything else is set in the admin.
 */
export function normalizeCoupon(input, existing = null) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ValidationError('Invalid discount code');
  const code = existing ? existing.code : normalizeCode(input.code);
  if (!CODE_RE.test(code)) throw new ValidationError('Codes are 3–20 letters or numbers, like DIWALI10');
  const type = input.type === 'flat' ? 'flat' : 'percent';
  const value = wholeRupees(input.value);
  if (!value) throw new ValidationError('Enter the discount amount');
  if (type === 'percent' && value > 90) throw new ValidationError('A percentage discount can be at most 90%');
  const startsAt = dateOnly(input.startsAt);
  const expiresAt = dateOnly(input.expiresAt);
  if (startsAt && expiresAt && expiresAt < startsAt) throw new ValidationError('The expiry date is before the start date');
  return {
    code,
    type,
    value,
    minOrder: wholeRupees(input.minOrder),
    maxDiscount: type === 'percent' ? wholeRupees(input.maxDiscount) : 0,
    startsAt,
    expiresAt,
    usageLimit: wholeRupees(input.usageLimit),
    perPhoneLimit: wholeRupees(input.perPhoneLimit),
    active: input.active !== false,
    note: text(input.note, 200),
    used: existing ? existing.used : 0,
    createdAt: existing ? existing.createdAt : new Date().toISOString(),
  };
}

export function describeCoupon(c) {
  const off = c.type === 'percent' ? `${c.value}% off` : `${formatPrice(c.value)} off`;
  return c.type === 'percent' && c.maxDiscount ? `${off} (up to ${formatPrice(c.maxDiscount)})` : off;
}

// Today in India, as YYYY-MM-DD (coupon dates are shop-local)
function todayIST() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

/**
 * Work out a coupon's discount for this subtotal, or explain why it can't be used.
 */
export function discountFor(coupon, subtotal) {
  if (!coupon || !coupon.active) throw new ValidationError("That code isn't valid");
  const today = todayIST();
  if (coupon.startsAt && today < coupon.startsAt) throw new ValidationError("That code isn't active yet");
  if (coupon.expiresAt && today > coupon.expiresAt) throw new ValidationError('That code has expired');
  if (coupon.usageLimit && coupon.used >= coupon.usageLimit) throw new ValidationError('That code has been fully used');
  if (coupon.minOrder && subtotal < coupon.minOrder) {
    throw new ValidationError(`That code needs an order of at least ${formatPrice(coupon.minOrder)}`);
  }
  let amount = coupon.type === 'percent' ? Math.floor((subtotal * coupon.value) / 100) : coupon.value;
  if (coupon.type === 'percent' && coupon.maxDiscount) amount = Math.min(amount, coupon.maxDiscount);
  // Never take an order to ₹0 or below
  amount = Math.min(amount, subtotal - 1);
  if (amount <= 0) throw new ValidationError("That code doesn't apply to this order");
  return { code: coupon.code, amount, label: describeCoupon(coupon) };
}

// ---------- Storage ----------

export async function getCoupon(db, code) {
  const row = await db.prepare('SELECT data FROM coupons WHERE code = ?').bind(normalizeCode(code)).first();
  return row ? JSON.parse(row.data) : null;
}

export async function getCoupons(db) {
  const { results } = await db.prepare("SELECT data FROM coupons ORDER BY json_extract(data, '$.createdAt') DESC").all();
  return results.map((row) => JSON.parse(row.data));
}

export async function addCoupon(db, input) {
  const { count } = await db.prepare('SELECT COUNT(*) AS count FROM coupons').first();
  if (count >= MAX_COUPONS) throw new ValidationError(`You can have at most ${MAX_COUPONS} discount codes`);
  const coupon = normalizeCoupon(input);
  if (await getCoupon(db, coupon.code)) throw new ValidationError(`${coupon.code} already exists`);
  await db.prepare('INSERT INTO coupons (code, data) VALUES (?, ?)').bind(coupon.code, JSON.stringify(coupon)).run();
  return coupon;
}

export async function updateCoupon(db, code, input) {
  const existing = await getCoupon(db, code);
  if (!existing) return null;
  const coupon = normalizeCoupon({ ...existing, ...input }, existing);
  await db.prepare('UPDATE coupons SET data = ? WHERE code = ?').bind(JSON.stringify(coupon), coupon.code).run();
  return coupon;
}

export async function deleteCoupon(db, code) {
  const { meta } = await db.prepare('DELETE FROM coupons WHERE code = ?').bind(normalizeCode(code)).run();
  return meta.changes > 0;
}

/**
 * Count one use of a coupon for an order. The usage limit is checked in the same UPDATE, so two
 * customers can't both take the last use; the per-phone limit is checked just before.
 */
export async function redeemCoupon(db, code, phone, orderId) {
  const coupon = await getCoupon(db, code);
  if (!coupon) throw new ValidationError("That code isn't valid");
  const last10 = phone.replace(/\D/g, '').slice(-10);
  if (coupon.perPhoneLimit) {
    const { uses } = await db
      .prepare('SELECT COUNT(*) AS uses FROM coupon_redemptions WHERE code = ? AND phone = ?')
      .bind(coupon.code, last10)
      .first();
    if (uses >= coupon.perPhoneLimit) throw new ValidationError("You've already used that code");
  }
  const { meta } = await db
    .prepare(
      `UPDATE coupons SET data = json_set(data, '$.used', json_extract(data, '$.used') + 1)
       WHERE code = ? AND (json_extract(data, '$.usageLimit') = 0 OR json_extract(data, '$.used') < json_extract(data, '$.usageLimit'))`,
    )
    .bind(coupon.code)
    .run();
  if (meta.changes === 0) throw new ValidationError('That code has been fully used');
  await db
    .prepare('INSERT INTO coupon_redemptions (code, phone, order_id, at) VALUES (?, ?, ?, ?)')
    .bind(coupon.code, last10, orderId, new Date().toISOString())
    .run();
}
