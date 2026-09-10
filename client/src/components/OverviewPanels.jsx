import { Link } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import ErrorPopup from './ErrorPopup';
import StatusCelebration from './StatusCelebration';
import OfficePunchesPanel from './OfficePunchesPanel';
import {
  REQUEST_LABELS,
  STATUS_LABELS,
  appToday,
  avatarSrc,
  formatOverviewHolidayRow,
  holidayKind,
  holidayKindLabel,
  insufficientRestrictedBalance,
  isApplyBlockError,
  toYmd,
} from '../utils';

const LEAVE_DOT = {
  earned: 'var(--elb-tone-earned, var(--tone-ok))',
  sick: 'var(--elb-tone-sick, var(--tone-accent))',
  casual: 'var(--elb-tone-casual, var(--tone-info))',
  restricted: 'var(--elb-tone-restricted, var(--tone-danger))',
  celebration: 'var(--elb-tone-celebration, var(--tone-pink))',
  wfh: 'var(--tone-accent)',
};

function PanelLink({ to, children, tone }) {
  return (
    <Link to={to} className={`emp-dash-link${tone ? ` tone-${tone}` : ''}`}>
      {children}
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
        <path
          d="M9 6l6 6-6 6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </Link>
  );
}

function formatLeaveRangeShort(start, end) {
  const startYmd = toYmd(start);
  const endYmd = toYmd(end);
  const fmtDay = (ymd) => {
    const [y, m, d] = ymd.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return {
      day: d,
      month: date.toLocaleString('en-IN', { month: 'short' }),
    };
  };
  const s = fmtDay(startYmd);
  if (startYmd === endYmd) return `${s.day} ${s.month}`;
  const e = fmtDay(endYmd);
  if (s.month === e.month) return `${s.day} - ${e.day} ${s.month}`;
  return `${s.day} ${s.month} - ${e.day} ${e.month}`;
}

