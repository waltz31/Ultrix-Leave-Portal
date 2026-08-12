import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { THEME_PRESETS, useTheme } from '../theme';
import { formatDateTime } from '../utils';
import ApprovedCelebration from './ApprovedCelebration';
import StatusCelebration from './StatusCelebration';

const DEFAULT_COLOR_INPUT = '#0b1220';

const USER_ICONS = [
  { to: '/app', label: 'Home', icon: '/assets/nav-home.png', end: true },
  { to: '/app/apply', label: 'Apply', icon: '/assets/nav-apply.png' },
  { to: '/app/calendar', label: 'Calendar', icon: '/assets/nav-calendar.png' },
  { to: '/app/ratings', label: 'Ratings', icon: '/assets/rating-star.png' },
  { to: '/app/invoices', label: 'Invoices', icon: '/assets/nav-searchlist.png' },
  { to: '/app/history', label: 'History', icon: '/assets/nav-history.png' },
];

function pathForNotification(role, type) {
  if (role === 'manager') {
    if (type === 'pending_manager') return '/manager/approvals';
    if (type === 'approved' || type === 'cancelled') return '/manager/calendar';
    return '/manager/history';
  }
  if (role === 'hr') {
    if (type === 'pending_hr') return '/hr/approvals';
    if (type === 'approved' || type === 'cancelled') return '/hr/calendar';
    return '/hr/history';
  }
  if (type === 'approved') return '/app/calendar';
  if (type === 'balance_credited') return '/app';
  if (type === 'rating_received') return '/app/ratings';
  if (type === 'invoice_submitted') return '/hr/invoices';
  if (type === 'cancelled') return '/app/history';
  if (type === 'pending_manager' || type === 'pending_hr') return '/app';
  return '/app/history';
}

