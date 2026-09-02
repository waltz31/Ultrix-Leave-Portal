import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { pathForNotification, useNotifications } from '../notifications';
import { useAuth } from '../auth';
import { DARK_THEMES, LIGHT_THEMES, useTheme } from '../theme';
import { avatarSrc, formatDateTime } from '../utils';
import StatusCelebration from './StatusCelebration';
import HrLeaveApplyShortcuts from './HrLeaveApplyShortcuts';

const DEFAULT_COLOR_INPUT = '#0b1220';
const SIDEBAR_COLLAPSE_KEY = 'ultrix_sidebar_collapsed';

function BellGlyph() {
  const common = { viewBox: '0 0 24 24', width: '22', height: '22', fill: 'none', 'aria-hidden': true };
  const stroke = { stroke: 'currentColor', strokeWidth: '1.8', strokeLinecap: 'round', strokeLinejoin: 'round' };
  return (
    <svg {...common} className="bell-btn-icon">
      <path d="M18 16v-5a6 6 0 1 0-12 0v5l-1.5 2.5h15L18 16Z" {...stroke} />
      <path d="M10 19a2 2 0 0 0 4 0" {...stroke} />
    </svg>
  );
}

function NavGlyph({ label }) {
  const key = String(label || '').toLowerCase();
  const common = { viewBox: '0 0 24 24', width: '20', height: '20', fill: 'none', 'aria-hidden': true };
  const stroke = { stroke: 'currentColor', strokeWidth: '1.8', strokeLinecap: 'round', strokeLinejoin: 'round' };
  if (key.includes('overview') || key === 'home') {
    return (
      <svg {...common}>
        <rect x="3.5" y="3.5" width="7" height="7" rx="1.6" {...stroke} />
        <rect x="13.5" y="3.5" width="7" height="7" rx="1.6" {...stroke} />
        <rect x="3.5" y="13.5" width="7" height="7" rx="1.6" {...stroke} />
        <rect x="13.5" y="13.5" width="7" height="7" rx="1.6" {...stroke} />
      </svg>
    );
  }
  if (key.includes('approv')) {
    return (
      <svg {...common}>
        <path d="M20 6.5 9.5 17 4 11.5" {...stroke} />
      </svg>
    );
  }
  if (key.includes('calendar')) {
    return (
      <svg {...common}>
        <rect x="3.5" y="5" width="17" height="15" rx="2.2" {...stroke} />
        <path d="M8 3.5v3M16 3.5v3M3.5 10h17" {...stroke} />
      </svg>
    );
  }
  if (key.includes('apply')) {
    return (
      <svg {...common}>
        <path d="M12 5v14M5 12h14" {...stroke} />
      </svg>
    );
  }
  if (key.includes('salary') || key.includes('invoice') || key.includes('reimburs')) {
    return (
      <svg {...common}>
        <rect x="5" y="3.5" width="14" height="17" rx="2" {...stroke} />
        <path d="M8.5 8h7M8.5 12h7M8.5 16h4.5" {...stroke} />
      </svg>
    );
  }
  if (key.includes('rating')) {
    return (
      <svg {...common}>
        <path d="m12 4 2.3 4.7 5.2.8-3.8 3.6.9 5.2L12 16.2 7.4 18.3l.9-5.2L4.5 9.5l5.2-.8L12 4Z" {...stroke} />
      </svg>
    );
  }
  if (key.includes('history')) {
    return (
      <svg {...common}>
        <path d="M12 7.5V12l3 1.8" {...stroke} />
        <path d="M4.8 9.2A8 8 0 1 1 4 12" {...stroke} />
        <path d="M4 6.5V12h4" {...stroke} />
      </svg>
    );
  }
  if (key.includes('onboard') || key.includes('team') || key.includes('leave management') || key.includes('users')) {
    return (
      <svg {...common}>
        <circle cx="9" cy="8" r="3" {...stroke} />
        <path d="M3.6 18.5c.6-3 3.1-4.5 5.4-4.5s4.8 1.5 5.4 4.5" {...stroke} />
        <path d="M16.5 8.5a2.5 2.5 0 1 1 0 5" {...stroke} />
        <path d="M19.2 18.4c.3-1.8 1.4-3 2.8-3.4" {...stroke} />
      </svg>
    );
  }
  if (key.includes('report')) {
    return (
      <svg {...common}>
        <path d="M4.5 18.5V9.5M10 18.5V5.5M15.5 18.5v-6M21 18.5V8" {...stroke} />
      </svg>
    );
  }
  if (key.includes('feed')) {
    return (
      <svg {...common}>
        <path d="M5 8.8h9.2a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H9.4L6.2 19.5v-2.7H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2Z" {...stroke} />
        <path d="M9.6 6.4V5.6A2 2 0 0 1 11.6 3.6H17a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-.7" {...stroke} />
      </svg>
    );
  }
  if (key.includes('regular')) {
    return (
      <svg {...common}>
        <rect x="4" y="4.5" width="16" height="15" rx="2.2" {...stroke} />
        <path d="M8 3.5v3M16 3.5v3M4 10h16" {...stroke} />
        <path d="M9 14.5 11 16.5 15.5 12.5" {...stroke} />
      </svg>
    );
  }
  if (key.includes('attendance') || key.includes('punch')) {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="7.5" {...stroke} />
        <path d="M12 8v4.2l2.6 1.5" {...stroke} />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="7.5" {...stroke} />
    </svg>
  );
}