export function TeamOnLeavePanel({
  items = [],
  title = 'Teams Leave',
  subtitle = "Who's on leave this month",
  calendarTo = null,
}) {
  const visible = (items || []).slice(0, 5);

  return (
    <section className="emp-dash-panel">
      <header className="emp-dash-panel-head">
        <div className="emp-dash-panel-title">
          <span className="emp-dash-panel-icon tone-team" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="9" cy="8" r="3" />
              <path d="M3.8 19c.6-2.8 2.8-4.2 5.2-4.2s4.6 1.4 5.2 4.2" strokeLinecap="round" />
              <path d="M16.4 9.2a2.4 2.4 0 1 1 0 4.6" strokeLinecap="round" />
              <path d="M19.2 19c.3-1.6 1.3-2.8 2.6-3.2" strokeLinecap="round" />
            </svg>
          </span>
          <div>
            <h2>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
        </div>
        {calendarTo ? <PanelLink to={calendarTo}>View team calendar</PanelLink> : null}
      </header>

      {!visible.length ? (
        <p className="empty emp-dash-empty">No teammates on leave this month.</p>
      ) : (
        <ul className="emp-dash-team-list">
          {visible.map((leave) => {
            const type = leave.leaveType;
            const label = REQUEST_LABELS[type] || type;
            const days = Number(leave.days || 0);
            return (
              <li key={leave.id}>
                <img
                  src={avatarSrc(leave.profilePhoto)}
                  alt=""
                  className="emp-dash-team-photo"
                />
                <div className="emp-dash-team-main">
                  <strong>{leave.userName || 'Employee'}</strong>
                  <span>{leave.designation || leave.employeeNumber || 'Team member'}</span>
                </div>
                <div className="emp-dash-team-type">
                  <span
                    className="emp-dash-leave-dot"
                    style={{ background: LEAVE_DOT[type] || 'var(--shell-muted, #64748b)' }}
                    aria-hidden
                  />
                  {label}
                </div>
                <div className="emp-dash-team-dates">
                  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                    <rect x="4" y="5" width="16" height="15" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
                    <path d="M8 3v3M16 3v3M4 10h16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                  {formatLeaveRangeShort(leave.startDate, leave.endDate)}
                </div>
                <span className="emp-dash-days-pill">
                  {days % 1 ? days.toFixed(1) : days} {days === 1 ? 'day' : 'days'}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {items.length > 5 && calendarTo ? (
        <footer className="emp-dash-panel-foot">
          <PanelLink to={calendarTo}>View all team members</PanelLink>
        </footer>
      ) : null}
    </section>
  );
}

function holidayCardDate(iso) {
  const { date, weekday } = formatOverviewHolidayRow(iso);
  const parts = String(date).split(' ').filter(Boolean);
  const day = parts.find((part) => /^\d+$/.test(part)) || parts[0] || '—';
  const month = parts.find((part) => /[A-Za-z]/.test(part)) || '';
  return {
    day,
    month,
    weekday,
    weekdayShort: weekday ? weekday.slice(0, 3) : '',
  };
}

export function CompanyHolidaysPanel({
  canApplyRestricted = false,
  holidaysTo = null,
  onApplied,
}) {
  const { user } = useAuth();
  const year = appToday().getFullYear();
  const todayYmd = toYmd(appToday());
  const [holidays, setHolidays] = useState([]);
  const [balances, setBalances] = useState(null);
  const [leaves, setLeaves] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyDate, setBusyDate] = useState('');
  const [submittedPopup, setSubmittedPopup] = useState(null);
  const [errorPopup, setErrorPopup] = useState(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const tasks = [api(`/holidays?year=${year}`)];
      if (canApplyRestricted) {
        const mineQuery = user?.id ? `/leaves?userId=${user.id}` : '/leaves';
        tasks.push(api('/balances/me'), api(mineQuery));
      }
      const results = await Promise.all(tasks);
      const holidayData = results[0];
      setHolidays(holidayData.holidays || []);
      if (canApplyRestricted) {
        setBalances(results[1].balances);
        const mine = (results[2].leaves || []).filter(
          (leave) => String(leave.userId) === String(user?.id)
        );
        setLeaves(mine);
      }
    } catch {
      setHolidays([]);
    } finally {
      setLoading(false);
    }
  }, [year, canApplyRestricted, user?.id]);

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

  const listedHolidays = useMemo(
    () => sortedHolidays.filter((holiday) => toYmd(holiday.startDate) >= todayYmd),
    [sortedHolidays, todayYmd]
  );

  function statusLabel(status) {
    if (status === 'approved') return STATUS_LABELS.approved;
    if (status === 'pending_manager') return STATUS_LABELS.pending_manager;
    if (status === 'pending_hr') return STATUS_LABELS.pending_hr;
    return STATUS_LABELS.pending;
  }

  async function applyRestricted(holiday) {
    const ymd = toYmd(holiday.startDate);
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
    try {
      const data = await api('/leaves', {
        method: 'POST',
        body: {
          leaveType: 'restricted',
          startDate: ymd,
          endDate: ymd,
          session: 'full',
          reason: holiday.userName || holiday.title || '',
        },
      });
      const autoApproved = data.leave?.status === 'approved' || user?.role === 'hr';
      setSubmittedPopup({
        message: autoApproved ? 'Restricted leave applied' : 'Restricted leave submitted',
        detail: autoApproved
          ? 'Added to your calendar.'
          : 'Your request is waiting for manager approval, then HR.',
        imageSrc: autoApproved ? '/assets/leave-approved.gif' : '/assets/request-submitted.gif',
      });
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
    const isFuture = ymd >= todayYmd;
    if (!canApplyRestricted || holiday.holidayType !== 'restricted' || !isFuture) return null;

    const status = appliedRhDates.get(ymd);
    if (status === 'approved') {
      return <span className="overview-holiday-status is-approved">{statusLabel(status)}</span>;
    }
    if (status === 'pending_manager' || status === 'pending_hr') {
      return (
        <span className="overview-holiday-status is-pending">
          {statusLabel(status)}
        </span>
      );
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
      <StatusCelebration
        show={Boolean(submittedPopup)}
        onDone={() => setSubmittedPopup(null)}
        message={submittedPopup?.message || 'Request submitted'}
        detail={submittedPopup?.detail || ''}
        imageSrc={submittedPopup?.imageSrc || '/assets/request-submitted.gif'}
        durationMs={3200}
      />
      <div className="overview-panel-head">
        <h2>Upcoming Holidays</h2>
        {holidaysTo ? (
          <Link to={holidaysTo} className="overview-panel-link" aria-label="Open Upcoming Holidays">
            →
          </Link>
        ) : null}
      </div>
      {loading && <p className="muted">Loading holidays…</p>}
      {!loading && !listedHolidays.length && (
        <p className="empty">No upcoming holidays published from today onward.</p>
      )}
      {!loading && !!listedHolidays.length && (
        <ul className="overview-holiday-list">
          {listedHolidays.map((holiday) => {
            const { day, month, weekdayShort } = holidayCardDate(holiday.startDate);
            const { date, weekday } = formatOverviewHolidayRow(holiday.startDate);
            const name = holiday.userName || holiday.title || 'Holiday';
            const kind = holidayKind(holiday);
            const isRestricted = kind === 'restricted';
            return (
              <li
                key={holiday.id || `${holiday.startDate}-${name}`}
                className={`overview-holiday-card is-${kind}${kind === 'national' ? ' has-india-flag' : ''}`.trim()}
                aria-label={`${name}, ${holidayKindLabel(kind)}, ${date}${weekday ? `, ${weekday}` : ''}`}
              >
                {kind === 'national' ? (
                  <span className="india-flag-backdrop" aria-hidden="true" />
                ) : null}
                <div className="overview-holiday-dateblock" aria-hidden>
                  <span className="overview-holiday-day">{day}</span>
                  <span className="overview-holiday-month">{month}</span>
                  {weekdayShort ? (
                    <span className="overview-holiday-weekday">{weekdayShort}</span>
                  ) : null}
                </div>
                <div className="overview-holiday-copy">
                  <span className="overview-holiday-name">{name}</span>
                  {isRestricted ? (
                    actionFor(holiday)
                  ) : (
                    <span className={`badge type-${kind === 'national' ? 'national' : 'regional'}`}>
                      {holidayKindLabel(kind)}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function TodayPunchesPanel(props) {
  return <OfficePunchesPanel {...props} />;
}

export default function OverviewPanels({
  todayOnLeave = [],
  teamTitle = 'Teams Leave',
  calendarTo = null,
  holidaysTo = null,
  attendanceTo = null,
  canApplyRestricted = false,
  onRestrictedApplied,
}) {
  return (
    <div className="overview-stack emp-dash-overview">
      <OfficePunchesPanel attendanceTo={attendanceTo} />
      <TeamOnLeavePanel items={todayOnLeave} title={teamTitle} calendarTo={calendarTo} />
      <CompanyHolidaysPanel
        canApplyRestricted={canApplyRestricted}
        holidaysTo={holidaysTo}
        onApplied={onRestrictedApplied}
      />
    </div>
  );
}
