import { ValidationError, randomHex } from './util.js';

// D1 stores at most 2 MB per value. The admin resizes photos before upload, so this is a backstop.
const MAX_BYTES = 1_500_000;

/**
 * If `img` is a freshly uploaded photo (data: URL), save it and return its /media path.
 * Anything else (site images, https URLs, existing media) is returned unchanged.
 */
export async function storeImage(db, img) {
  const match = /^data:(image\/(?:png|jpe?g|webp|gif|avif));base64,([a-z0-9+/=\s]+)$/i.exec(img || '');
  if (!match) return img;
  const binary = atob(match[2].replace(/\s/g, ''));
  if (binary.length > MAX_BYTES) throw new ValidationError('That photo is too large. Please use one under 1.5 MB.');
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  const id = randomHex(16);
  await db
    .prepare('INSERT INTO media (id, mime, bytes, created_at) VALUES (?, ?, ?, ?)')
    .bind(id, match[1].toLowerCase(), bytes, new Date().toISOString())
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
    },
  });
}
