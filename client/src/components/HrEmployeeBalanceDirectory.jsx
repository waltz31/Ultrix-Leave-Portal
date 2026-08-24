import { Fragment, useMemo, useState } from 'react';
import { ROLE_LABELS } from '../utils';

const LEAVE_TYPES = [
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

function daysText(value) {
  const n = Number(value) || 0;
  return `${fmtDays(n)} ${n === 1 ? 'day' : 'days'}`;
}

function metricStats(user, key) {
  const remaining = Number(user.balances?.[key] ?? 0);
  const used = Number(user.usage?.[key] ?? 0);
  return { remaining, used };
}

function LeaveTypeIcon({ tone }) {
  const props = {
    viewBox: '0 0 24 24',
    width: '18',
    height: '18',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: '1.85',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  };
  if (tone === 'earned') {
    return (
      <svg {...props}>
        <rect x="3.5" y="5" width="17" height="15" rx="2.2" />
        <path d="M8 3.5v3M16 3.5v3M3.5 10h17" />
        <path d="M8.6 14.6 10.8 16.6 15.6 12.4" />
      </svg>
    );
  }
  if (tone === 'sick') {
    return (
      <svg {...props}>
        <path d="M12 3.4 20 7.2v5c0 4.6-3.2 7.8-8 9.2-4.8-1.4-8-4.6-8-9.2v-5L12 3.4Z" />
        <path d="M12 9.4v5.2M9.4 12h5.2" />
      </svg>
    );
  }
  if (tone === 'casual') {
    return (
      <svg {...props}>
        <path d="M8 4.5h8v3.2c0 2.6-1.8 4.7-4 5.3-2.2-.6-4-2.7-4-5.3V4.5Z" />
        <path d="M8 6.2H5.6A2.6 2.6 0 0 0 8.6 9.4M16 6.2h2.4A2.6 2.6 0 0 1 15.4 9.4" />
        <path d="M12 13v4.2M9.2 20.5h5.6M10.4 20.5v-3h3.2v3" />
      </svg>
    );
  }
  return (
    <svg {...props}>
      <rect x="5" y="11" width="14" height="9.5" rx="2" />
      <path d="M8.2 11V8.1a3.8 3.8 0 0 1 7.6 0V11" />
    </svg>
  );
}

function PeopleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
      <circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M3.8 19c.6-2.8 2.8-4.2 5.2-4.2s4.6 1.4 5.2 4.2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path d="M16.4 9.2a2.4 2.4 0 1 1 0 4.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M19.2 19c.3-1.6 1.3-2.8 2.6-3.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function CardWave() {
  return (
    <svg className="elb-card-wave" viewBox="0 0 320 54" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0 22C42 8 74 36 118 24 162 12 198 6 236 18 268 28 296 22 320 12v42H0V22Z" />
    </svg>
  );
}

