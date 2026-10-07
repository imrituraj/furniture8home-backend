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
  findOrderForTracking,
  applyCoupon,
  getOrder,
  getOwnOrder,
  markOrderPaid,
  priceItems,
  publicOrder,
  trackingView,
  saveOrder,
  updateOrder,
} from './orders.js';
import { createRazorpayOrder, fetchPayment, razorpayConfig, verifyPaymentSignature, verifyWebhookSignature } from './razorpay.js';
import { MIN_PASSWORD_LENGTH, addHit, adminEmail, adminPassword, createSession, credentialsMatch, endSession, hits, requireAdmin } from './auth.js';
import { serveMedia } from './media.js';
import { addCoupon, deleteCoupon, getCoupons, redeemCoupon, updateCoupon } from './coupons.js';
import { availability, createBooking, getBookings, getBookingsOn, markReminderSent, tomorrowIST, updateBooking } from './bookings.js';
import { ensureSeeded, resetCatalog } from './seed.js';
import {
  NOTIFY_STATUSES,
  bookingEmails,
  bookingReminderEmail,
  deliver,
  loginAlertEmail,
  loginNoticeEmail,
  orderPlacedEmails,
  paymentReceivedEmails,
  statusEmails,
  visitsSummaryEmail,
} from './emails.js';

const PUBLIC_BODY_LIMIT = 20_000;
const WEBHOOK_BODY_LIMIT = 1_000_000;

// Order flood limits: per device, per phone number, and for the whole shop
const ORDER_LIMITS = [
  { key: (ip) => `orders:${ip}`, max: 15, windowMs: 10 * 60 * 1000, message: 'Too many orders from this device. Please call or WhatsApp us.' },
  { key: () => 'orders:*', max: 60, windowMs: 60 * 60 * 1000, message: 'We are receiving a lot of orders right now. Please try again shortly, or WhatsApp us.' },
];
const ORDERS_PER_PHONE_PER_DAY = 10;
const ADMIN_BODY_LIMIT = 8_000_000; // a product with a full gallery; photos are resized in the admin first

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
  const ip = clientIp(request);
  for (const limit of ORDER_LIMITS) {
    if ((await hits(db, limit.key(ip))) >= limit.max) throw new HttpError(429, limit.message);
  }
  await db.batch(ORDER_LIMITS.map((limit) => addHit(db, limit.key(ip), limit.windowMs)));

  const order = await buildOrder(db, await readJson(request, PUBLIC_BODY_LIMIT));
  const phoneKey = `orders:phone:${order.customer.phone.slice(-10)}`;
  if ((await hits(db, phoneKey)) >= ORDERS_PER_PHONE_PER_DAY) {
    throw new HttpError(429, 'Too many orders for this phone number today. Please call or WhatsApp us.');
  }
  await addHit(db, phoneKey, 24 * 60 * 60 * 1000).run();
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

  // Count the code's use only once the order is really being created
  if (order.discount) await redeemCoupon(db, order.discount.code, order.customer.phone, order.id);
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

/**
 * Book a showroom visit. Limited per device so nobody can fill the calendar.
 */
async function bookVisit(request, env, ctx) {
  const db = env.DB;
  const ipKey = `bookings:${clientIp(request)}`;
  if ((await hits(db, ipKey)) >= 5) throw new HttpError(429, 'Too many bookings from this device. Please call or WhatsApp us.');
  await addHit(db, ipKey, 60 * 60 * 1000).run();
  const booking = await createBooking(db, await readJson(request, PUBLIC_BODY_LIMIT));
  deliver(env, ctx, bookingEmails(env, booking));
  const { id, showroom, date, slot, name } = booking;
  return json({ id, showroom, date, slot, name }, 201, { 'Cache-Control': 'no-store' });
}

/**
 * Every evening: remind customers about tomorrow's visits, and send the owner the list.
 */
async function sendVisitReminders(env, ctx) {
  await ensureSeeded(env.DB);
  const date = tomorrowIST();
  const bookings = await getBookingsOn(env.DB, date);
  if (bookings.length === 0) return;
  const reminders = bookings.filter((b) => b.email && !b.reminderSent);
  deliver(env, ctx, [visitsSummaryEmail(env, date, bookings), ...reminders.map(bookingReminderEmail)]);
  for (const b of reminders) await markReminderSent(env.DB, b.id);
}

/**
 * Preview a discount code at checkout. Rate-limited so codes can't be guessed.
 */
