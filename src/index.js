import { HttpError, ValidationError, clientIp, empty, json, readJson } from './util.js';
import {
  addProduct,
  countProductsInCategory,
  deleteProduct,
  duplicateProduct,
  getCatalog,
  getPublicCatalog,
  replaceCatalog,
  updateProduct,
} from './catalog.js';
import {
  addCategory,
  deleteCategory,
  getCategories,
  getPublicCategories,
  reorderCategories,
  updateCategory,
} from './categories.js';
import {
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  buildOrder,
  findOrderByRazorpayId,
  getOrders,
  getOrder,
  getOwnOrder,
  markOrderPaid,
  publicOrder,
  saveOrder,
  updateOrder,
} from './orders.js';
import { createRazorpayOrder, fetchPayment, razorpayConfig, verifyPaymentSignature, verifyWebhookSignature } from './razorpay.js';
import { addHit, adminPin, createSession, endSession, hits, pinMatches, requireAdmin } from './auth.js';
import { serveMedia } from './media.js';
import { ensureSeeded, resetCatalog } from './seed.js';
import { NOTIFY_STATUSES, deliver, orderPlacedEmails, paymentReceivedEmails, statusEmails } from './emails.js';

const PUBLIC_BODY_LIMIT = 20_000;
const ADMIN_BODY_LIMIT = 3_000_000; // photos are resized in the admin before upload

// ---------- Payments ----------

/**
 * Record a confirmed payment and send the "payment received" emails, once per order.
 */
async function markPaid(env, ctx, order, paymentId) {
  const updated = await markOrderPaid(env.DB, order, paymentId);
  if (!updated) return (await getOrder(env.DB, order.id)) || order;
  deliver(env, ctx, paymentReceivedEmails(env, updated));
  return updated;
}

function paymentMatchesOrder(payment, order) {
  return (
    payment.order_id === order.razorpay?.orderId &&
    payment.amount === order.total * 100 &&
    payment.currency === 'INR' &&
    ['authorized', 'captured'].includes(payment.status)
  );
}

// ---------- Public storefront API ----------

async function placeOrder(request, env, ctx) {
  const db = env.DB;
  const ipKey = `orders:${clientIp(request)}`;
  if ((await hits(db, ipKey)) >= 15) {
    throw new HttpError(429, 'Too many orders from this device. Please call or WhatsApp us.');
  }
  await addHit(db, ipKey, 10 * 60 * 1000).run();

  const order = await buildOrder(db, await readJson(request, PUBLIC_BODY_LIMIT));
  const rzp = razorpayConfig(env);

  if (order.paymentMethod === 'razorpay') {
    if (!rzp.enabled) throw new ValidationError('Online payment is not available right now');
    try {
      const created = await createRazorpayOrder(rzp, { amount: order.total, receipt: order.id, notes: { orderId: order.id } });
      order.razorpay = { orderId: created.id, paymentId: null };
    } catch (err) {
      console.error('Razorpay order creation failed', err.message);
      throw new HttpError(502, 'Could not start online payment. Please try again or choose another option.');
    }
  }

  const accessToken = await saveOrder(db, order);
  deliver(env, ctx, orderPlacedEmails(env, order));
  return json(
    {
      order: publicOrder(order),
      accessToken,
      razorpay: order.razorpay && { keyId: rzp.keyId, orderId: order.razorpay.orderId, amount: order.total * 100, currency: 'INR' },
    },
    201,
  );
}

async function findOwnOrder(env, id, body) {
  const order = await getOwnOrder(env.DB, id, body?.accessToken);
  if (!order) throw new HttpError(404, 'Order not found');
  return order;
}

