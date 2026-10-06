import { ValidationError } from './util.js';
import { hasCategory } from './categories.js';
import { storeImage } from './media.js';

const MAX_PRICE = 10_000_000; // ₹1 crore — well above any real piece, guards against typos and overflow
const MAX_PRODUCTS = 2000;
const MAX_FEATURES = 20;
const DEFAULT_IMG = 'images/chairs/B612_20221205_111922_652.jpg';

/**
 * Format a number or string into ₹ formatted string (e.g. 14500 -> "₹14,500")
 */
export function formatPrice(val) {
  if (val === undefined || val === null || val === '') return '₹0';
  const num = typeof val === 'number' ? val : parseInt(String(val).replace(/[^0-9]/g, ''), 10) || 0;
  return `₹${num.toLocaleString('en-IN')}`;
}

export function parsePriceNum(val) {
  if (typeof val === 'number') return Math.max(0, Math.round(val));
  const num = parseInt(String(val || '').replace(/[^0-9]/g, ''), 10);
  return isNaN(num) ? 0 : num;
}

export function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function text(value, max) {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim().slice(0, max) : '';
}

/**
 * Only allow images that are safe to put in src/href on the storefront: site-relative paths,
 * https URLs, photos already uploaded to /media, or a new upload (data: URL, stored by storeImage).
 */
