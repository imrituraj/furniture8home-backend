import { useState } from 'react';
import { login } from '../lib/api.js';
import { ChairIcon, CloseIcon } from './Icons.jsx';

export default function AdminLogin({ onLoginSuccess, onCancel }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function handleSubmit(e) {
    e.preventDefault();
    if (!pin.trim()) {
      setError('Please enter your admin PIN');
      return;
    }

    setSubmitting(true);
    login(pin)
      .then(() => {
        setError('');
        onLoginSuccess();
      })
      .catch((err) => {
        setError(err.message || 'Login failed. Please try again.');
        setPin('');
      })
      .finally(() => setSubmitting(false));
  }

  function handleKeypad(digit) {
    if (pin.length < 8) {
      setPin((prev) => prev + digit);
      setError('');
    }
  }

  function handleBackspace() {
    setPin((prev) => prev.slice(0, -1));
    setError('');
  }

  return (
    <div className="admin-login-overlay" role="dialog" aria-modal="true" aria-labelledby="adminLoginTitle">
      <div className="admin-login-card">
        {onCancel && (
          <button type="button" className="admin-modal-close" onClick={onCancel} aria-label="Cancel and return">
            <CloseIcon />
          </button>
        )}
        <div className="admin-login-icon">
          <ChairIcon />
        </div>
        <h2 id="adminLoginTitle" className="admin-login-title">Admin Access</h2>
        <p className="admin-login-sub">Enter your security PIN to manage products, pricing, stock, and catalog items.</p>

        <form onSubmit={handleSubmit} className="admin-login-form">
          <div className="admin-pin-display">
            <input
              type="password"
              value={pin}
              onChange={(e) => {
                setPin(e.target.value.replace(/[^0-9]/g, ''));
                setError('');
              }}
              placeholder="••••"
              maxLength={8}
              autoFocus
              className={`admin-pin-input${error ? ' has-error' : ''}`}
              aria-label="Admin PIN"
            />
          </div>

          {error && <div className="admin-login-error">{error}</div>}

          <div className="admin-keypad">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
              <button key={n} type="button" className="admin-keypad-btn" onClick={() => handleKeypad(String(n))}>
                {n}
              </button>
            ))}
            <button type="button" className="admin-keypad-btn admin-keypad-clear" onClick={() => setPin('')}>
              C
            </button>
            <button key={0} type="button" className="admin-keypad-btn" onClick={() => handleKeypad('0')}>
              0
            </button>
            <button type="button" className="admin-keypad-btn admin-keypad-back" onClick={handleBackspace} aria-label="Backspace">
              ⌫
            </button>
          </div>

          <div className="admin-login-actions">
            <button type="submit" className="btn-primary" disabled={submitting} style={{ width: '100%', justifyContent: 'center' }}>
              Unlock Catalog Manager
            </button>
            {onCancel && (
              <button type="button" className="btn-secondary" style={{ width: '100%', justifyContent: 'center', marginTop: '8px' }} onClick={onCancel}>
                Return to Store
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
