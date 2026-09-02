import { Fragment, useMemo, useState } from 'react';
import { ROLE_LABELS } from '../utils';
import LeaveBalanceSummaryCards, {
  LEAVE_BALANCE_TYPES,
  LeaveTypeIcon,
  fmtDays,
} from './LeaveBalanceSummaryCards';

const LEAVE_TYPES = LEAVE_BALANCE_TYPES;
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

function metricStats(user, key) {
  const remaining = Number(user.balances?.[key] ?? 0);
  const used = Number(user.usage?.[key] ?? 0);
  return { remaining, used };
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

      <LeaveBalanceSummaryCards items={totals} />

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
        </div>
      )}
    </section>
  );
}
