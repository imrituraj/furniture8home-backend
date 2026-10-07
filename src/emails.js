import { isEmail, mailConfig, sendMail } from './mail.js';
import qrcode from 'qrcode-generator';
import { formatPrice } from './catalog.js';
import { addHit, hits } from './auth.js';

const SHOP_PHONE = '60025 84075';
const SHOP_WHATSAPP = 'https://wa.me/916002584075';
const SHOWROOMS = {
  Maligaon: 'AT Road, Maligaon, opposite The GYM, Guwahati 781011',
  'Paschim Boragaon': 'Paschim Boragaon, opposite GYM Central, Guwahati 781035',
};
const METHOD_LABELS = { razorpay: 'Paid online (Razorpay)', offline: 'Pay on delivery / at showroom', whatsapp: 'WhatsApp order' };
const STATUS_COPY = {
  confirmed: { subject: 'is confirmed', heading: 'Your order is confirmed', body: 'We have confirmed your order and our workshop is getting it ready. We will call you to fix a delivery or pickup time.' },
  out_for_delivery: { subject: 'is out for delivery', heading: 'Your order is on its way', body: 'Our team is bringing your order today. They will call you before they arrive, carry it in and set it up.' },
  delivered: { subject: 'has been delivered', heading: 'Your order has been delivered', body: 'Thank you for choosing Furniture8home. We hope you enjoy your new furniture. If anything needs attention, just reply to this email or WhatsApp us.' },
};
// Status changes that email the customer
export const NOTIFY_STATUSES = Object.keys(STATUS_COPY);

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

// The owner's inbox (ADMIN_EMAIL) gets every new-order, payment and login alert.
// Falls back to the sending address only if ADMIN_EMAIL isn't set.
function shopEmail(env) {
  const address = (env.ADMIN_EMAIL || mailConfig(env).user || '').trim();
  return isEmail(address) ? address : null;
}

function adminLink(env) {
  const origin = String(env.ADMIN_ORIGIN || '').split(',')[0].trim();
  return origin ? `${origin}/#orders` : null;
}

function optionsText(item) {
  return [item.options?.fabric, item.options?.chaise].filter(Boolean).join(' · ');
}

function fulfilmentText(order) {
  if (order.fulfilment.type === 'pickup') {
    const showroom = order.fulfilment.showroom;
    return `Pickup from our ${showroom} showroom (${SHOWROOMS[showroom] || 'Guwahati'})`;
  }
  return `Delivery to ${order.customer.address}, PIN ${order.customer.pincode}`;
}

// ---------- Order pass (QR code staff scan at the showroom or on delivery) ----------

const QR_CID = 'order-pass-qr@furniture8home';

/**
 * The QR links to the order in the admin dashboard (it needs the admin PIN, so it shows
 * customers nothing). Same link as the pass on the storefront's order-placed screen.
 */
function orderQrImage(env, order) {
  const origin = String(env.ADMIN_ORIGIN || '').split(',')[0].trim();
  if (!origin) return null;
  const qr = qrcode(0, 'Q');
  qr.addData(`${origin}/#order/${encodeURIComponent(order.id)}`);
  qr.make();
  // A GIF data URL; Gmail won't show data: images, so it's sent as an inline attachment instead
  const dataUrl = qr.createDataURL(6, 4);
  return { cid: QR_CID, contentType: 'image/gif', filename: `${order.id}-pass.gif`, base64: dataUrl.split(',')[1] };
}

