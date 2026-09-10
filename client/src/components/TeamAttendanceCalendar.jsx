import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { createPortal } from 'react-dom';
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
import { getPortalRoot } from '../portalRoot';
import {
  APPLY_LABELS,
  REQUEST_LABELS,
  SESSION_LABELS,
  appToday,
  avatarSrc,
  formatDate,
  formatTime,
  punchInLateness,
  toYmd,
} from '../utils';

const WEEK_STARTS_ON = 1;
const DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const ON_TIME_CUTOFF_MINUTES = 11 * 60 + 30;
const AVATAR_TONES = 6;

const SCOPE_LINKS = {
  hr: { attendance: '/hr/muster', approvals: '/hr/approvals' },
  manager: { attendance: '/manager/muster', approvals: '/manager/approvals' },
};

function leaveTypeLabel(type) {
  return REQUEST_LABELS[type] || type || 'Leave';
}

function personInitials(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function avatarTone(seed) {
  const s = String(seed || '');
  let hash = 0;
  for (let i = 0; i < s.length; i += 1) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return hash % AVATAR_TONES;
}

function formatLateByLabel(punchIn) {
  const lateness = punchInLateness(punchIn);
  if (lateness !== 'late' && lateness !== 'very-late') return null;

  let minutesOfDay = null;
  const parsed = new Date(punchIn);
  if (!Number.isNaN(parsed.getTime())) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(parsed);
    const hour = Number(parts.find((p) => p.type === 'hour')?.value);
    const minute = Number(parts.find((p) => p.type === 'minute')?.value);
    if (!Number.isNaN(hour) && !Number.isNaN(minute)) minutesOfDay = hour * 60 + minute;
  } else {
    const match = String(punchIn || '').match(/(?:^|\s)(\d{1,2}):(\d{2})(?::\d{2})?\s*$/);
    if (match) minutesOfDay = Number(match[1]) * 60 + Number(match[2]);
  }

  if (minutesOfDay == null) return 'Late';
  const lateMins = Math.max(0, minutesOfDay - ON_TIME_CUTOFF_MINUTES);
  if (lateMins <= 0) return 'Late';
  const h = Math.floor(lateMins / 60);
  const m = lateMins % 60;
  if (h > 0 && m > 0) return `Late by ${h}h ${String(m).padStart(2, '0')}m`;
  if (h > 0) return `Late by ${h}h`;
  return `Late by ${m}m`;
}

function CalendarHeadIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
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
  );
}

function PunchInMetricIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        d="M10 12h9M15.5 8.5 19 12l-3.5 3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M13 5.5H7.5A2.5 2.5 0 0 0 5 8v8a2.5 2.5 0 0 0 2.5 2.5H13"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PunchOutMetricIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        d="M14 12H5M9.5 8.5 6 12l3.5 3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M11 5.5h5.5A2.5 2.5 0 0 1 19 8v8a2.5 2.5 0 0 1-2.5 2.5H11"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function TotalHoursMetricIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 8v4l2.8 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function MoreMenuIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <circle cx="12" cy="5" r="1.6" fill="currentColor" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
      <circle cx="12" cy="19" r="1.6" fill="currentColor" />
    </svg>
  );
}