export default function HrEmployeeBalanceDirectory({ users = [], renderMenu, empty, actions }) {
  const [query, setQuery] = useState('');
  const [sortDir, setSortDir] = useState('asc');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? users.filter((user) =>
          [user.name, user.email, user.department, user.designation, user.role]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(q))
        )
      : [...users];
    list.sort((a, b) => {
      const cmp = String(a.name || '').localeCompare(String(b.name || ''), undefined, {
        sensitivity: 'base',
      });
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [users, query, sortDir]);

  const totals = useMemo(
    () =>
      LEAVE_TYPES.map((type) => {
        const stats = filtered.reduce(
          (acc, user) => {
            const row = metricStats(user, type.key);
            acc.available += row.remaining;
            acc.used += row.used;
            return acc;
          },
          { available: 0, used: 0 }
        );
        return { ...type, ...stats };
      }),
    [filtered]
  );

  return (
    <section className="elb">
      <header className="elb-head">
        <div className="elb-title-wrap">
          <span className="elb-title-icon" aria-hidden="true">
            <LeaveTypeIcon tone="earned" />
          </span>
          <div>
            <h2>Employee Leave Balances</h2>
            <p>Quick overview of leave availability and usage across your organization.</p>
          </div>
        </div>
        <div className="elb-head-actions">
          <label className="elb-search">
            <span className="sr-only">Search staff members or departments</span>
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
            placeholder="Search staff members or departments..."
          />
          </label>
          {actions}
        </div>
      </header>

      <div className="elb-cards">
        {totals.map((type) => (
          <article key={type.key} className={`elb-card tone-${type.tone}`}>
            <div className="elb-card-mark" aria-hidden="true">
              <LeaveTypeIcon tone={type.tone} />
            </div>
            <CardWave />
            <div className="elb-card-top">
              <span className="elb-card-icon">
                <LeaveTypeIcon tone={type.tone} />
              </span>
              <strong>{type.label}</strong>
            </div>
            <div className="elb-card-stats">
              <div>
                <span>Available</span>
                <b>{daysText(type.available)}</b>
              </div>
              <div>
                <span>Used</span>
                <b>{daysText(type.used)}</b>
              </div>
            </div>
          </article>
        ))}
      </div>

      {!users.length ? (
        empty || <p className="empty">No employees yet.</p>
      ) : !filtered.length ? (
        <p className="empty">No staff members match that search.</p>
      ) : (
        <div className="elb-table-card">
          <div className="elb-table-head">
            <span className="elb-count-icon" aria-hidden="true">
              <PeopleIcon />
            </span>
            <div>
              <h3>
                {filtered.length} {filtered.length === 1 ? 'Employee' : 'Employees'}
              </h3>
              <p>Overview of leave balances.</p>
            </div>
          </div>
          <div className="elb-table-wrap">
            <table className="elb-table">
              <thead>
                <tr>
                  <th rowSpan={2} className="elb-emp-col">
                    <button
                      type="button"
                      className="elb-sort"
                      onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
                    >
                      Employee
                      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                        <path d="M8 9l4-4 4 4M8 15l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </th>
                  {LEAVE_TYPES.map((type) => (
                    <th key={type.key} colSpan={2} className={`elb-group tone-${type.tone}`}>
                      <span className="elb-group-inner">
                        <LeaveTypeIcon tone={type.tone} />
                        {type.label}
                      </span>
                    </th>
                  ))}
                  {renderMenu ? (
                    <th rowSpan={2} className="elb-actions-col">
                      <span className="sr-only">Actions</span>
                    </th>
                  ) : null}
                </tr>
                <tr>
                  {LEAVE_TYPES.map((type) => (
                    <Fragment key={type.key}>
                      <th className={`elb-sub tone-${type.tone}`}>Available</th>
                      <th className={`elb-sub tone-${type.tone}`}>Used</th>
                    </Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((user) => {
                  const tone = Number(user.id || 0) % AVATAR_TONES;
                  return (
                    <tr key={user.id} className={user.active ? '' : 'is-inactive'}>
                      <td className="elb-emp-col">
                        <div className="elb-who">
                          <span className={`elb-avatar tone-${tone}`}>{initials(user.name)}</span>
                          <div className="elb-who-copy">
                            <strong>{user.name}</strong>
                            <span>
                              {user.department ||
                                user.designation ||
                                ROLE_LABELS[user.role] ||
                                'Employee'}
                            </span>
                          </div>
                        </div>
                      </td>
                      {LEAVE_TYPES.map((type) => {
                        const stats = metricStats(user, type.key);
                        return (
                          <Fragment key={`${user.id}-${type.key}`}>
                            <td className={`elb-num tone-${type.tone}`}>
                              <strong>{fmtDays(stats.remaining)}</strong>
                              <em>{stats.remaining === 1 ? 'day' : 'days'}</em>
                            </td>
                            <td className={`elb-num tone-${type.tone}`}>
                              <strong>{fmtDays(stats.used)}</strong>
                              <em>{stats.used === 1 ? 'day' : 'days'}</em>
                            </td>
                          </Fragment>
                        );
                      })}
                      {renderMenu ? <td className="elb-actions-col">{renderMenu(user)}</td> : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="elb-foot">
            Showing 1 to {filtered.length} of {filtered.length} employees
          </p>
        </div>
      )}
    </section>
  );
}