function passHtml(order) {
  const where = order.fulfilment.type === 'pickup' ? `Pickup at our ${order.fulfilment.showroom} showroom` : 'Home delivery';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 6px;"><tr><td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:280px;background:#26312a;border-radius:20px;">
      <tr><td style="padding:16px 18px 0;color:#f3eee6;font-family:Georgia,serif;font-size:16px;">Furniture<span style="color:#e2b486;">8</span>home
        <span style="float:right;font-family:Helvetica,Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:2px;color:#b9c2b1;line-height:22px;">ORDER PASS</span></td></tr>
      <tr><td align="center" style="padding:14px 18px 0;"><div style="background:#ffffff;border-radius:14px;padding:8px;"><img src="cid:${QR_CID}" width="228" height="228" alt="QR code for order ${escapeHtml(order.id)}" style="display:block;width:228px;height:228px;"></div></td></tr>
      <tr><td align="center" style="padding:14px 18px 0;font-family:Helvetica,Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:2px;color:#b9c2b1;">ORDER</td></tr>
      <tr><td align="center" style="padding:2px 18px 0;font-family:Menlo,Consolas,monospace;font-size:19px;font-weight:700;color:#f3eee6;">${escapeHtml(order.id)}</td></tr>
      <tr><td align="center" style="padding:2px 18px 0;font-family:Georgia,serif;font-size:17px;color:#e2b486;">${escapeHtml(order.totalLabel)}</td></tr>
      <tr><td align="center" style="padding:10px 18px 18px;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.45;color:#b9c2b1;"><strong style="color:#f3eee6;">${escapeHtml(where)}</strong><br>Show this code at the showroom or to our delivery team.</td></tr>
    </table>
  </td></tr></table>`;
}

// ---------- Layout ----------

function itemsHtml(order) {
  const rows = order.items
    .map(
      (item) => `<tr>
        <td style="padding:10px 0;border-bottom:1px solid #e2d9ca;">
          <div style="font-weight:600;color:#1d1a16;">${escapeHtml(item.name)}</div>
          <div style="font-size:13px;color:#7f7568;">${escapeHtml(optionsText(item))}${optionsText(item) ? ' · ' : ''}${item.qty} × ${escapeHtml(formatPrice(item.unitPrice))}</div>
        </td>
        <td style="padding:10px 0;border-bottom:1px solid #e2d9ca;text-align:right;white-space:nowrap;font-weight:600;color:#1d1a16;">${escapeHtml(formatPrice(item.lineTotal))}</td>
      </tr>`,
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:8px 0 4px;">
    ${rows}
    <tr><td style="padding:12px 0;font-weight:700;color:#1d1a16;">Total</td><td style="padding:12px 0;text-align:right;font-size:18px;font-weight:700;color:#1d1a16;">${escapeHtml(order.totalLabel)}</td></tr>
  </table>`;
}

