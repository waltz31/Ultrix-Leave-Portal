import { useMemo, useState } from 'react';
import { ROLE_LABELS } from '../utils';

const LEAVE_TILES = [
  { key: 'earned', label: 'Earned Leave', tone: 'earned' },
  { key: 'sick', label: 'Sick Leave', tone: 'sick' },
  { key: 'casual', label: 'Casual Leave', tone: 'casual' },
  { key: 'restricted', label: 'Restricted Leave', tone: 'restricted' },
];
const AVATAR_TONES = 6;

function initials(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return 'ME';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function fmtDays(value) {
  const n = Number(value) || 0;
  return n % 1 ? n.toFixed(1) : String(n);
}

function metricStats(user, key) {
  const remaining = Number(user.balances?.[key] ?? 0);
  const used = Number(user.usage?.[key] ?? 0);
  const allocated = Math.max(remaining + used, remaining, 0);
  return { remaining, used, allocated };
}

function LeaveTypeIcon({ tone }) {
  const props = {
    viewBox: '0 0 24 24',
    width: '18',
    height: '18',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: '1.8',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  };
  if (tone === 'earned') {
    return (
      <svg {...props}>
        <rect x="3.5" y="5" width="17" height="15" rx="2.2" />
        <path d="M8 3.5v3M16 3.5v3M3.5 10h17" />
        <path d="M8.5 14.5 10.7 16.5 15.5 12.5" />
      </svg>
    );
  }
  if (tone === 'sick') {
    return (
      <svg {...props}>
        <path d="M12 3.5 19.5 7v5.2c0 4.4-3 7.4-7.5 8.8C8 19.6 4.5 16.6 4.5 12.2V7L12 3.5Z" />
        <path d="M12 9.5v5M9.5 12h5" />
      </svg>
    );
  }
  if (tone === 'casual') {
    return (
      <svg {...props}>
        <path d="M12 13a7 7 0 0 1-7-6h14a7 7 0 0 1-7 6Z" />
        <path d="M12 13v7M9.5 20.5h5" />
      </svg>
    );
  }
  return (
    <svg {...props}>
      <rect x="5" y="11" width="14" height="9.5" rx="2" />
      <path d="M8 11V8.2a4 4 0 0 1 8 0V11" />
    </svg>
  );
}

export default function HrEmployeeBalanceDirectory({ users = [], renderMenu, empty }) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((user) =>
      [user.name, user.email, user.department, user.designation, user.role]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q))
    );
  }, [users, query]);

  return (
    <section className="panel hr-bal-dir">
      <div className="hr-bal-dir-head">
        <div>
          <h2>Employee leave balances</h2>
        </div>
        <label className="hr-bal-search">
          <span className="sr-only">Search staff members</span>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search staff members or depts…"
          />
        </label>
      </div>

      {!users.length ? (
        empty || <p className="empty">No employees yet.</p>
      ) : !filtered.length ? (
        <p className="empty">No team members match your search.</p>
      ) : (
        <div className="hr-bal-grid">
          {filtered.map((user) => {
            const tone = Number(user.id || 0) % AVATAR_TONES;
            return (
              <article
                key={user.id}
                className={`hr-bal-card ${user.active ? '' : 'is-inactive'}`}
              >
                <header className="hr-bal-card-head">
                  <div className="hr-bal-who">
                    <span className={`hr-bal-avatar tone-${tone}`}>{initials(user.name)}</span>
                    <div>
                      <h3>{user.name}</h3>
                      <p>
                        {user.department ||
                          user.designation ||
                          ROLE_LABELS[user.role] ||
                          'Employee'}
                      </p>
                    </div>
                  </div>
                  <div className="hr-bal-card-tools">{renderMenu?.(user)}</div>
                </header>
                <div className="hr-bal-metrics">
                  {LEAVE_TILES.map((metric) => {
                    const stats = metricStats(user, metric.key);
                    return (
                      <div key={metric.key} className={`hr-bal-metric tone-${metric.tone}`}>
                        <div className="hr-bal-tile-head">
                          <span className="hr-bal-type-icon">
                            <LeaveTypeIcon tone={metric.tone} />
                          </span>
                          <strong>{metric.label}</strong>
                        </div>
                        <div className="hr-bal-tile-stats">
                          <div className="hr-bal-stat is-available">
                            <strong>{fmtDays(stats.remaining)}</strong>
                            <span>days available</span>
                          </div>
                          <div className="hr-bal-stat">
                            <span>Used</span>
                            <em>{fmtDays(stats.used)}</em>
                          </div>
                          <div className="hr-bal-stat">
                            <span>Allocated</span>
                            <em>{fmtDays(stats.allocated)}</em>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
