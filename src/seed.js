import seedProducts from '../seed/products.json';
import seedCategories from '../seed/categories.json';
import { replaceCatalog } from './catalog.js';
import { replaceCategories } from './categories.js';
import { SCHEMA } from './schema.js';

let seeded = false;

// Split the schema into single statements, dropping SQL comments
const STATEMENTS = SCHEMA.replace(/--[^\n]*/g, '')
  .split(';')
  .map((statement) => statement.trim())
  .filter(Boolean);

/**
 * Create any missing tables, then load the starter categories and catalog the first time the
 * shop runs against an empty database. Seeding is recorded in `meta`, so deleting every
 * product later doesn't bring the starter catalog back.
 */
export async function ensureSeeded(db) {
  if (seeded) return;
  await db.batch(STATEMENTS.map((statement) => db.prepare(statement)));
  const done = await db.prepare("SELECT 1 FROM meta WHERE key = 'seeded'").first();
  if (!done) {
    await replaceCategories(db, seedCategories);
    await replaceCatalog(db, seedProducts);
    await db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('seeded', ?)").bind(new Date().toISOString()).run();
  }
  seeded = true;
}

export function resetCatalog(db) {
  return replaceCatalog(db, seedProducts);
}