async function checkCoupon(request, env) {
  const db = env.DB;
  const ipKey = `coupon:${clientIp(request)}`;
  if ((await hits(db, ipKey)) >= 20) throw new HttpError(429, 'Too many tries. Please try again in a few minutes.');
  await addHit(db, ipKey, 10 * 60 * 1000).run();
  const body = await readJson(request, PUBLIC_BODY_LIMIT);
  const { subtotal } = await priceItems(db, body?.items);
  const discount = await applyCoupon(db, body?.code, subtotal);
  if (!discount) throw new ValidationError('Enter a discount code');
  return json({ ...discount, subtotal, total: subtotal - discount.amount }, 200, { 'Cache-Control': 'no-store' });
}

/**
 * Order tracking: order number + phone. Rate-limited so order numbers can't be scanned.
 */
async function trackOrder(request, env) {
  const db = env.DB;
  const ipKey = `track:${clientIp(request)}`;
  if ((await hits(db, ipKey)) >= 20) throw new HttpError(429, 'Too many lookups. Please try again in a few minutes.');
  await addHit(db, ipKey, 10 * 60 * 1000).run();
  const body = await readJson(request, 1_000);
  const order = await findOrderForTracking(db, body?.orderId, body?.phone);
  if (!order) throw new HttpError(404, "We couldn't find an order with that number and phone. Check both and try again.");
  return json(absoluteMedia(trackingView(order), new URL(request.url).origin), 200, { 'Cache-Control': 'no-store' });
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
  if (Number(request.headers.get('content-length') || 0) > WEBHOOK_BODY_LIMIT) return json({ error: 'Request is too large' }, 413);
  const raw = await request.arrayBuffer();
  if (raw.byteLength > WEBHOOK_BODY_LIMIT) return json({ error: 'Request is too large' }, 413);
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
    // Check the amount whichever entity the event carries
    const rzpOrder = event.payload?.order?.entity;
    const amountOk = payment
      ? paymentMatchesOrder(payment, order)
      : rzpOrder?.id === order.razorpay?.orderId && rzpOrder?.amount_paid === order.total * 100 && rzpOrder?.currency === 'INR';
    if (amountOk) await markPaid(env, ctx, order, payment?.id);
    else console.warn(`Webhook payment for ${order.id} does not match the order amount — not marking paid`);
  } else if (order && event.event === 'payment.failed' && order.paymentStatus === 'pending') {
    await updateOrder(env.DB, order.id, { paymentStatus: 'failed' });
  }
  return json({ ok: true });
}

// ---------- Admin ----------

/**
 * Who is logging in: IP, approximate location and network (from Cloudflare), and their browser.
 */
function loginContext(request, enteredEmail) {
  const cf = request.cf || {};
  return {
    email: typeof enteredEmail === 'string' ? enteredEmail.trim().slice(0, 120) : '',
    ip: clientIp(request),
    city: cf.city,
    region: cf.region,
    country: cf.country,
    timezone: cf.timezone,
    network: cf.asOrganization,
    userAgent: (request.headers.get('user-agent') || '').slice(0, 300),
    language: (request.headers.get('accept-language') || '').split(',')[0].slice(0, 20),
  };
}

async function login(request, env, ctx) {
  const db = env.DB;
  if (!adminPassword(env) || !adminEmail(env)) {
    throw new HttpError(503, `Admin login is not set up yet. Set ADMIN_EMAIL and an ADMIN_PASSWORD of at least ${MIN_PASSWORD_LENGTH} characters for the Worker.`);
  }
  const ipKey = `login:${clientIp(request)}`;
  // Lock out after repeated failed logins — per device, and site-wide to stop distributed guessing
  if ((await hits(db, ipKey)) >= 5 || (await hits(db, 'login:*')) >= 30) {
    throw new HttpError(429, 'Too many failed logins. Try again in 15 minutes.');
  }
  const body = await readJson(request, 1_000);
  if (!(await credentialsMatch(env, body?.email, body?.password ?? body?.pin))) {
    const window = 15 * 60 * 1000;
    await db.batch([addHit(db, ipKey, window), addHit(db, 'login:*', window)]);
    // Once a lockout kicks in, tell the owner (at most once per 15 minutes)
    const lockedOut = (await hits(db, ipKey)) >= 5 || (await hits(db, 'login:*')) >= 30;
    if (lockedOut && (await hits(db, 'alert:login')) === 0) {
      await addHit(db, 'alert:login', window).run();
      deliver(env, ctx, [
        loginAlertEmail(env, loginContext(request, body?.email)),
      ]);
    }
    // Don't say which one was wrong
    throw new HttpError(401, 'Incorrect email or password. Please try again.');
  }
  const token = await createSession(env);
  // Tell the owner about every successful admin login
  deliver(env, ctx, [loginNoticeEmail(env, loginContext(request, body?.email))]);
  return json({ token });
}

