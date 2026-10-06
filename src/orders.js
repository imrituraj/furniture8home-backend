import { ValidationError, randomHex, safeEqual } from './util.js';
import { formatPrice, getCatalog, text } from './catalog.js';
import { getCategories } from './categories.js';

export const PAYMENT_METHODS = ['razorpay', 'offline', 'whatsapp'];
export const ORDER_STATUSES = ['new', 'confirmed', 'ready', 'out_for_delivery', 'delivered', 'cancelled'];
export const PAYMENT_STATUSES = ['pending', 'paid', 'failed', 'refunded'];
export const SHOWROOMS = ['Maligaon', 'Paschim Boragaon'];

const MAX_QTY = 20;
const MAX_LINES = 30;

// Must match FABRICS / CHAISE_OPTIONS in frontend/src/data/content.js
const FABRICS = ['Royal Navy', 'Charcoal Grey', 'Forest Sage', 'Ivory Cream', 'Mustard Gold'];
const CHAISE_OPTIONS = ['Right Facing Chaise', 'Left Facing Chaise', 'Custom Measurement'];

function cleanText(value, max = 200) {
  // Strip control characters (keep newlines in addresses/notes)
  return text(value, 10_000).replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '').trim().slice(0, max);
}

function newOrderId() {
  const d = new Date();
  const date = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `F8H-${date}-${randomHex(3).toUpperCase()}`;
}

/**
 * Validate a checkout request and build the order. Prices always come from the catalog,
 * never from the client.
 */
export async function buildOrder(db, body) {
  const { items, customer = {}, fulfilment = {}, paymentMethod } = body || {};

  if (!PAYMENT_METHODS.includes(paymentMethod)) throw new ValidationError('Choose a payment method');
  if (!Array.isArray(items) || items.length === 0) throw new ValidationError('Your cart is empty');
  if (items.length > MAX_LINES) throw new ValidationError('Too many items in one order — please call or WhatsApp us');
  if (typeof customer !== 'object' || typeof fulfilment !== 'object' || !customer || !fulfilment) {
    throw new ValidationError('Invalid order details');
  }

  const [catalog, categories] = await Promise.all([getCatalog(db), getCategories(db)]);
  const chaiseCategories = new Set(categories.filter((c) => c.chaise).map((c) => c.id));
  const lines = [];
  for (const line of items) {
    if (!line || typeof line !== 'object') throw new ValidationError('Invalid cart item');
    const product = catalog.find((p) => p.id === Number(line.id));
    if (!product || product.hidden) throw new ValidationError('An item in your cart is no longer available');
    if (product.inStock === false) {
      throw new ValidationError(`"${product.name}" is out of stock — please order it on WhatsApp as a custom order`);
    }
    const qty = Math.min(MAX_QTY, Math.max(1, Math.floor(Number(line.qty) || 1)));
    lines.push({
      id: product.id,
      name: product.name,
      img: product.img,
      unitPrice: product.priceNum,
      qty,
      lineTotal: product.priceNum * qty,
      options: {
        fabric: FABRICS.includes(line.options?.fabric) ? line.options.fabric : FABRICS[0],
        ...(chaiseCategories.has(product.cat)
          ? { chaise: CHAISE_OPTIONS.includes(line.options?.chaise) ? line.options.chaise : CHAISE_OPTIONS[0] }
          : {}),
      },
    });
  }

  const name = cleanText(customer.name, 80);
  const phone = cleanText(customer.phone, 20).replace(/[^\d+]/g, '');
  if (!name) throw new ValidationError('Please enter your name');
  if (!/^(\+?91)?[6-9]\d{9}$/.test(phone)) throw new ValidationError('Please enter a valid 10-digit mobile number');

  const email = cleanText(customer.email, 120);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ValidationError('Please enter a valid email address');

  const type = fulfilment.type === 'pickup' ? 'pickup' : 'delivery';
  const address = cleanText(customer.address, 400);
  const pincode = cleanText(customer.pincode, 6);
  if (type === 'delivery') {
    if (!address) throw new ValidationError('Please enter your delivery address');
    if (!/^\d{6}$/.test(pincode)) throw new ValidationError('Please enter a valid 6-digit PIN code');
  }
  const showroom = SHOWROOMS.includes(fulfilment.showroom) ? fulfilment.showroom : SHOWROOMS[0];

  const total = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  if (total <= 0) throw new ValidationError('Order total must be more than ₹0');

  const now = new Date().toISOString();
  return {
    id: newOrderId(),
    createdAt: now,
    updatedAt: now,
    items: lines,
    total,
    totalLabel: formatPrice(total),
    customer: {
      name,
      phone,
      email,
      address: type === 'delivery' ? address : '',
      pincode: type === 'delivery' ? pincode : '',
      notes: cleanText(customer.notes, 500),
    },
    fulfilment: type === 'pickup' ? { type, showroom } : { type },
    paymentMethod,
    paymentStatus: 'pending',
    status: 'new',
    razorpay: null,
  };
}

