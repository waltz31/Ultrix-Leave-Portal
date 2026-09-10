import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isWeekend,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns';
import { api } from '../api';
import { useAuth } from '../auth';
import { usePollWhenVisible } from '../usePollWhenVisible';
import { downloadPunchesExcel } from '../exportPunches';
import RegularizeRequestModal from './RegularizeRequestModal';
import {
  REQUEST_LABELS,
  appToday,
  formatSessionWorkDisplay,
  formatTime,
  formatWorkHoursMinutes,
  holidayKind,
  holidayKindLabel,
  parseAppDateTime,
  punchInLateness,
  toYmd,
  expectedLogoutFromPunchIn,
  REQUIRED_WORK_MINUTES,
} from '../utils';
import { PunchCheckoutDisplay } from './PunchStatusChips';

const WEEK_STARTS_ON = 1;
const DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const EARLY_OUT_MINUTES = 18 * 60;
const ON_TIME_CUTOFF_MINUTES = 11 * 60 + 30;

function stampToTime(stamp) {
  const m = String(stamp || '').match(/(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : '';
}

const LEAVE_KIND = {
  casual: { pill: 'Casual Leave', tone: 'leave' },
  earned: { pill: 'Earned Leave', tone: 'leave' },
  sick: { pill: 'Sick Leave', tone: 'leave' },
  restricted: { pill: 'Restricted Leave', tone: 'leave' },
  celebration: { pill: 'Celebration Leave', tone: 'leave' },
  wfh: { pill: 'Work from Home', tone: 'leave' },
};

function formatWorkHours(minutes) {
  return formatWorkHoursMinutes(minutes) || '—';
}

function istMinutesOfDay(value) {
  const parsed = parseAppDateTime(value);
  if (!parsed) {
    const match = String(value || '').match(/(\d{1,2}):(\d{2})/);
    if (!match) return null;
    return Number(match[1]) * 60 + Number(match[2]);
  }
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(parsed);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
  return hour * 60 + minute;
}

function lateMinutesAfterCutoff(punchIn) {
  const mins = istMinutesOfDay(punchIn);
  if (mins == null || mins <= ON_TIME_CUTOFF_MINUTES) return 0;
  return mins - ON_TIME_CUTOFF_MINUTES;
}

function isEarlyDeparture(punchOut) {
  const mins = istMinutesOfDay(punchOut);
  return mins != null && mins < EARLY_OUT_MINUTES;
}

function isHolidayLeave(leave) {
  return Boolean(
    leave?.isMandatory ||
      leave?.holidayType === 'general' ||
      leave?.holidayType === 'restricted' ||
      leave?.leaveType === 'general' ||
      leave?.leaveType === 'mandatory'
  );
}

function holidayDisplayName(holiday) {
  const named =
    holiday?.userName ||
    holiday?.title ||
    holiday?.name ||
    holiday?.holiday ||
    REQUEST_LABELS[holiday?.leaveType] ||
    REQUEST_LABELS[holiday?.holidayType];
  return String(named || 'Holiday').trim() || 'Holiday';
}

function monthRange(monthKey) {
  const [year, monthNum] = monthKey.split('-').map(Number);
  const pad = (n) => String(n).padStart(2, '0');
  const last = new Date(year, monthNum, 0).getDate();
  return {
    from: `${year}-${pad(monthNum)}-01`,
    to: `${year}-${pad(monthNum)}-${pad(last)}`,
  };
}

function resolveDayStatus(day, ctx) {
  const ymd = format(day, 'yyyy-MM-dd');
  const todayYmd = format(ctx.today, 'yyyy-MM-dd');
  const session = ctx.sessionsByDate.get(ymd);
  const holiday = ctx.holidayByDate.get(ymd);
  const leaves = ctx.leavesByDate.get(ymd) || [];
  const approved = leaves.find((l) => l.status === 'approved' && !isHolidayLeave(l));
  const pending = leaves.find(
    (l) => l.status && !['approved', 'rejected', 'cancelled'].includes(l.status)
  );

  if (approved) {
    const meta = LEAVE_KIND[approved.leaveType] || { pill: REQUEST_LABELS[approved.leaveType] || 'Leave', tone: 'leave' };
    return {
      tone: meta.tone,
      label: meta.pill,
      session,
      leave: approved,
      kind: 'leave',
    };
  }

  if (holiday) {
    const name = holidayDisplayName(holiday);
    const kind = holidayKind(holiday);
    return {
      tone: kind === 'national' ? 'national' : kind === 'restricted' ? 'restricted-holiday' : 'holiday',
      label: name,
      kind: 'holiday',
      holidayKind: kind,
      leave: holiday,
    };
  }

  if (isWeekend(day) && !session?.punchIn) {
    return { tone: 'weekend', label: 'Weekend', kind: 'weekend' };
  }

  if (session?.punchIn) {
    const lateness = punchInLateness(session.punchIn);
    const late = lateness === 'late' || lateness === 'very-late';
    const lateMins = lateMinutesAfterCutoff(session.punchIn);
    return {
      tone: late ? 'late' : 'present',
      label: late ? (lateMins > 0 ? `Late (${lateMins}m)` : 'Late') : 'Present',
      kind: late ? 'late' : 'present',
      session,
      earlyOut: session.punchOut ? isEarlyDeparture(session.punchOut) : false,
    };
  }

  if (pending) {
    const meta = LEAVE_KIND[pending.leaveType] || { pill: 'Leave', tone: 'leave' };
    return { tone: meta.tone, label: `${meta.pill} · Pending`, kind: 'leave-pending', leave: pending };
  }

  if (ymd < todayYmd && !isWeekend(day)) {
    return { tone: 'absent', label: 'Absent', kind: 'absent' };
  }

  return { tone: 'empty', label: '', kind: 'empty' };
}

function KpiCard({ tone, label, value, sub, spark }) {
  return (
    <article className={`my-att-kpi tone-${tone}`}>
      <span className="my-att-kpi-icon" aria-hidden="true">
        {spark}
      </span>
      <div>
        <span className="my-att-kpi-label">{label}</span>
        <strong>{value}</strong>
        {sub ? <em>{sub}</em> : null}
      </div>
    </article>
  );
}

function MonthPicker({ value, onChange, today }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const selected = useMemo(() => {
    const [y, m] = String(value || '').split('-').map(Number);
    return new Date(y, (m || 1) - 1, 1);
  }, [value]);
  const [viewYear, setViewYear] = useState(selected.getFullYear());

  useEffect(() => {
    if (open) setViewYear(selected.getFullYear());
  }, [open, selected]);

  useEffect(() => {
    if (!open) return undefined;
    function onDoc(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const todayKey = format(today, 'yyyy-MM');
  const isCurrentMonth = value === todayKey;

  function shift(dir) {
    onChange(format(dir > 0 ? addMonths(selected, 1) : subMonths(selected, 1), 'yyyy-MM'));
  }

  function pickMonth(monthIndex) {
    onChange(format(new Date(viewYear, monthIndex, 1), 'yyyy-MM'));
    setOpen(false);
  }

  return (
    <div className="my-att-month-picker" ref={rootRef}>
      <div className="my-att-month-control" role="group" aria-label="Month selector">
        <button type="button" className="my-att-month-step" onClick={() => shift(-1)} aria-label="Previous month">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          type="button"
          className={`my-att-month-trigger${open ? ' is-open' : ''}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="my-att-month-ico" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="16" height="16">
              <rect x="3.5" y="5" width="17" height="15" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
              <path d="M8 3.5v3M16 3.5v3M3.5 10h17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </span>
          <span className="my-att-month-label">{format(selected, 'MMMM yyyy')}</span>
          <span className="my-att-month-caret" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="14" height="14">
              <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </button>
        <button type="button" className="my-att-month-step" onClick={() => shift(1)} aria-label="Next month">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {!isCurrentMonth ? (
        <button type="button" className="my-att-month-today" onClick={() => onChange(todayKey)}>
          This month
        </button>
      ) : null}

      {open ? (
        <div className="my-att-month-popover" role="dialog" aria-label="Choose month">
          <div className="my-att-month-popover-head">
            <button type="button" className="my-att-month-step is-ghost" onClick={() => setViewYear((y) => y - 1)} aria-label="Previous year">
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                <path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <strong>{viewYear}</strong>
            <button type="button" className="my-att-month-step is-ghost" onClick={() => setViewYear((y) => y + 1)} aria-label="Next year">
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
          <div className="my-att-month-grid">
            {Array.from({ length: 12 }, (_, i) => {
              const key = format(new Date(viewYear, i, 1), 'yyyy-MM');
              const selectedMonth = key === value;
              const isNow = key === todayKey;
              return (
                <button
                  key={key}
                  type="button"
                  className={[
                    'my-att-month-chip',
                    selectedMonth ? 'is-selected' : '',
                    isNow ? 'is-now' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => pickMonth(i)}
                >
                  {format(new Date(viewYear, i, 1), 'MMM')}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RegularizeAction({ session, onRegularize, className = '' }) {
  if (!session?.canRegularize && !session?.regularizePending) {
    return null;
  }
  if (session.regularizePending) {
    return <span className={`my-att-regularize-pending ${className}`.trim()}>Pending</span>;
  }
  return (
    <button
      type="button"
      className={`btn my-att-regularize-btn my-att-punch-regularize ${className}`.trim()}
      onClick={(e) => {
        e.stopPropagation();
        onRegularize(session);
      }}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="M12 8v4l2.5 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      Regularize
    </button>
  );
}

function PunchStatusBadges({ status, session }) {
  const stillIn = Boolean(session?.stillIn);
  const kind = status?.kind || 'empty';
  const badges = [];

  if (kind === 'late') {
    badges.push({ key: 'late', label: 'Late', tone: 'late', icon: 'late' });
  } else if (kind === 'present') {
    badges.push({ key: 'present', label: 'Present', tone: 'present', icon: 'check' });
  } else if (kind === 'absent') {
    badges.push({ key: 'absent', label: 'Absent', tone: 'absent', icon: 'absent' });
  } else if (kind === 'leave' || kind === 'leave-pending') {
    badges.push({
      key: 'leave',
      label: status?.label || 'Leave',
      tone: 'leave',
      icon: 'leave',
    });
  } else if (kind === 'holiday') {
    badges.push({
      key: 'holiday',
      label: status?.label || 'Holiday',
      tone: 'holiday',
      icon: 'holiday',
    });
  }

  if (stillIn) {
    badges.push({ key: 'progress', label: 'In progress', tone: 'progress', icon: 'dot' });
  }

  if (!badges.length) {
    badges.push({ key: 'empty', label: status?.label || '—', tone: 'empty', icon: null });
  }

  return (
    <div className="my-att-punch-badges">
      {badges.map((badge) => (
        <span key={badge.key} className={`my-att-punch-badge tone-${badge.tone}`}>
          {badge.icon === 'late' ? (
            <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
              <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.8" />
              <path d="M12 8v4l2.5 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          ) : null}
          {badge.icon === 'check' ? (
            <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
              <path
                d="M5.5 12.5l4 4 9-9"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : null}
          {badge.icon === 'absent' ? (
            <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
              <rect x="4" y="5" width="16" height="15" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
              <path d="M8 3.5v3M16 3.5v3M4 10h16M9.5 14.5l5 5M14.5 14.5l-5 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
          ) : null}
          {badge.icon === 'dot' ? <span className="my-att-punch-badge-dot" aria-hidden="true" /> : null}
          {badge.label}
        </span>
      ))}
    </div>
  );
}

function PunchDetailCard({ day, status, session, onRegularize }) {
  const stillIn = Boolean(session?.stillIn);
  const tone =
    status?.kind === 'absent'
      ? 'absent'
      : status?.kind === 'late' || stillIn
        ? 'live'
        : status?.kind === 'present'
          ? 'present'
          : status?.kind === 'leave' || status?.kind === 'leave-pending'
            ? 'leave'
            : status?.kind === 'holiday'
              ? 'holiday'
              : 'neutral';

  const expectedOut = session?.punchIn
    ? expectedLogoutFromPunchIn(session.punchIn, REQUIRED_WORK_MINUTES)
    : null;
  const expectedOutLabel = expectedOut ? formatTime(expectedOut) : null;
  const checkOutLabel = session?.punchOut
    ? formatTime(session.punchOut)
    : stillIn
      ? 'In progress'
      : '—';
  return (
    <li className={`my-att-punch-card tone-${tone}`}>
      <div className="my-att-punch-card-date" aria-hidden="true">
        <strong>{format(day, 'd')}</strong>
        <span>{format(day, 'EEE').toUpperCase()}</span>
      </div>
      <div className="my-att-punch-card-body">
        <PunchStatusBadges status={status} session={session} />
        <div className="my-att-punch-blocks">
          <div className="my-att-punch-block">
            <span className="my-att-punch-block-label">Punch In</span>
            <strong className="my-att-punch-block-value">
              {session?.punchIn ? formatTime(session.punchIn) : '—'}
            </strong>
          </div>
          <div className="my-att-punch-block">
            <span className="my-att-punch-block-label">Check Out</span>
            <strong
              className={`my-att-punch-block-value${
                stillIn && !session?.punchOut ? ' is-progress' : ''
              }`}
            >
              {checkOutLabel}
            </strong>
          </div>
          <div className="my-att-punch-block">
            <span className="my-att-punch-block-label">Expected Out</span>
            <strong
              className={`my-att-punch-block-value${expectedOutLabel ? ' is-expected' : ''}`}
            >
              {expectedOutLabel || '—'}
            </strong>
          </div>
          <div className="my-att-punch-block">
            <span className="my-att-punch-block-label">Total</span>
            <strong
              className={`my-att-punch-block-value${stillIn ? ' is-progress' : ''}`}
            >
              {formatSessionWorkDisplay(session)}
            </strong>
          </div>
        </div>
        {session?.canRegularize || session?.regularizePending ? (
          <div className="my-att-punch-card-action">
            <RegularizeAction session={session} onRegularize={onRegularize} />
          </div>
        ) : null}
      </div>
    </li>
  );
}

function CalendarDayCell({
  day,
  outside,
  isToday,
  isSelected,
  status,
  session,
  todayYmd,
  onRegularize,
  onSelect,
}) {
  const ymd = format(day, 'yyyy-MM-dd');
  const pastOrToday = ymd <= todayYmd;
  const showTooltip = !outside && pastOrToday && status.kind !== 'empty';
  const [open, setOpen] = useState(false);
  const closeTimer = useRef(null);

  function clearCloseTimer() {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }

  function openPanel() {
    if (!showTooltip) return;
    clearCloseTimer();
    setOpen(true);
  }

  function scheduleClose() {
    clearCloseTimer();
    closeTimer.current = setTimeout(() => setOpen(false), 280);
  }

  useEffect(() => () => clearCloseTimer(), []);

  const pillLabel =
    status.kind === 'weekend'
      ? 'WEEKEND'
      : status.kind === 'late'
        ? 'Late'
        : status.kind === 'holiday'
          ? holidayKindLabel(status.holidayKind) || 'Holiday'
          : status.kind === 'present'
            ? 'Present'
            : status.kind === 'absent'
              ? 'Absent'
              : status.kind === 'leave' || status.kind === 'leave-pending'
                ? status.label
                : status.label;

  const workLabel =
    !outside && (status.kind === 'present' || status.kind === 'late')
      ? formatSessionWorkDisplay(session)
      : '';

  return (
    <div
      role={outside ? undefined : 'button'}
      className={[
        'my-att-cal-cell',
        outside ? 'is-outside' : '',
        isToday ? 'is-today' : '',
        isSelected ? 'is-selected' : '',
        status.tone !== 'empty' ? `tone-${status.tone}` : '',
        status.kind === 'weekend' ? 'is-weekend' : '',
        status.holidayKind === 'national' ? 'has-india-flag' : '',
        showTooltip ? 'has-tooltip' : '',
        open ? 'is-open' : '',
        outside ? '' : 'is-clickable',
      ]
        .filter(Boolean)
        .join(' ')}
      onMouseEnter={openPanel}
      onMouseLeave={scheduleClose}
      onFocus={openPanel}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) scheduleClose();
      }}
      onClick={() => {
        if (outside || !onSelect) return;
        onSelect(ymd);
      }}
      onKeyDown={(e) => {
        if (outside || !onSelect) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(ymd);
        }
      }}
      tabIndex={outside ? undefined : 0}
    >
      {status.holidayKind === 'national' && !outside ? (
        <span className="india-flag-backdrop" aria-hidden="true" />
      ) : null}
      <span className="my-att-cal-day">{format(day, 'd')}</span>
      {!outside && pillLabel ? (
        <span className={`my-att-cal-pill tone-${status.tone}`}>{pillLabel}</span>
      ) : null}
      {!outside && status.kind === 'holiday' && status.holidayKind ? (
        <span className={`my-att-cal-holiday-kind is-${status.holidayKind}`} title={status.label}>
          {status.label}
        </span>
      ) : null}
      {!outside && workLabel && workLabel !== '—' ? (
        <span className="my-att-cal-hours">{workLabel}</span>
      ) : null}
      {open && showTooltip ? (
        <div
          className="my-att-cal-tooltip"
          role="tooltip"
          onMouseEnter={openPanel}
          onMouseLeave={scheduleClose}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="my-att-cal-tooltip-head">
            <strong>{format(day, 'EEE, d MMM')}</strong>
            {status.label ? (
              <span className={`my-att-cal-tooltip-pill tone-${status.tone}`}>{status.label}</span>
            ) : null}
          </div>
          {status.kind === 'leave' || status.kind === 'leave-pending' || status.kind === 'holiday' ? (
            <p className="my-att-cal-tooltip-status">{status.label}</p>
          ) : status.kind === 'weekend' ? (
            <p className="my-att-cal-tooltip-status">Non-working day</p>
          ) : (
            <div className="my-att-cal-tooltip-summary">
              <div>
                <span>Punch In</span>
                <strong>{session?.punchIn ? formatTime(session.punchIn) : '—'}</strong>
              </div>
              <div>
                <span>Punch Out</span>
                <strong>
                  {session?.punchOut || session?.stillIn ? (
                    <PunchCheckoutDisplay
                      session={session}
                      formatTime={formatTime}
                      expectedLogoutFromPunchIn={expectedLogoutFromPunchIn}
                      requiredMinutes={REQUIRED_WORK_MINUTES}
                    />
                  ) : (
                    '—'
                  )}
                </strong>
              </div>
              <div>
                <span>Total</span>
                <strong>{formatSessionWorkDisplay(session)}</strong>
              </div>
            </div>
          )}
          {session?.canRegularize ? (
            <RegularizeAction
              session={session}
              onRegularize={(s) => {
                clearCloseTimer();
                setOpen(false);
                onRegularize(s);
              }}
              className="my-att-cal-regularize"
            />
          ) : session?.regularizePending ? (
            <span className="my-att-cal-pending">Regularization pending</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default function MyAttendanceHub() {
  const { user } = useAuth();
  const today = appToday();
  const [month, setMonth] = useState(format(today, 'yyyy-MM'));
  const [sessions, setSessions] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [publishedHolidays, setPublishedHolidays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [regularizeOpen, setRegularizeOpen] = useState(false);
  const [regularizeSession, setRegularizeSession] = useState(null);
  const [selectedDayYmd, setSelectedDayYmd] = useState(() => format(today, 'yyyy-MM-dd'));

  const cursor = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    return new Date(y, m - 1, 1);
  }, [month]);

  const range = useMemo(() => monthRange(month), [month]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const year = Number(month.slice(0, 4));
    try {
      const [attendance, leaveData, holidayData] = await Promise.all([
        api(`/attendance/calendar?from=${range.from}&to=${range.to}`),
        api(`/leaves/calendar?from=${range.from}&to=${range.to}`),
        api(`/holidays?year=${year}`).catch(() => ({ holidays: [] })),
      ]);
      setSessions(attendance.sessions || []);
      setLeaves(leaveData.leaves || []);
      setPublishedHolidays(holidayData.holidays || holidayData.general || []);
    } catch (err) {
      setError(err.message || 'Could not load attendance');
      setSessions([]);
      setLeaves([]);
      setPublishedHolidays([]);
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to, month]);

  usePollWhenVisible(load, 120_000, [load]);

  const filteredLeaves = useMemo(
    () =>
      (leaves || []).filter((leave) => {
        if (leave.isMandatory && (leave.leaveType === 'restricted' || leave.holidayType === 'restricted')) {
          return false;
        }
        if (leave.leaveType === 'restricted' && leave.status !== 'approved') return false;
        return true;
      }),
    [leaves]
  );

  const holidayByDate = useMemo(() => {
    const map = new Map();
    for (const leave of filteredLeaves) {
      if (!isHolidayLeave(leave)) continue;
      const start = parseISO(toYmd(leave.startDate));
      const end = parseISO(toYmd(leave.endDate) || toYmd(leave.startDate));
      if (Number.isNaN(start.getTime())) continue;
      for (const day of eachDayOfInterval({ start, end })) {
        map.set(format(day, 'yyyy-MM-dd'), leave);
      }
    }
    for (const holiday of publishedHolidays || []) {
      // Restricted dates stay off the calendar until the employee has an approved RH leave.
      if (holidayKind(holiday) === 'restricted') continue;
      const startYmd = toYmd(holiday.startDate || holiday.date);
      const endYmd = toYmd(holiday.endDate || holiday.startDate || holiday.date);
      if (!startYmd) continue;
      const start = parseISO(startYmd);
      const end = parseISO(endYmd || startYmd);
      if (Number.isNaN(start.getTime())) continue;
      for (const day of eachDayOfInterval({ start, end })) {
        const key = format(day, 'yyyy-MM-dd');
        if (!map.has(key)) map.set(key, holiday);
      }
    }
    return map;
  }, [filteredLeaves, publishedHolidays]);

  const leavesByDate = useMemo(() => {
    const map = new Map();
    for (const leave of filteredLeaves) {
      if (isHolidayLeave(leave)) continue;
      const start = parseISO(toYmd(leave.startDate));
      const end = parseISO(toYmd(leave.endDate) || toYmd(leave.startDate));
      if (Number.isNaN(start.getTime())) continue;
      for (const day of eachDayOfInterval({ start, end })) {
        const key = format(day, 'yyyy-MM-dd');
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(leave);
      }
    }
    return map;
  }, [filteredLeaves]);

  const sessionsByDate = useMemo(() => {
    const map = new Map();
    for (const session of sessions) {
      if (!session.punchDate) continue;
      map.set(session.punchDate, session);
    }
    return map;
  }, [sessions]);

  const monthDays = useMemo(
    () =>
      eachDayOfInterval({
        start: startOfMonth(cursor),
        end: endOfMonth(cursor),
      }),
    [cursor]
  );

  const weekdaysInMonth = useMemo(
    () => monthDays.filter((day) => !isWeekend(day)).length,
    [monthDays]
  );

  const dayStatuses = useMemo(() => {
    const ctx = { today, sessionsByDate, holidayByDate, leavesByDate };
    const map = new Map();
    for (const day of monthDays) {
      map.set(format(day, 'yyyy-MM-dd'), resolveDayStatus(day, ctx));
    }
    return map;
  }, [monthDays, today, sessionsByDate, holidayByDate, leavesByDate]);

  const stats = useMemo(() => {
    const todayYmd = format(today, 'yyyy-MM-dd');
    let present = 0;
    let absent = 0;
    let late = 0;
    let early = 0;
    let totalWork = 0;
    let workDays = 0;

    for (const day of monthDays) {
      const ymd = format(day, 'yyyy-MM-dd');
      if (ymd > todayYmd) continue;
      const status = dayStatuses.get(ymd);
      if (!status || status.kind === 'weekend' || status.kind === 'holiday') continue;
      if (status.kind === 'leave' || status.kind === 'leave-pending') continue;
      if (status.kind === 'present') present += 1;
      if (status.kind === 'late') late += 1;
      if (status.kind === 'absent') absent += 1;
      if (status.kind === 'present' || status.kind === 'late') {
        if (status.earlyOut) early += 1;
        if (status.session?.workMinutes != null) {
          totalWork += Number(status.session.workMinutes);
          workDays += 1;
        }
      }
    }

    const avgMinutes = workDays ? Math.round(totalWork / workDays) : 0;
    return { present, absent, late, early, avgMinutes, totalWorkMinutes: totalWork, weekdaysInMonth };
  }, [monthDays, today, dayStatuses, weekdaysInMonth]);

  const leaveDaysInMonth = useMemo(() => {
    const todayYmd = format(today, 'yyyy-MM-dd');
    let onLeave = 0;
    for (const day of monthDays) {
      const ymd = format(day, 'yyyy-MM-dd');
      if (ymd > todayYmd) continue;
      const status = dayStatuses.get(ymd);
      if (status?.kind === 'leave' || status?.kind === 'leave-pending') onLeave += 1;
    }
    return onLeave;
  }, [monthDays, today, dayStatuses]);

  const nextHolidayLabel = useMemo(() => {
    const todayYmd = format(today, 'yyyy-MM-dd');
    const fromMap = [...holidayByDate.entries()]
      .filter(([ymd]) => ymd >= todayYmd)
      .sort((a, b) => a[0].localeCompare(b[0]));
    if (fromMap.length) {
      return format(parseISO(fromMap[0][0]), 'MMM d');
    }
    const upcoming = [...(publishedHolidays || [])]
      .filter((h) => holidayKind(h) !== 'restricted')
      .map((h) => toYmd(h.startDate))
      .filter((ymd) => ymd && ymd >= todayYmd)
      .sort((a, b) => a.localeCompare(b));
    if (!upcoming.length) return null;
    return format(parseISO(upcoming[0]), 'MMM d');
  }, [holidayByDate, publishedHolidays, today]);

  const calendarCells = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: WEEK_STARTS_ON });
    const end = endOfWeek(endOfMonth(cursor), { weekStartsOn: WEEK_STARTS_ON });
    return eachDayOfInterval({ start, end });
  }, [cursor]);

  const todayYmd = format(today, 'yyyy-MM-dd');

  useEffect(() => {
    // Keep selection inside the visible month; default to today when possible.
    if (selectedDayYmd.startsWith(month)) return;
    if (todayYmd.startsWith(month)) {
      setSelectedDayYmd(todayYmd);
      return;
    }
    setSelectedDayYmd(`${month}-01`);
  }, [month, selectedDayYmd, todayYmd]);

  const selectedDay = useMemo(() => {
    const parsed = parseISO(selectedDayYmd);
    if (Number.isNaN(parsed.getTime())) return today;
    return parsed;
  }, [selectedDayYmd, today]);

  const selectedPunch = useMemo(() => {
    const status = dayStatuses.get(selectedDayYmd) || { tone: 'empty', label: '', kind: 'empty' };
    const session = sessionsByDate.get(selectedDayYmd) || null;
    return { day: selectedDay, ymd: selectedDayYmd, status, session };
  }, [dayStatuses, sessionsByDate, selectedDay, selectedDayYmd]);

  function exportMonth() {
    downloadPunchesExcel(sessions, `attendance-${month}.xlsx`);
  }

  function openRegularize(session) {
    setRegularizeSession(session);
    setRegularizeOpen(true);
  }

  return (
    <div className="my-att">
      <header className="my-att-head">
        <div className="my-att-head-actions">
          <MonthPicker value={month} onChange={setMonth} today={today} />
          <button type="button" className="btn secondary my-att-export" onClick={exportMonth} disabled={!sessions.length}>
            Export
          </button>
        </div>
      </header>

      {error && <p className="form-error">{error}</p>}
      {loading && <p className="muted">Loading attendance…</p>}

      <div className="my-att-kpis">
        <KpiCard
          tone="present"
          label="Days Present"
          value={`${stats.present} / ${stats.weekdaysInMonth}`}
          sub="Days"
          spark="✓"
        />
        <KpiCard
          tone="absent"
          label="Absent"
          value={`${stats.absent} / ${stats.weekdaysInMonth}`}
          sub="Days"
          spark="!"
        />
        <KpiCard
          tone="late"
          label="Late Arrivals"
          value={`${stats.late} / ${stats.weekdaysInMonth}`}
          sub="Days"
          spark="⏰"
        />
        <KpiCard
          tone="early"
          label="Early Departures"
          value={`${stats.early} / ${stats.weekdaysInMonth}`}
          sub="Days"
          spark="↩"
        />
        <KpiCard
          tone="hours"
          label="Avg. Working Hours"
          value={formatWorkHours(stats.avgMinutes)}
          sub="/ Day"
          spark="⏱"
        />
      </div>

      <div className="my-att-body">
        <section className="my-att-panel my-att-calendar-panel">
          <div className="my-att-cal-board">
            <div className="my-att-cal-board-head">
              <h2 className="my-att-cal-title">{format(cursor, 'MMMM yyyy')}</h2>
              <ul className="my-att-legend" aria-label="Attendance legend">
                <li><span className="dot present" /> Present</li>
                <li><span className="dot late" /> Late</li>
                <li><span className="dot absent" /> Absent</li>
                <li><span className="dot leave" /> Leave</li>
                <li><span className="dot holiday" /> Regional</li>
                <li><span className="dot national" /> National</li>
                <li><span className="dot restricted-holiday" /> Restricted</li>
                <li><span className="dot weekend" /> Weekend</li>
              </ul>
            </div>

            <div className="my-att-cal-grid head">
              {DOW_LABELS.map((label) => (
                <div key={label} className="my-att-cal-dow">
                  {label}
                </div>
              ))}
            </div>

            <div className="my-att-cal-grid body">
              {calendarCells.map((day) => {
                const ymd = format(day, 'yyyy-MM-dd');
                const outside = !isSameMonth(day, cursor);
                const status = dayStatuses.get(ymd) || { tone: 'empty', label: '', kind: 'empty' };
                const isToday = isSameDay(day, today);
                const session = sessionsByDate.get(ymd);
                return (
                  <CalendarDayCell
                    key={ymd}
                    day={day}
                    outside={outside}
                    isToday={isToday}
                    isSelected={ymd === selectedDayYmd}
                    status={status}
                    session={session}
                    todayYmd={todayYmd}
                    onRegularize={openRegularize}
                    onSelect={setSelectedDayYmd}
                  />
                );
              })}
            </div>

            <footer className="my-att-cal-glance">
              <div className="my-att-cal-glance-main">
                <strong>Stats at a Glance</strong>
                <span>
                  Present: {stats.present}
                  <em aria-hidden="true">|</em>
                  Absent: {stats.absent}
                  <em aria-hidden="true">|</em>
                  On Leave: {leaveDaysInMonth}
                  <em aria-hidden="true">|</em>
                  Hours: {formatWorkHours(stats.totalWorkMinutes)}
                </span>
              </div>
              <div className="my-att-cal-glance-next">
                Next Holiday:{' '}
                <strong>{nextHolidayLabel || '—'}</strong>
              </div>
            </footer>
          </div>
        </section>

        <aside className="my-att-sidebar">
          <section className="my-att-panel my-att-punch-details">
            <div className="my-att-punch-details-head">
              <div className="my-att-punch-details-title">
                <span className="my-att-punch-details-ico" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="18" height="18">
                    <rect
                      x="3.5"
                      y="5"
                      width="17"
                      height="15"
                      rx="2.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                    />
                    <path
                      d="M8 3.5v3M16 3.5v3M3.5 10h17"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />
                  </svg>
                </span>
                <div>
                  <h2>Daily Punch Details</h2>
                  <p className="my-att-emp-meta">{format(selectedDay, 'EEE, d MMM yyyy')}</p>
                </div>
              </div>
              <label className="sr-only" htmlFor="my-att-punch-month">
                Month
              </label>
              <select
                id="my-att-punch-month"
                className="my-att-punch-month-select"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
              >
                {Array.from({ length: 12 }, (_, i) => {
                  const d = addMonths(startOfMonth(today), i - 8);
                  const value = format(d, 'yyyy-MM');
                  return (
                    <option key={value} value={value}>
                      {format(d, 'MMMM yyyy')}
                    </option>
                  );
                })}
              </select>
            </div>
            <ul className="my-att-punch-list is-single">
              <PunchDetailCard
                day={selectedPunch.day}
                status={selectedPunch.status}
                session={selectedPunch.session}
                onRegularize={openRegularize}
              />
            </ul>
            <div className="my-att-punch-summary">
              <div className="my-att-punch-summary-item">
                <span className="my-att-punch-summary-ico is-hours" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="18" height="18">
                    <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.8" />
                    <path d="M12 8v4l2.5 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                </span>
                <div className="my-att-punch-summary-copy">
                  <span>Total hours worked</span>
                  <strong>{formatWorkHours(stats.totalWorkMinutes)}</strong>
                </div>
              </div>
              <div className="my-att-punch-summary-item">
                <span className="my-att-punch-summary-ico is-avg" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="18" height="18">
                    <path
                      d="M5 19V10M10 19V5M15 19v-7M20 19V8"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />
                  </svg>
                </span>
                <div className="my-att-punch-summary-copy">
                  <span>Avg. per day</span>
                  <strong>{formatWorkHours(stats.avgMinutes)}</strong>
                </div>
              </div>
            </div>
          </section>
        </aside>
      </div>

      {user?.role === 'user' ? (
        <RegularizeRequestModal
          open={regularizeOpen}
          onClose={() => {
            setRegularizeOpen(false);
            setRegularizeSession(null);
          }}
          defaultDate={regularizeSession?.punchDate || todayYmd}
          currentIn={stampToTime(regularizeSession?.punchIn)}
          currentOut={stampToTime(regularizeSession?.punchOut)}
          onSubmitted={() => {
            setRegularizeOpen(false);
            setRegularizeSession(null);
            load();
          }}
        />
      ) : null}
    </div>
  );
}
