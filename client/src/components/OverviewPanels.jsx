import { Link } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import ErrorPopup from './ErrorPopup';
import {
  REQUEST_LABELS,
  appToday,
  formatHolidayTableDate,
  formatLeaveSpan,
  insufficientRestrictedBalance,
  isApplyBlockError,
  toYmd,
} from '../utils';

function PanelHead({ title, to }) {
  return (
    <div className="overview-panel-head">
      <h2>{title}</h2>
      {to ? (
        <Link to={to} className="overview-panel-link" aria-label={`Open ${title}`}>
          →
        </Link>
      ) : null}
    </div>
  );
}

function TeamOnLeaveEmpty() {
  return (
    <div className="overview-empty" aria-hidden>
      <svg className="overview-empty-art" viewBox="0 0 120 88" fill="none">
        <ellipse cx="60" cy="78" rx="34" ry="6" fill="rgba(100,197,193,0.18)" />
        <path
          d="M34 62c8-18 22-28 26-28s18 10 26 28"
          stroke="#64c5c1"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <path d="M34 62h52" stroke="#64c5c1" strokeWidth="3" strokeLinecap="round" />
        <rect x="44" y="58" width="32" height="6" rx="2" fill="#b5a3ed" opacity="0.85" />
        <circle cx="86" cy="52" r="14" stroke="#ff7b8a" strokeWidth="2.5" />
        <path d="M78 52h16M86 44v16" stroke="#ff7b8a" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    </div>
  );
}