async function verifyPayment(request, env, ctx, id) {
  const body = await readJson(request, PUBLIC_BODY_LIMIT);
  const order = await findOwnOrder(env, id, body);
  const rzp = razorpayConfig(env);
  const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = body;
  const rejected = new HttpError(400, 'Payment could not be verified. If money was debited, please contact us.');

  if (!rzp.enabled || !order.razorpay || orderId !== order.razorpay.orderId || !(await verifyPaymentSignature(rzp, { orderId, paymentId, signature }))) {
    throw rejected;
  }

  // Defence in depth: confirm with Razorpay that this payment is for this order and the full amount.
  // A valid signature already proves Razorpay issued it, so a lookup outage doesn't block the customer.
  try {
    const payment = await fetchPayment(rzp, paymentId);
    if (!paymentMatchesOrder(payment, order)) {
      console.warn(`Payment ${paymentId} does not match order ${order.id}`);
      throw rejected;
    }
  } catch (err) {
    if (err === rejected) throw err;
    console.warn(`Could not look up payment ${paymentId}; relying on its signature:`, err.message);
  }

  return json(publicOrder(await markPaid(env, ctx, order, paymentId)));
}

async function paymentFailed(request, env, id) {
  const order = await findOwnOrder(env, id, await readJson(request, PUBLIC_BODY_LIMIT));
  const updated = order.paymentStatus === 'pending' ? await updateOrder(env.DB, order.id, { paymentStatus: 'failed' }) : order;
  return json(publicOrder(updated));
}

async function razorpayWebhook(request, env, ctx) {
  const rzp = razorpayConfig(env);
  if (!rzp.webhookSecret) return new Response('Not found', { status: 404 });
  const raw = await request.arrayBuffer();
  if (!(await verifyWebhookSignature(rzp, raw, request.headers.get('x-razorpay-signature')))) {
    return json({ error: 'Invalid signature' }, 400);
  }

  let event;
  try {
    event = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return json({ error: 'Invalid payload' }, 400);
  }
  const payment = event.payload?.payment?.entity;
  const rzpOrderId = event.payload?.order?.entity?.id || payment?.order_id;
  const order = typeof rzpOrderId === 'string' ? await findOrderByRazorpayId(env.DB, rzpOrderId) : null;

  if (order && (event.event === 'order.paid' || event.event === 'payment.captured')) {
    if (!payment || paymentMatchesOrder(payment, order)) await markPaid(env, ctx, order, payment?.id);
    else console.warn(`Webhook payment for ${order.id} does not match the order amount — not marking paid`);
  } else if (order && event.event === 'payment.failed' && order.paymentStatus === 'pending') {
    await updateOrder(env.DB, order.id, { paymentStatus: 'failed' });
  }
  return json({ ok: true });
}

// ---------- Admin ----------

async function login(request, env) {
  const db = env.DB;
  if (!adminPin(env)) {
    throw new HttpError(503, 'Admin login is not set up yet. Set a 6–8 digit ADMIN_PIN secret for the Worker.');
  }
  const ipKey = `login:${clientIp(request)}`;
  // Lock out after repeated wrong PINs — per device, and site-wide to stop distributed guessing
  if ((await hits(db, ipKey)) >= 5 || (await hits(db, 'login:*')) >= 30) {
    throw new HttpError(429, 'Too many wrong PINs. Try again in 15 minutes.');
  }
  const body = await readJson(request, 1_000);
  if (!(await pinMatches(env, body?.pin))) {
    const window = 15 * 60 * 1000;
    await db.batch([addHit(db, ipKey, window), addHit(db, 'login:*', window)]);
    throw new HttpError(401, 'Incorrect PIN. Please try again.');
  }
  return json({ token: await createSession(db) });
}

const NO_STORE = { 'Cache-Control': 'no-store' };
const adminJson = (data, status = 200) => json(data, status, NO_STORE);

function stripToken({ accessToken, ...order }) {
  return order;
}

