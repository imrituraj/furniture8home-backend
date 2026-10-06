import { useEffect, useMemo, useRef, useState } from 'react';
import {
  addCategory,
  deleteCategory,
  fetchCatalog,
  fetchCategories,
  logout,
  reorderCategories,
  updateCategory,
} from '../lib/api.js';
import { assetUrl } from '../lib/storefront.js';
import { readResizedImage } from '../lib/images.js';
import { ChairIcon, CloseIcon } from './Icons.jsx';

export default function CategoriesDashboard({ nav, onExit, onLogout }) {
  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // category object, or {} when creating
  const [deleteCandidate, setDeleteCandidate] = useState(null);
  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);

  function showToast(message, type = 'success') {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message, type });
    toastTimerRef.current = setTimeout(() => setToast(null), 3200);
  }

  async function refresh() {
    try {
      const [cats, catalog] = await Promise.all([fetchCategories(), fetchCatalog()]);
      setCategories(cats);
      setProducts(catalog);
    } catch (err) {
      showToast(err.message || 'Failed to load categories', 'warning');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  // Run a server action, then reload; surface failures as a toast
  async function run(action, message) {
    try {
      const result = await action();
      setCategories(await fetchCategories());
      if (message) showToast(message);
      return result ?? true;
    } catch (err) {
      showToast(err.message || 'Something went wrong', 'warning');
      return null;
    }
  }

  async function handleLogout() {
    await logout().catch(() => {});
    onLogout();
  }

  const counts = useMemo(() => {
    const map = {};
    for (const p of products) map[p.cat] = (map[p.cat] || 0) + 1;
    return map;
  }, [products]);

  const unlisted = useMemo(
    () => Object.keys(counts).filter((cat) => !categories.some((c) => c.id === cat)),
    [counts, categories],
  );

  function move(index, delta) {
    const ids = categories.map((c) => c.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    run(() => reorderCategories(ids), 'Order saved');
  }

  async function handleSave(form) {
    const saved = editing?.id
      ? await run(() => updateCategory(editing.id, form), `"${form.name}" saved`)
      : await run(() => addCategory(form), `"${form.name}" added`);
    if (saved) setEditing(null);
  }

  return (
    <div className="admin-wrapper">
      {toast && (
        <div className={`admin-toast admin-toast-${toast.type}`} role="status">
          <span>{toast.message}</span>
          <button type="button" onClick={() => setToast(null)}>×</button>
        </div>
      )}

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
              <div className="admin-brand-sub">Storefront categories</div>
            </div>
          </div>

          <div className="admin-nav-actions">
            {nav}
            <button type="button" className="admin-btn admin-btn-primary" onClick={() => setEditing({})}>
              <span>+ Add Category</span>
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
        {unlisted.length > 0 && (
          <div className="admin-callout">
            Some products use categories that aren't in this list: <strong>{unlisted.join(', ')}</strong>. They show under
            "All" on the store but have no category tile. Add a category or move those products.
          </div>
        )}

        <section className="admin-catalog-container">
          <div className="admin-table-meta">
            <span>
              {loading ? 'Loading categories…' : <><strong>{categories.length}</strong> categories · shown on the store in this order</>}
            </span>
          </div>

          <div className="admin-table-responsive">
            <table className="admin-table">
              <thead>
                <tr>
                  <th style={{ width: '84px' }}>Order</th>
                  <th>Category</th>
                  <th>Products</th>
                  <th>Options</th>
                  <th>Visibility</th>
                  <th style={{ width: '200px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((c, index) => (
                  <tr key={c.id} className={c.hidden ? 'is-row-hidden' : ''}>
                    <td>
                      <div className="admin-reorder">
                        <button type="button" className="admin-btn admin-btn-sm admin-btn-ghost" disabled={index === 0} onClick={() => move(index, -1)} aria-label={`Move ${c.name} up`}>↑</button>
                        <button type="button" className="admin-btn admin-btn-sm admin-btn-ghost" disabled={index === categories.length - 1} onClick={() => move(index, 1)} aria-label={`Move ${c.name} down`}>↓</button>
                      </div>
                    </td>
                    <td>
                      <div className="admin-category-cell">
                        <img src={assetUrl(c.img)} alt="" loading="lazy" />
                        <div>
                          <div className="admin-cell-title">{c.name}</div>
                          <div className="admin-cell-sub">{c.nameAs || 'No Assamese name'} · id: <span className="admin-slug">{c.id}</span></div>
                        </div>
                      </div>
                    </td>
                    <td><strong>{counts[c.id] || 0}</strong></td>
                    <td><div className="admin-cell-sub">{c.chaise ? 'L-shape orientation picker' : '—'}</div></td>
                    <td>
                      <button
                        type="button"
                        className={`admin-status-pill ${c.hidden ? 'pill-out' : 'pill-in'}`}
                        onClick={() => run(() => updateCategory(c.id, { hidden: !c.hidden }), c.hidden ? `"${c.name}" is live` : `"${c.name}" hidden`)}
                        title="Click to toggle"
                      >
                        <span className="pill-dot" />
                        {c.hidden ? 'Hidden' : 'Live'}
                      </button>
                    </td>
                    <td>
                      <div className="admin-actions-cell">
                        <button type="button" className="admin-btn admin-btn-sm admin-btn-secondary" onClick={() => setEditing(c)}>Edit</button>
                        <button type="button" className="admin-btn admin-btn-sm admin-btn-danger" onClick={() => setDeleteCandidate(c)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {editing && (
        <CategoryForm
          category={editing}
          productImages={products.filter((p) => p.cat === editing.id && !p.img.startsWith('data:')).map((p) => p.img)}
          onClose={() => setEditing(null)}
          onSave={handleSave}
          onError={(message) => showToast(message, 'warning')}
        />
      )}

      {deleteCandidate && (
        <div className="admin-modal-overlay open" role="dialog" aria-modal="true">
          <div className="admin-confirm-card">
            <h2>Delete "{deleteCandidate.name}"?</h2>
            <p>
              {counts[deleteCandidate.id]
                ? `${counts[deleteCandidate.id]} products are in this category. Move them to another category first, or hide the category instead.`
                : 'This removes the category from the store. It cannot be undone.'}
            </p>
            <div className="admin-modal-footer">
              <button type="button" className="admin-btn admin-btn-secondary" onClick={() => setDeleteCandidate(null)}>Cancel</button>
              <button
                type="button"
                className="admin-btn admin-btn-danger"
                disabled={Boolean(counts[deleteCandidate.id])}
                onClick={async () => {
                  const name = deleteCandidate.name;
                  if (await run(() => deleteCategory(deleteCandidate.id), `"${name}" deleted`)) setDeleteCandidate(null);
                }}
              >
                Delete category
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CategoryForm({ category, productImages, onClose, onSave, onError }) {
  const isNew = !category.id;
  const [name, setName] = useState(category.name || '');
  const [nameAs, setNameAs] = useState(category.nameAs || '');
  const [img, setImg] = useState(category.img || productImages[0] || '');
  const [chaise, setChaise] = useState(Boolean(category.chaise));
  const [hidden, setHidden] = useState(Boolean(category.hidden));
  const [saving, setSaving] = useState(false);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setImg(await readResizedImage(file, 900));
    } catch (err) {
      onError(err.message);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) return onError('Please give the category a name');
    setSaving(true);
    await onSave({ name: name.trim(), nameAs: nameAs.trim(), img: img.trim(), chaise, hidden });
    setSaving(false);
  }

  return (
    <div className="admin-modal-overlay open" role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="admin-export-card admin-category-form" onSubmit={handleSubmit}>
        <div className="admin-modal-header">
          <div>
            <h2>{isNew ? 'Add category' : `Edit "${category.name}"`}</h2>
            {!isNew && <div className="admin-modal-sub">id: {category.id} (products link to this, so it never changes)</div>}
          </div>
          <button type="button" className="admin-modal-close" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>

        <div className="admin-form-row">
          <div className="admin-form-group">
            <label htmlFor="cName">Name (English) *</label>
            <input id="cName" type="text" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="e.g. Recliners" autoFocus />
          </div>
          <div className="admin-form-group">
            <label htmlFor="cNameAs">Name (Assamese)</label>
            <input id="cNameAs" type="text" value={nameAs} maxLength={60} onChange={(e) => setNameAs(e.target.value)} placeholder="e.g. ৰিক্লাইনাৰ" />
          </div>
        </div>

        <div className="admin-form-group">
          <label>Cover photo</label>
          <div className="admin-category-media">
            <div className="admin-preview-frame">
              {img ? <img src={assetUrl(img)} alt="Category cover preview" /> : <div className="no-img">No image</div>}
            </div>
            <div>
              <input type="file" accept="image/*" onChange={handleFile} className="admin-file-input" />
              <input type="text" value={img.startsWith('data:') ? '' : img} onChange={(e) => setImg(e.target.value)} placeholder={img.startsWith('data:') ? 'Uploaded photo' : 'images/… or https://…'} />
              {productImages.length > 0 && (
                <div className="admin-preset-gallery">
                  {productImages.slice(0, 8).map((src) => (
                    <div key={src} className={`admin-preset-item${img === src ? ' active' : ''}`} onClick={() => setImg(src)}>
                      <img src={assetUrl(src)} alt="" />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <label className="admin-check">
          <input type="checkbox" checked={chaise} onChange={(e) => setChaise(e.target.checked)} />
          <span>Ask customers for L-shape orientation (left / right chaise) on products in this category</span>
        </label>
        <label className="admin-check">
          <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />
          <span>Hide this category's tile and filter on the store</span>
        </label>

        <div className="admin-modal-footer">
          <button type="button" className="admin-btn admin-btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="admin-btn admin-btn-primary" disabled={saving}>
            {saving ? 'Saving…' : isNew ? 'Add category' : 'Save changes'}
          </button>
        </div>
      </form>
    </div>
  );
}
