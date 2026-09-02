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
  parseAppDateTime,
  punchInLateness,
  toYmd,
} from '../utils';

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
    return {
      tone: 'holiday',
      label: 'Holiday',
      kind: 'holiday',
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
    return <span className={`my-att-regularize-empty ${className}`.trim()}>—</span>;
  }
  if (session.regularizePending) {
    return <span className={`my-att-regularize-pending ${className}`.trim()}>Pending</span>;
  }
  return (
    <button
      type="button"
      className={`btn primary my-att-regularize-btn ${className}`.trim()}
      onClick={(e) => {
        e.stopPropagation();
        onRegularize(session);
      }}
    >
      Regularize
    </button>
  );
}

function CalendarDayCell({ day, outside, isToday, status, session, todayYmd, onRegularize }) {
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
        : status.kind === 'leave' || status.kind === 'leave-pending'
          ? 'Leave'
          : status.kind === 'holiday'
            ? 'Holiday'
            : status.label;

  const workLabel =
    !outside && (status.kind === 'present' || status.kind === 'late')
      ? formatSessionWorkDisplay(session)
      : '';

  return (
    <div
      className={[
        'my-att-cal-cell',
        outside ? 'is-outside' : '',
        isToday ? 'is-today' : '',
        status.tone !== 'empty' ? `tone-${status.tone}` : '',
        status.kind === 'weekend' ? 'is-weekend' : '',
        showTooltip ? 'has-tooltip' : '',
        open ? 'is-open' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onMouseEnter={openPanel}
      onMouseLeave={scheduleClose}
      onFocus={openPanel}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) scheduleClose();
      }}
      tabIndex={showTooltip ? 0 : undefined}
    >
      <span className="my-att-cal-day">{format(day, 'd')}</span>
      {!outside && pillLabel ? (
        <span className={`my-att-cal-pill tone-${status.tone}`}>{pillLabel}</span>
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
                  {session?.punchOut
                    ? formatTime(session.punchOut)
                    : session?.stillIn
                      ? 'Still in'
                      : '—'}
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

  usePollWhenVisible(load, 60_000, [load]);

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
    return map;
  }, [filteredLeaves]);

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
  const historyRows = useMemo(() => {
    return [...monthDays]
      .reverse()
      .filter((day) => format(day, 'yyyy-MM-dd') <= todayYmd)
      .map((day) => {
        const ymd = format(day, 'yyyy-MM-dd');
        const status = dayStatuses.get(ymd);
        const session = sessionsByDate.get(ymd);
        return { day, ymd, status, session };
      })
      .filter((row) => row.status?.kind !== 'empty' && row.status?.kind !== 'weekend');
  }, [monthDays, todayYmd, dayStatuses, sessionsByDate]);

  const punchDetailRows = useMemo(() => historyRows.slice(0, 12), [historyRows]);

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
                <li><span className="dot holiday" /> Holiday</li>
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
                    status={status}
                    session={session}
                    todayYmd={todayYmd}
                    onRegularize={openRegularize}
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
            <div className="my-att-panel-head">
              <div>
                <h2>Daily Punch Details</h2>
                <p className="my-att-emp-meta">{format(cursor, 'MMMM yyyy')}</p>
              </div>
            </div>
            {!punchDetailRows.length ? (
              <p className="empty">No punch records for this month yet.</p>
            ) : (
              <ul className="my-att-punch-list">
                {punchDetailRows.map(({ day, ymd, status, session }) => (
                  <li key={ymd} className="my-att-punch-row">
                    <div className="my-att-punch-date">
                      <strong>{format(day, 'd')}</strong>
                      <span>{format(day, 'EEE').toUpperCase()}</span>
                    </div>
                    <span className={`my-att-status-pill tone-${status?.tone || 'empty'}`}>
                      {status?.kind === 'late'
                        ? 'Late'
                        : status?.kind === 'leave' || status?.kind === 'leave-pending'
                          ? 'Leave'
                          : status?.label || '—'}
                    </span>
                    <div className="my-att-punch-metrics">
                      <div>
                        <strong>{session?.punchIn ? formatTime(session.punchIn) : '—'}</strong>
                        <span>Punch In</span>
                      </div>
                      <div>
                        <strong>
                          {session?.punchOut
                            ? formatTime(session.punchOut)
                            : session?.stillIn
                              ? 'Still in'
                              : '—'}
                        </strong>
                        <span>Punch Out</span>
                      </div>
                      <div>
                        <strong>{formatSessionWorkDisplay(session)}</strong>
                        <span>Total</span>
                      </div>
                    </div>
                    {session?.canRegularize || session?.regularizePending ? (
                      <div className="my-att-punch-action">
                        <RegularizeAction session={session} onRegularize={openRegularize} />
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            <div className="my-att-total-hours">
              <span>Total hours worked</span>
              <strong>{formatWorkHours(stats.totalWorkMinutes)}</strong>
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
