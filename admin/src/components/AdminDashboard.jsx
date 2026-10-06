import { useEffect, useMemo, useRef, useState } from 'react';
import {
  addProduct,
  deleteProduct,
  duplicateProduct,
  fetchCatalog,
  fetchCategories,
  formatPrice,
  importCatalog,
  logout,
  parsePriceNum,
  resetCatalog,
  slugify,
  updateProduct,
} from '../lib/api.js';
import { assetUrl, productUrl } from '../lib/storefront.js';
import { readResizedImage } from '../lib/images.js';
import { ChairIcon, CloseIcon, HeartIcon, WaIcon } from './Icons.jsx';

const PRESET_IMAGES = [
  { label: 'Aura Lilac Dining', url: 'images/chairs/B612_20221205_111922_652.jpg' },
  { label: 'Celeste Marine Blue', url: 'images/chairs/B612_20221205_112007_914.jpg' },
  { label: 'Artisan Solid Oak', url: 'images/chairs/image.jpg' },
  { label: 'Emerald Dining Chair', url: 'images/chairs/image_1.jpg' },
  { label: 'L-Sectional Velvet', url: 'images/lsofa/0e06df108cba5f38f4c09e7d95643405.jpg' },
  { label: 'Solid Teak Sofa', url: 'images/woodensofa/2223b117512a2b4decec1a5c0d5163e2.jpg' },
  { label: 'Velvet Accent Armchair', url: 'images/singlechair/5d54248074aaac490842264668b74d3d.jpg' },
  { label: 'Meadow Floral Wingback', url: 'images/original_site/prod_5_meadow_floral_wingback_ottoman.jpeg' },
];