function NotificationBell({
  items,
  unread,
  refresh,
  markIdsRead,
  markAllRead,
  clearAll,
  onApprovedNotice,
  onBalanceCredited,
  onManagerApproved,
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);

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
    if (next) await refresh(true);
  }

  async function openNotification(n) {
    try {
      await markIdsRead([n.id]);
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
        <BellGlyph />
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

function ThemeSwatch({ primary, secondary, bg, active, label, onClick }) {
  return (
    <button
      type="button"
      className={`theme-preset${active ? ' is-on' : ''}`}
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
    >
      <span className="theme-preset-chip" style={{ background: bg }}>
        <span style={{ background: primary }} />
        <span style={{ background: secondary }} />
      </span>
      <span className="theme-preset-name">{label}</span>
    </button>
  );
}

function ColorPanel({ onClose }) {
  const { themeId, bgColor, setBgColor, setThemeId, resetTheme, isDefault, isCustom } = useTheme();
  return (
    <div className="settings-color">
      <div className="bell-panel-head">
        <strong>Theme</strong>
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
      <p className="theme-group-label">Light</p>
      <div className="theme-presets">
        {LIGHT_THEMES.map((p) => (
          <ThemeSwatch
            key={p.id}
            label={p.label}
            primary={p.primary}
            secondary={p.secondary}
            bg={p.bg}
            active={themeId === p.id}
            onClick={() => setThemeId(p.id)}
          />
        ))}
      </div>
      <p className="theme-group-label">Dark</p>
      <div className="theme-presets">
        {DARK_THEMES.map((p) => (
          <ThemeSwatch
            key={p.id}
            label={p.label}
            primary={p.primary}
            secondary={p.secondary}
            bg={p.bg}
            active={themeId === p.id}
            onClick={() => setThemeId(p.id)}
          />
        ))}
      </div>
      <label className={`theme-custom${isCustom ? ' is-on' : ''}`}>
        Custom wash
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
  const { primary, secondary } = useTheme();
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
          aria-label="Account menu"
          title={user?.name || 'Account'}
          aria-expanded={open}
        >
          <img className="settings-avatar" src={avatarSrc(user?.profilePhoto)} alt="" />
          <span
            className="theme-swatch"
            style={{ background: `linear-gradient(135deg, ${primary} 50%, ${secondary} 50%)` }}
          />
        </button>

        {open && (
          <div className={`settings-panel${view === 'color' ? ' is-theme' : ''}`}>
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
                  <span>Theme</span>
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
  if (!title) return null;
  let label = String(title).trim();
  if (label.startsWith('Welcome ')) label = 'Home';
  if (label.includes(' · ')) label = label.split(' · ')[0].trim();
  return <h1 className="page-section-title">{label}</h1>;
}

export default function AppShell({ title, nav, children }) {
  const { user } = useAuth();
  const { mode, shellStyle } = useTheme();
  const location = useLocation();
  const [celebrate, setCelebrate] = useState(false);
  const [managerCelebrate, setManagerCelebrate] = useState(false);
  const [creditNotice, setCreditNotice] = useState(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const navRef = useRef(null);
  const [indicator, setIndicator] = useState({ y: 0, h: 44, visible: false });
  const {
    notifications,
    unreadCount,
    unreadByPath,
    refresh: refreshNotifications,
    markIdsRead,
    markAllRead,
    clearAll: clearNotifications,
    markPathRead,
  } = useNotifications(user?.role);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const sidebarNav = nav || [];

  const moveIndicator = useCallback(() => {
    const nav = navRef.current;
    const target = nav?.querySelector('.sidebar-link.active');
    if (!nav || !target) {
      setIndicator((s) => (s.visible ? { ...s, visible: false } : s));
      return;
    }
    const y = Math.round(target.offsetTop);
    const h = Math.round(target.offsetHeight);
    setIndicator((s) => (s.y === y && s.h === h && s.visible ? s : { y, h, visible: true }));
  }, []);

  useLayoutEffect(() => {
    moveIndicator();
  }, [location.pathname, collapsed, mobileOpen, moveIndicator]);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return undefined;
    let frame = 0;
    const scheduleMove = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => moveIndicator());
    };
    window.addEventListener('resize', scheduleMove);
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(scheduleMove) : null;
    observer?.observe(nav);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', scheduleMove);
      observer?.disconnect();
    };
  }, [moveIndicator, location.pathname, collapsed, mobileOpen]);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      markPathRead(location.pathname);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [location.pathname, markPathRead]);

  function navBadgeFor(item) {
    const count = unreadByPath[item.to] || 0;
    return count || null;
  }

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSE_KEY, next ? '1' : '0');
      } catch {
        // ignore
      }
      return next;
    });
  }

  function onSidebarToggle() {
    if (window.matchMedia('(max-width: 960px)').matches) {
      setMobileOpen(false);
      return;
    }
    toggleCollapsed();
  }

  return (
    <div
      className="shell"
      data-theme={mode}
      data-sidebar-collapsed={collapsed ? 'true' : 'false'}
      data-sidebar-open={mobileOpen ? 'true' : 'false'}
      style={shellStyle}
    >
      <StatusCelebration
        show={celebrate}
        onDone={() => setCelebrate(false)}
        message="Leave approved!"
        imageSrc="/assets/leave-approved.gif"
        durationMs={2800}
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
      {mobileOpen && (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="Close menu"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside className="sidebar">
        <div className="sidebar-head">
          <div className="brand brand-only">
            <img className="brand-logo" src="/assets/yupnup.svg" alt="YupNup" />
          </div>
          <button
            type="button"
            className="sidebar-toggle"
            onClick={onSidebarToggle}
            aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}
          >
            <span />
            <span />
            <span />
          </button>
        </div>
        <div className="sidebar-nav-stage">
          <nav className="sidebar-nav" ref={navRef}>
            <span
              className={`sidebar-indicator${indicator.visible ? ' is-on' : ''}`}
              style={{ transform: `translate3d(0, ${indicator.y}px, 0)`, height: indicator.h }}
              aria-hidden="true"
            />
            {sidebarNav.map((item) => {
              const badge = navBadgeFor(item);
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  title={collapsed ? item.label : undefined}
                  className="sidebar-link"
                  onClick={() => markPathRead(item.to)}
                >
                  <span className="sidebar-link-icon">
                    <NavGlyph label={item.label} />
                  </span>
                  <span className="sidebar-link-label">{item.label}</span>
                  {badge != null && (
                    <span className="nav-count-badge" aria-label={`${badge} pending`}>
                      {badge > 99 ? '99+' : badge}
                    </span>
                  )}
                </NavLink>
              );
            })}
          </nav>
        </div>
      </aside>
      <main className="main">
        <header className="page-header with-tools">
          <button
            type="button"
            className="sidebar-mobile-toggle"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label="Open menu"
          >
            <span />
            <span />
            <span />
          </button>
          <PageTitle title={title} />
          <div className="header-tools">
            <div className="header-tools-cluster">
              <NotificationBell
                items={notifications}
                unread={unreadCount}
                refresh={refreshNotifications}
                markIdsRead={markIdsRead}
                markAllRead={markAllRead}
                clearAll={async () => {
                  const ok = window.confirm('Clear all notifications?');
                  if (ok) await clearNotifications();
                }}
                onApprovedNotice={() => setCelebrate(true)}
                onManagerApproved={() => setManagerCelebrate(true)}
                onBalanceCredited={(n) =>
                  setCreditNotice(n.message || 'Leave balance credited to your account.')
                }
              />
              <SettingsMenu />
            </div>
          </div>
        </header>
        {children}
      </main>
      <HrLeaveApplyShortcuts />
    </div>
  );
}
