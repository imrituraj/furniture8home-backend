import { ValidationError, randomHex } from './util.js';

// D1 stores at most 2 MB per value. The admin resizes photos before upload, so this is a backstop.
const MAX_BYTES = 1_500_000;

/**
 * If `img` is a freshly uploaded photo (data: URL), save it and return its /media path.
 * Anything else (site images, https URLs, existing media) is returned unchanged.
 */
// File signatures, so a file can't claim to be an image without being one
const SIGNATURES = {
  'image/png': (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/gif': (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38,
  'image/webp': (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  'image/avif': (b) => b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70,
};

export async function storeImage(db, img) {
  const match = /^data:(image\/(?:png|jpe?g|webp|gif|avif));base64,([a-z0-9+/=\s]+)$/i.exec(img || '');
  if (!match) return img;
  let binary;
  try {
    binary = atob(match[2].replace(/\s/g, ''));
  } catch {
    throw new ValidationError('That photo could not be read. Please upload it again.');
  }
  if (binary.length > MAX_BYTES) throw new ValidationError('That photo is too large. Please use one under 1.5 MB.');
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  const mime = match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase();
  if (!SIGNATURES[mime]?.(bytes)) throw new ValidationError('That file is not a valid image. Please upload a JPG, PNG, WebP, GIF or AVIF photo.');
  const id = randomHex(16);
  await db
    .prepare('INSERT INTO media (id, mime, bytes, created_at) VALUES (?, ?, ?, ?)')
    .bind(id, mime, bytes, new Date().toISOString())
    .run();
  return `media/${id}`;
}

export async function serveMedia(db, id) {
  if (!/^[a-f0-9]{32}$/.test(id)) return new Response('Not found', { status: 404 });
  const row = await db.prepare('SELECT mime, bytes FROM media WHERE id = ?').bind(id).first();
  if (!row) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(row.bytes), {
    headers: {
      'Content-Type': row.mime,
      // Media ids are random and never reused, so the bytes behind a URL never change
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      // Even if a crafted file got in, a browser won't run anything from it
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      'Content-Disposition': 'inline',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    },
  });
}
