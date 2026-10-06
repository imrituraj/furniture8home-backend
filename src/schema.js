// Database schema. Every statement is idempotent; the Worker runs it once per instance before its
// first query, so a new (empty) D1 database needs no separate migration step.
export const SCHEMA = `
-- Furniture8home shop data. Products, categories and orders keep their full record as JSON in
-- data; the other columns are only what queries need to sort or look things up.

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  position INTEGER NOT NULL,   -- storefront "featured" order; new products get the lowest value
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,         -- stored on products as cat, never changes
  sort INTEGER NOT NULL,
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  razorpay_order_id TEXT,
  access_token TEXT NOT NULL,  -- lets the customer who placed the order check and pay for it
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS orders_by_razorpay_order ON orders (razorpay_order_id);
CREATE INDEX IF NOT EXISTS orders_by_created ON orders (created_at);

-- Photos uploaded from the admin dashboard, served at /media/<id>
CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  mime TEXT NOT NULL,
  bytes BLOB NOT NULL,
  created_at TEXT NOT NULL
);

-- Admin logins. Only a hash of each session token is stored.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);

-- Fixed-window rate-limit counters (orders per device, wrong PINs)
CREATE TABLE IF NOT EXISTS counters (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);

-- One-off flags, e.g. whether the starter catalog has been loaded
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;