const NO_STORE = { 'Cache-Control': 'no-store' };
const adminJson = (data, status = 200) => json(data, status, NO_STORE);

function stripToken({ accessToken, ...order }) {
  return order;
}

async function adminRoute(request, env, ctx, method, parts) {
  const db = env.DB;
  const token = await requireAdmin(env, request);
  const body = () => readJson(request, ADMIN_BODY_LIMIT);
  const [resource, id, action] = parts;
  const key = id === undefined ? undefined : decodeURIComponent(id);

  if (resource === 'logout' && method === 'POST') {
    await endSession(env, token);
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

  if (resource === 'bookings') {
    if (!key && method === 'GET') return adminJson(await getBookings(db));
    if (key && method === 'PATCH') {
      const updated = await updateBooking(db, key, (await body()) || {});
      if (!updated) throw new HttpError(404, 'Booking not found');
      return adminJson(updated);
    }
  }

  if (resource === 'coupons') {
    if (!key && method === 'GET') return adminJson(await getCoupons(db));
    if (!key && method === 'POST') return adminJson(await addCoupon(db, await body()), 201);
    if (key && method === 'PATCH') {
      const updated = await updateCoupon(db, key, await body());
      if (!updated) throw new HttpError(404, 'Discount code not found');
      return adminJson(updated);
    }
    if (key && method === 'DELETE') {
      if (!(await deleteCoupon(db, key))) throw new HttpError(404, 'Discount code not found');
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
        if (!confirmedByPayment) deliver(env, ctx, statusEmails(env, updated, updates.status));
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
  const absolute = (src) => (typeof src === 'string' && src.startsWith('media/') ? `${origin}/${src}` : src);
  for (const [key, item] of Object.entries(value)) {
    if (key === 'img') out[key] = absolute(item);
    else if (key === 'images' && Array.isArray(item)) out[key] = item.map(absolute);
    else out[key] = absoluteMedia(item, origin);
  }
  return out;
}

// ---------- Router ----------

async function publicRoute(request, env, ctx, parts) {
  const method = request.method;
  const origin = new URL(request.url).origin;
  const publicJson = (data, status, headers) => json(absoluteMedia(data, origin), status, headers);

  if (parts[0] === 'products' && parts.length === 1 && method === 'GET') return publicJson(await getPublicCatalog(env.DB));
  if (parts[0] === 'categories' && parts.length === 1 && method === 'GET') return publicJson(await getPublicCategories(env.DB));
  if (parts[0] === 'config' && parts.length === 1 && method === 'GET') {
    const rzp = razorpayConfig(env);
    return json({ razorpay: rzp.enabled ? { keyId: rzp.keyId } : null });
  }
  if (parts[0] === 'bookings' && parts[1] === 'availability' && parts.length === 2 && method === 'GET') {
    const url = new URL(request.url);
    return json(await availability(env.DB, url.searchParams.get('showroom'), url.searchParams.get('date')), 200, { 'Cache-Control': 'no-store' });
  }
  if (parts[0] === 'bookings' && parts.length === 1 && method === 'POST') return bookVisit(request, env, ctx);
  if (parts[0] === 'coupons' && parts[1] === 'check' && parts.length === 2 && method === 'POST') {
    return checkCoupon(request, env);
  }
  if (parts[0] === 'orders' && parts[1] === 'track' && parts.length === 2 && method === 'POST') {
    return trackOrder(request, env);
  }
  if (parts[0] === 'orders' && method === 'POST') {
    let response = null;
    if (parts.length === 1) response = await placeOrder(request, env, ctx);
    else if (parts.length === 3 && parts[2] === 'verify-payment') response = await verifyPayment(request, env, ctx, parts[1]);
    else if (parts.length === 3 && parts[2] === 'payment-failed') response = await paymentFailed(request, env, parts[1]);
    if (response) return publicJson(await response.json(), response.status, { 'Cache-Control': 'no-store' });
  }
  return null;
}

async function apiRoute(request, env, ctx, parts) {
  const method = request.method;
  if (parts[0] === 'razorpay' && parts[1] === 'webhook' && method === 'POST') return razorpayWebhook(request, env, ctx);
  if (parts[0] === 'admin') {
    if (parts[1] === 'login' && method === 'POST') return login(request, env, ctx);
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
  // Cron trigger (wrangler.jsonc): 12:30 UTC = 6 PM in India
  async scheduled(event, env, ctx) {
    await sendVisitReminders(env, ctx);
  },

  async fetch(request, env, ctx) {
    try {
      return await route(request, env, ctx);
    } catch (err) {
      console.error(err);
      return json({ error: 'Something went wrong. Please try again.' }, 500);
    }
  },
};
