import { ValidationError } from './util.js';
import { safeImage, slugify, text } from './catalog.js';
import { storeImage } from './media.js';

const MAX_CATEGORIES = 100;
const DEFAULT_IMG = 'images/lsofa/0e06df108cba5f38f4c09e7d95643405.jpg';

/**
 * A category's id is what products store in `cat`, so it never changes after creation.
 */
export function normalizeCategory(category, index = 0) {
  if (!category || typeof category !== 'object' || Array.isArray(category)) {
    throw new ValidationError('Each category must be an object');
  }
  const id = text(category.id, 60);
  const name = text(category.name, 60);
  if (!id) throw new ValidationError('Category id is missing');
  if (!name) throw new ValidationError('Please give the category a name');
  const sort = Number(category.sort);
  return {
    id,
    name,
    nameAs: text(category.nameAs, 60),
    img: safeImage(category.img, DEFAULT_IMG),
    sort: Number.isFinite(sort) ? Math.round(sort) : index,
    hidden: category.hidden === true,
    // Show the L-shape orientation picker for products in this category
    chaise: category.chaise === true,
  };
}

export async function getCategories(db) {
  const { results } = await db.prepare('SELECT data FROM categories ORDER BY sort, id').all();
  return results.map((row) => JSON.parse(row.data));
}

export async function getPublicCategories(db) {
  return (await getCategories(db)).filter((c) => !c.hidden);
}

async function getCategory(db, id) {
  const row = await db.prepare('SELECT data FROM categories WHERE id = ?').bind(id).first();
  return row ? JSON.parse(row.data) : null;
}

export async function hasCategory(db, id) {
  return Boolean(id) && Boolean(await db.prepare('SELECT 1 FROM categories WHERE id = ?').bind(id).first());
}

function save(db, category) {
  return db
    .prepare('INSERT INTO categories (id, sort, data) VALUES (?1, ?2, ?3) ON CONFLICT (id) DO UPDATE SET sort = ?2, data = ?3')
    .bind(category.id, category.sort, JSON.stringify(category));
}

export async function addCategory(db, data) {
  const { count, maxSort } = await db.prepare('SELECT COUNT(*) AS count, COALESCE(MAX(sort), -1) AS maxSort FROM categories').first();
  if (count >= MAX_CATEGORIES) throw new ValidationError(`You can have at most ${MAX_CATEGORIES} categories`);
  const base = slugify(text(data?.name, 60));
  if (!base) throw new ValidationError('Please give the category a name using letters or numbers');
  let id = base;
  for (let n = 2; await hasCategory(db, id); n += 1) id = `${base}-${n}`;
  const category = normalizeCategory({ ...data, id, sort: maxSort + 1 });
  category.img = await storeImage(db, category.img);
  await save(db, category).run();
  return category;
}

export async function updateCategory(db, id, updates) {
  const current = await getCategory(db, id);
  if (!current) return null;
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) throw new ValidationError('Invalid update');
  const next = normalizeCategory({ ...current, ...updates, id: current.id, sort: current.sort });
  next.img = await storeImage(db, next.img);
  await save(db, next).run();
  return next;
}

/**
 * Save a new display order. `ids` must list every category exactly once.
 */
export async function reorderCategories(db, ids) {
  const current = await getCategories(db);
  const known = new Set(current.map((c) => c.id));
  if (!Array.isArray(ids) || ids.length !== current.length || new Set(ids).size !== ids.length || !ids.every((id) => known.has(id))) {
    throw new ValidationError('The new order must list every category once');
  }
  await db.batch(current.map((c) => save(db, { ...c, sort: ids.indexOf(c.id) })));
  return getCategories(db);
}

/**
 * Delete a category. Refused while products still use it, so nothing is silently orphaned.
 */
export async function deleteCategory(db, id, productCount) {
  if (!(await hasCategory(db, id))) return false;
  if (productCount > 0) {
    throw new ValidationError(`${productCount} product${productCount === 1 ? ' is' : 's are'} still in this category. Move or delete them first.`);
  }
  await db.prepare('DELETE FROM categories WHERE id = ?').bind(id).run();
  return true;
}

export async function replaceCategories(db, list) {
  const normalized = list.map((c, index) => normalizeCategory(c, index));
  await db.batch([db.prepare('DELETE FROM categories'), ...normalized.map((c) => save(db, c))]);
  return normalized;
}