export function TeamOnLeavePanel({ items = [], title = 'Team on leave', calendarTo = null }) {
  const today = appToday();
  const todayYmd = toYmd(today);

  const onLeaveToday = useMemo(
    () =>
      (items || []).filter((leave) => {
        const start = toYmd(leave.startDate);
        const end = toYmd(leave.endDate);
        return start <= todayYmd && end >= todayYmd;
      }),
    [items, todayYmd]
  );

  return (
    <section className="panel overview-panel">
      <PanelHead title={title} to={calendarTo} />
      {!onLeaveToday.length ? (
        <TeamOnLeaveEmpty />
      ) : (
        <ul className="overview-team-list">
          {onLeaveToday.map((leave) => (
            <li key={leave.id}>
              <div className="overview-team-main">
                <strong>{leave.userName || 'Employee'}</strong>
                <span className={`badge type-${leave.leaveType}`}>
                  {REQUEST_LABELS[leave.leaveType] || leave.leaveType}
                </span>
              </div>
              <span className="overview-team-dates">{formatLeaveSpan(leave)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RestrictedBalancePanel({ balance = 0 }) {
  return (
    <section className="panel overview-panel">
      <h2>Restricted leave</h2>
      <p className="overview-restricted-balance">
        <strong>{balance}</strong>
        <span>days available</span>
      </p>
      <p className="muted slim">
        Apply for restricted holidays from the company list below. Each approval uses 1 day from
        this balance.
      </p>
    </section>
  );
}

export function CompanyHolidaysPanel({
  canApplyRestricted = false,
  holidaysTo = null,
  onApplied,
}) {
  const year = appToday().getFullYear();
  const todayYmd = toYmd(appToday());
  const [holidays, setHolidays] = useState([]);
  const [balances, setBalances] = useState(null);
  const [leaves, setLeaves] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyDate, setBusyDate] = useState('');
  const [successDate, setSuccessDate] = useState('');
  const [errorPopup, setErrorPopup] = useState(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const tasks = [api(`/holidays?year=${year}`)];
      if (canApplyRestricted) {
        tasks.push(api('/balances/me'), api('/leaves'));
      }
      const results = await Promise.all(tasks);
      const holidayData = results[0];
      setHolidays(holidayData.holidays || []);
      if (canApplyRestricted) {
        setBalances(results[1].balances);
        setLeaves(results[2].leaves || []);
      }
    } catch {
      setHolidays([]);
    } finally {
      setLoading(false);
    }
  }, [year, canApplyRestricted]);

  useEffect(() => {
    reload();
  }, [reload]);

  const restrictedBalance = balances?.restricted ?? 2;
  const noRestrictedBalance = restrictedBalance < 1;

  const appliedRhDates = useMemo(() => {
    const map = new Map();
    for (const leave of leaves) {
      if (leave.leaveType !== 'restricted') continue;
      if (!['pending_manager', 'pending_hr', 'approved'].includes(leave.status)) continue;
      map.set(toYmd(leave.startDate), leave.status);
    }
    return map;
  }, [leaves]);

  const sortedHolidays = useMemo(
    () =>
      [...(holidays || [])].sort((a, b) =>
        toYmd(a.startDate).localeCompare(toYmd(b.startDate))
      ),
    [holidays]
  );

  async function applyRestricted(holiday) {
    const ymd = toYmd(holiday.startDate);
    if (!canApplyRestricted || holiday.holidayType !== 'restricted') return;
    if (appliedRhDates.has(ymd)) return;
    if (ymd < todayYmd) return;
    if (noRestrictedBalance) {
      setErrorPopup({
        title: 'No restricted leave balance',
        message: insufficientRestrictedBalance(restrictedBalance),
      });
      return;
    }

    setBusyDate(ymd);
    setSuccessDate('');
    try {
      await api('/leaves', {
        method: 'POST',
        body: {
          leaveType: 'restricted',
          startDate: ymd,
          endDate: ymd,
          session: 'full',
          reason: holiday.userName || holiday.title || '',
        },
      });
      setSuccessDate(ymd);
      await reload();
      onApplied?.();
    } catch (err) {
      const message = err.message || 'Could not apply restricted leave';
      setErrorPopup({
        title: isApplyBlockError(message) ? 'Cannot apply leave' : 'Apply failed',
        message,
      });
    } finally {
      setBusyDate('');
    }
  }

  function actionFor(holiday) {
    const ymd = toYmd(holiday.startDate);
    if (holiday.holidayType !== 'restricted' || !canApplyRestricted) return null;

    if (ymd < todayYmd) {
      const status = appliedRhDates.get(ymd);
      if (status === 'approved') {
        return <span className="overview-holiday-status is-approved">Approved</span>;
      }
      if (status === 'pending_manager' || status === 'pending_hr') {
        return <span className="overview-holiday-status is-pending">Pending</span>;
      }
      return <span className="overview-holiday-status is-muted">—</span>;
    }

    const status = appliedRhDates.get(ymd);
    if (status === 'approved') {
      return <span className="overview-holiday-status is-approved">Approved</span>;
    }
    if (status === 'pending_manager' || status === 'pending_hr') {
      return <span className="overview-holiday-status is-pending">Pending</span>;
    }
    if (successDate === ymd) {
      return <span className="overview-holiday-status is-pending">Submitted</span>;
    }
    if (noRestrictedBalance) {
      return <span className="overview-holiday-status is-muted">No balance</span>;
    }
    return (
      <button
        type="button"
        className="overview-holiday-apply"
        disabled={busyDate === ymd}
        onClick={() => applyRestricted(holiday)}
      >
        {busyDate === ymd ? 'Applying…' : 'Apply'}
      </button>
    );
  }

  return (
    <section className="panel overview-panel overview-holidays-wide">
      <ErrorPopup
        show={Boolean(errorPopup)}
        title={errorPopup?.title}
        message={errorPopup?.message}
        onClose={() => setErrorPopup(null)}
      />
      <PanelHead title={`Company holidays ${year}`} to={holidaysTo} />
      {canApplyRestricted && (
        <p className="muted slim overview-holidays-note">
          General holidays are fixed on the calendar. Restricted holidays can be applied below —
          each uses 1 day from your restricted leave balance ({restrictedBalance} remaining).
        </p>
      )}
      {loading && <p className="muted">Loading holidays…</p>}
      {!loading && !sortedHolidays.length && (
        <p className="empty">No company holidays published for {year} yet.</p>
      )}
      {!loading && !!sortedHolidays.length && (
        <div className="table-wrap">
          <table className="overview-holiday-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Holiday</th>
                <th>Holiday Type</th>
                {canApplyRestricted ? <th className="overview-holiday-action-col">Apply</th> : null}
              </tr>
            </thead>
            <tbody>
              {sortedHolidays.map((holiday) => (
                <tr
                  key={holiday.id || `${holiday.startDate}-${holiday.userName}`}
                  className={
                    holiday.holidayType === 'restricted'
                      ? 'overview-holiday-row-restricted'
                      : 'overview-holiday-row-general'
                  }
                >
                  <td>{formatHolidayTableDate(holiday.startDate)}</td>
                  <td>{holiday.userName || holiday.title || 'Holiday'}</td>
                  <td>
                    <span
                      className={`badge ${
                        holiday.holidayType === 'restricted' ? 'type-restricted' : 'type-general'
                      }`}
                    >
                      {holiday.holidayType === 'restricted' ? 'Restricted' : 'General'}
                    </span>
                  </td>
                  {canApplyRestricted ? (
                    <td className="overview-holiday-action-col">{actionFor(holiday)}</td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default function OverviewPanels({
  todayOnLeave = [],
  teamTitle = 'Team on leave',
  calendarTo = null,
  holidaysTo = null,
  canApplyRestricted = false,
  restrictedBalance: restrictedBalanceProp = null,
  onRestrictedApplied,
}) {
  const [restrictedBalance, setRestrictedBalance] = useState(restrictedBalanceProp ?? 2);

  useEffect(() => {
    if (restrictedBalanceProp != null) {
      setRestrictedBalance(restrictedBalanceProp);
    }
  }, [restrictedBalanceProp]);

  useEffect(() => {
    if (!canApplyRestricted) return;
    api('/balances/me')
      .then((d) => setRestrictedBalance(d.balances?.restricted ?? 2))
      .catch(() => {});
  }, [canApplyRestricted]);

  function handleApplied() {
    if (canApplyRestricted) {
      api('/balances/me')
        .then((d) => setRestrictedBalance(d.balances?.restricted ?? 2))
        .catch(() => {});
    }
    onRestrictedApplied?.();
  }

  return (
    <div className="overview-stack">
      <div className={`overview-grid${canApplyRestricted ? '' : ' overview-grid-single'}`}>
        <TeamOnLeavePanel items={todayOnLeave} title={teamTitle} calendarTo={calendarTo} />
        {canApplyRestricted ? (
          <RestrictedBalancePanel balance={restrictedBalance} />
        ) : null}
      </div>
      <CompanyHolidaysPanel
        canApplyRestricted={canApplyRestricted}
        holidaysTo={holidaysTo}
        onApplied={handleApplied}
      />
    </div>
  );
}
