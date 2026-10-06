import { useEffect, useState } from 'react';
import AdminDashboard from './components/AdminDashboard.jsx';
import AdminLogin from './components/AdminLogin.jsx';
import CategoriesDashboard from './components/CategoriesDashboard.jsx';
import OrdersDashboard from './components/OrdersDashboard.jsx';
import { isAuthenticated, onSessionExpired } from './lib/api.js';
import { STOREFRONT_URL } from './lib/storefront.js';

const VIEWS = [
  { key: 'orders', label: 'Orders' },
  { key: 'catalog', label: 'Products' },
  { key: 'categories', label: 'Categories' },
];

function readView() {
  const hash = window.location.hash.slice(1);
  return VIEWS.some((v) => v.key === hash) ? hash : 'orders';
}

export default function App() {
  const [authed, setAuthed] = useState(isAuthenticated);
  const [view, setView] = useState(readView);

  useEffect(() => onSessionExpired(() => setAuthed(false)), []);

  useEffect(() => {
    const onHash = () => setView(readView());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  function openStore() {
    window.location.href = STOREFRONT_URL;
  }

  if (!authed) {
    return <AdminLogin onLoginSuccess={() => setAuthed(true)} onCancel={openStore} />;
  }

  const nav = (
    <div className="admin-view-tabs" role="tablist">
      {VIEWS.map((v) => (
        <a key={v.key} href={`#${v.key}`} role="tab" aria-selected={view === v.key} className={view === v.key ? 'active' : ''}>
          {v.label}
        </a>
      ))}
    </div>
  );

  const props = { nav, onExit: openStore, onLogout: () => setAuthed(false) };
  if (view === 'catalog') return <AdminDashboard {...props} />;
  if (view === 'categories') return <CategoriesDashboard {...props} />;
  return <OrdersDashboard {...props} />;
}
