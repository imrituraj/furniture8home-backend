import { hmacSha256Hex, safeEqual } from './util.js';

export function razorpayConfig(env) {
  const keyId = env.RAZORPAY_KEY_ID || '';
  const keySecret = env.RAZORPAY_KEY_SECRET || '';
  return { enabled: Boolean(keyId && keySecret), keyId, keySecret, webhookSecret: env.RAZORPAY_WEBHOOK_SECRET || '' };
}

function authHeader({ keyId, keySecret }) {
  return `Basic ${btoa(`${keyId}:${keySecret}`)}`;
}

/**
 * Create a Razorpay order for the given amount (in rupees).
 * https://razorpay.com/docs/api/orders/create/
 */
export async function createRazorpayOrder(config, { amount, receipt, notes }) {
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authHeader(config) },
    body: JSON.stringify({ amount: Math.round(amount * 100), currency: 'INR', receipt, notes }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.description || `Razorpay order creation failed (${res.status})`);
  return data;
}

/**
 * Verify the signature Razorpay Checkout returns after a successful payment.
 * https://razorpay.com/docs/payments/server-integration/nodejs/payment-gateway/build-integration/#verify-payment-signature
 */
export async function verifyPaymentSignature(config, { orderId, paymentId, signature }) {
  if (typeof orderId !== 'string' || typeof paymentId !== 'string' || typeof signature !== 'string') return false;
  return safeEqual(await hmacSha256Hex(config.keySecret, `${orderId}|${paymentId}`), signature);
}

/**
 * Fetch a payment from Razorpay to confirm it really belongs to this order and amount.
 * https://razorpay.com/docs/api/payments/fetch-with-id/
 */
export async function fetchPayment(config, paymentId) {
  if (typeof paymentId !== 'string' || !/^pay_[A-Za-z0-9]+$/.test(paymentId)) throw new Error('Invalid payment id');
  const res = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}`, { headers: { Authorization: authHeader(config) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.description || `Razorpay payment lookup failed (${res.status})`);
  return data;
}

export async function verifyWebhookSignature(config, rawBody, signature) {
  // Accept the raw body as an ArrayBuffer or a byte view; refuse empty bodies and a missing secret
  let bytes;
  try {
    bytes = ArrayBuffer.isView(rawBody) ? rawBody : new Uint8Array(rawBody);
  } catch {
    return false;
  }
  if (bytes.byteLength === 0 || typeof signature !== 'string' || !config.webhookSecret) return false;
  return safeEqual(await hmacSha256Hex(config.webhookSecret, bytes), signature.trim());
}