async function adminRoute(request, env, ctx, method, parts) {
  const db = env.DB;
  const token = await requireAdmin(db, request);
  const body = () => readJson(request, ADMIN_BODY_LIMIT);
  const [resource, id, action] = parts;
  const key = id === undefined ? undefined : decodeURIComponent(id);

  if (resource === 'logout' && method === 'POST') {
    await endSession(db, token);
    return empty();
  }

  if (resource === 'products') {
    if (!key && method === 'GET') return adminJson(await getCatalog(db));
    if (!key && method === 'POST') return adminJson(await addProduct(db, await body()), 201);
    if (key && action === 'duplicate' && method === 'POST') {
      const clone = await duplicateProduct(db, key);
      if (!clone) throw new HttpError(404, 'Product not found');
      return adminJson(clone, 201);
    }
    if (key && !action && method === 'PATCH') {
      const updated = await updateProduct(db, key, await body());
      if (!updated) throw new HttpError(404, 'Product not found');
      return adminJson(updated);
    }
    if (key && !action && method === 'DELETE') {
      if (!(await deleteProduct(db, key))) throw new HttpError(404, 'Product not found');
      return empty();
    }
  }

  if (resource === 'catalog') {
    if (!key && method === 'PUT') return adminJson(await replaceCatalog(db, await body()));
    if (key === 'reset' && method === 'POST') return adminJson(await resetCatalog(db));
  }

  if (resource === 'categories') {
    if (!key && method === 'GET') return adminJson(await getCategories(db));
    if (!key && method === 'POST') return adminJson(await addCategory(db, await body()), 201);
    if (key === 'order' && method === 'PUT') return adminJson(await reorderCategories(db, (await body())?.ids));
    if (key && method === 'PATCH') {
      const updated = await updateCategory(db, key, await body());
      if (!updated) throw new HttpError(404, 'Category not found');
      return adminJson(updated);
    }
    if (key && method === 'DELETE') {
      if (!(await deleteCategory(db, key, await countProductsInCategory(db, key)))) throw new HttpError(404, 'Category not found');
      return empty();
    }
  }

  if (resource === 'orders') {
    if (!key && method === 'GET') return adminJson((await getOrders(db)).map(stripToken));
    if (key && method === 'PATCH') {
      const { status, paymentStatus, adminNote } = (await body()) || {};
      const updates = {};
      if (status !== undefined) {
        if (!ORDER_STATUSES.includes(status)) throw new ValidationError('Unknown order status');
        updates.status = status;
      }
      if (paymentStatus !== undefined) {
        if (!PAYMENT_STATUSES.includes(paymentStatus)) throw new ValidationError('Unknown payment status');
        updates.paymentStatus = paymentStatus;
      }
      if (adminNote !== undefined) {
        if (typeof adminNote !== 'string') throw new ValidationError('Note must be text');
        updates.adminNote = adminNote.slice(0, 1000);
      }
      const before = await getOrder(db, key);
      if (!before) throw new HttpError(404, 'Order not found');
      let updated;
      if (updates.paymentStatus === 'paid' && before.paymentStatus !== 'paid') {
        // Marking paid by hand (cash, UPI at the showroom) emails the customer a receipt
        const { paymentStatus: _paid, ...rest } = updates;
        const paid = await markOrderPaid(db, { ...before, ...rest }, null);
        updated = paid || (await updateOrder(db, key, updates));
        if (paid) deliver(env, ctx, paymentReceivedEmails(env, paid, { alertShop: false }));
      } else {
        updated = await updateOrder(db, key, updates);
      }
      // Tell the customer about progress they'd care about (confirmed, out for delivery, delivered)
      if (updates.status && updates.status !== before.status && NOTIFY_STATUSES.includes(updates.status)) {
        // Marking paid already moves a new order to confirmed, and its receipt says so
        const confirmedByPayment = updates.status === 'confirmed' && updated.paymentStatus === 'paid' && before.paymentStatus !== 'paid';
        if (!confirmedByPayment) deliver(env, ctx, statusEmails(updated, updates.status));
      }
      return adminJson(stripToken(updated));
    }
  }

  throw new HttpError(404, 'Not found');
}

// ---------- Cross-site access (the storefront and admin are hosted on other domains) ----------

function originList(value) {
  return String(value || '').split(',').map((o) => o.trim()).filter(Boolean);
}

// Public shop endpoints: the storefront (STOREFRONT_ORIGIN) and the admin (ADMIN_ORIGIN).
// Admin endpoints: the admin only. Logins use a bearer token, never cookies.
const CORS_SCOPES = {
  public: { origins: (env) => [...originList(env.STOREFRONT_ORIGIN || '*'), ...originList(env.ADMIN_ORIGIN)], methods: 'GET, POST, OPTIONS', headers: 'Content-Type' },
  admin: { origins: (env) => originList(env.ADMIN_ORIGIN), methods: 'GET, POST, PATCH, PUT, DELETE, OPTIONS', headers: 'Content-Type, Authorization' },
};