/**
 * Save a new order. Returns the secret the customer needs to pay for / check on it.
 */
export async function saveOrder(db, order) {
  const accessToken = randomHex(24);
  await db
    .prepare('INSERT INTO orders (id, created_at, razorpay_order_id, access_token, data) VALUES (?, ?, ?, ?, ?)')
    .bind(order.id, order.createdAt, order.razorpay?.orderId || null, accessToken, JSON.stringify(order))
    .run();
  return accessToken;
}

export async function getOrders(db) {
  const { results } = await db.prepare('SELECT data FROM orders ORDER BY created_at DESC').all();
  return results.map((row) => JSON.parse(row.data));
}

/**
 * Look up an order for the customer who placed it, using the secret returned at checkout.
 */
export async function getOwnOrder(db, id, token) {
  if (typeof id !== 'string' || typeof token !== 'string') return null;
  const row = await db.prepare('SELECT access_token, data FROM orders WHERE id = ?').bind(id).first();
  return row && safeEqual(row.access_token, token) ? JSON.parse(row.data) : null;
}

export async function findOrderByRazorpayId(db, razorpayOrderId) {
  const row = await db.prepare('SELECT data FROM orders WHERE razorpay_order_id = ?').bind(razorpayOrderId).first();
  return row ? JSON.parse(row.data) : null;
}

export async function updateOrder(db, id, updates) {
  const row = await db.prepare('SELECT data FROM orders WHERE id = ?').bind(id).first();
  if (!row) return null;
  const next = { ...JSON.parse(row.data), ...updates, id, updatedAt: new Date().toISOString() };
  await db.prepare('UPDATE orders SET data = ? WHERE id = ?').bind(JSON.stringify(next), id).run();
  return next;
}

/**
 * Fields a customer is allowed to see when polling their own order
 */
export function publicOrder(order) {
  const { id, createdAt, items, total, totalLabel, fulfilment, paymentMethod, paymentStatus, status } = order;
  return { id, createdAt, items, total, totalLabel, fulfilment, paymentMethod, paymentStatus, status, customerName: order.customer.name };
}

export async function getOrder(db, id) {
  const row = await db.prepare('SELECT data FROM orders WHERE id = ?').bind(id).first();
  return row ? JSON.parse(row.data) : null;
}

/**
 * Mark an order paid, once. Razorpay's webhook and the customer's browser can confirm the same
 * payment at the same moment; the conditional UPDATE lets only one of them win, so follow-up
 * work (emails) runs exactly once. Refunded orders are never marked paid again.
 * Returns the updated order, or null if it was already paid or refunded.
 */
export async function markOrderPaid(db, order, paymentId) {
  const next = {
    ...order,
    paymentStatus: 'paid',
    status: order.status === 'new' ? 'confirmed' : order.status,
    razorpay: order.razorpay ? { ...order.razorpay, paymentId: paymentId || order.razorpay.paymentId } : order.razorpay,
    updatedAt: new Date().toISOString(),
  };
  const { meta } = await db
    .prepare("UPDATE orders SET data = ? WHERE id = ? AND json_extract(data, '$.paymentStatus') NOT IN ('paid', 'refunded')")
    .bind(JSON.stringify(next), order.id)
    .run();
  return meta.changes > 0 ? next : null;
}
