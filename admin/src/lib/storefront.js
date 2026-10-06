// The storefront is hosted separately (Vercel). Override with VITE_STOREFRONT_URL at build time.
const DEFAULT_STOREFRONT = import.meta.env.DEV ? 'http://localhost:5173' : 'https://furniture8home.com';
export const STOREFRONT_URL = (import.meta.env.VITE_STOREFRONT_URL || DEFAULT_STOREFRONT).replace(/\/+$/, '');

/**
 * Resolve a product or category image for display in the admin.
 * Uploaded photos ("media/<id>") are served by this backend; catalog images ("images/…")
 * live on the storefront.
 */
export function assetUrl(src) {
  if (!src || /^(https?:|data:|blob:)/.test(src)) return src;
  const path = src.replace(/^\/+/, '');
  return path.startsWith('media/') ? `/${path}` : `${STOREFRONT_URL}/${path}`;
}

export function productUrl(product) {
  return `${STOREFRONT_URL}/?product=${encodeURIComponent(product.slug)}`;
}