function NotificationBell({ onApprovedNotice, onBalanceCredited, onManagerApproved }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const panelRef = useRef(null);

  async function loadNotifications() {
    try {
      const data = await api('/notifications');
      setItems(data.notifications || []);
      setUnread(data.unreadCount || 0);
    } catch {
      // ignore transient errors
    }
  }

  useEffect(() => {
    loadNotifications();
    const timer = setInterval(loadNotifications, 15000);
    return () => clearInterval(timer);
  }, [location.pathname]);

  useEffect(() => {
    function onDocClick(e) {
      if (!panelRef.current?.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  async function toggleBell() {
    const next = !open;
    setOpen(next);
    if (next) await loadNotifications();
  }

  async function markAllRead() {
    try {
      const data = await api('/notifications/read', { method: 'PATCH', body: {} });
      setUnread(data.unreadCount || 0);
      setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch {
      // ignore
    }
  }

  async function clearAll() {
    const ok = window.confirm('Clear all notifications?');
    if (!ok) return;
    try {
      await api('/notifications', { method: 'DELETE' });
      setUnread(0);
      setItems([]);
    } catch {
      // ignore
    }
  }

  async function openNotification(n) {
    try {
      await api('/notifications/read', { method: 'PATCH', body: { ids: [n.id] } });
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      setUnread((c) => Math.max(0, c - (n.read ? 0 : 1)));
    } catch {
      // still navigate
    }
    setOpen(false);
    if (n.type === 'approved') onApprovedNotice?.();
    if (n.type === 'pending_hr') onManagerApproved?.();
    if (n.type === 'balance_credited') onBalanceCredited?.(n);
    navigate(pathForNotification(user?.role, n.type));
  }

  return (
    <div className="bell-wrap" ref={panelRef}>
      <button
        type="button"
        className="bell-btn"
        onClick={toggleBell}
        aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
        aria-expanded={open}
      >
        <img src="/assets/nav-bell.png" alt="" />
        {unread > 0 && (
          <span className="bell-badge">{unread > 99 ? '99+' : unread}</span>
        )}
      </button>

      {open && (
        <div className="bell-panel">
          <div className="bell-panel-head">
            <strong>Updates</strong>
            <div className="bell-actions">
              {unread > 0 && (
                <button type="button" className="btn ghost" onClick={markAllRead}>
                  Mark read
                </button>
              )}
              {items.length > 0 && (
                <button type="button" className="btn ghost" onClick={clearAll}>
                  Clear all
                </button>
              )}
            </div>
          </div>
          {!items.length && <p className="empty">No notifications yet.</p>}
          <ul className="bell-list">
            {items.map((n) => (
              <li key={n.id} className={n.read ? '' : 'unread'}>
                <button type="button" className="notif-item" onClick={() => openNotification(n)}>
                  <strong>{n.title}</strong>
                  <span>{n.message}</span>
                  <small>
                    {n.createdAt ? formatDateTime(n.createdAt) : ''}
                  </small>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ColorPanel({ onClose }) {
  const { bgColor, setBgColor, resetTheme, isDefault } = useTheme();
  return (
    <div className="settings-color">
      <div className="bell-panel-head">
        <strong>Background color</strong>
        <div className="bell-actions">
          {!isDefault && (
            <button type="button" className="btn ghost" onClick={resetTheme}>
              Reset
            </button>
          )}
          {onClose && (
            <button type="button" className="btn ghost" onClick={onClose}>
              Back
            </button>
          )}
        </div>
      </div>
      <div className="theme-presets">
        {THEME_PRESETS.map((p) => (
          <button
            key={p.value}
            type="button"
            className={`theme-preset${bgColor.toLowerCase() === p.value.toLowerCase() ? ' active' : ''}`}
            style={{ background: p.value }}
            title={p.label}
            aria-label={p.label}
            onClick={() => setBgColor(p.value)}
          />
        ))}
      </div>
      <label className="theme-custom">
        Custom
        <input
          type="color"
          value={/^#[0-9a-fA-F]{6}$/.test(bgColor) ? bgColor : DEFAULT_COLOR_INPUT}
          onChange={(e) => setBgColor(e.target.value)}
        />
      </label>
    </div>
  );
}

function ChangePasswordModal({ onClose }) {
  const [form, setForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  async function submit(e) {
    e.preventDefault();
    setError('');
    setOk('');
    if (form.newPassword !== form.confirmPassword) {
      setError('New passwords do not match');
      return;
    }
    setBusy(true);
    try {
      await api('/auth/password', {
        method: 'PATCH',
        body: {
          currentPassword: form.currentPassword,
          newPassword: form.newPassword,
        },
      });
      setOk('Password updated.');
      setForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop modal-backdrop-static">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="change-pass-title">
        <h2 id="change-pass-title">Change password</h2>
        <form className="stack-form" onSubmit={submit}>
          <label>
            Current password
            <input
              type="password"
              value={form.currentPassword}
              onChange={(e) => setForm((f) => ({ ...f, currentPassword: e.target.value }))}
              required
              autoFocus
              autoComplete="current-password"
            />
          </label>
          <label>
            New password
            <input
              type="password"
              value={form.newPassword}
              onChange={(e) => setForm((f) => ({ ...f, newPassword: e.target.value }))}
              minLength={6}
              required
              autoComplete="new-password"
            />
          </label>
          <label>
            Confirm new password
            <input
              type="password"
              value={form.confirmPassword}
              onChange={(e) => setForm((f) => ({ ...f, confirmPassword: e.target.value }))}
              minLength={6}
              required
              autoComplete="new-password"
            />
          </label>
          {error && <p className="form-error">{error}</p>}
          {ok && <p className="form-ok">{ok}</p>}
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={onClose}>
              Close
            </button>
            <button className="btn primary" type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Update password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ChangeNameModal({ onClose }) {
  const { user, updateProfile } = useAuth();
  const [name, setName] = useState(user?.name || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  async function submit(e) {
    e.preventDefault();
    setError('');
    setOk('');
    setBusy(true);
    try {
      await updateProfile({ name });
      setOk('Name updated.');
      setTimeout(onClose, 700);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop modal-backdrop-static">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="change-name-title">
        <h2 id="change-name-title">Update name</h2>
        <form className="stack-form" onSubmit={submit}>
          <label>
            Display name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              minLength={2}
              maxLength={80}
              autoFocus
            />
          </label>
          {error && <p className="form-error">{error}</p>}
          {ok && <p className="form-ok">{ok}</p>}
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={onClose}>
              Close
            </button>
            <button className="btn primary" type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save name'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SettingsMenu() {
  const { user, logout } = useAuth();
  const { bgColor } = useTheme();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState('menu'); // menu | color
  const [showPassword, setShowPassword] = useState(false);
  const [showName, setShowName] = useState(false);
  const panelRef = useRef(null);
  const isHr = user?.role === 'hr';

  useEffect(() => {
    function onDocClick(e) {
      if (!panelRef.current?.contains(e.target)) {
        setOpen(false);
        setView('menu');
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  function toggle() {
    setOpen((v) => {
      const next = !v;
      if (!next) setView('menu');
      return next;
    });
  }

  return (
    <>
      <div className="bell-wrap" ref={panelRef}>
        <button
          type="button"
          className="bell-btn settings-btn"
          onClick={toggle}
          aria-label="Settings"
          title="Settings"
          aria-expanded={open}
        >
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path
              fill="currentColor"
              d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.03 7.03 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.59.24-1.13.55-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.84a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.13.23.4.32.64.22l2.39-.96c.5.39 1.04.71 1.63.94l.36 2.54c.05.24.26.42.5.42h3.84c.24 0 .45-.18.5-.42l.36-2.54c.59-.24 1.13-.55 1.63-.94l2.39.96c.24.1.5 0 .64-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z"
            />
          </svg>
          <span className="theme-swatch" style={{ background: bgColor }} />
        </button>

        {open && (
          <div className="settings-panel">
            {view === 'color' ? (
              <ColorPanel onClose={() => setView('menu')} />
            ) : (
              <div className="settings-menu">
                {isHr && (
                  <button
                    type="button"
                    className="settings-item"
                    onClick={() => {
                      setOpen(false);
                      setShowName(true);
                    }}
                  >
                    <span className="settings-item-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24" width="18" height="18">
                        <path
                          fill="currentColor"
                          d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm0 2c-3.3 0-8 1.7-8 4v1a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1c0-2.3-4.7-4-8-4Z"
                        />
                      </svg>
                    </span>
                    <span>Update name</span>
                  </button>
                )}
                <button type="button" className="settings-item" onClick={() => setView('color')}>
                  <span className="settings-item-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="18" height="18">
                      <path
                        fill="currentColor"
                        d="M12 2a10 10 0 0 0 0 20c.8 0 1.4-.7 1.1-1.4-.2-.4 0-.9.4-1.1.3-.2.7-.1.9.2.5.7 1.4 1.1 2.3 1.1A5.5 5.5 0 0 0 22 15.3C21.2 7.8 15.2 2 12 2Z"
                      />
                    </svg>
                  </span>
                  <span>Color</span>
                </button>
                <button
                  type="button"
                  className="settings-item"
                  onClick={() => {
                    setOpen(false);
                    setShowPassword(true);
                  }}
                >
                  <span className="settings-item-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="18" height="18">
                      <path
                        fill="currentColor"
                        d="M17 8h-1V6a4 4 0 1 0-8 0v2H7a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2Zm-7-2a2 2 0 1 1 4 0v2h-4V6Zm3 10.7V18a1 1 0 1 1-2 0v-1.3a2 2 0 1 1 2 0Z"
                      />
                    </svg>
                  </span>
                  <span>Change password</span>
                </button>
                <button
                  type="button"
                  className="settings-item settings-item-danger"
                  onClick={logout}
                >
                  <span className="settings-item-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="18" height="18">
                      <path
                        fill="currentColor"
                        d="M10 3a1 1 0 0 1 1 1v8a1 1 0 1 1-2 0V5H6.5A1.5 1.5 0 0 0 5 6.5v11A1.5 1.5 0 0 0 6.5 19H9a1 1 0 1 1 0 2H6.5A3.5 3.5 0 0 1 3 17.5v-11A3.5 3.5 0 0 1 6.5 3H10Zm5.3 5.3a1 1 0 0 1 1.4 0l4 4a1 1 0 0 1 0 1.4l-4 4a1 1 0 1 1-1.4-1.4L17.58 14H11a1 1 0 1 1 0-2h6.58l-2.28-2.3a1 1 0 0 1 0-1.4Z"
                      />
                    </svg>
                  </span>
                  <span>Logout</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      {showPassword && <ChangePasswordModal onClose={() => setShowPassword(false)} />}
      {showName && <ChangeNameModal onClose={() => setShowName(false)} />}
    </>
  );
}

function PageTitle({ title }) {
  if (typeof title === 'string' && title.startsWith('Welcome ')) {
    const name = title.slice('Welcome '.length).trim();
    return (
      <h1 className="welcome-title">
        <img src="/assets/welcome-cool.png" alt="" className="welcome-icon" />
        <span className="welcome-label">Welcome</span>
        <span className="welcome-name">{name}</span>
      </h1>
    );
  }
  return <h1>{title}</h1>;
}

export default function AppShell({ title, nav, children }) {
  const { user } = useAuth();
  const { mode, shellStyle } = useTheme();
  const [celebrate, setCelebrate] = useState(false);
  const [managerCelebrate, setManagerCelebrate] = useState(false);
  const [creditNotice, setCreditNotice] = useState(null);
  const roleIsUser = user?.role === 'user';
  const sidebarNav = roleIsUser ? USER_ICONS : nav;
  const hasIcons = sidebarNav.some((item) => item.icon);

  return (
    <div className="shell" data-theme={mode} style={shellStyle}>
      <ApprovedCelebration
        show={celebrate}
        onDone={() => setCelebrate(false)}
        message="Leave approved!"
      />
      <StatusCelebration
        show={managerCelebrate}
        onDone={() => setManagerCelebrate(false)}
        message="Manager approved"
        detail="Waiting for HR final approval."
        imageSrc="/assets/icon-manager-approved.gif"
        durationMs={2800}
      />
      <StatusCelebration
        show={Boolean(creditNotice)}
        onDone={() => setCreditNotice(null)}
        message="Leaves credited"
        detail={creditNotice || ''}
        imageSrc="/assets/balance-credited.gif"
        durationMs={3200}
      />
      <aside className="sidebar">
        <div className="brand brand-only">
          <img className="brand-logo" src="/assets/yupnup.svg" alt="YupNup" />
        </div>
        <nav className={hasIcons ? 'sidebar-icon-nav' : undefined}>
          {sidebarNav.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} title={item.label}>
              {item.icon ? (
                <>
                  <img src={item.icon} alt="" className="nav-icon" />
                  <span>{item.label}</span>
                </>
              ) : (
                item.label
              )}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="main">
        <header className="page-header with-tools">
          <PageTitle title={title} />
          <div className="header-tools">
            <NotificationBell
              onApprovedNotice={() => setCelebrate(true)}
              onManagerApproved={() => setManagerCelebrate(true)}
              onBalanceCredited={(n) =>
                setCreditNotice(n.message || 'Leave balance credited to your account.')
              }
            />
            <SettingsMenu />
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}