function TeamPunchDetailCard({ session, musterTo }) {
  const name = session.userName || 'Unmapped';
  const idLabel = session.employeeNumber || session.deviceUserCode || '—';
  const lateBy = session.punchIn ? formatLateByLabel(session.punchIn) : null;
  const isLate = Boolean(session.late || lateBy);
  const stillIn = Boolean(session.stillIn);
  const photo = session.profilePhoto ? avatarSrc(session.profilePhoto) : null;
  const tone = avatarTone(session.userId || session.deviceUserCode || name);

  return (
    <li className="team-att-dpc-card">
      <div className="team-att-dpc-top">
        <div className="team-att-dpc-who">
          {photo ? (
            <img className="team-att-dpc-avatar is-photo" src={photo} alt="" />
          ) : (
            <span className={`team-att-dpc-avatar tone-${tone}`}>{personInitials(name)}</span>
          )}
          <div className="team-att-dpc-identity">
            <div className="team-att-dpc-name-row">
              <strong>{name}</strong>
              <div className="team-att-dpc-badges">
                {isLate ? (
                  <span className="team-att-dpc-badge tone-late">
                    <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
                      <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.8" />
                      <path d="M12 8v4l2.5 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    </svg>
                    Late
                  </span>
                ) : null}
                {stillIn ? (
                  <span className="team-att-dpc-badge tone-progress">
                    <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
                      <circle cx="5" cy="12" r="1.6" fill="currentColor" />
                      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
                      <circle cx="19" cy="12" r="1.6" fill="currentColor" />
                    </svg>
                    In Progress
                  </span>
                ) : null}
                {!isLate && !stillIn ? (
                  <span className="team-att-dpc-badge tone-present">Present</span>
                ) : null}
              </div>
            </div>
            <span>
              {idLabel}
              {session.department ? ` • ${session.department}` : ''}
            </span>
          </div>
        </div>
        <Link
          className="team-att-dpc-more"
          to={musterTo}
          aria-label={`Open muster for ${name}`}
          title="Open muster"
        >
          <MoreMenuIcon />
        </Link>
      </div>

      <div className="team-att-dpc-metrics" role="group" aria-label="Punch metrics">
        <div className="team-att-dpc-metric">
          <span className="team-att-dpc-metric-ico is-in" aria-hidden="true">
            <PunchInMetricIcon />
          </span>
          <div className="team-att-dpc-metric-copy">
            <span className="team-att-dpc-metric-label">Punch In</span>
            <strong className="team-att-dpc-metric-value">
              {session.punchIn ? formatTime(session.punchIn) : '—'}
            </strong>
            {lateBy ? <em className="team-att-dpc-chip tone-late">{lateBy}</em> : null}
          </div>
        </div>

        <div className="team-att-dpc-metric">
          <span className="team-att-dpc-metric-ico is-out" aria-hidden="true">
            <PunchOutMetricIcon />
          </span>
          <div className="team-att-dpc-metric-copy">
            <span className="team-att-dpc-metric-label">Punch Out</span>
            {session.punchOut ? (
              <strong className="team-att-dpc-metric-value">{formatTime(session.punchOut)}</strong>
            ) : stillIn ? (
              <em className="team-att-dpc-chip tone-progress">In progress •••</em>
            ) : (
              <strong className="team-att-dpc-metric-value">—</strong>
            )}
          </div>
        </div>

        <div className="team-att-dpc-metric">
          <span className="team-att-dpc-metric-ico is-total" aria-hidden="true">
            <TotalHoursMetricIcon />
          </span>
          <div className="team-att-dpc-metric-copy">
            <span className="team-att-dpc-metric-label">Total Hours</span>
            {session.workHours ? (
              <strong className="team-att-dpc-metric-value">{session.workHours}</strong>
            ) : stillIn ? (
              <strong className="team-att-dpc-metric-value">In progress</strong>
            ) : (
              <strong className="team-att-dpc-metric-value">—</strong>
            )}
          </div>
        </div>
      </div>
    </li>
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

  function shift(dir) {
    onChange(format(dir > 0 ? addMonths(selected, 1) : subMonths(selected, 1), 'yyyy-MM'));
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
          <span className="my-att-month-label">{format(selected, 'MMMM yyyy')}</span>
        </button>
        <button type="button" className="my-att-month-step" onClick={() => shift(1)} aria-label="Next month">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      {value !== todayKey ? (
        <button type="button" className="my-att-month-today" onClick={() => onChange(todayKey)}>
          This month
        </button>
      ) : null}
      {open ? (
        <div className="my-att-month-popover" role="dialog" aria-label="Choose month">
          <div className="my-att-month-popover-head">
            <button type="button" className="my-att-month-step is-ghost" onClick={() => setViewYear((y) => y - 1)} aria-label="Previous year">
              ‹
            </button>
            <strong>{viewYear}</strong>
            <button type="button" className="my-att-month-step is-ghost" onClick={() => setViewYear((y) => y + 1)} aria-label="Next year">
              ›
            </button>
          </div>
          <div className="my-att-month-grid">
            {Array.from({ length: 12 }, (_, i) => {
              const key = format(new Date(viewYear, i, 1), 'yyyy-MM');
              return (
                <button
                  key={key}
                  type="button"
                  className={[
                    'my-att-month-chip',
                    key === value ? 'is-selected' : '',
                    key === todayKey ? 'is-now' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => {
                    onChange(key);
                    setOpen(false);
                  }}
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

function DayCard({ day, outside, isToday, selected, stats, todayYmd, onSelect }) {
  const ymd = format(day, 'yyyy-MM-dd');
  const weekend = isWeekend(day);
  const pastOrToday = ymd <= todayYmd;
  const hasData = !outside && pastOrToday && stats;
  const [tipOpen, setTipOpen] = useState(false);
  const closeTimer = useRef(null);

  const present = stats?.present ?? 0;
  const absent = stats?.absent ?? 0;
  const onLeave = stats?.onLeave ?? 0;
  const late = stats?.late ?? 0;
  const quietWeekend = weekend && present === 0 && onLeave === 0;
  const showMetrics = hasData && !quietWeekend;
  const clickable = !outside && pastOrToday;

  function clearCloseTimer() {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }

  function openTip() {
    if (!hasData) return;
    clearCloseTimer();
    setTipOpen(true);
  }

  function scheduleClose() {
    clearCloseTimer();
    closeTimer.current = setTimeout(() => setTipOpen(false), 280);
  }

  useEffect(() => () => clearCloseTimer(), []);

  return (
    <div
      className={[
        'team-att-day',
        outside ? 'is-outside' : '',
        isToday ? 'is-today' : '',
        weekend && !outside ? 'is-weekend' : '',
        selected ? 'is-selected' : '',
        clickable ? 'is-clickable' : '',
        tipOpen ? 'is-open' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-pressed={clickable ? selected : undefined}
      onClick={() => clickable && onSelect(ymd)}
      onKeyDown={(e) => {
        if (!clickable) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(ymd);
        }
      }}
      onMouseEnter={openTip}
      onMouseLeave={scheduleClose}
      onFocus={openTip}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) scheduleClose();
      }}
    >
      <div className="team-att-day-top">
        <span className="team-att-day-num">{format(day, 'd')}</span>
        {!outside && quietWeekend ? <span className="team-att-pill tone-weekend">Weekend</span> : null}
      </div>

      {showMetrics ? (
        <div className="team-att-day-stats">
          <span className="team-att-pill tone-present">Present {present}</span>
          <span className="team-att-pill tone-absent">Absent {absent}</span>
          <span className="team-att-pill tone-leave">Leave {onLeave}</span>
        </div>
      ) : null}

      {tipOpen && hasData ? (
        <div
          className="team-att-tip"
          role="tooltip"
          onMouseEnter={openTip}
          onMouseLeave={scheduleClose}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="team-att-tip-head">
            <strong>{format(day, 'EEE, d MMM')}</strong>
          </div>
          {quietWeekend ? (
            <p className="team-att-tip-status">Non-working day</p>
          ) : (
            <div className="team-att-tip-grid">
              <div><span>Present</span><strong>{present}</strong></div>
              <div><span>Absent</span><strong>{absent}</strong></div>
              <div><span>On leave</span><strong>{onLeave}</strong></div>
              <div><span>Late</span><strong>{late}</strong></div>
            </div>
          )}
          <p className="team-att-tip-hint">Click for punch board & leave list</p>
        </div>
      ) : null}
    </div>
  );
}

export default function TeamAttendanceCalendar({
  scope = 'hr',
  employees = [],
  canManage = false,
  onCreateLeave = null,
}) {
  const links = SCOPE_LINKS[scope] || SCOPE_LINKS.hr;
  const today = appToday();
  const todayYmd = toYmd(today);
  const [month, setMonth] = useState(format(today, 'yyyy-MM'));
  const [date, setDate] = useState(todayYmd);
  const [location, setLocation] = useState('');
  const [department, setDepartment] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createErr, setCreateErr] = useState('');
  const [createForm, setCreateForm] = useState({
    userId: '',
    leaveType: 'casual',
    startDate: '',
    endDate: '',
    session: 'full',
    reason: '',
  });

  const canCreate = canManage && typeof onCreateLeave === 'function';
  const cursor = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    return new Date(y, m - 1, 1);
  }, [month]);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ date });
    if (location) params.set('location', location);
    if (department) params.set('department', department);
    const res = await api(`/attendance/overview?${params}`);
    setData(res.overview);
  }, [date, location, department]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    load()
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Could not load attendance info');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') load().catch(() => {});
    }, 180_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [load]);

  function handleMonthChange(nextMonth) {
    setMonth(nextMonth);
    const [y, m] = nextMonth.split('-').map(Number);
    const monthEnd = format(endOfMonth(new Date(y, m - 1, 1)), 'yyyy-MM-dd');
    const nextDate = nextMonth === format(today, 'yyyy-MM') ? todayYmd : monthEnd;
    setDate(nextDate > todayYmd ? todayYmd : nextDate);
  }

  function openCreate(dayKey = date) {
    setCreateErr('');
    setCreateForm({
      userId: employees[0] ? String(employees[0].id) : '',
      leaveType: 'casual',
      startDate: dayKey,
      endDate: dayKey,
      session: 'full',
      reason: '',
    });
    setShowCreate(true);
  }

  async function submitCreate(e) {
    e.preventDefault();
    if (!canCreate) return;
    setCreateBusy(true);
    setCreateErr('');
    try {
      const startDate = toYmd(createForm.startDate);
      const endDate = createForm.session !== 'full' ? startDate : toYmd(createForm.endDate || startDate);
      await onCreateLeave({
        ...createForm,
        userId: Number(createForm.userId),
        startDate,
        endDate,
      });
      setShowCreate(false);
      await load();
    } catch (err) {
      setCreateErr(err.message || 'Could not create leave');
    } finally {
      setCreateBusy(false);
    }
  }

  const trendByDate = useMemo(() => {
    const map = new Map();
    for (const row of data?.trend || []) map.set(row.date, row);
    return map;
  }, [data?.trend]);

  const calendarCells = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: WEEK_STARTS_ON });
    const end = endOfWeek(endOfMonth(cursor), { weekStartsOn: WEEK_STARTS_ON });
    return eachDayOfInterval({ start, end });
  }, [cursor]);

  const kpis = data?.kpis;
  const dayPunches = data?.dayPunches || data?.recentPunches || [];
  const dayLeaves = data?.dayLeaves || [];
  const dayNotPunched = data?.dayNotPunched || [];
  const dayReady = data?.date === date;
  const selectedDay = useMemo(() => {
    try {
      return parseISO(date);
    } catch {
      return today;
    }
  }, [date, today]);

  const portal = getPortalRoot();

  return (
    <div className="team-att">
      <header className="team-att-head">
        <div>
          <h2>Attendance info</h2>
          <p className="muted">Month calendar — hover for counts, click a day for punch board and leave list.</p>
        </div>
        <div className="team-att-filters">
          <MonthPicker value={month} onChange={handleMonthChange} today={today} />
          <label>
            Location
            <select value={location} onChange={(e) => setLocation(e.target.value)}>
              <option value="">All locations</option>
              {(data?.filters?.locations || []).map((loc) => (
                <option key={loc} value={loc}>{loc}</option>
              ))}
            </select>
          </label>
          <label>
            Department
            <select value={department} onChange={(e) => setDepartment(e.target.value)}>
              <option value="">All departments</option>
              {(data?.filters?.departments || []).map((dept) => (
                <option key={dept} value={dept}>{dept}</option>
              ))}
            </select>
          </label>
        </div>
      </header>

      {error && <p className="form-error">{error}</p>}
      {loading && !data && <p className="muted">Loading attendance…</p>}

      {kpis && (
        <div className="team-att-kpis">
          <article className="team-att-kpi tone-present">
            <span>Present</span>
            <strong>{dayReady ? kpis.present : '—'}</strong>
            <em>{formatDate(date)}</em>
          </article>
          <article className="team-att-kpi tone-absent">
            <span>Absent</span>
            <strong>{dayReady ? kpis.absent : '—'}</strong>
          </article>
          <article className="team-att-kpi tone-leave">
            <span>On leave</span>
            <strong>{dayReady ? kpis.onLeave : '—'}</strong>
          </article>
          <article className="team-att-kpi tone-late">
            <span>Late</span>
            <strong>{dayReady ? kpis.late : '—'}</strong>
          </article>
          <article className="team-att-kpi tone-wfh">
            <span>WFH</span>
            <strong>{dayReady ? kpis.wfh : '—'}</strong>
          </article>
        </div>
      )}

      {data && (
        <div className="team-att-body">
          <section className="team-att-panel team-att-cal-panel">
            <div className="team-att-cal-head">
              <div className="team-att-cal-head-left">
                {canCreate ? (
                  <button type="button" className="btn primary team-att-add" onClick={() => openCreate(date)}>
                    Add leave
                  </button>
                ) : null}
                <h3>{format(cursor, 'MMMM yyyy')}</h3>
              </div>
              <ul className="team-att-legend" aria-label="Attendance legend">
                <li><i className="present" /> Present</li>
                <li><i className="absent" /> Absent</li>
                <li><i className="leave" /> Leave</li>
                <li><i className="late" /> Late</li>
                <li><i className="weekend" /> Weekend</li>
              </ul>
            </div>

            <div className="team-att-grid head">
              {DOW_LABELS.map((label) => (
                <div key={label} className="team-att-dow">{label}</div>
              ))}
            </div>

            <div className="team-att-grid body">
              {calendarCells.map((day) => {
                const ymd = format(day, 'yyyy-MM-dd');
                return (
                  <DayCard
                    key={ymd}
                    day={day}
                    outside={!isSameMonth(day, cursor)}
                    isToday={isSameDay(day, today)}
                    selected={ymd === date}
                    stats={trendByDate.get(ymd)}
                    todayYmd={todayYmd}
                    onSelect={setDate}
                  />
                );
              })}
            </div>

            <footer className="team-att-glance">
              <div>
                <strong>Stats at a Glance</strong>
                <span>
                  Present: {dayReady ? (kpis?.present ?? 0) : '—'}
                  <em>|</em>
                  Absent: {dayReady ? (kpis?.absent ?? 0) : '—'}
                  <em>|</em>
                  On Leave: {dayReady ? (kpis?.onLeave ?? 0) : '—'}
                  <em>|</em>
                  Late: {dayReady ? (kpis?.late ?? 0) : '—'}
                </span>
              </div>
              <div>
                Selected: <strong>{formatDate(date)}</strong>
              </div>
            </footer>
          </section>

          <aside className="team-att-aside">
            <section className="team-att-panel team-att-dpc">
              <div className="team-att-dpc-head">
                <div className="team-att-dpc-title">
                  <span className="team-att-dpc-title-ico" aria-hidden="true">
                    <CalendarHeadIcon />
                  </span>
                  <div>
                    <h3>Daily Punch Details</h3>
                    <p>{format(selectedDay, 'EEEE, d MMMM yyyy')}</p>
                  </div>
                </div>
                <Link className="team-att-dpc-muster" to={`${links.attendance}?date=${date}`}>
                  Open muster
                  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                    <path
                      d="M7 10l5 5 5-5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </Link>
              </div>

              {!dayReady ? (
                <p className="muted">Loading day details…</p>
              ) : !dayPunches.length ? (
                <p className="empty">No punches recorded for this day.</p>
              ) : (
                <ul className="team-att-dpc-list">
                  {dayPunches.map((session) => (
                    <TeamPunchDetailCard
                      key={`${session.userId || session.deviceUserCode}-${session.id}`}
                      session={session}
                      musterTo={`${links.attendance}?date=${date}`}
                    />
                  ))}
                </ul>
              )}
            </section>

            <section className="team-att-panel">
              <div className="team-att-panel-head">
                <div>
                  <h3>Not punched in</h3>
                  <p>
                    {dayReady && dayNotPunched.length
                      ? `${dayNotPunched.length} people · ${formatDate(date)}`
                      : formatDate(date)}
                  </p>
                </div>
              </div>

              {!dayReady ? (
                <p className="muted">Loading…</p>
              ) : !dayNotPunched.length ? (
                <p className="empty">Everyone expected has punched in or is on leave.</p>
              ) : (
                <ul className="team-att-leave-list team-att-absent-list">
                  {dayNotPunched.map((row) => (
                    <li key={row.userId}>
                      <div className="team-att-person">
                        <img src={avatarSrc(null)} alt="" />
                        <div>
                          <strong>{row.userName}</strong>
                          <span>
                            {row.employeeNumber || '—'}
                            {row.department ? ` · ${row.department}` : ''}
                          </span>
                        </div>
                      </div>
                      <span className="team-att-pill tone-absent">Not punched in</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="team-att-panel">
              <div className="team-att-panel-head">
                <div>
                  <h3>On leave</h3>
                  <p>
                    {dayReady && dayLeaves.length
                      ? `${dayLeaves.length} people · ${formatDate(date)}`
                      : formatDate(date)}
                  </p>
                </div>
                {canCreate ? (
                  <button type="button" className="btn secondary team-att-add-sm" onClick={() => openCreate(date)}>
                    Add leave
                  </button>
                ) : (
                  <Link to={links.approvals}>Approvals</Link>
                )}
              </div>

              {!dayReady ? (
                <p className="muted">Loading leave list…</p>
              ) : !dayLeaves.length ? (
                <p className="empty">Nobody on leave for this day.</p>
              ) : (
                <ul className="team-att-leave-list">
                  {dayLeaves.map((row) => (
                    <li key={`${row.userId}-${row.leaveType}-${row.startDate}`}>
                      <div className="team-att-person">
                        <img src={avatarSrc(null)} alt="" />
                        <div>
                          <strong>{row.userName}</strong>
                          <span>
                            {row.employeeNumber || '—'}
                            {row.department ? ` · ${row.department}` : ''}
                          </span>
                        </div>
                      </div>
                      <div className="team-att-leave-meta">
                        <span className={`team-att-pill tone-leave${row.leaveType === 'wfh' ? ' is-wfh' : ''}`}>
                          {leaveTypeLabel(row.leaveType)}
                        </span>
                        {row.session && row.session !== 'full' ? (
                          <em>{SESSION_LABELS[row.session] || row.session}</em>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </aside>
        </div>
      )}

      {showCreate && portal
        ? createPortal(
            <div className="modal-backdrop" onClick={() => setShowCreate(false)}>
              <div
                className="modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="team-att-create-title"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="row-between">
                  <h2 id="team-att-create-title">Add leave</h2>
                  <button type="button" className="btn ghost" onClick={() => setShowCreate(false)}>
                    Close
                  </button>
                </div>
                <form className="stack-form" onSubmit={submitCreate}>
                  <label>
                    Employee
                    <select
                      value={createForm.userId}
                      onChange={(e) => setCreateForm((f) => ({ ...f, userId: e.target.value }))}
                      required
                    >
                      <option value="">Select…</option>
                      {employees.map((u) => (
                        <option key={u.id} value={u.id}>{u.name}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Leave type
                    <select
                      value={createForm.leaveType}
                      onChange={(e) => setCreateForm((f) => ({ ...f, leaveType: e.target.value }))}
                    >
                      {Object.entries(APPLY_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Session
                    <select
                      value={createForm.session}
                      onChange={(e) =>
                        setCreateForm((f) => ({
                          ...f,
                          session: e.target.value,
                          endDate: e.target.value !== 'full' ? f.startDate : f.endDate,
                        }))
                      }
                    >
                      {Object.entries(SESSION_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Start date
                    <input
                      type="date"
                      required
                      value={createForm.startDate}
                      onChange={(e) =>
                        setCreateForm((f) => ({
                          ...f,
                          startDate: e.target.value,
                          endDate: f.session !== 'full' ? e.target.value : f.endDate || e.target.value,
                        }))
                      }
                    />
                  </label>
                  {createForm.session === 'full' ? (
                    <label>
                      End date
                      <input
                        type="date"
                        required
                        value={createForm.endDate}
                        onChange={(e) => setCreateForm((f) => ({ ...f, endDate: e.target.value }))}
                      />
                    </label>
                  ) : null}
                  <label>
                    Reason
                    <input
                      value={createForm.reason}
                      onChange={(e) => setCreateForm((f) => ({ ...f, reason: e.target.value }))}
                      placeholder="Optional"
                    />
                  </label>
                  {createErr ? <p className="form-error">{createErr}</p> : null}
                  <button type="submit" className="btn primary" disabled={createBusy}>
                    {createBusy ? 'Saving…' : 'Add leave'}
                  </button>
                </form>
              </div>
            </div>,
            portal
          )
        : null}
    </div>
  );
}