export function safeImage(value, fallback = DEFAULT_IMG) {
  const img = text(value, 4_000_000);
  if (!img) return fallback;
  if (/^data:image\/(png|jpe?g|webp|gif|avif);base64,[a-z0-9+/=\s]+$/i.test(img)) return img;
  if (/^https:\/\/[^\s"'<>]+$/i.test(img)) return img;
  if (/^media\/[a-f0-9]{32}$/.test(img)) return img;
  if (/^\/?images\/[\w\-./~ ]+$/.test(img) && !img.includes('..')) return img;
  throw new ValidationError('Image must be an uploaded image, an https:// URL, or a path under images/');
}

function safeLocalization(as) {
  if (!as || typeof as !== 'object' || Array.isArray(as)) return null;
  const name = text(as.name, 200);
  const desc = text(as.desc, 2000);
  return name || desc ? { name, desc } : null;
}

function nextId(list) {
  return list.reduce((max, p) => Math.max(max, Number(p.id) || 0), 100) + 1;
}

/**
 * Normalize product to ensure all required fields are present
 */
export function normalizeProduct(product, existingList = []) {
  if (!product || typeof product !== 'object' || Array.isArray(product)) {
    throw new ValidationError('Each product must be an object');
  }
  const priceNum = Math.min(MAX_PRICE, parsePriceNum(product.priceNum ?? product.price));
  const rawId = Math.floor(Number(product.id));
  const id = Number.isSafeInteger(rawId) && rawId > 0 ? rawId : nextId(existingList);
  const name = text(product.name, 200) || 'Untitled Furniture Piece';
  const slug = slugify(text(product.slug, 200)) || slugify(name) || `piece-${id}`;
  const rating = Number(product.rating);
  const reviews = Math.floor(Number(product.reviews));

  return {
    id,
    slug,
    name,
    cat: text(product.cat, 60) || 'Accent',
    price: formatPrice(priceNum),
    priceNum,
    badge: text(product.badge, 60),
    rating: rating > 0 && rating <= 5 ? Math.round(rating * 10) / 10 : 4.9,
    reviews: reviews >= 0 && reviews < 1_000_000 ? reviews : 12,
    img: safeImage(product.img),
    desc: text(product.desc, 2000),
    dims: text(product.dims, 300),
    material: text(product.material, 300),
    features: Array.isArray(product.features)
      ? product.features.map((f) => text(f, 200)).filter(Boolean).slice(0, MAX_FEATURES)
      : [],
    inStock: product.inStock !== false, // default true
    hidden: product.hidden === true,    // default false
    as: safeLocalization(product.as),   // optional Assamese localization overrides
  };
}

// ---------- Storage ----------

export async function getCatalog(db) {
  const { results } = await db.prepare('SELECT data FROM products ORDER BY position, id').all();
  return results.map((row) => JSON.parse(row.data));
}

export async function getPublicCatalog(db) {
  return (await getCatalog(db)).filter((product) => !product.hidden);
}

async function getProduct(db, id) {
  const row = await db.prepare('SELECT data FROM products WHERE id = ?').bind(Number(id)).first();
  return row ? JSON.parse(row.data) : null;
}

async function insertAtTop(db, product) {
  await db
    .prepare('INSERT INTO products (id, position, data) VALUES (?1, (SELECT COALESCE(MIN(position), 0) - 1 FROM products), ?2)')
    .bind(product.id, JSON.stringify(product))
    .run();
}

// Products created or edited from the admin must belong to a managed category
async function assertCategory(db, cat) {
  if (!(await hasCategory(db, text(cat, 60)))) {
    throw new ValidationError('Choose a category from the list (add new ones in the Categories tab)');
  }
}

async function withStoredImage(db, product) {
  return { ...product, img: await storeImage(db, product.img) };
}

export async function updateProduct(db, id, updates) {
  const target = await getProduct(db, id);
  if (!target) return null;
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) throw new ValidationError('Invalid update');
  if ('cat' in updates) await assertCategory(db, updates.cat);

  const merged = { ...target, ...updates, id: target.id };
  // Recalculate price if either price or priceNum was passed
  if ('price' in updates || 'priceNum' in updates) {
    merged.priceNum = parsePriceNum(updates.priceNum ?? updates.price);
  }
  // Recalculate slug if title changed and slug wasn't explicitly supplied
  if (updates.name && !updates.slug) {
    merged.slug = slugify(updates.name) || target.slug;
  }

  const normalized = await withStoredImage(db, normalizeProduct(merged));
  await db.prepare('UPDATE products SET data = ? WHERE id = ?').bind(JSON.stringify(normalized), normalized.id).run();
  return normalized;
}

export async function addProduct(db, data) {
  const { count } = await db.prepare('SELECT COUNT(*) AS count FROM products').first();
  if (count >= MAX_PRODUCTS) throw new ValidationError(`A catalog can hold at most ${MAX_PRODUCTS} products`);
  const { id: _ignored, ...rest } = data || {};
  await assertCategory(db, rest.cat);
  const { maxId } = await db.prepare('SELECT COALESCE(MAX(id), 100) AS maxId FROM products').first();
  const normalized = await withStoredImage(db, normalizeProduct({ ...rest, id: Math.max(100, maxId) + 1 }));
  // Newly added items go to the top of the catalog
  await insertAtTop(db, normalized);
  return normalized;
}

export async function duplicateProduct(db, id) {
  const item = await getProduct(db, id);
  if (!item) return null;
  const { maxId } = await db.prepare('SELECT COALESCE(MAX(id), 100) AS maxId FROM products').first();
  const newId = Math.max(100, maxId) + 1;
  const clone = normalizeProduct({
    ...item,
    id: newId,
    name: `${item.name} (Copy)`,
    slug: `${item.slug}-copy-${newId}`,
    badge: item.badge || 'New Variation',
  });
  await insertAtTop(db, clone);
  return clone;
}

export async function deleteProduct(db, id) {
  const { meta } = await db.prepare('DELETE FROM products WHERE id = ?').bind(Number(id)).run();
  return meta.changes > 0;
}

export async function countProductsInCategory(db, cat) {
  const { count } = await db.prepare("SELECT COUNT(*) AS count FROM products WHERE json_extract(data, '$.cat') = ?").bind(cat).first();
  return count;
}

// D1 caps a single value at 2 MB; keep each JSON chunk well under that
const CHUNK_BYTES = 900_000;

function chunkBySize(items) {
  const chunks = [];
  let current = [];
  let size = 0;
  let offset = 0;
  items.forEach((item, index) => {
    const itemSize = JSON.stringify(item).length;
    if (current.length && size + itemSize > CHUNK_BYTES) {
      chunks.push([offset, current]);
      current = [];
      size = 0;
      offset = index;
    }
    current.push(item);
    size += itemSize;
  });
  if (current.length) chunks.push([offset, current]);
  return chunks;
}

/**
 * Replace the whole catalog (JSON import, factory reset, first-run seed).
 */
export async function replaceCatalog(db, data) {
  if (!Array.isArray(data) || data.length === 0) {
    throw new ValidationError('Invalid JSON: Must be an array of products');
  }
  if (data.length > MAX_PRODUCTS) throw new ValidationError(`A catalog can hold at most ${MAX_PRODUCTS} products`);

  const normalized = data.map((item) => normalizeProduct(item, data));
  // Duplicate ids would make edits hit the wrong product — give repeats a fresh id
  let maxId = nextId(normalized) - 1;
  const seen = new Set();
  for (const product of normalized) {
    if (seen.has(product.id)) product.id = ++maxId;
    seen.add(product.id);
  }
  const stored = [];
  for (const product of normalized) stored.push(await withStoredImage(db, product));

  // Insert in a few large statements: free-plan Workers may only run 50 queries per request.
  // Each chunk is one JSON array, expanded row by row with json_each.
  const insert = db.prepare(
    'INSERT INTO products (id, position, data) SELECT json_extract(value, \'$.id\'), ?1 + key, value FROM json_each(?2)',
  );
  const statements = [db.prepare('DELETE FROM products')];
  for (const [offset, chunk] of chunkBySize(stored)) statements.push(insert.bind(offset, JSON.stringify(chunk)));
  await db.batch(statements);
  return stored;
}
