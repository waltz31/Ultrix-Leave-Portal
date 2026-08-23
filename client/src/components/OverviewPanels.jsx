import { Link } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import ErrorPopup from './ErrorPopup';
import StatusCelebration from './StatusCelebration';
import { PunchInProgressChip } from './PunchStatusChips';
import {
  REQUEST_LABELS,
  STATUS_LABELS,
  appToday,
  formatOverviewHolidayRow,
  formatLeaveSpan,
  formatTime,
  punchInLateness,
  isUnderNineHours,
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
      <PanelHead title="Upcoming Holidays" to={holidaysTo} />
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
            const isRestricted = holiday.holidayType === 'restricted';
            return (
              <li
                key={holiday.id || `${holiday.startDate}-${name}`}
                className={`overview-holiday-card ${isRestricted ? 'is-restricted' : 'is-general'}`.trim()}
                aria-label={`${name}, ${date}${weekday ? `, ${weekday}` : ''}`}
              >
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
                    <span className="badge type-general">General</span>
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

export function TodayPunchesPanel({ attendanceTo = null, title = 'Office punches' }) {
  const [punches, setPunches] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const today = toYmd(appToday());
      const data = await api(`/punches?from=${today}&to=${today}`);
      setPunches(data.punches || []);
    } catch {
      setPunches([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 4000);
    return () => clearInterval(timer);
  }, [load]);

  const latest = punches.slice(0, 6);

  return (
    <section className="panel overview-panel">
      <PanelHead title={title} to={attendanceTo} />
      {loading && <p className="muted">Loading punches…</p>}
      {!loading && !latest.length && (
        <p className="empty">No device punches yet today.</p>
      )}
      {!!latest.length && (
        <ul className="overview-team-list">
          {latest.map((session) => (
            <li key={`${session.userId || session.deviceUserCode}-${session.id}`}>
              <div className="overview-team-main">
                <strong>{session.userName || `ID ${session.deviceUserCode}`}</strong>
                <span className={`badge ${session.stillIn ? 'status-approved' : 'status-rejected'}`}>
                  {session.stillIn ? 'In' : 'Out'}
                </span>
              </div>
              <span className="overview-team-dates">
                In{' '}
                {session.punchIn ? (
                  <span className={`punch-in-sq is-${punchInLateness(session.punchIn) || 'on-time'}`}>
                    {formatTime(session.punchIn)}
                  </span>
                ) : (
                  '—'
                )}
                {' · '}
                Out{' '}
                {session.punchOut
                  ? formatTime(session.punchOut)
                  : session.stillIn
                    ? 'still in'
                    : '—'}
                {session.workHours ? (
                  <>
                    {' · '}
                    <span className={isUnderNineHours(session.workMinutes) ? 'work-hours-short' : undefined}>
                      {session.workHours}
                    </span>
                  </>
                ) : session.stillIn ? (
                  <>
                    {' · '}
                    <PunchInProgressChip />
                  </>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function OverviewPanels({
  todayOnLeave = [],
  teamTitle = 'Team on leave',
  calendarTo = null,
  holidaysTo = null,
  attendanceTo = null,
  canApplyRestricted = false,
  onRestrictedApplied,
}) {
  return (
    <div className="overview-stack">
      <TodayPunchesPanel attendanceTo={attendanceTo} />
      <TeamOnLeavePanel items={todayOnLeave} title={teamTitle} calendarTo={calendarTo} />
      <CompanyHolidaysPanel
        canApplyRestricted={canApplyRestricted}
        holidaysTo={holidaysTo}
        onApplied={onRestrictedApplied}
      />
    </div>
  );
}