export default function AdminDashboard({ nav, onExit, onLogout }) {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // all | live | out | hidden
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [sortKey, setSortKey] = useState('newest'); // newest | price-desc | price-asc | name-asc | rating
  const [viewMode, setViewMode] = useState('table'); // table | grid

  // Modals state
  const [editingProduct, setEditingProduct] = useState(null); // null or product object
  const [isCreating, setIsCreating] = useState(false);
  const [deleteCandidate, setDeleteCandidate] = useState(null);
  const [showExportModal, setShowExportModal] = useState(false);
  const [importJsonText, setImportJsonText] = useState('');
  const [importError, setImportError] = useState('');
  const [toast, setToast] = useState(null);

  // Inline price edit state: { [id]: priceString }
  const [inlinePriceId, setInlinePriceId] = useState(null);
  const [inlinePriceVal, setInlinePriceVal] = useState('');

  const toastTimerRef = useRef(null);

  function showToast(message, type = 'success') {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message, type });
    toastTimerRef.current = setTimeout(() => setToast(null), 3200);
  }

  // Run a server action, then refresh the catalog; surface failures as a toast
  async function run(action) {
    try {
      const result = await action();
      setProducts(await fetchCatalog());
      return result;
    } catch (err) {
      showToast(err.message || 'Something went wrong', 'warning');
      return null;
    }
  }

  useEffect(() => {
    fetchCategories()
      .then(setCategories)
      .catch((err) => showToast(err.message || 'Failed to load categories', 'warning'));
    fetchCatalog()
      .then(setProducts)
      .catch((err) => showToast(err.message || 'Failed to load catalog', 'warning'))
      .finally(() => setLoading(false));
  }, []);

  function onOpenProduct(product) {
    window.open(productUrl(product), '_blank', 'noopener');
  }

  const catName = (id) => categories.find((c) => c.id === id)?.name || id;

  async function handleLogout() {
    await logout().catch(() => {});
    onLogout();
  }

  // Compute stats
  const stats = useMemo(() => {
    const total = products.length;
    const live = products.filter((p) => !p.hidden).length;
    const outOfStock = products.filter((p) => p.inStock === false).length;
    const hidden = products.filter((p) => p.hidden).length;
    const cats = new Set(products.map((p) => p.cat)).size;
    const avgPrice = Math.round(
      products.reduce((acc, p) => acc + (p.priceNum || 0), 0) / (total || 1)
    );
    return { total, live, outOfStock, hidden, cats, avgPrice };
  }, [products]);

  // Filtered & sorted products
  const filteredProducts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products
      .filter((product) => {
        // Status filter
        if (statusFilter === 'live' && product.hidden) return false;
        if (statusFilter === 'out' && product.inStock !== false) return false;
        if (statusFilter === 'hidden' && !product.hidden) return false;

        // Category filter
        if (categoryFilter !== 'all' && product.cat !== categoryFilter) return false;

        // Query search
        if (!q) return true;
        const haystack = [
          product.name,
          product.slug,
          String(product.id),
          product.cat,
          product.badge,
          product.material,
          product.desc,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        return haystack.includes(q);
      })
      .sort((a, b) => {
        if (sortKey === 'newest') return b.id - a.id;
        if (sortKey === 'price-desc') return (b.priceNum || 0) - (a.priceNum || 0);
        if (sortKey === 'price-asc') return (a.priceNum || 0) - (b.priceNum || 0);
        if (sortKey === 'name-asc') return (a.name || '').localeCompare(b.name || '');
        if (sortKey === 'rating') return (b.rating || 0) - (a.rating || 0);
        return 0;
      });
  }, [products, query, statusFilter, categoryFilter, sortKey]);

  // Actions
  async function handleToggleStock(product) {
    const updated = await run(() => updateProduct(product.id, { inStock: product.inStock === false }));
    if (updated) {
      showToast(
        `"${updated.name}" is now ${updated.inStock ? 'In Stock' : 'Marked Stock Out'}`,
        updated.inStock ? 'success' : 'warning'
      );
    }
  }

  async function handleToggleVisibility(product) {
    const updated = await run(() => updateProduct(product.id, { hidden: !product.hidden }));
    if (updated) {
      showToast(
        `"${updated.name}" ${updated.hidden ? 'hidden from customer store' : 'is now LIVE on store'}`,
        updated.hidden ? 'warning' : 'success'
      );
    }
  }

  async function handleDuplicate(id) {
    const clone = await run(() => duplicateProduct(id));
    if (clone) showToast(`Duplicated: "${clone.name}"`, 'success');
  }

  async function handleDeleteConfirm() {
    if (!deleteCandidate) return;
    const candidate = deleteCandidate;
    setDeleteCandidate(null);
    const ok = await run(() => deleteProduct(candidate.id).then(() => true));
    if (ok) showToast(`Deleted "${candidate.name}" permanently`, 'warning');
  }

  function handleStartInlinePrice(product) {
    setInlinePriceId(product.id);
    setInlinePriceVal(String(product.priceNum || ''));
  }

  async function handleSaveInlinePrice(product) {
    const num = parsePriceNum(inlinePriceVal);
    setInlinePriceId(null);
    const updated = await run(() => updateProduct(product.id, { price: num, priceNum: num }));
    if (updated) showToast(`Updated price for "${product.name}" to ${updated.price}`);
  }

  async function handleSaveProductModal(formData) {
    if (isCreating) {
      const created = await run(() => addProduct(formData));
      if (created) {
        setIsCreating(false);
        showToast(`Added new piece "${created.name}" to catalog!`, 'success');
      }
    } else if (editingProduct) {
      const updated = await run(() => updateProduct(editingProduct.id, formData));
      if (updated) {
        setEditingProduct(null);
        showToast(`Saved updates for "${updated.name}"`, 'success');
      }
    }
  }

  async function handleResetCatalog() {
    if (window.confirm('Reset catalog to the factory defaults? Any custom additions or price updates will be restored to initial defaults.')) {
      const ok = await run(() => resetCatalog().then(() => true));
      if (ok) showToast('Catalog restored to factory defaults.', 'warning');
    }
  }

  async function handleImportSubmit(e) {
    e.preventDefault();
    setImportError('');
    let data;
    try {
      data = JSON.parse(importJsonText);
    } catch (err) {
      setImportError(err.message || 'Failed to parse JSON');
      return;
    }
    try {
      setProducts(await importCatalog(data));
      setShowExportModal(false);
      setImportJsonText('');
      showToast('Catalog imported successfully!', 'success');
    } catch (err) {
      setImportError(err.message || 'Import failed');
    }
  }

  function handleDownloadJson() {
    const blob = new Blob([JSON.stringify(products, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'products.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="admin-wrapper">
      {/* Toast Notification */}
      {toast && (
        <div className={`admin-toast admin-toast-${toast.type}`} role="status">
          <span>{toast.message}</span>
          <button type="button" onClick={() => setToast(null)}>×</button>
        </div>
      )}

      {/* Admin Navbar */}
      <header className="admin-nav-header">
        <div className="admin-nav-inner wrap">
          <div className="admin-brand">
            <div className="admin-brand-icon">
              <ChairIcon />
            </div>
            <div>
              <div className="admin-brand-title">
                Furniture<span className="num">8</span>home
                <span className="admin-badge">Admin Manager</span>
              </div>
              <div className="admin-brand-sub">Catalog, Pricing, Stock & Storefront Control</div>
            </div>
          </div>

          <div className="admin-nav-actions">
            {nav}
            <button
              type="button"
              className="admin-btn admin-btn-secondary"
              onClick={() => setShowExportModal(true)}
              title="Download or backup products.json"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              <span>Export / Import</span>
            </button>

            <button
              type="button"
              className="admin-btn admin-btn-primary"
              onClick={() => {
                setIsCreating(true);
                setEditingProduct(null);
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              <span>Add Furniture</span>
            </button>

            <button type="button" className="admin-btn admin-btn-ghost" onClick={onExit} title="Exit Admin and View Store">
              <span>← View Store</span>
            </button>

            <button type="button" className="admin-btn admin-btn-ghost" onClick={handleLogout} title="Log out of the admin dashboard">
              <span>Log out</span>
            </button>
          </div>
        </div>
      </header>

      <main className="admin-main wrap">
        {/* KPI Metrics Ribbon */}
        <section className="admin-kpi-grid">
          <div className="admin-kpi-card" onClick={() => setStatusFilter('all')} role="button" tabIndex={0}>
            <div className="admin-kpi-label">Total Catalog</div>
            <div className="admin-kpi-value">{stats.total}</div>
            <div className="admin-kpi-hint">Across {stats.cats} categories</div>
          </div>

          <div className="admin-kpi-card is-active" onClick={() => setStatusFilter('live')} role="button" tabIndex={0}>
            <div className="admin-kpi-label">Live in Store</div>
            <div className="admin-kpi-value" style={{ color: 'var(--brand-sage)' }}>{stats.live}</div>
            <div className="admin-kpi-hint">Visible to customers</div>
          </div>

          <div className="admin-kpi-card is-out" onClick={() => setStatusFilter('out')} role="button" tabIndex={0}>
            <div className="admin-kpi-label">Stock Out</div>
            <div className="admin-kpi-value" style={{ color: '#b91c1c' }}>{stats.outOfStock}</div>
            <div className="admin-kpi-hint">Available on custom order</div>
          </div>

          <div className="admin-kpi-card is-hidden" onClick={() => setStatusFilter('hidden')} role="button" tabIndex={0}>
            <div className="admin-kpi-label">Hidden / Drafts</div>
            <div className="admin-kpi-value" style={{ color: 'var(--ink-muted)' }}>{stats.hidden}</div>
            <div className="admin-kpi-hint">Unpublished from store</div>
          </div>

          <div className="admin-kpi-card">
            <div className="admin-kpi-label">Avg Piece Value</div>
            <div className="admin-kpi-value" style={{ color: 'var(--brand-brass)' }}>
              ₹{stats.avgPrice.toLocaleString('en-IN')}
            </div>
            <div className="admin-kpi-hint">Pricing health</div>
          </div>
        </section>

        {/* Toolbar & Filter Bar */}
        <section className="admin-controls-card">
          <div className="admin-controls-row">
            {/* Search */}
            <div className="admin-search-wrap">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search piece, category, SKU, material..."
                className="admin-search-input"
              />
              {query && (
                <button type="button" className="admin-search-clear" onClick={() => setQuery('')}>
                  ×
                </button>
              )}
            </div>

            {/* Status Pills */}
            <div className="admin-status-tabs">
              <button
                type="button"
                className={`admin-tab-btn${statusFilter === 'all' ? ' active' : ''}`}
                onClick={() => setStatusFilter('all')}
              >
                All ({products.length})
              </button>
              <button
                type="button"
                className={`admin-tab-btn${statusFilter === 'live' ? ' active' : ''}`}
                onClick={() => setStatusFilter('live')}
              >
                Live ({stats.live})
              </button>
              <button
                type="button"
                className={`admin-tab-btn${statusFilter === 'out' ? ' active' : ''}`}
                onClick={() => setStatusFilter('out')}
              >
                Stock Out ({stats.outOfStock})
              </button>
              <button
                type="button"
                className={`admin-tab-btn${statusFilter === 'hidden' ? ' active' : ''}`}
                onClick={() => setStatusFilter('hidden')}
              >
                Hidden ({stats.hidden})
              </button>
            </div>

            {/* Category Select */}
            <div className="admin-select-wrap">
              <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
                <option value="all">All Categories</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Sort Select */}
            <div className="admin-select-wrap">
              <select value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
                <option value="newest">Recently Added / SKU</option>
                <option value="price-desc">Price: High to Low</option>
                <option value="price-asc">Price: Low to High</option>
                <option value="name-asc">Name: A to Z</option>
                <option value="rating">Rating: Highest</option>
              </select>
            </div>

            {/* View Mode Toggle */}
            <div className="admin-view-toggle">
              <button
                type="button"
                className={`admin-toggle-icon-btn${viewMode === 'table' ? ' active' : ''}`}
                onClick={() => setViewMode('table')}
                title="Table view"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </svg>
              </button>
              <button
                type="button"
                className={`admin-toggle-icon-btn${viewMode === 'grid' ? ' active' : ''}`}
                onClick={() => setViewMode('grid')}
                title="Visual grid view"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="7" height="7" />
                  <rect x="14" y="3" width="7" height="7" />
                  <rect x="14" y="14" width="7" height="7" />
                  <rect x="3" y="14" width="7" height="7" />
                </svg>
              </button>
            </div>
          </div>
        </section>

        {/* Catalog List / Table */}
        <section className="admin-catalog-container">
          <div className="admin-table-meta">
            <span>
              {loading ? 'Loading catalog…' : (
                <>Showing <strong>{filteredProducts.length}</strong> of {products.length} products</>
              )}
            </span>
            <button type="button" className="admin-btn-link" onClick={handleResetCatalog}>
              Restore Factory Catalog
            </button>
          </div>

          {filteredProducts.length === 0 ? (
            <div className="admin-empty-state">
              <div className="admin-empty-icon">🛋️</div>
              <h3>No matching furniture found</h3>
              <p>Try clearing your search query or switching your filter status.</p>
              <button
                type="button"
                className="admin-btn admin-btn-secondary"
                onClick={() => {
                  setQuery('');
                  setStatusFilter('all');
                  setCategoryFilter('all');
                }}
              >
                Reset Filters
              </button>
            </div>
          ) : viewMode === 'table' ? (
            /* TABLE VIEW */
            <div className="admin-table-responsive">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th style={{ width: '70px' }}>Image</th>
                    <th>Product & SKU</th>
                    <th>Category</th>
                    <th style={{ width: '150px' }}>Price</th>
                    <th style={{ width: '130px', textAlign: 'center' }}>Stock Status</th>
                    <th style={{ width: '120px', textAlign: 'center' }}>Store Status</th>
                    <th style={{ width: '160px', textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProducts.map((p) => {
                    const isEditingPrice = inlinePriceId === p.id;
                    const isStockOut = p.inStock === false;
                    const isHidden = Boolean(p.hidden);

                    return (
                      <tr key={p.id} className={`${isHidden ? 'is-row-hidden' : ''} ${isStockOut ? 'is-row-out' : ''}`}>
                        {/* Thumbnail */}
                        <td>
                          <div
                            className="admin-table-thumb"
                            onClick={() => onOpenProduct(p)}
                            title="Click to view details"
                          >
                            <img src={assetUrl(p.img)} alt={p.name} loading="lazy" />
                          </div>
                        </td>

                        {/* Title & SKU */}
                        <td>
                          <div className="admin-cell-title">
                            <span className="admin-title-text" onClick={() => setEditingProduct(p)}>
                              {p.name}
                            </span>
                            {p.badge && <span className="admin-tag-badge">{p.badge}</span>}
                          </div>
                          <div className="admin-cell-sub">
                            <span>ID: #{p.id}</span>
                            <span>•</span>
                            <span className="admin-slug">{p.slug}</span>
                            <span>•</span>
                            <span>★ {p.rating} ({p.reviews})</span>
                          </div>
                        </td>

                        {/* Category */}
                        <td>
                          <span className="admin-cat-pill">{catName(p.cat)}</span>
                        </td>

                        {/* Price (Inline Editable!) */}
                        <td>
                          {isEditingPrice ? (
                            <div className="admin-inline-price-edit">
                              <span className="currency-prefix">₹</span>
                              <input
                                type="text"
                                value={inlinePriceVal}
                                onChange={(e) => setInlinePriceVal(e.target.value.replace(/[^0-9]/g, ''))}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleSaveInlinePrice(p);
                                  if (e.key === 'Escape') setInlinePriceId(null);
                                }}
                                autoFocus
                              />
                              <button
                                type="button"
                                className="admin-inline-btn save"
                                title="Save"
                                onClick={() => handleSaveInlinePrice(p)}
                              >
                                ✓
                              </button>
                              <button
                                type="button"
                                className="admin-inline-btn cancel"
                                title="Cancel"
                                onClick={() => setInlinePriceId(null)}
                              >
                                ✕
                              </button>
                            </div>
                          ) : (
                            <div
                              className="admin-price-display"
                              onClick={() => handleStartInlinePrice(p)}
                              title="Click to quick-edit price"
                            >
                              <span className="admin-price-text">{p.price}</span>
                              <span className="admin-price-pencil" aria-hidden="true">✎</span>
                            </div>
                          )}
                        </td>

                        {/* Stock Out Toggle */}
                        <td style={{ textAlign: 'center' }}>
                          <button
                            type="button"
                            className={`admin-status-pill${isStockOut ? ' pill-out' : ' pill-in'}`}
                            onClick={() => handleToggleStock(p)}
                            title={isStockOut ? 'Currently marked Stock Out (click to set In Stock)' : 'Currently In Stock (click to mark Stock Out)'}
                          >
                            <span className="pill-dot" />
                            {isStockOut ? 'Stock Out' : 'In Stock'}
                          </button>
                        </td>

                        {/* Visibility / Remove Toggle */}
                        <td style={{ textAlign: 'center' }}>
                          <button
                            type="button"
                            className={`admin-status-pill${isHidden ? ' pill-hidden' : ' pill-live'}`}
                            onClick={() => handleToggleVisibility(p)}
                            title={isHidden ? 'Hidden from customers (click to publish Live)' : 'Live on store (click to Hide/Remove)'}
                          >
                            <span className="pill-dot" />
                            {isHidden ? 'Hidden' : 'Live'}
                          </button>
                        </td>

                        {/* Actions */}
                        <td>
                          <div className="admin-actions-cell">
                            <button
                              type="button"
                              className="admin-action-icon edit"
                              onClick={() => setEditingProduct(p)}
                              title="Edit piece details"
                            >
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                              </svg>
                            </button>

                            <button
                              type="button"
                              className="admin-action-icon clone"
                              onClick={() => handleDuplicate(p.id)}
                              title="Duplicate piece"
                            >
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                              </svg>
                            </button>

                            <button
                              type="button"
                              className="admin-action-icon preview"
                              onClick={() => onOpenProduct(p)}
                              title="View on storefront"
                            >
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                <circle cx="12" cy="12" r="3" />
                              </svg>
                            </button>

                            <button
                              type="button"
                              className="admin-action-icon delete"
                              onClick={() => setDeleteCandidate(p)}
                              title="Delete permanently"
                            >
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <polyline points="3 6 5 6 21 6" />
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                              </svg>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            /* GRID VIEW */
            <div className="admin-grid-view">
              {filteredProducts.map((p) => {
                const isStockOut = p.inStock === false;
                const isHidden = Boolean(p.hidden);

                return (
                  <article key={p.id} className={`admin-card${isHidden ? ' is-hidden' : ''}${isStockOut ? ' is-out' : ''}`}>
                    <div className="admin-card-media">
                      <img src={assetUrl(p.img)} alt={p.name} loading="lazy" />
                      <div className="admin-card-badges">
                        {p.badge && <span className="admin-tag-badge">{p.badge}</span>}
                        {isStockOut && <span className="admin-badge-out">STOCK OUT</span>}
                        {isHidden && <span className="admin-badge-hidden">HIDDEN</span>}
                      </div>
                    </div>

                    <div className="admin-card-content">
                      <div className="admin-card-header">
                        <span className="admin-cat-pill">{catName(p.cat)}</span>
                        <span className="admin-sku-pill">#{p.id}</span>
                      </div>

                      <h3 className="admin-card-name" onClick={() => setEditingProduct(p)}>
                        {p.name}
                      </h3>

                      <div className="admin-card-price-row">
                        <span className="admin-card-price">{p.price}</span>
                        <span className="admin-card-rating">★ {p.rating}</span>
                      </div>

                      <div className="admin-card-switches">
                        <button
                          type="button"
                          className={`admin-status-pill${isStockOut ? ' pill-out' : ' pill-in'}`}
                          onClick={() => handleToggleStock(p)}
                        >
                          <span className="pill-dot" />
                          {isStockOut ? 'Stock Out' : 'In Stock'}
                        </button>

                        <button
                          type="button"
                          className={`admin-status-pill${isHidden ? ' pill-hidden' : ' pill-live'}`}
                          onClick={() => handleToggleVisibility(p)}
                        >
                          <span className="pill-dot" />
                          {isHidden ? 'Hidden' : 'Live'}
                        </button>
                      </div>

                      <div className="admin-card-footer">
                        <button
                          type="button"
                          className="admin-btn admin-btn-sm admin-btn-secondary"
                          onClick={() => setEditingProduct(p)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="admin-btn admin-btn-sm admin-btn-ghost"
                          onClick={() => handleDuplicate(p.id)}
                          title="Duplicate"
                        >
                          Clone
                        </button>
                        <button
                          type="button"
                          className="admin-btn admin-btn-sm admin-btn-danger"
                          onClick={() => setDeleteCandidate(p)}
                          title="Delete"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </main>

      {/* Edit / Create Product Modal */}
      {(editingProduct || isCreating) && (
        <ProductFormModal
          product={editingProduct}
          categories={categories}
          isCreating={isCreating}
          onClose={() => {
            setEditingProduct(null);
            setIsCreating(false);
          }}
          onSave={handleSaveProductModal}
        />
      )}

      {/* Delete Confirmation Modal */}
      {deleteCandidate && (
        <div className="admin-modal-overlay open" role="dialog" aria-modal="true">
          <div className="admin-confirm-card">
            <div className="admin-confirm-icon">⚠️</div>
            <h3>Delete &quot;{deleteCandidate.name}&quot;?</h3>
            <p>
              Are you sure you want to permanently delete this furniture piece (ID #{deleteCandidate.id})? This action
              cannot be undone unless you restore the factory defaults.
            </p>
            <div className="admin-confirm-actions">
              <button
                type="button"
                className="admin-btn admin-btn-secondary"
                onClick={() => setDeleteCandidate(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="admin-btn admin-btn-danger"
                onClick={handleDeleteConfirm}
              >
                Yes, Delete Piece
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export / Import Modal */}
      {showExportModal && (
        <div className="admin-modal-overlay open" role="dialog" aria-modal="true">
          <div className="admin-export-card">
            <div className="admin-modal-header">
              <h2>Export & Import Catalog</h2>
              <button
                type="button"
                className="admin-modal-close"
                onClick={() => setShowExportModal(false)}
                aria-label="Close"
              >
                <CloseIcon />
              </button>
            </div>

            <div className="admin-export-section">
              <h3>1. Download products.json</h3>
              <p>
                Download the updated catalog JSON file with all your latest prices, new products, and stock statuses.
                Changes are saved on the server automatically — use this file as a backup, or replace <code>worker/seed/products.json</code> to change the factory defaults.
              </p>
              <div className="admin-export-btn-row">
                <button
                  type="button"
                  className="admin-btn admin-btn-primary"
                  onClick={() => {
                    handleDownloadJson();
                    showToast('Downloaded products.json successfully!');
                  }}
                >
                  Download products.json
                </button>
                <button
                  type="button"
                  className="admin-btn admin-btn-secondary"
                  onClick={() => {
                    navigator.clipboard.writeText(JSON.stringify(products, null, 2));
                    showToast('Copied JSON to clipboard!');
                  }}
                >
                  Copy to Clipboard
                </button>
              </div>
            </div>

            <hr className="admin-divider" />

            <div className="admin-export-section">
              <h3>2. Import Catalog JSON</h3>
              <p>Paste an updated JSON array of products to bulk update or restore the store catalog.</p>
              <form onSubmit={handleImportSubmit}>
                <textarea
                  rows={6}
                  value={importJsonText}
                  onChange={(e) => setImportJsonText(e.target.value)}
                  placeholder='[ { "id": 101, "name": "...", "price": "₹15,000", ... } ]'
                  className="admin-textarea-json"
                />
                {importError && <div className="admin-form-error">{importError}</div>}
                <div style={{ marginTop: '12px', display: 'flex', gap: '10px' }}>
                  <button type="submit" className="admin-btn admin-btn-primary">
                    Import & Overwrite
                  </button>
                  <button
                    type="button"
                    className="admin-btn admin-btn-secondary"
                    onClick={() => {
                      setImportJsonText('');
                      setImportError('');
                    }}
                  >
                    Clear
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Product Edit & Creation Modal Component
 */
function ProductFormModal({ product, categories, isCreating, onClose, onSave }) {
  const [name, setName] = useState(product?.name || '');
  const [cat, setCat] = useState(product?.cat || categories[0]?.id || '');
  const [priceNum, setPriceNum] = useState(product?.priceNum || 15000);
  const [badge, setBadge] = useState(product?.badge || '');
  const [inStock, setInStock] = useState(product?.inStock !== false);
  const [hidden, setHidden] = useState(Boolean(product?.hidden));
  const [img, setImg] = useState(product?.img || PRESET_IMAGES[0].url);
  const [desc, setDesc] = useState(product?.desc || '');
  const [dims, setDims] = useState(product?.dims || '');
  const [material, setMaterial] = useState(product?.material || '');
  const [rating, setRating] = useState(product?.rating || 4.9);
  const [reviews, setReviews] = useState(product?.reviews || 24);

  // Features list
  const [features, setFeatures] = useState(
    Array.isArray(product?.features) && product.features.length > 0
      ? product.features
      : ['Kiln-seasoned Assam timber frame', 'High-resilience 40D foam cushioning']
  );
  const [newFeatureText, setNewFeatureText] = useState('');

  // Optional Assamese translation fields
  const [asName, setAsName] = useState(product?.as?.name || '');
  const [asDesc, setAsDesc] = useState(product?.as?.desc || '');
  const [asBadge, setAsBadge] = useState(product?.as?.badge || '');

  // Tab switch in modal
  const [activeTab, setActiveTab] = useState('details'); // details | media | specs | assamese

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    readResizedImage(file)
      .then(setImg)
      .catch((err) => alert(err.message));
  }

  function handleAddFeature(e) {
    e.preventDefault();
    if (!newFeatureText.trim()) return;
    setFeatures([...features, newFeatureText.trim()]);
    setNewFeatureText('');
  }

  function handleRemoveFeature(index) {
    setFeatures(features.filter((_, i) => i !== index));
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) {
      alert('Please provide a piece name.');
      return;
    }

    const num = parsePriceNum(priceNum);

    const formData = {
      name: name.trim(),
      cat,
      price: formatPrice(num),
      priceNum: num,
      badge: badge.trim(),
      inStock,
      hidden,
      img: img.trim(),
      desc: desc.trim(),
      dims: dims.trim(),
      material: material.trim(),
      rating: Number(rating) || 4.9,
      reviews: Number(reviews) || 10,
      features,
    };

    if (asName.trim() || asDesc.trim() || asBadge.trim()) {
      formData.as = {
        name: asName.trim() || undefined,
        desc: asDesc.trim() || undefined,
        badge: asBadge.trim() || undefined,
      };
    } else {
      formData.as = null;
    }

    onSave(formData);
  }

  return (
    <div className="admin-modal-overlay open" role="dialog" aria-modal="true">
      <div className="admin-product-modal-card">
        <div className="admin-modal-header">
          <div>
            <h2>{isCreating ? 'Add New Furniture Piece' : `Edit: ${product.name}`}</h2>
            <div className="admin-modal-sub">
              {isCreating ? 'Create a new design for the catalog' : `Product ID: #${product.id}`}
            </div>
          </div>
          <button type="button" className="admin-modal-close" onClick={onClose} aria-label="Close modal">
            <CloseIcon />
          </button>
        </div>

        <div className="admin-modal-tabs">
          <button
            type="button"
            className={`admin-modal-tab${activeTab === 'details' ? ' active' : ''}`}
            onClick={() => setActiveTab('details')}
          >
            General & Pricing
          </button>
          <button
            type="button"
            className={`admin-modal-tab${activeTab === 'media' ? ' active' : ''}`}
            onClick={() => setActiveTab('media')}
          >
            Photo & Media
          </button>
          <button
            type="button"
            className={`admin-modal-tab${activeTab === 'specs' ? ' active' : ''}`}
            onClick={() => setActiveTab('specs')}
          >
            Dimensions & Features
          </button>
          <button
            type="button"
            className={`admin-modal-tab${activeTab === 'assamese' ? ' active' : ''}`}
            onClick={() => setActiveTab('assamese')}
          >
            অসমীয়া (Assamese)
          </button>
        </div>

        <form onSubmit={handleSubmit} className="admin-product-form">
          <div className="admin-form-body">
            {/* TAB 1: DETAILS & PRICING */}
            {activeTab === 'details' && (
              <div className="admin-tab-pane">
                <div className="admin-form-group">
                  <label htmlFor="pName">Piece Name *</label>
                  <input
                    id="pName"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Royal Chesterfield 3-Seater Velvet Sofa"
                    required
                  />
                </div>

                <div className="admin-form-row">
                  <div className="admin-form-group">
                    <label htmlFor="pCat">Category *</label>
                    <select
                      id="pCat"
                      value={cat}
                      onChange={(e) => setCat(e.target.value)}
                    >
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}{c.hidden ? ' (hidden)' : ''}
                        </option>
                      ))}
                      {cat && !categories.some((c) => c.id === cat) && (
                        <option value={cat}>{cat} (not in category list)</option>
                      )}
                    </select>
                    <span className="admin-help-text">
                      New categories are added in the <a href="#categories">Categories</a> tab.
                    </span>
                  </div>


                  <div className="admin-form-group">
                    <label htmlFor="pBadge">Badge / Tag</label>
                    <input
                      id="pBadge"
                      type="text"
                      value={badge}
                      onChange={(e) => setBadge(e.target.value)}
                      placeholder="e.g. Bestseller, Sold in Pairs, Handmade"
                    />
                  </div>
                </div>

                <div className="admin-form-row">
                  <div className="admin-form-group">
                    <label htmlFor="pPrice">Price in INR (₹) *</label>
                    <div className="admin-price-input-wrapper">
                      <span className="prefix">₹</span>
                      <input
                        id="pPrice"
                        type="number"
                        min="0"
                        step="100"
                        value={priceNum}
                        onChange={(e) => setPriceNum(e.target.value)}
                        required
                      />
                    </div>
                    <span className="admin-help-text">Formatted: {formatPrice(priceNum)}</span>
                  </div>

                  <div className="admin-form-group">
                    <label>Stock Status</label>
                    <div className="admin-radio-toggle">
                      <button
                        type="button"
                        className={`radio-toggle-btn${inStock ? ' selected in' : ''}`}
                        onClick={() => setInStock(true)}
                      >
                        ✓ In Stock
                      </button>
                      <button
                        type="button"
                        className={`radio-toggle-btn${!inStock ? ' selected out' : ''}`}
                        onClick={() => setInStock(false)}
                      >
                        ✕ Stock Out
                      </button>
                    </div>
                  </div>

                  <div className="admin-form-group">
                    <label>Storefront Visibility</label>
                    <div className="admin-radio-toggle">
                      <button
                        type="button"
                        className={`radio-toggle-btn${!hidden ? ' selected live' : ''}`}
                        onClick={() => setHidden(false)}
                      >
                        👁 Live on Store
                      </button>
                      <button
                        type="button"
                        className={`radio-toggle-btn${hidden ? ' selected hidden' : ''}`}
                        onClick={() => setHidden(true)}
                      >
                        🚫 Hidden / Draft
                      </button>
                    </div>
                  </div>
                </div>

                <div className="admin-form-group">
                  <label htmlFor="pDesc">Description</label>
                  <textarea
                    id="pDesc"
                    rows={4}
                    value={desc}
                    onChange={(e) => setDesc(e.target.value)}
                    placeholder="Describe the craftsmanship, comfort, timber seasoning, and aesthetic appeal..."
                  />
                </div>
              </div>
            )}

            {/* TAB 2: MEDIA & PHOTO */}
            {activeTab === 'media' && (
              <div className="admin-tab-pane">
                <div className="admin-media-grid">
                  <div className="admin-media-controls">
                    <div className="admin-form-group">
                      <label>Upload Image from Device</label>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleFileChange}
                        className="admin-file-input"
                      />
                      <span className="admin-help-text">
                        Uploads directly from your phone/computer (works instantly).
                      </span>
                    </div>

                    <div className="admin-form-group">
                      <label htmlFor="pImgUrl">Or Enter Image URL / Path</label>
                      <input
                        id="pImgUrl"
                        type="text"
                        value={img}
                        onChange={(e) => setImg(e.target.value)}
                        placeholder="e.g. images/chairs/image.jpg or https://..."
                      />
                    </div>

                    <div className="admin-form-group">
                      <label>Or Select from Existing Catalog Images</label>
                      <div className="admin-preset-gallery">
                        {PRESET_IMAGES.map((preset) => (
                          <div
                            key={preset.url}
                            className={`admin-preset-item${img === preset.url ? ' active' : ''}`}
                            onClick={() => setImg(preset.url)}
                          >
                            <img src={assetUrl(preset.url)} alt={preset.label} />
                            <span>{preset.label}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="admin-media-preview-box">
                    <label>Live Image Preview</label>
                    <div className="admin-preview-frame">
                      {img ? (
                        <img src={assetUrl(img)} alt="Product preview" />
                      ) : (
                        <div className="no-img">No Image Selected</div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 3: SPECIFICATIONS */}
            {activeTab === 'specs' && (
              <div className="admin-tab-pane">
                <div className="admin-form-group">
                  <label htmlFor="pDims">Dimensions</label>
                  <input
                    id="pDims"
                    type="text"
                    value={dims}
                    onChange={(e) => setDims(e.target.value)}
                    placeholder="e.g. W 210cm · D 90cm · H 85cm · Seat H 45cm"
                  />
                </div>

                <div className="admin-form-group">
                  <label htmlFor="pMaterial">Materials Used</label>
                  <input
                    id="pMaterial"
                    type="text"
                    value={material}
                    onChange={(e) => setMaterial(e.target.value)}
                    placeholder="e.g. Solid Seasoned Teak · High Density 40D Foam · Luxe Velvet"
                  />
                </div>

                <div className="admin-form-row">
                  <div className="admin-form-group">
                    <label htmlFor="pRating">Rating (out of 5)</label>
                    <input
                      id="pRating"
                      type="number"
                      step="0.1"
                      min="1"
                      max="5"
                      value={rating}
                      onChange={(e) => setRating(e.target.value)}
                    />
                  </div>
                  <div className="admin-form-group">
                    <label htmlFor="pReviews">Reviews Count</label>
                    <input
                      id="pReviews"
                      type="number"
                      min="0"
                      value={reviews}
                      onChange={(e) => setReviews(e.target.value)}
                    />
                  </div>
                </div>

                <div className="admin-form-group">
                  <label>Key Features & Bullets</label>
                  <div className="admin-feature-list">
                    {features.map((feat, idx) => (
                      <div key={idx} className="admin-feature-item">
                        <span>• {feat}</span>
                        <button
                          type="button"
                          className="admin-feature-del"
                          onClick={() => handleRemoveFeature(idx)}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="admin-feature-add-row">
                    <input
                      type="text"
                      value={newFeatureText}
                      onChange={(e) => setNewFeatureText(e.target.value)}
                      placeholder="Add another highlight bullet..."
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddFeature(e);
                        }
                      }}
                    />
                    <button type="button" className="admin-btn admin-btn-secondary" onClick={handleAddFeature}>
                      + Add
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 4: ASSAMESE LOCALIZATION */}
            {activeTab === 'assamese' && (
              <div className="admin-tab-pane">
                <div className="admin-info-banner">
                  Shoppers who toggle the &quot;অসমীয়া&quot; language switcher on the storefront will see these translated
                  texts. Leave blank to fallback to English.
                </div>

                <div className="admin-form-group">
                  <label htmlFor="asName">অসমীয়া নাম (Assamese Name)</label>
                  <input
                    id="asName"
                    type="text"
                    value={asName}
                    onChange={(e) => setAsName(e.target.value)}
                    placeholder="যেনে: অৰা কাৰ্ভড ডাইনিং চেয়াৰ (যোৰ)"
                  />
                </div>

                <div className="admin-form-group">
                  <label htmlFor="asBadge">অসমীয়া বেজ (Assamese Badge)</label>
                  <input
                    id="asBadge"
                    type="text"
                    value={asBadge}
                    onChange={(e) => setAsBadge(e.target.value)}
                    placeholder="যেনে: যোৰ হিচাপে উপলব্ধ, বেষ্টচেলাৰ"
                  />
                </div>

                <div className="admin-form-group">
                  <label htmlFor="asDesc">অসমীয়া বিৱৰণ (Assamese Description)</label>
                  <textarea
                    id="asDesc"
                    rows={4}
                    value={asDesc}
                    onChange={(e) => setAsDesc(e.target.value)}
                    placeholder="আমাৰ কাৰিকৰী ডাইনিং চকীত ব্যৱহৃত উচ্চমানৰ ভেলভেট আৰু কঠিন কাঠ..."
                  />
                </div>
              </div>
            )}
          </div>

          <div className="admin-modal-footer">
            <button type="button" className="admin-btn admin-btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="admin-btn admin-btn-primary">
              {isCreating ? 'Create Furniture Piece' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
