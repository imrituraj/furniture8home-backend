import { connect } from 'cloudflare:sockets';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Gmail login for sending: GMAIL_USER (the shop's address) and GMAIL_APP_PASSWORD (a Google
 * "app password", not the account password). Email is off until both are set.
 */
export function mailConfig(env) {
  const user = (env.GMAIL_USER || '').trim();
  const password = (env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
  return {
    enabled: Boolean(user && password),
    user,
    password,
    // Overridable for local testing against a fake mail server
    host: env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(env.SMTP_PORT) || 465,
    secure: env.SMTP_SECURE !== 'false',
  };
}

const EMAIL_RE = /^[^\s@<>()",;:\\[\]]+@[^\s@<>()",;:\\[\]]+\.[^\s@<>()",;:\\[\]]+$/;

export function isEmail(value) {
  return typeof value === 'string' && value.length <= 254 && EMAIL_RE.test(value);
}

function base64Utf8(text) {
  const bytes = encoder.encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

// RFC 2047 encoded-word, so names and subjects can use any characters (₹, Assamese, …)
function encodeHeader(text) {
  return /^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${base64Utf8(text)}?=`;
}

function wrap76(base64) {
  return base64.replace(/.{1,76}/g, '$&\r\n');
}

function buildMessage({ from, fromName, to, replyTo, subject, text, html, inlineImages = [] }) {
  const boundary = `f8h-${crypto.randomUUID()}`;
  const related = `f8h-rel-${crypto.randomUUID()}`;
  const domain = from.split('@')[1];
  const headers = [
    `From: ${encodeHeader(fromName)} <${from}>`,
    `To: ${to.join(', ')}`,
    ...(replyTo ? [`Reply-To: ${replyTo}`] : []),
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    'MIME-Version: 1.0',
  ];
  const part = (type, body) =>
    [`--${boundary}`, `Content-Type: ${type}; charset=UTF-8`, 'Content-Transfer-Encoding: base64', '', wrap76(base64Utf8(body))].join('\r\n');
  const alternative = [part('text/plain', text), part('text/html', html), `--${boundary}--`].join('\r\n');

  if (inlineImages.length === 0) {
    return [...headers, `Content-Type: multipart/alternative; boundary="${boundary}"`, '', alternative, ''].join('\r\n');
  }
  // Images the HTML shows with <img src="cid:…"> travel as inline parts next to it
  const images = inlineImages.map((img) =>
    [
      `--${related}`,
      `Content-Type: ${img.contentType}; name="${img.filename}"`,
      'Content-Transfer-Encoding: base64',
      `Content-ID: <${img.cid}>`,
      `Content-Disposition: inline; filename="${img.filename}"`,
      '',
      wrap76(img.base64),
    ].join('\r\n'),
  );
  return [
    ...headers,
    `Content-Type: multipart/related; boundary="${related}"`,
    '',
    `--${related}`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    alternative,
    ...images,
    `--${related}--`,
    '',
  ].join('\r\n');
}

/**
 * Send one email through Gmail's SMTP server (implicit TLS on port 465).
 */
export async function sendMail(env, { to, subject, text, html, replyTo, inlineImages }) {
  const config = mailConfig(env);
  if (!config.enabled) return false;
  const recipients = (Array.isArray(to) ? to : [to]).filter(isEmail);
  if (recipients.length === 0) return false;
  if (replyTo && !isEmail(replyTo)) replyTo = undefined;

  const socket = connect({ hostname: config.host, port: config.port }, { secureTransport: config.secure ? 'on' : 'off' });
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  let buffer = '';

  // Read one (possibly multi-line) SMTP reply, e.g. "250-…\r\n250 OK\r\n"
  async function readReply() {
    for (;;) {
      const lines = buffer.split('\r\n');
      for (let i = 0; i < lines.length - 1; i += 1) {
        if (/^\d{3} /.test(lines[i]) || /^\d{3}$/.test(lines[i])) {
          buffer = lines.slice(i + 1).join('\r\n');
          return { code: Number(lines[i].slice(0, 3)), text: lines.slice(0, i + 1).join(' | ') };
        }
      }
      const { value, done } = await reader.read();
      if (done) throw new Error('Mail server closed the connection');
      buffer += decoder.decode(value, { stream: true });
    }
  }

  async function command(line, expected, label = line) {
    if (line !== null) await writer.write(encoder.encode(`${line}\r\n`));
    const reply = await readReply();
    if (!expected.includes(reply.code)) throw new Error(`Mail server rejected ${label}: ${reply.text}`);
    return reply;
  }

  try {
    await command(null, [220], 'connection');
    await command(`EHLO ${config.user.split('@')[1] || 'localhost'}`, [250], 'EHLO');
    await command('AUTH LOGIN', [334]);
    await command(btoa(config.user), [334], 'username');
    await command(btoa(config.password), [235], 'app password');
    await command(`MAIL FROM:<${config.user}>`, [250]);
    for (const rcpt of recipients) await command(`RCPT TO:<${rcpt}>`, [250, 251], 'recipient');
    await command('DATA', [354]);
    const message = buildMessage({ from: config.user, fromName: 'Furniture8home', to: recipients, replyTo, subject, text, html, inlineImages });
    // Lines starting with "." must be doubled so they aren't read as the end of the message
    const stuffed = message.replace(/\r\n\./g, '\r\n..');
    await command(`${stuffed}\r\n.`, [250], 'message');
    await command('QUIT', [221]).catch(() => {});
    return true;
  } finally {
    socket.close().catch(() => {});
  }
}