function withCors(response, request, env, scope) {
  const { origins, methods, headers: allowHeaders } = CORS_SCOPES[scope];
  const allowed = origins(env);
  const origin = request.headers.get('Origin');
  const allow = allowed.includes('*') ? '*' : origin && allowed.includes(origin) ? origin : null;
  if (!allow) return response;
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', allow);
  headers.set('Access-Control-Allow-Methods', methods);
  headers.set('Access-Control-Allow-Headers', allowHeaders);
  headers.set('Access-Control-Max-Age', '86400');
  headers.append('Vary', 'Origin');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/**
 * Uploaded photos are stored as "media/<id>", served by this Worker. The storefront lives on
 * another domain, so give it absolute URLs.
 */
function absoluteMedia(value, origin) {
  if (Array.isArray(value)) return value.map((item) => absoluteMedia(item, origin));
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = key === 'img' && typeof item === 'string' && item.startsWith('media/') ? `${origin}/${item}` : absoluteMedia(item, origin);
  }
  return out;
}

// ---------- Router ----------

async function publicRoute(request, env, ctx, parts) {
  const method = request.method;
  const origin = new URL(request.url).origin;
  const publicJson = (data, status) => json(absoluteMedia(data, origin), status);

  if (parts[0] === 'products' && parts.length === 1 && method === 'GET') return publicJson(await getPublicCatalog(env.DB));
  if (parts[0] === 'categories' && parts.length === 1 && method === 'GET') return publicJson(await getPublicCategories(env.DB));
  if (parts[0] === 'config' && parts.length === 1 && method === 'GET') {
    const rzp = razorpayConfig(env);
    return json({ razorpay: rzp.enabled ? { keyId: rzp.keyId } : null });
  }
  if (parts[0] === 'orders' && method === 'POST') {
    let response = null;
    if (parts.length === 1) response = await placeOrder(request, env, ctx);
    else if (parts.length === 3 && parts[2] === 'verify-payment') response = await verifyPayment(request, env, ctx, parts[1]);
    else if (parts.length === 3 && parts[2] === 'payment-failed') response = await paymentFailed(request, env, parts[1]);
    if (response) return publicJson(await response.json(), response.status);
  }
  return null;
}

async function apiRoute(request, env, ctx, parts) {
  const method = request.method;
  if (parts[0] === 'razorpay' && parts[1] === 'webhook' && method === 'POST') return razorpayWebhook(request, env, ctx);
  if (parts[0] === 'admin') {
    if (parts[1] === 'login' && method === 'POST') return login(request, env);
    return adminRoute(request, env, ctx, method, parts.slice(1));
  }
  const response = await publicRoute(request, env, ctx, parts);
  if (response) return response;
  throw new HttpError(404, 'Not found');
}

async function route(request, env, ctx) {
  const { pathname } = new URL(request.url);
  const method = request.method;

  if (pathname.startsWith('/media/') && (method === 'GET' || method === 'HEAD')) {
    await ensureSeeded(env.DB);
    return serveMedia(env.DB, pathname.slice('/media/'.length));
  }

  if (!pathname.startsWith('/api/')) {
    // This Worker is API-only; the storefront and admin dashboard are hosted on Vercel
    return json({ name: 'Furniture8home API', ok: true }, pathname === '/' ? 200 : 404);
  }

  const parts = pathname.slice('/api/'.length).split('/').filter(Boolean);
  const scope = parts[0] === 'admin' ? 'admin' : 'public';

  // Browsers check before cross-site requests with a JSON body or a login token
  if (method === 'OPTIONS') return withCors(empty(), request, env, scope);

  let response;
  try {
    await ensureSeeded(env.DB);
    response = await apiRoute(request, env, ctx, parts);
  } catch (err) {
    if (err instanceof HttpError) {
      response = json({ error: err.message }, err.status);
    } else {
      console.error(err);
      response = json({ error: 'Something went wrong. Please try again.' }, 500);
    }
  }
  return withCors(response, request, env, scope);
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await route(request, env, ctx);
    } catch (err) {
      console.error(err);
      return json({ error: 'Something went wrong. Please try again.' }, 500);
    }
  },
};
