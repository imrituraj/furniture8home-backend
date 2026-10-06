import { isEmail, mailConfig, sendMail } from './mail.js';
import { formatPrice } from './catalog.js';

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

function shopEmail(env) {
  const address = (env.SHOP_EMAIL || mailConfig(env).user || '').trim();
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

function customerEmail(order, { subject, heading, intro }) {
  return {
    to: order.customer.email,
    subject,
    text: customerText(order, heading, intro),
    html: layout({
      preheader: intro,
      heading,
      intro: escapeHtml(intro),
      content: `${itemsHtml(order)}${customerSummary(order)}`,
      footer: CUSTOMER_FOOTER,
    }),
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
    customerEmail(order, {
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
    customerEmail(order, {
      subject: `Payment received for order ${order.id} · Furniture8home`,
      heading: online ? `Thank you, ${order.customer.name}! Payment received` : 'Payment received',
      intro: online
        ? `We have received your payment of ${order.totalLabel} and your order is confirmed. Our team will call you to fix a delivery or pickup time.`
        : `We have received your payment of ${order.totalLabel}. Thank you!`,
    }),
  ];
}

export function statusEmails(order, status) {
  const copy = STATUS_COPY[status];
  if (!copy) return [];
  return [
    customerEmail(order, {
      subject: `Order ${order.id} ${copy.subject} · Furniture8home`,
      heading: copy.heading,
      intro: copy.body,
    }),
  ];
}

/**
 * Send emails without holding up the response. Failures are logged, never shown to the customer.
 */
export function deliver(env, ctx, emails) {
  if (!mailConfig(env).enabled) return;
  const shopReplyTo = shopEmail(env) || undefined;
  const sends = emails
    .filter((email) => isEmail(email.to))
    .map((email) =>
      sendMail(env, { replyTo: shopReplyTo, ...email }).catch((err) => console.error(`Email "${email.subject}" failed:`, err.message)),
    );
  if (sends.length) ctx.waitUntil(Promise.all(sends));
}
