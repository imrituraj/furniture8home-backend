const TOKEN_KEY = 'f8h_admin_token';

let expiredHandler = null;

export function onSessionExpired(handler) {
  expiredHandler = handler;
  return () => {
    if (expiredHandler === handler) expiredHandler = null;
  };
}

export function isAuthenticated() {
  return Boolean(sessionStorage.getItem(TOKEN_KEY));
}

async function request(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sessionStorage.getItem(TOKEN_KEY) || ''}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 401 && path !== '/admin/login') {
    sessionStorage.removeItem(TOKEN_KEY);
    expiredHandler?.();
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return res.status === 204 ? null : res.json();
}

export async function login(pin) {
  const { token } = await request('POST', '/admin/login', { pin });
  sessionStorage.setItem(TOKEN_KEY, token);
}

export async function logout() {
  try {
    await request('POST', '/admin/logout');
  } finally {
    sessionStorage.removeItem(TOKEN_KEY);
  }
}

export const fetchCatalog = () => request('GET', '/admin/products');
export const addProduct = (data) => request('POST', '/admin/products', data);
export const updateProduct = (id, updates) => request('PATCH', `/admin/products/${id}`, updates);
export const deleteProduct = (id) => request('DELETE', `/admin/products/${id}`);
export const duplicateProduct = (id) => request('POST', `/admin/products/${id}/duplicate`);
export const importCatalog = (products) => request('PUT', '/admin/catalog', products);
export const resetCatalog = () => request('POST', '/admin/catalog/reset');

/**
 * Format a number or string into ₹ formatted string (e.g. 14500 -> "₹14,500")
 */
export function formatPrice(val) {
  if (val === undefined || val === null || val === '') return '₹0';
  const num = typeof val === 'number' ? val : parseInt(String(val).replace(/[^0-9]/g, ''), 10) || 0;
  return `₹${num.toLocaleString('en-IN')}`;
}

/**
 * Extract clean numeric price
 */
export function parsePriceNum(val) {
  if (typeof val === 'number') return Math.max(0, Math.round(val));
  const num = parseInt(String(val || '').replace(/[^0-9]/g, ''), 10);
  return isNaN(num) ? 0 : num;
}

/**
 * Generate URL slug from title
 */
export function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export const fetchOrders = () => request('GET', '/admin/orders');
export const updateOrder = (id, updates) => request('PATCH', `/admin/orders/${id}`, updates);

const categoryPath = (id) => `/admin/categories/${encodeURIComponent(id)}`;
export const fetchCategories = () => request('GET', '/admin/categories');
export const addCategory = (data) => request('POST', '/admin/categories', data);
export const updateCategory = (id, updates) => request('PATCH', categoryPath(id), updates);
export const deleteCategory = (id) => request('DELETE', categoryPath(id));
export const reorderCategories = (ids) => request('PUT', '/admin/categories/order', { ids });
