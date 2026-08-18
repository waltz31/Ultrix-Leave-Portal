import { useMemo, useState } from 'react';
import { ROLE_LABELS } from '../utils';

const MINI_RING = { r: 22, c: 2 * Math.PI * 22 };
const RING_METRICS = [
  { key: 'earned', label: 'Earned', tone: 'earned' },
  { key: 'sick', label: 'Sick', tone: 'sick' },
  { key: 'casual', label: 'Casual', tone: 'casual' },
  { key: 'restricted', label: 'Restricted', tone: 'restricted' },
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
  const ratio = allocated > 0 ? Math.max(0, Math.min(1, remaining / allocated)) : 0;
  return { remaining, used, allocated, ratio };
}

function MiniRing({ ratio, tone }) {
  const offset = MINI_RING.c - ratio * MINI_RING.c;
  return (
    <div className={`hr-bal-ring tone-${tone}`} aria-hidden>
      <svg viewBox="0 0 56 56">
        <circle className="hr-bal-ring-bg" cx="28" cy="28" r={MINI_RING.r} />
        <circle
          className="hr-bal-ring-fg"
          cx="28"
          cy="28"
          r={MINI_RING.r}
          strokeDasharray={MINI_RING.c}
          strokeDashoffset={offset}
        />
      </svg>
      <span>{Math.round(ratio * 100)}%</span>
    </div>
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
          <p className="muted">Remaining days for each leave type, with used vs allocated.</p>
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
                  {RING_METRICS.map((metric) => {
                    const stats = metricStats(user, metric.key);
                    return (
                      <div key={metric.key} className={`hr-bal-metric tone-${metric.tone}`}>
                        <span className="hr-bal-pill">{metric.label}</span>
                        <div className="hr-bal-metric-body">
                          <div className="hr-bal-metric-copy">
                            <strong>{fmtDays(stats.remaining)}</strong>
                            <em>days left</em>
                            <small>
                              {fmtDays(stats.allocated)} allocated · {fmtDays(stats.used)} used
                            </small>
                          </div>
                          <MiniRing ratio={stats.ratio} tone={metric.tone} />
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
