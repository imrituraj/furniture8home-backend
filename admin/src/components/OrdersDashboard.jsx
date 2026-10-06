import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchOrders, formatPrice, logout, updateOrder } from '../lib/api.js';
import { assetUrl } from '../lib/storefront.js';
import { ChairIcon, CloseIcon, WaIcon } from './Icons.jsx';

const REFRESH_MS = 30_000;

export const ORDER_STATUS_LABELS = {
  new: 'New',
  confirmed: 'Confirmed',
  ready: 'Ready / Packed',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

const PAYMENT_STATUS_LABELS = {
  pending: 'Pending',
  paid: 'Paid',
  failed: 'Failed',
  refunded: 'Refunded',
};

const METHOD_LABELS = {
  razorpay: 'Online (Razorpay)',
  offline: 'Pay offline',
  whatsapp: 'WhatsApp order',
};

const STATUS_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Open', match: (o) => !['delivered', 'cancelled'].includes(o.status) },
  { key: 'new', label: 'New', match: (o) => o.status === 'new' },
  { key: 'delivered', label: 'Delivered', match: (o) => o.status === 'delivered' },
  { key: 'cancelled', label: 'Cancelled', match: (o) => o.status === 'cancelled' },
];

function formatDate(iso) {
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

function waCustomer(order, text) {
  const phone = order.customer.phone.replace(/\D/g, '').slice(-10);
  return `https://wa.me/91${phone}?text=${encodeURIComponent(text)}`;
}

function paymentPillClass(status) {
  if (status === 'paid') return 'pill-in';
  if (status === 'failed' || status === 'refunded') return 'pill-out';
  return 'pill-pending';
}

export default function OrdersDashboard({ nav, onExit, onLogout }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('open');
  const [methodFilter, setMethodFilter] = useState('all');
  const [selectedId, setSelectedId] = useState(null);
  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);

  function showToast(message, type = 'success') {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message, type });
    toastTimerRef.current = setTimeout(() => setToast(null), 3200);
  }

  async function refresh({ quiet = false } = {}) {
    try {
      setOrders(await fetchOrders());
    } catch (err) {
      if (!quiet) showToast(err.message || 'Failed to load orders', 'warning');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    const timer = setInterval(() => refresh({ quiet: true }), REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  async function handleUpdate(order, updates, message) {
    try {
      const updated = await updateOrder(order.id, updates);
      setOrders((list) => list.map((o) => (o.id === updated.id ? updated : o)));
      if (message) showToast(message);
    } catch (err) {
      showToast(err.message || 'Update failed', 'warning');
    }
  }

  async function handleLogout() {
    await logout().catch(() => {});
    onLogout();
  }

  const stats = useMemo(() => {
    const live = orders.filter((o) => o.status !== 'cancelled');
    return {
      newCount: orders.filter((o) => o.status === 'new').length,
      open: orders.filter((o) => !['delivered', 'cancelled'].includes(o.status)).length,
      paid: live.filter((o) => o.paymentStatus === 'paid').reduce((sum, o) => sum + o.total, 0),
      due: live.filter((o) => o.paymentStatus !== 'paid').reduce((sum, o) => sum + o.total, 0),
    };
  }, [orders]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const statusMatch = STATUS_FILTERS.find((f) => f.key === statusFilter)?.match;
    return orders.filter((o) => {
      if (statusMatch && !statusMatch(o)) return false;
      if (methodFilter !== 'all' && o.paymentMethod !== methodFilter) return false;
      if (!q) return true;
      return [o.id, o.customer.name, o.customer.phone, o.customer.pincode, ...o.items.map((i) => i.name)]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [orders, query, statusFilter, methodFilter]);

  const selected = orders.find((o) => o.id === selectedId) || null;

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
              <div className="admin-brand-sub">Orders, Payments & Deliveries</div>
            </div>
          </div>

          <div className="admin-nav-actions">
            {nav}
            <button type="button" className="admin-btn admin-btn-secondary" onClick={() => refresh()}>
              <span>Refresh</span>
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
        <section className="admin-kpi-grid">
          <div className="admin-kpi-card" onClick={() => setStatusFilter('new')} role="button" tabIndex={0}>
            <div className="admin-kpi-label">New Orders</div>
            <div className="admin-kpi-value" style={{ color: 'var(--brand-brass)' }}>{stats.newCount}</div>
            <div className="admin-kpi-hint">Call to confirm</div>
          </div>
          <div className="admin-kpi-card" onClick={() => setStatusFilter('open')} role="button" tabIndex={0}>
            <div className="admin-kpi-label">Open Orders</div>
            <div className="admin-kpi-value">{stats.open}</div>
            <div className="admin-kpi-hint">Not yet delivered</div>
          </div>
          <div className="admin-kpi-card">
            <div className="admin-kpi-label">Paid</div>
            <div className="admin-kpi-value" style={{ color: 'var(--brand-sage)' }}>{formatPrice(stats.paid)}</div>
            <div className="admin-kpi-hint">Excludes cancelled</div>
          </div>
          <div className="admin-kpi-card">
            <div className="admin-kpi-label">To Collect</div>
            <div className="admin-kpi-value">{formatPrice(stats.due)}</div>
            <div className="admin-kpi-hint">Offline & WhatsApp orders</div>
          </div>
        </section>

        <section className="admin-controls-card">
          <div className="admin-controls-row">
            <div className="admin-search-wrap">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                placeholder="Search order no., name, phone, product…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="admin-search-input"
              />
              {query && (
                <button type="button" className="admin-search-clear" onClick={() => setQuery('')}>×</button>
              )}
            </div>

            <div className="admin-status-tabs">
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  className={`admin-tab-btn${statusFilter === f.key ? ' active' : ''}`}
                  onClick={() => setStatusFilter(f.key)}
                >
                  {f.label} ({f.match ? orders.filter(f.match).length : orders.length})
                </button>
              ))}
            </div>

            <div className="admin-select-wrap">
              <select value={methodFilter} onChange={(e) => setMethodFilter(e.target.value)}>
                <option value="all">All payment types</option>
                {Object.entries(METHOD_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>
          </div>
        </section>

        <section className="admin-catalog-container">
          <div className="admin-table-meta">
            <span>
              {loading ? 'Loading orders…' : <>Showing <strong>{filtered.length}</strong> of {orders.length} orders</>}
            </span>
          </div>

          {!loading && filtered.length === 0 ? (
            <div className="admin-empty-state">
              <div className="admin-empty-icon">📦</div>
              <h3>No orders here yet</h3>
              <p>Orders placed on the storefront appear here automatically.</p>
            </div>
          ) : (
            <div className="admin-table-responsive">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Customer</th>
                    <th>Items</th>
                    <th>Total</th>
                    <th>Payment</th>
                    <th>Fulfilment</th>
                    <th style={{ width: '170px' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((o) => (
                    <tr key={o.id} className={o.status === 'cancelled' ? 'is-row-hidden' : ''}>
                      <td>
                        <button type="button" className="admin-order-link" onClick={() => setSelectedId(o.id)}>
                          {o.id}
                        </button>
                        <div className="admin-cell-sub">{formatDate(o.createdAt)}</div>
                      </td>
                      <td>
                        <div className="admin-cell-title">{o.customer.name}</div>
                        <div className="admin-cell-sub">
                          <a href={`tel:+91${o.customer.phone.slice(-10)}`}>{o.customer.phone}</a>
                        </div>
                      </td>
                      <td>
                        <div className="admin-cell-title admin-order-items">
                          {o.items.map((i) => `${i.name} × ${i.qty}`).join(', ')}
                        </div>
                      </td>
                      <td><strong>{o.totalLabel}</strong></td>
                      <td>
                        <div className="admin-cell-sub">{METHOD_LABELS[o.paymentMethod]}</div>
                        <span className={`admin-status-pill ${paymentPillClass(o.paymentStatus)}`}>
                          <span className="pill-dot" />
                          {PAYMENT_STATUS_LABELS[o.paymentStatus]}
                        </span>
                      </td>
                      <td>
                        <div className="admin-cell-sub">
                          {o.fulfilment.type === 'pickup' ? `Pickup · ${o.fulfilment.showroom}` : `Delivery · ${o.customer.pincode}`}
                        </div>
                      </td>
                      <td>
                        <div className="admin-select-wrap">
                          <select
                            value={o.status}
                            onChange={(e) => handleUpdate(o, { status: e.target.value }, `${o.id} marked ${ORDER_STATUS_LABELS[e.target.value]}`)}
                          >
                            {Object.entries(ORDER_STATUS_LABELS).map(([key, label]) => (
                              <option key={key} value={key}>{label}</option>
                            ))}
                          </select>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>

      {selected && (
        <OrderDetail
          order={selected}
          onClose={() => setSelectedId(null)}
          onUpdate={(updates, message) => handleUpdate(selected, updates, message)}
        />
      )}
    </div>
  );
}

function OrderDetail({ order, onClose, onUpdate }) {
  const [note, setNote] = useState(order.adminNote || '');

  useEffect(() => {
    setNote(order.adminNote || '');
  }, [order.id]);

  const confirmText = `Hi ${order.customer.name}, this is Furniture8home. We have received your order ${order.id} (${order.totalLabel}). `;

  return (
    <div className="admin-modal-overlay open" role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="admin-export-card admin-order-card">
        <div className="admin-modal-header">
          <div>
            <h2>Order {order.id}</h2>
            <div className="admin-modal-sub">Placed {formatDate(order.createdAt)} · {METHOD_LABELS[order.paymentMethod]}</div>
          </div>
          <button type="button" className="admin-modal-close" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>

        <ul className="admin-order-lines">
          {order.items.map((item) => (
            <li key={`${item.id}-${item.options?.fabric}-${item.options?.chaise}`}>
              <img src={assetUrl(item.img)} alt="" />
              <div>
                <div className="admin-cell-title">{item.name}</div>
                <div className="admin-cell-sub">
                  SKU #{item.id}
                  {item.options?.fabric && ` · ${item.options.fabric}`}
                  {item.options?.chaise && ` · ${item.options.chaise}`}
                </div>
              </div>
              <div className="admin-order-line-price">
                {item.qty} × {formatPrice(item.unitPrice)}
                <strong>{formatPrice(item.lineTotal)}</strong>
              </div>
            </li>
          ))}
          <li className="admin-order-total">
            <span>Total</span>
            <strong>{order.totalLabel}</strong>
          </li>
        </ul>

        <div className="admin-order-grid">
          <div>
            <h3>Customer</h3>
            <p>{order.customer.name}</p>
            <p><a href={`tel:+91${order.customer.phone.slice(-10)}`}>{order.customer.phone}</a></p>
            {order.customer.email && <p><a href={`mailto:${order.customer.email}`}>{order.customer.email}</a></p>}
          </div>
          <div>
            <h3>{order.fulfilment.type === 'pickup' ? 'Showroom pickup' : 'Home delivery'}</h3>
            {order.fulfilment.type === 'pickup' ? (
              <p>{order.fulfilment.showroom}</p>
            ) : (
              <p>{order.customer.address}<br />PIN {order.customer.pincode}</p>
            )}
          </div>
          {order.customer.notes && (
            <div className="admin-order-wide">
              <h3>Customer notes</h3>
              <p>{order.customer.notes}</p>
            </div>
          )}
          {order.razorpay && (
            <div className="admin-order-wide">
              <h3>Razorpay</h3>
              <p className="admin-slug">Order {order.razorpay.orderId}{order.razorpay.paymentId && ` · Payment ${order.razorpay.paymentId}`}</p>
            </div>
          )}
        </div>

        <div className="admin-form-row">
          <div className="admin-form-group">
            <label>Order status</label>
            <div className="admin-select-wrap">
              <select value={order.status} onChange={(e) => onUpdate({ status: e.target.value }, `Status: ${ORDER_STATUS_LABELS[e.target.value]}`)}>
                {Object.entries(ORDER_STATUS_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="admin-form-group">
            <label>Payment status</label>
            <div className="admin-select-wrap">
              <select value={order.paymentStatus} onChange={(e) => onUpdate({ paymentStatus: e.target.value }, `Payment: ${PAYMENT_STATUS_LABELS[e.target.value]}`)}>
                {Object.entries(PAYMENT_STATUS_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>
            {order.paymentMethod === 'razorpay' && (
              <span className="admin-help-text">Online payments are marked paid automatically once Razorpay confirms them.</span>
            )}
          </div>
        </div>

        <div className="admin-form-group">
          <label>Internal note</label>
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Delivery slot, advance received, etc." />
        </div>

        <div className="admin-modal-footer">
          <a className="admin-btn admin-btn-secondary" href={waCustomer(order, confirmText)} target="_blank" rel="noopener noreferrer">
            <WaIcon size={16} /> <span>WhatsApp customer</span>
          </a>
          <button
            type="button"
            className="admin-btn admin-btn-primary"
            disabled={note === (order.adminNote || '')}
            onClick={() => onUpdate({ adminNote: note }, 'Note saved')}
          >
            Save note
          </button>
        </div>
      </div>
    </div>
  );
}