function detailsHtml(pairs) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;">
    ${pairs
      .filter(([, value]) => value)
      .map(([label, value]) => `<tr><td style="padding:6px 12px 6px 0;color:#7f7568;vertical-align:top;white-space:nowrap;">${escapeHtml(label)}</td><td style="padding:6px 0;color:#1d1a16;">${value}</td></tr>`)
      .join('')}
  </table>`;
}

function layout({ preheader, heading, intro, content, footer }) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;background:#f5f0e8;font-family:Helvetica,Arial,sans-serif;">
<span style="display:none;max-height:0;overflow:hidden;">${escapeHtml(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0e8;padding:24px 12px;"><tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fffdf9;border-radius:14px;overflow:hidden;">
    <tr><td style="background:#26312a;padding:18px 24px;color:#f3eee6;font-family:Georgia,serif;font-size:22px;">Furniture<span style="color:#e2b486;font-style:italic;">8</span>home</td></tr>
    <tr><td style="padding:24px;color:#4e473f;font-size:15px;line-height:1.55;">
      <h1 style="margin:0 0 8px;font-family:Georgia,serif;font-weight:500;font-size:24px;color:#1d1a16;">${escapeHtml(heading)}</h1>
      <p style="margin:0 0 16px;">${intro}</p>
      ${content}
    </td></tr>
    <tr><td style="padding:16px 24px 24px;border-top:1px solid #e2d9ca;font-size:13px;color:#7f7568;line-height:1.5;">${footer}</td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

const CUSTOMER_FOOTER = `Questions? Reply to this email, call or WhatsApp us on <a href="${SHOP_WHATSAPP}" style="color:#a86a32;">${SHOP_PHONE}</a>.<br>
Showrooms: AT Road, Maligaon · Paschim Boragaon, Guwahati · Open daily 10 AM – 8:30 PM`;

function customerSummary(order) {
  return detailsHtml([
    ['Order', `<strong>${escapeHtml(order.id)}</strong>`],
    ['Payment', escapeHtml(order.paymentStatus === 'paid' ? `${METHOD_LABELS[order.paymentMethod]} · Paid` : METHOD_LABELS[order.paymentMethod])],
    [order.fulfilment.type === 'pickup' ? 'Pickup' : 'Delivery', escapeHtml(fulfilmentText(order).replace(/^(Pickup from|Delivery to) /, ''))],
  ]);
}

function customerText(order, heading, intro) {
  return [
    heading,
    '',
    intro,
    '',
    `Order: ${order.id}`,
    ...order.items.map((i) => `- ${i.name}${optionsText(i) ? ` (${optionsText(i)})` : ''}: ${i.qty} × ${formatPrice(i.unitPrice)} = ${formatPrice(i.lineTotal)}`),
    `Total: ${order.totalLabel}`,
    `Payment: ${METHOD_LABELS[order.paymentMethod]}${order.paymentStatus === 'paid' ? ' · Paid' : ''}`,
    fulfilmentText(order),
    '',
    `Questions? Reply to this email, or call / WhatsApp ${SHOP_PHONE}.`,
    'Furniture8home · Maligaon & Paschim Boragaon, Guwahati',
  ].join('\n');
}

// ---------- Emails ----------

function customerEmail(env, order, { subject, heading, intro, pass = true }) {
  const qr = pass ? orderQrImage(env, order) : null;
  return {
    to: order.customer.email,
    subject,
    text: customerText(order, heading, intro),
    html: layout({
      preheader: intro,
      heading,
      intro: escapeHtml(intro),
      content: `${qr ? passHtml(order) : ''}${itemsHtml(order)}${customerSummary(order)}`,
      footer: CUSTOMER_FOOTER,
    }),
    inlineImages: qr ? [qr] : [],
  };
}

function shopAlert(env, order, { paid }) {
  const c = order.customer;
  const label = paid ? 'New paid order' : 'New order';
  const subject = `${label} ${order.id} · ${order.totalLabel} · ${c.name}`;
  const link = adminLink(env);
  const details = [
    ['Customer', escapeHtml(c.name)],
    ['Phone', `<a href="tel:+91${escapeHtml(c.phone.slice(-10))}" style="color:#a86a32;">${escapeHtml(c.phone)}</a> · <a href="https://wa.me/91${escapeHtml(c.phone.slice(-10))}" style="color:#a86a32;">WhatsApp</a>`],
    ['Email', c.email ? escapeHtml(c.email) : ''],
    [order.fulfilment.type === 'pickup' ? 'Pickup' : 'Delivery', escapeHtml(fulfilmentText(order).replace(/^(Pickup from|Delivery to) /, ''))],
    ['Payment', escapeHtml(`${METHOD_LABELS[order.paymentMethod]}${paid ? ' · Paid' : ' · Not paid yet'}`)],
    ['Notes', c.notes ? escapeHtml(c.notes) : ''],
  ];
  const text = [
    `${label} ${order.id}`,
    '',
    ...order.items.map((i) => `- ${i.name}${optionsText(i) ? ` (${optionsText(i)})` : ''}: ${i.qty} × ${formatPrice(i.unitPrice)} = ${formatPrice(i.lineTotal)}`),
    `Total: ${order.totalLabel}`,
    '',
    `Customer: ${c.name}, ${c.phone}${c.email ? `, ${c.email}` : ''}`,
    fulfilmentText(order),
    `Payment: ${METHOD_LABELS[order.paymentMethod]}${paid ? ' · Paid' : ' · Not paid yet'}`,
    ...(c.notes ? [`Notes: ${c.notes}`] : []),
    ...(link ? ['', `Manage it in the admin: ${link}`] : []),
  ].join('\n');
  return {
    to: shopEmail(env),
    replyTo: isEmail(c.email) ? c.email : undefined,
    subject,
    text,
    html: layout({
      preheader: subject,
      heading: `${label} ${order.id}`,
      intro: paid ? 'A customer has placed and paid for an order.' : 'A customer has placed an order. Call them to confirm.',
      content: `${itemsHtml(order)}${detailsHtml(details)}${link ? `<p style="margin:20px 0 0;"><a href="${escapeHtml(link)}" style="display:inline-block;background:#2e3b2b;color:#fffdf9;text-decoration:none;padding:11px 20px;border-radius:999px;font-weight:600;">Open in admin</a></p>` : ''}`,
      footer: 'Sent automatically by the Furniture8home shop. Reply to email the customer directly (if they gave an email).',
    }),
  };
}

// ---------- When to send ----------

/**
 * Offline and WhatsApp orders: alert the shop and confirm to the customer straight away.
 * Online (Razorpay) orders wait for the payment, so abandoned payments don't send anything.
 */
export function orderPlacedEmails(env, order) {
  if (order.paymentMethod === 'razorpay') return [];
  return [
    shopAlert(env, order, { paid: false }),
    customerEmail(env, order, {
      subject: `Order ${order.id} received · Furniture8home`,
      heading: `Thank you, ${order.customer.name}!`,
      intro:
        order.paymentMethod === 'whatsapp'
          ? 'We have received your order and will continue on WhatsApp to confirm the details.'
          : 'We have received your order. Our team will call you shortly to confirm it and fix a delivery or pickup time.',
    }),
  ];
}

/**
 * A payment was confirmed. For Razorpay orders this is the first the shop hears of the order,
 * so the shop is alerted too, unless staff marked it paid themselves.
 */
export function paymentReceivedEmails(env, order, { alertShop = order.paymentMethod === 'razorpay' } = {}) {
  const online = order.paymentMethod === 'razorpay';
  return [
    ...(alertShop ? [shopAlert(env, order, { paid: true })] : []),
    customerEmail(env, order, {
      subject: `Payment received for order ${order.id} · Furniture8home`,
      heading: online ? `Thank you, ${order.customer.name}! Payment received` : 'Payment received',
      intro: online
        ? `We have received your payment of ${order.totalLabel} and your order is confirmed. Our team will call you to fix a delivery or pickup time.`
        : `We have received your payment of ${order.totalLabel}. Thank you!`,
    }),
  ];
}

export function statusEmails(env, order, status) {
  const copy = STATUS_COPY[status];
  if (!copy) return [];
  return [
    customerEmail(env, order, {
      subject: `Order ${order.id} ${copy.subject} · Furniture8home`,
      heading: copy.heading,
      intro: copy.body,
      // Nothing left to show the pass for once it's delivered
      pass: status !== 'delivered',
    }),
  ];
}

// Customers type their own email at checkout, so anyone could make the shop email a stranger.
// Cap emails per address and per day, so the Gmail account can't be used to send spam (Gmail
// suspends accounts that do) and always has room left for the owner's alerts.
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_PER_ADDRESS_PER_DAY = 8;
const MAX_CUSTOMER_EMAILS_PER_DAY = 300;
const MAX_EMAILS_PER_DAY = 450; // Gmail allows about 500

async function allowedToSend(env, email, isOwner) {
  const db = env.DB;
  const address = email.to.toLowerCase();
  const checks = [['mail:all', MAX_EMAILS_PER_DAY]];
  if (!isOwner) checks.push(['mail:customers', MAX_CUSTOMER_EMAILS_PER_DAY], [`mail:to:${address}`, MAX_PER_ADDRESS_PER_DAY]);
  for (const [key, max] of checks) {
    if ((await hits(db, key)) >= max) {
      console.warn(`Email "${email.subject}" not sent: daily limit ${key} reached`);
      return false;
    }
  }
  await db.batch(checks.map(([key]) => addHit(db, key, DAY_MS)));
  return true;
}

/**
 * Send emails without holding up the response. Failures are logged, never shown to the customer.
 */
export function deliver(env, ctx, emails) {
  if (!mailConfig(env).enabled) return;
  const owner = (shopEmail(env) || '').toLowerCase();
  // Customer emails have no Reply-To, so replies reach the sending address (the shop's public
  // inbox). Owner alerts set Reply-To to the customer.
  const sends = emails
    .filter((email) => isEmail(email.to))
    .map(async (email) => {
      try {
        if (await allowedToSend(env, email, email.to.toLowerCase() === owner)) await sendMail(env, email);
      } catch (err) {
        console.error(`Email "${email.subject}" failed:`, err.message);
      }
    });
  if (sends.length) ctx.waitUntil(Promise.all(sends));
}

// ---------- Admin login emails ----------

/**
 * Turn a user-agent string into "Chrome 128 on Windows 11 (desktop)".
 */
export function describeBrowser(ua = '') {
  const pick = (re) => re.exec(ua)?.[1];
  const browser =
    (pick(/Edg(?:A|iOS)?\/(\d+)/) && `Edge ${pick(/Edg(?:A|iOS)?\/(\d+)/)}`) ||
    (pick(/OPR\/(\d+)/) && `Opera ${pick(/OPR\/(\d+)/)}`) ||
    (pick(/SamsungBrowser\/(\d+)/) && `Samsung Internet ${pick(/SamsungBrowser\/(\d+)/)}`) ||
    (pick(/(?:Firefox|FxiOS)\/(\d+)/) && `Firefox ${pick(/(?:Firefox|FxiOS)\/(\d+)/)}`) ||
    (pick(/(?:Chrome|CriOS)\/(\d+)/) && `Chrome ${pick(/(?:Chrome|CriOS)\/(\d+)/)}`) ||
    (/Safari\//.test(ua) && `Safari ${pick(/Version\/(\d+(?:\.\d+)?)/) || ''}`.trim()) ||
    (/curl|wget|python|postman|insomnia|httpie|axios|node-fetch|go-http/i.test(ua) && `Script / API tool (${ua.split(/[\s/]/)[0]})`) ||
    'Unknown browser';
  const os =
    (/iPhone|iPad|iPod/.test(ua) && `iOS ${(pick(/OS (\d+[_.]\d+)/) || '').replace('_', '.')}`.trim()) ||
    (/Android/.test(ua) && `Android ${pick(/Android (\d+(?:\.\d+)?)/) || ''}`.trim()) ||
    (/Windows NT 10/.test(ua) && 'Windows 10/11') ||
    (/Windows/.test(ua) && 'Windows') ||
    (/Mac OS X|Macintosh/.test(ua) && 'macOS') ||
    (/CrOS/.test(ua) && 'ChromeOS') ||
    (/Linux/.test(ua) && 'Linux') ||
    'unknown system';
  const device = /iPad|Tablet/.test(ua) ? 'tablet' : /Mobi|iPhone|Android/.test(ua) ? 'phone' : 'computer';
  return `${browser} on ${os} (${device})`;
}

function loginDetails(info) {
  const when = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'full', timeStyle: 'medium' });
  const place = [info.city, info.region, info.country].filter(Boolean).join(', ');
  return [
    ['Time', `${when} IST`],
    ['Email used', info.email || '(none)'],
    ['IP address', info.ip],
    ['Approx. location', place || 'Unknown'],
    ['Network', info.network || 'Unknown'],
    ['Their time zone', info.timezone || 'Unknown'],
    ['Browser', describeBrowser(info.userAgent)],
    ['Language', info.language || 'Unknown'],
    ['Full browser string', info.userAgent || 'None sent'],
  ];
}

const NOT_YOU =
  "If this wasn't you, change ADMIN_PASSWORD in Cloudflare (Worker furniture8home-backend → Settings → Variables and Secrets) straight away. That logs out every device instantly.";

/**
 * Sent on every successful admin login.
 */
export function loginNoticeEmail(env, info) {
  const details = loginDetails(info);
  const place = [info.city, info.country].filter(Boolean).join(', ');
  return {
    to: shopEmail(env),
    subject: `Admin login${place ? ` from ${place}` : ''} · ${describeBrowser(info.userAgent)} · Furniture8home`,
    text: ['Someone just logged in to the Furniture8home admin.', '', ...details.map(([k, v]) => `${k}: ${v}`), '', NOT_YOU].join('\n'),
    html: layout({
      preheader: `New admin login from ${info.ip}`,
      heading: 'New admin login',
      intro: 'Someone just logged in to the Furniture8home admin with the correct email and password.',
      content: detailsHtml(details.map(([k, v]) => [k, escapeHtml(v)])),
      footer: escapeHtml(NOT_YOU),
    }),
  };
}

/**
 * Tell the owner someone keeps failing to log in to the admin (sent at most once per lockout).
 */
export function loginAlertEmail(env, info) {
  const details = loginDetails(info);
  return {
    to: shopEmail(env),
    subject: 'Security alert: repeated failed admin logins · Furniture8home',
    text: [
      'Someone has repeatedly entered a wrong email or password on the Furniture8home admin. Admin login is locked for them for 15 minutes.',
      '',
      ...details.map(([k, v]) => `${k}: ${v}`),
      '',
      'If this was you, wait 15 minutes and try again. If not, nothing was accessed; consider changing ADMIN_PASSWORD in Cloudflare (Worker furniture8home-backend → Settings → Variables and Secrets).',
    ].join('\n'),
    html: layout({
      preheader: 'Repeated failed admin logins were blocked.',
      heading: 'Repeated failed admin logins',
      intro: 'Someone has repeatedly entered a wrong email or password on the Furniture8home admin. Login is locked for them for 15 minutes, and nothing was accessed.',
      content: detailsHtml(details.map(([k, v]) => [k, escapeHtml(v)])),
      footer: 'If this was you, wait 15 minutes and try again. If not, nothing was accessed; consider changing ADMIN_PASSWORD in Cloudflare (Worker furniture8home-backend → Settings → Variables and Secrets).',
    }),
  };
}
