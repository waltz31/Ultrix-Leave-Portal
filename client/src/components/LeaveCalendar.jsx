import { useEffect, useMemo, useState } from 'react';
import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  getMonth,
  isSameDay,
  isSameMonth,
  isWeekend,
  isWithinInterval,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns';
import {
  APPLY_LABELS,
  LEAVE_LABELS,
  REQUEST_LABELS,
  SESSION_LABELS,
  STATUS_LABELS,
  appToday,
  canUserCancel,
  formatDate,
  formatTime,
  formatLeaveSpan,
  holidayDateLabel,
  punchInLateness,
  isUnderNineHours,
  toYmd,
  blockedRegularLeaveMessage,
  generalHolidayMapFromList,
  isApplyBlockError,
  RH_ONLY_PUBLISHED_DATES,
} from '../utils';
import { useAuth } from '../auth';
import ErrorPopup from './ErrorPopup';
import {
  CALENDAR_CELLS,
  calendarMonthImageUrl,
} from '../calendarMonthImages';
import { api } from '../api';
import { getPortalRoot } from '../portalRoot';
import { createPortal } from 'react-dom';
import TeamRosterCalendar from './TeamRosterCalendar';

const WEEK_STARTS_ON = 0;
const DOW_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const EXPECTED_WORK_MINUTES = 540;

function stampToTimeInput(stamp) {
  const m = String(stamp || '').match(/(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : '';
}

function shortPunchTime(stamp) {
  return formatTime(stamp);
}

function attendanceChipLabel(sessions, summary) {
  if (summary) {
    if (summary.stillIn) return `In ${shortPunchTime(summary.punchIn)}`;
    if (summary.workHours) return summary.workHours;
    if (summary.punchOut) return `${shortPunchTime(summary.punchIn)}–${shortPunchTime(summary.punchOut)}`;
    return shortPunchTime(summary.punchIn);
  }
  const still = sessions.filter((s) => s.stillIn).length;
  if (still > 0) return `${sessions.length} · ${still} in`;
  return `${sessions.length} present`;
}

const MONTH_THEMES = [
  { header: '#5b9bd5' },
  { header: '#6ba3d6' },
  { header: '#c4a574' },
  { header: '#9bc53d' },
  { header: '#56b8a4' },
  { header: '#e8a838' },
  { header: '#ef7b6a' },
  { header: '#d97757' },
  { header: '#8b6fd4' },
  { header: '#c97b4a' },
  { header: '#6d8fb8' },
  { header: '#5a9e86' },
];

function monthTheme(date) {
  return MONTH_THEMES[getMonth(date)] || MONTH_THEMES[0];
}

function BalanceTooltip({ leave, balances }) {
  const bal = balances || { casual: 0, earned: 0, sick: 0, restricted: 2 };

  return (
    <div className="cal-tooltip" role="tooltip">
      <strong className="cal-tooltip-name">{leave.userName}</strong>
      <span className={`cal-tooltip-type type-${leave.leaveType}`}>
        On {REQUEST_LABELS[leave.leaveType]}
        {leave.session && leave.session !== 'full'
          ? ` · ${SESSION_LABELS[leave.session]}`
          : ''}
        {' · '}
        {format(parseISO(leave.startDate), 'd MMM')}
        {leave.startDate !== leave.endDate
          ? ` – ${format(parseISO(leave.endDate), 'd MMM')}`
          : ''}
      </span>
      <div className="cal-tooltip-balances">
        <span className="cal-tooltip-label">Available leave</span>
        <ul>
          {Object.entries(LEAVE_LABELS).map(([key, label]) => (
            <li key={key}>
              <span>{label}</span>
              <strong>{bal[key] ?? 0}</strong>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function sessionSuffix(session) {
  if (session === 'morning') return ' AM';
  if (session === 'afternoon') return ' PM';
  return '';
}

function primaryLeaveType(items) {
  if (!items.length) return null;
  const types = [...new Set(items.map((l) => l.leaveType))];
  return types.length === 1 ? types[0] : items[0].leaveType;
}

function shortTypeLabel(type) {
  if (type === 'wfh') return 'WFH';
  if (type === 'casual') return 'CL';
  if (type === 'earned') return 'EL';
  if (type === 'sick') return 'SL';
  if (type === 'restricted') return 'RL';
  if (type === 'general') return 'GH';
  if (type === 'mandatory') return 'GH';
  return REQUEST_LABELS[type] || type;
}

function chipMainLabel(leave, showNames) {
  if (leave.isMandatory) {
    return leave.userName || (leave.leaveType === 'restricted' ? 'Restricted holiday' : 'General holiday');
  }
  if (showNames) return String(leave.userName || '').split(' ')[0];
  return shortTypeLabel(leave.leaveType);
}

function isHolidayLeave(leave) {
  return (
    Boolean(leave?.isMandatory) ||
    leave?.leaveType === 'general' ||
    leave?.leaveType === 'mandatory'
  );
}

const ROSTER_LEAVE = {
  casual: { code: 'CL', kind: 'leave-casual' },
  earned: { code: 'PL', kind: 'leave-earned' },
  sick: { code: 'SL', kind: 'leave-sick' },
  restricted: { code: 'RL', kind: 'leave-restricted' },
  wfh: { code: 'WFH', kind: 'leave-wfh' },
};

function earliestPunch(sessions) {
  if (!sessions?.length) return null;
  return [...sessions].sort((a, b) =>
    String(a.punchIn || '').localeCompare(String(b.punchIn || ''))
  )[0];
}

export default function LeaveCalendar({
  leaves,
  showNames = false,
  balancesByUserId = null,
  onCancel = null,
  busyId = null,
  employees = null,
  canManage = false,
  onCreateLeave = null,
  onDeleteLeave = null,
  layout = 'month',
}) {
  const { user } = useAuth();
  const [cursor, setCursor] = useState(() => startOfMonth(appToday()));
  const [selected, setSelected] = useState(null); // { id, day }
  const [employeeFilter, setEmployeeFilter] = useState('');
  const [calendarLayer, setCalendarLayer] = useState('all');
  const [attendanceUserId, setAttendanceUserId] = useState(null);
  const [attendanceReady, setAttendanceReady] = useState(false);
  const [attendanceSessions, setAttendanceSessions] = useState([]);
  const [expectedWorkMinutes, setExpectedWorkMinutes] = useState(EXPECTED_WORK_MINUTES);
  const [attendanceDay, setAttendanceDay] = useState(null);
  const [regularizeSession, setRegularizeSession] = useState(null);
  const [regForm, setRegForm] = useState({ punchIn: '', punchOut: '', reason: '' });
  const [regBusy, setRegBusy] = useState(false);
  const [regError, setRegError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({
    userId: '',
    leaveType: 'casual',
    startDate: '',
    endDate: '',
    session: 'full',
    reason: '',
  });
  const [createBusy, setCreateBusy] = useState(false);
  const [createErr, setCreateErr] = useState('');
  const [errorPopup, setErrorPopup] = useState(null);
  const [publishedRestricted, setPublishedRestricted] = useState([]);
  const showBalances = Boolean(balancesByUserId);
  const canCancelLeaves = typeof onCancel === 'function';
  const canDelete = canManage && typeof onDeleteLeave === 'function';
  const canCreate = canManage && typeof onCreateLeave === 'function';
  const today = appToday();

  useEffect(() => {
    const year = cursor.getFullYear();
    api(`/holidays?year=${year}`)
      .then((data) => setPublishedRestricted(data.restricted || []))
      .catch(() => setPublishedRestricted([]));
  }, [cursor]);

  useEffect(() => {
    const rangeStart = startOfMonth(cursor);
    const rangeEnd = endOfMonth(cursor);
    const from = format(rangeStart, 'yyyy-MM-dd');
    const to = format(rangeEnd, 'yyyy-MM-dd');
    const params = new URLSearchParams({ from, to });
    if (layout !== 'roster' && employeeFilter) {
      params.set('userId', employeeFilter);
    }
    let cancelled = false;
    setAttendanceReady(false);
    api(`/attendance/calendar?${params}`)
      .then((data) => {
        if (cancelled) return;
        setAttendanceSessions(data.sessions || []);
        if (data.expectedWorkMinutes) setExpectedWorkMinutes(data.expectedWorkMinutes);
        setAttendanceReady(true);
      })
      .catch(() => {
        if (!cancelled) {
          setAttendanceSessions([]);
          setAttendanceReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [cursor, employeeFilter, layout]);

  const employeeOptions = useMemo(() => {
    if (employees?.length) return employees;
    const map = new Map();
    for (const leave of leaves || []) {
      if (leave.userId && !map.has(leave.userId)) {
        map.set(leave.userId, { id: leave.userId, name: leave.userName || `User ${leave.userId}` });
      }
    }
    return [...map.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }, [employees, leaves]);

  const filteredLeaves = useMemo(() => {
    const all = (leaves || []).filter((leave) => {
      if (leave.isMandatory && (leave.leaveType === 'restricted' || leave.holidayType === 'restricted')) {
        return false;
      }
      if (leave.leaveType === 'restricted' && leave.status !== 'approved') {
        return false;
      }
      return true;
    });
    if (!employeeFilter) return all;
    return all.filter(
      (l) => l.isMandatory || String(l.userId) === String(employeeFilter)
    );
  }, [leaves, employeeFilter]);

  const attendanceByDate = useMemo(() => {
    const map = new Map();
    for (const session of attendanceSessions) {
      if (employeeFilter && String(session.userId) !== String(employeeFilter)) continue;
      const key = session.punchDate;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(session);
    }
    return map;
  }, [attendanceSessions, employeeFilter]);

  const showEmployeeFilter = (showNames || canManage) && user?.role !== 'user';
  const showLayerFilter = showEmployeeFilter;
  const showLeavesLayer = !showLayerFilter || calendarLayer === 'leaves' || calendarLayer === 'all';
  const showAttendanceLayer = !showLayerFilter || calendarLayer === 'attendance' || calendarLayer === 'all';
  const attendanceForDay = (attendanceDay ? attendanceByDate.get(attendanceDay) || [] : []).filter(
    (session) => attendanceUserId == null || String(session.userId) === String(attendanceUserId)
  );

  function openRegularize(session) {
    setRegError('');
    setRegularizeSession(session);
    setRegForm({
      punchIn: stampToTimeInput(session.punchIn) || '09:30',
      punchOut: stampToTimeInput(session.punchOut) || '18:00',
      reason: '',
    });
  }

  async function submitRegularize(event) {
    event.preventDefault();
    if (!regularizeSession) return;
    setRegBusy(true);
    setRegError('');
    try {
      await api('/attendance/regularizations', {
        method: 'POST',
        body: {
          punchDate: regularizeSession.punchDate,
          proposedPunchIn: regForm.punchIn,
          proposedPunchOut: regForm.punchOut,
          reason: regForm.reason,
        },
      });
      setRegularizeSession(null);
      const from = format(startOfMonth(cursor), 'yyyy-MM-dd');
      const to = format(endOfMonth(cursor), 'yyyy-MM-dd');
      const params = new URLSearchParams({ from, to });
      if (employeeFilter) {
        params.set('userId', employeeFilter);
        params.set('userId', employeeFilter);
      }
      const data = await api(`/attendance/calendar?${params}`);
      setAttendanceSessions(data.sessions || []);
    } catch (err) {
      setRegError(err.message || 'Could not submit request');
    } finally {
      setRegBusy(false);
    }
  }

  const restrictedHolidayOptions = useMemo(
    () =>
      [...publishedRestricted].sort((a, b) =>
        toYmd(a.startDate).localeCompare(toYmd(b.startDate))
      ),
    [publishedRestricted]
  );
  const restrictedHolidayDates = useMemo(
    () => new Set(restrictedHolidayOptions.map((h) => toYmd(h.startDate))),
    [restrictedHolidayOptions]
  );
  const generalHolidayMap = useMemo(
    () => generalHolidayMapFromList(leaves),
    [leaves]
  );

  function applyBlockMessage(ymd) {
    if (restrictedHolidayDates.has(toYmd(ymd))) return null;
    return blockedRegularLeaveMessage(ymd, ymd, generalHolidayMap);
  }

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: WEEK_STARTS_ON });
    const end = endOfWeek(endOfMonth(cursor), { weekStartsOn: WEEK_STARTS_ON });
    const interval = eachDayOfInterval({ start, end });
    const padded = [...interval];
    while (padded.length < CALENDAR_CELLS) {
      padded.push(addDays(padded[padded.length - 1], 1));
    }
    return padded.slice(0, CALENDAR_CELLS);
  }, [cursor]);

  const rosterDays = useMemo(
    () =>
      eachDayOfInterval({
        start: startOfMonth(cursor),
        end: endOfMonth(cursor),
      }),
    [cursor]
  );

  const holidayByDate = useMemo(() => {
    const map = new Map();
    for (const leave of filteredLeaves) {
      if (!isHolidayLeave(leave)) continue;
      const start = parseISO(toYmd(leave.startDate));
      const end = parseISO(toYmd(leave.endDate) || toYmd(leave.startDate));
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;
      for (const day of eachDayOfInterval({ start, end })) {
        map.set(format(day, 'yyyy-MM-dd'), leave);
      }
    }
    return map;
  }, [filteredLeaves]);

  const leavesByUserDate = useMemo(() => {
    const map = new Map();
    for (const leave of filteredLeaves) {
      if (isHolidayLeave(leave)) continue;
      const start = parseISO(toYmd(leave.startDate));
      const end = parseISO(toYmd(leave.endDate) || toYmd(leave.startDate));
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;
      for (const day of eachDayOfInterval({ start, end })) {
        const key = `${leave.userId}|${format(day, 'yyyy-MM-dd')}`;
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(leave);
      }
    }
    return map;
  }, [filteredLeaves]);

  const attendanceByUserDate = useMemo(() => {
    const map = new Map();
    for (const session of attendanceSessions) {
      if (session.userId == null) continue;
      const key = `${session.userId}|${session.punchDate}`;
      const existing = map.get(key);
      if (!existing) map.set(key, session);
      else if (String(session.punchIn || '').localeCompare(String(existing.punchIn || '')) < 0) {
        map.set(key, session);
      }
    }
    return map;
  }, [attendanceSessions]);

  function rosterCell(employee, day) {
    const ymd = format(day, 'yyyy-MM-dd');
    const todayYmd = format(today, 'yyyy-MM-dd');
    if (!attendanceReady) return { kind: 'loading' };

    const empLeaves = leavesByUserDate.get(`${employee.id}|${ymd}`) || [];
    const approved = empLeaves.find((leave) => leave.status === 'approved');
    const pending = empLeaves.find(
      (leave) => leave.status && !['approved', 'rejected', 'cancelled'].includes(leave.status)
    );
    const session = attendanceByUserDate.get(`${employee.id}|${ymd}`);
    const holiday = holidayByDate.get(ymd);
    const leave = approved || pending;
    const leaveMeta = leave ? ROSTER_LEAVE[leave.leaveType] : null;
    const halfDay = Boolean(leave?.session && leave.session !== 'full');

    if (leaveMeta && approved) {
      return {
        kind: leaveMeta.kind,
        code: leaveMeta.code,
        halfDay,
        time: halfDay && session?.punchIn ? stampToTimeInput(session.punchIn) : '',
        leave,
        session: session || null,
        label: `${REQUEST_LABELS[leave.leaveType] || leaveMeta.code}${halfDay ? ' · Half day' : ''}`,
      };
    }

    if (holiday) {
      const name =
        holiday.userName ||
        (holiday.leaveType === 'restricted' ? 'Restricted holiday' : 'General holiday');
      return { kind: 'holiday', code: 'HOL', leave: holiday, label: `Holiday · ${name}` };
    }
    if (isWeekend(day) && !session) {
      return { kind: 'weekoff', code: 'WO', label: 'Weekly Off' };
    }

    if (session?.punchIn) {
      const lateness = punchInLateness(session.punchIn);
      const late = lateness === 'late' || lateness === 'very-late';
      return {
        kind: late ? 'late' : 'present',
        code: late ? 'L' : 'P',
        time: stampToTimeInput(session.punchIn),
        session,
        leave: leave || null,
        halfDay,
        label: late ? 'Late' : 'Present',
      };
    }

    if (leaveMeta && pending) {
      return {
        kind: leaveMeta.kind,
        code: leaveMeta.code,
        pending: true,
        halfDay,
        leave,
        label: `${REQUEST_LABELS[leave.leaveType] || leaveMeta.code}${halfDay ? ' · Half day' : ''} · Pending`,
      };
    }

    if (ymd < todayYmd && !isWeekend(day)) {
      return { kind: 'absent', code: 'A', time: '--:--', label: 'Absent' };
    }
    return { kind: 'empty' };
  }

  function handleRosterCell(employee, day, cell) {
    const ymd = format(day, 'yyyy-MM-dd');
    if (cell.leave && !isHolidayLeave(cell.leave)) {
      setSelected({ id: cell.leave.id, day: ymd });
      setAttendanceDay(null);
      return;
    }
    if (cell.session) {
      setSelected(null);
      setAttendanceUserId(employee.id);
      setAttendanceDay(ymd);
      return;
    }
    if (canCreate && cell.kind !== 'weekoff' && cell.kind !== 'holiday' && cell.kind !== 'loading') {
      openCreate(ymd, String(employee.id));
    }
  }

  function shiftRoster(dir) {
    setCursor((c) => startOfMonth(dir > 0 ? addMonths(c, 1) : subMonths(c, 1)));
  }

  const monthThemeStyle = useMemo(() => monthTheme(cursor), [cursor]);

  const selectedLeave = useMemo(
    () => (selected ? filteredLeaves.find((l) => l.id === selected.id) || null : null),
    [filteredLeaves, selected]
  );

  const multiDay =
    selectedLeave &&
    selectedLeave.startDate !== selectedLeave.endDate &&
    (selectedLeave.session || 'full') === 'full';

  useEffect(() => {
    if (!selected && !attendanceDay) return undefined;

    function onKey(e) {
      if (e.key !== 'Escape') return;
      if (regularizeSession) return;
      if (attendanceDay) setAttendanceDay(null);
      else if (selected) setSelected(null);
    }

    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selected, attendanceDay, regularizeSession]);

  function leavesOn(day) {
    return filteredLeaves
      .filter((leave) => {
        const start = parseISO(toYmd(leave.startDate));
        const end = parseISO(toYmd(leave.endDate) || toYmd(leave.startDate));
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;
        return isWithinInterval(day, { start, end });
      })
      .sort((a, b) => Number(Boolean(b.isMandatory)) - Number(Boolean(a.isMandatory)));
  }

  async function handleCancel(leave, opts = {}) {
    const done = await onCancel(leave, opts);
    if (done !== false) setSelected(null);
  }

  async function handleDelete(leave) {
    if (leave.isMandatory && (leave.leaveType === 'restricted' || leave.holidayType === 'restricted')) {
      setErrorPopup({
        title: 'Cannot remove from calendar',
        message:
          'Restricted holidays stay in Overview for applying. They appear on a calendar only after a leave request is approved.',
      });
      return;
    }
    const ok = window.confirm(
      leave.isMandatory
        ? `Remove mandatory leave “${leave.userName}” (${formatLeaveSpan(leave)}) from all calendars?`
        : `Delete ${REQUEST_LABELS[leave.leaveType] || leave.leaveType} for ${leave.userName}? This cannot be undone.`
    );
    if (!ok) return;
    const done = await onDeleteLeave(leave);
    if (done !== false) setSelected(null);
  }

  function openCreate(dayKey = '', userId = '') {
    const dayYmd = toYmd(dayKey);
    const rh = restrictedHolidayOptions.find((h) => toYmd(h.startDate) === dayYmd);
    if (dayYmd && !rh) {
      const blocked = applyBlockMessage(dayYmd);
      if (blocked) {
        setErrorPopup({ title: 'Cannot apply leave', message: blocked });
        return;
      }
    }
    setCreateErr('');
    setCreateForm({
      userId: userId || employeeFilter || (employeeOptions[0] ? String(employeeOptions[0].id) : ''),
      leaveType: rh ? 'restricted' : 'casual',
      startDate: dayYmd,
      endDate: dayYmd,
      session: 'full',
      reason: rh ? rh.userName || '' : '',
    });
    setShowCreate(true);
  }

  async function submitCreate(e) {
    e.preventDefault();
    setCreateBusy(true);
    setCreateErr('');
    try {
      const isRestricted = createForm.leaveType === 'restricted';
      const startDate = toYmd(createForm.startDate);
      const endDate =
        isRestricted || createForm.session !== 'full' ? startDate : toYmd(createForm.endDate);
      if (!createForm.userId) {
        throw new Error('Select an employee');
      }
      if (isRestricted) {
        if (!startDate || !restrictedHolidayDates.has(startDate)) {
          throw new Error(RH_ONLY_PUBLISHED_DATES);
        }
      } else {
        const blocked = blockedRegularLeaveMessage(startDate, endDate, generalHolidayMap);
        if (blocked) throw new Error(blocked);
      }
      const body = {
        ...createForm,
        userId: Number(createForm.userId),
        startDate,
        session: isRestricted ? 'full' : createForm.session,
        endDate,
      };
      await onCreateLeave(body);
      setShowCreate(false);
    } catch (err) {
      const message = err.message || 'Could not create leave';
      if (isApplyBlockError(message)) {
        setErrorPopup({
          title: /insufficient restricted leave/i.test(message)
            ? 'No restricted leave balance'
            : 'Cannot apply leave',
          message,
        });
      }
      setCreateErr(message);
    } finally {
      setCreateBusy(false);
    }
  }

  return (
    <div className={layout === 'roster' ? 'calendar roster-wrap' : 'calendar calendar-pro calendar-split-view'}>
      {getPortalRoot() &&
        createPortal(
          <ErrorPopup
            show={Boolean(errorPopup)}
            title={errorPopup?.title}
            message={errorPopup?.message}
            onClose={() => setErrorPopup(null)}
          />,
          getPortalRoot()
        )}
      {layout === 'roster' ? (
        <TeamRosterCalendar
          cursor={cursor}
          onPrev={() => shiftRoster(-1)}
          onNext={() => shiftRoster(1)}
          onToday={() => setCursor(startOfMonth(today))}
          days={rosterDays}
          employees={employeeOptions}
          getCell={rosterCell}
          onCellClick={handleRosterCell}
          canCreate={canCreate}
          onAddLeave={() => openCreate()}
          today={today}
          loading={!attendanceReady}
        />
      ) : (
      <>
      <div className="calendar-toolbar">
        <div className="calendar-nav">
          <button
            type="button"
            className="btn ghost calendar-nav-btn"
            onClick={() => setCursor((c) => startOfMonth(subMonths(c, 1)))}
            aria-label="Previous month"
          >
            ‹
          </button>
          <h3>{format(cursor, 'MMMM yyyy')}</h3>
          <button
            type="button"
            className="btn ghost calendar-nav-btn"
            onClick={() => setCursor((c) => startOfMonth(addMonths(c, 1)))}
            aria-label="Next month"
          >
            ›
          </button>
        </div>
        <div className="calendar-toolbar-actions">
          {showLayerFilter && (
            <label className="calendar-employee-filter">
              <span>View</span>
              <select
                value={calendarLayer}
                onChange={(e) => {
                  setCalendarLayer(e.target.value);
                  setSelected(null);
                  setAttendanceDay(null);
                }}
                aria-label="Calendar view"
              >
                <option value="all">All</option>
                <option value="attendance">Attendance</option>
                <option value="leaves">Leave</option>
              </select>
            </label>
          )}
          {showEmployeeFilter && (
            <label className="calendar-employee-filter">
              <span>Employee</span>
              <select
                value={employeeFilter}
                onChange={(e) => {
                  setEmployeeFilter(e.target.value);
                  setSelected(null);
                  setAttendanceDay(null);
                }}
                aria-label="Select employee"
              >
                <option value="">All employees</option>
                {employeeOptions.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {canCreate && showLeavesLayer && (
            <button
              type="button"
              className="btn primary calendar-add-btn"
              onClick={() => openCreate()}
              aria-label="Add leave"
              title="Add leave for an employee"
            >
              +
            </button>
          )}
          <button
            type="button"
            className="btn secondary calendar-today-btn"
            onClick={() => setCursor(startOfMonth(today))}
          >
            Today
          </button>
        </div>
      </div>

      <div className="calendar-legend" aria-hidden="true">
        {showLeavesLayer &&
          Object.entries(APPLY_LABELS).map(([key, label]) => (
            <span key={key} className="legend-item">
              <i className={`legend-swatch type-${key}`} /> {label}
            </span>
          ))}
        {showLeavesLayer && (
          <span className="legend-item">
            <i className="legend-swatch type-general" /> General Holiday
          </span>
        )}
        {showAttendanceLayer && (
          <>
            <span className="legend-item">
              <i className="legend-swatch att-on-time" /> In by 11am
            </span>
            <span className="legend-item">
              <i className="legend-swatch att-late" /> 12pm
            </span>
            <span className="legend-item">
              <i className="legend-swatch att-very-late" /> 1pm+
            </span>
          </>
        )}
        <span className="legend-item">
          <i className="legend-swatch type-weekend" /> Sat / Sun
        </span>
      </div>

      <div className="calendar-stage">
        <div className="calendar-visual-panel" aria-hidden="true">
          <img
            className="calendar-visual-image"
            src={calendarMonthImageUrl(getMonth(cursor), 'hero')}
            alt=""
            loading="lazy"
            decoding="async"
          />
          <div className="calendar-visual-overlay" />
          <span className="calendar-visual-label">{format(cursor, 'MMMM')}</span>
        </div>

        <div className="calendar-grid-panel">
          <div
            className="calendar-month-banner"
            style={{ backgroundColor: monthThemeStyle.header }}
          >
            {format(cursor, 'MMMM yyyy').toUpperCase()}
          </div>

          <div className="calendar-grid head calendar-grid-compact">
            {DOW_LABELS.map((label, index) => (
              <div
                key={`${label}-${index}`}
                className={`calendar-dow${index === 0 || index === 6 ? ' is-weekend' : ''}`}
              >
                {label}
              </div>
            ))}
          </div>

          <div className="calendar-grid body calendar-grid-compact">
            {days.map((day) => {
              const items = leavesOn(day);
              const visibleItems = showLeavesLayer
                ? items
                : items.filter((leave) => isHolidayLeave(leave));
              const outside = !isSameMonth(day, cursor);
              const isToday = isSameDay(day, today);
              const weekend = isWeekend(day);
              const leaveType = primaryLeaveType(visibleItems);
              const dayKey = format(day, 'yyyy-MM-dd');
              const dayAttendance = showAttendanceLayer
                ? attendanceByDate.get(dayKey) || []
                : [];
              const attSummary = earliestPunch(dayAttendance);
              const showAttSummary =
                Boolean(attSummary) &&
                (user?.role === 'user' || employeeFilter || dayAttendance.length === 1);
              const isHolidayDay = items.some((leave) => isHolidayLeave(leave));
              const attTone =
                showAttendanceLayer && !isHolidayDay && attSummary?.punchIn
                  ? punchInLateness(attSummary.punchIn) || 'on-time'
                  : null;
              const useLeaveBg = Boolean(leaveType) && (isHolidayDay || (showLeavesLayer && !attTone));
              return (
                <div
                  key={day.toISOString()}
                  className={[
                    'calendar-cell',
                    outside ? 'muted' : '',
                    isToday ? 'today' : '',
                    weekend ? 'weekend' : '',
                    visibleItems.length && useLeaveBg ? 'has-leave' : '',
                    dayAttendance.length ? 'has-attendance' : '',
                    useLeaveBg ? `leave-bg-${leaveType}` : '',
                    attTone ? `att-tone-${attTone}` : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <div className="day-head">
                    <span className={`day-num${isToday ? ' is-today' : ''}`}>
                      {format(day, 'dd')}
                    </span>
                    <div className="day-head-actions">
                      {visibleItems.length > 0 && (
                        <span className="day-count">{visibleItems.length}</span>
                      )}
                      {canCreate && showLeavesLayer && !outside && !applyBlockMessage(dayKey) && (
                        <button
                          type="button"
                          className="calendar-day-add"
                          aria-label={`Add leave on ${dayKey}`}
                          title="Add leave on this day"
                          onClick={(e) => {
                            e.stopPropagation();
                            openCreate(dayKey);
                          }}
                        >
                          +
                        </button>
                      )}
                    </div>
                  </div>
                  {showAttendanceLayer && dayAttendance.length > 0 && (
                    <button
                      type="button"
                      className={[
                        'cal-att-chip',
                        attSummary?.needsRegularize ? 'is-short' : '',
                        attSummary?.stillIn ? 'is-in' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      title="View attendance"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelected(null);
                        setAttendanceUserId(null);
                        setAttendanceDay(dayKey);
                      }}
                    >
                      {attSummary
                        ? attendanceChipLabel(dayAttendance, attSummary)
                        : attendanceChipLabel(dayAttendance, null)}
                    </button>
                  )}
                  <div className="leave-chips">
                    {visibleItems.slice(0, 2).map((leave) => {
                      const cancellable =
                        canCancelLeaves && !leave.isMandatory && canUserCancel(leave.status);
                      const interactive = cancellable || canDelete || (showBalances && !leave.isMandatory);
                      const ChipTag = interactive ? 'button' : 'span';
                      const isSelected =
                        selected?.id === leave.id && selected?.day === dayKey;
                      return (
                        <ChipTag
                          key={`${leave.id}-${dayKey}`}
                          type={interactive ? 'button' : undefined}
                          className={[
                            'chip',
                            'leave-chip',
                            `type-${leave.leaveType}`,
                            leave.isMandatory ? 'is-holiday' : '',
                            showBalances && !leave.isMandatory ? 'has-tip' : '',
                            cancellable || canDelete ? 'chip-cancellable' : '',
                            leave.status && leave.status !== 'approved' ? 'chip-pending' : '',
                            isSelected ? 'is-selected' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          title={
                            showBalances && !leave.isMandatory
                              ? undefined
                              : `${showNames || leave.isMandatory ? leave.userName + ' · ' : ''}${REQUEST_LABELS[leave.leaveType]}${
                                  leave.session && leave.session !== 'full'
                                    ? ` · ${SESSION_LABELS[leave.session]}`
                                    : ''
                                }${leave.status && leave.status !== 'approved' ? ` · ${STATUS_LABELS[leave.status] || leave.status}` : ''}`
                          }
                          onClick={
                            cancellable || canDelete
                              ? (e) => {
                                  e.stopPropagation();
                                  setSelected((cur) =>
                                    cur?.id === leave.id && cur?.day === dayKey
                                      ? null
                                      : { id: leave.id, day: dayKey }
                                  );
                                }
                              : undefined
                          }
                        >
                          <span className="leave-chip-main">
                            {chipMainLabel(leave, showNames)}
                            {!leave.isMandatory && sessionSuffix(leave.session)}
                          </span>
                          {(showNames || leave.isMandatory) && (
                            <span className="leave-chip-sub">{shortTypeLabel(leave.leaveType)}</span>
                          )}
                          {showBalances && !leave.isMandatory && (
                            <BalanceTooltip
                              leave={leave}
                              balances={balancesByUserId[leave.userId]}
                            />
                          )}
                        </ChipTag>
                      );
                    })}
                    {visibleItems.length > 2 && (
                      <span className="chip more">+{visibleItems.length - 2} more</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      </>
      )}

      {selectedLeave &&
        selected &&
        getPortalRoot() &&
        createPortal(
          <div
            className="modal-backdrop cal-day-backdrop"
            onClick={() => setSelected(null)}
          >
            <div
              className="cal-day-sheet"
              role="dialog"
              aria-modal="true"
              aria-label="Leave details"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="cal-day-sheet-head">
                <div className="cal-day-sheet-title">
                  <span className={`badge type-${selectedLeave.leaveType}`}>
                    {REQUEST_LABELS[selectedLeave.leaveType]}
                  </span>
                  {!selectedLeave.isMandatory && (
                    <span className={`status-pill status-${selectedLeave.status}`}>
                      {STATUS_LABELS[selectedLeave.status] || selectedLeave.status}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  className="btn ghost cal-leave-close"
                  onClick={() => setSelected(null)}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
              {(showNames || selectedLeave.isMandatory) && (
                <p className="cal-leave-person">
                  <strong>{selectedLeave.userName}</strong>
                </p>
              )}
              <p className="cal-leave-span">{formatLeaveSpan(selectedLeave)}</p>
              <p className="cal-leave-day">
                Selected day: <strong>{formatDate(selected.day)}</strong>
              </p>
              {selectedLeave.reason && (
                <p className="cal-leave-reason muted">{selectedLeave.reason}</p>
              )}
              {(canCancelLeaves || canDelete) && (
              <div className="cal-leave-actions">
                {canCancelLeaves &&
                  !selectedLeave.isMandatory &&
                  canUserCancel(selectedLeave.status) &&
                  (multiDay ? (
                    <>
                      <button
                        type="button"
                        className="btn danger"
                        disabled={busyId === selectedLeave.id}
                        onClick={() => handleCancel(selectedLeave, { date: selected.day })}
                      >
                        {busyId === selectedLeave.id ? 'Cancelling…' : 'Cancel this day'}
                      </button>
                      <button
                        type="button"
                        className="btn danger ghost-danger"
                        disabled={busyId === selectedLeave.id}
                        onClick={() => handleCancel(selectedLeave, { cancelAll: true })}
                      >
                        Cancel entire leave
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="btn danger"
                      disabled={busyId === selectedLeave.id}
                      onClick={() => handleCancel(selectedLeave, { cancelAll: true })}
                    >
                      {busyId === selectedLeave.id ? 'Cancelling…' : 'Cancel leave'}
                    </button>
                  ))}
                {canDelete && (
                  <button
                    type="button"
                    className="btn ghost-danger"
                    disabled={busyId === selectedLeave.id}
                    onClick={() => handleDelete(selectedLeave)}
                  >
                    {busyId === selectedLeave.id
                      ? 'Deleting…'
                      : selectedLeave.isMandatory
                        ? 'Remove mandatory leave'
                        : 'Delete leave'}
                  </button>
                )}
              </div>
              )}
            </div>
          </div>,
          getPortalRoot()
        )}

      {attendanceDay &&
        getPortalRoot() &&
        createPortal(
          <div
            className="modal-backdrop cal-day-backdrop"
            onClick={() => setAttendanceDay(null)}
          >
            <div
              className="cal-day-sheet cal-att-sheet"
              role="dialog"
              aria-modal="true"
              aria-label="Attendance details"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="cal-day-sheet-head">
                <div>
                  <h2 className="cal-day-sheet-heading">Attendance</h2>
                  <p className="muted cal-day-sheet-sub">{formatDate(attendanceDay)}</p>
                </div>
                <button
                  type="button"
                  className="btn ghost cal-leave-close"
                  onClick={() => setAttendanceDay(null)}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
              {!attendanceForDay.length ? (
                <p className="muted">No punches for this day.</p>
              ) : (
                <ul className="cal-att-list">
                  {attendanceForDay.map((session) => (
                    <li key={`${session.userId || session.deviceUserCode}-${session.id}`}>
                      {(showNames || canManage || user?.role === 'user') && (
                        <div className="cal-att-name">
                          <strong>{session.userName || 'Unmapped'}</strong>
                          {session.employeeNumber ? (
                            <span className="sub">{session.employeeNumber}</span>
                          ) : null}
                        </div>
                      )}
                      <div className="cal-att-times">
                        <div>
                          <span className="cal-att-label">Punch in</span>
                          <strong>{session.punchIn ? formatTime(session.punchIn) : '—'}</strong>
                        </div>
                        <div>
                          <span className="cal-att-label">Punch out</span>
                          <strong>
                            {session.punchOut
                              ? formatTime(session.punchOut)
                              : session.stillIn
                                ? 'Still in'
                                : '—'}
                          </strong>
                        </div>
                        <div>
                          <span className="cal-att-label">Hours</span>
                          <strong className={isUnderNineHours(session.workMinutes) ? 'work-hours-short' : undefined}>
                            {session.workHours || (session.stillIn ? 'In progress' : '—')}
                            {session.overridden ? ' · adjusted' : ''}
                          </strong>
                        </div>
                      </div>
                      {session.regularizePending ? (
                        <p className="cal-att-pending">Regularization pending HR review</p>
                      ) : null}
                      {session.canRegularize && user?.role === 'user' ? (
                        <button
                          type="button"
                          className="btn primary cal-att-regularize"
                          onClick={() => {
                            setAttendanceDay(null);
                            openRegularize(session);
                          }}
                        >
                          Regularize
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>,
          getPortalRoot()
        )}

      {regularizeSession &&
        getPortalRoot() &&
        createPortal(
          <div className="modal-backdrop" onClick={() => setRegularizeSession(null)}>
            <div
              className="modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="cal-reg-title"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 id="cal-reg-title">Regularize attendance</h2>
              <p className="muted">
                Recorded hours for {formatDate(regularizeSession.punchDate)} are under{' '}
                {expectedWorkMinutes / 60}h ({regularizeSession.workHours || '—'}). Propose
                corrected punch times for HR to review.
              </p>
              {regError ? <p className="form-error">{regError}</p> : null}
              <form className="stack-form" onSubmit={submitRegularize}>
                <label>
                  Proposed punch in
                  <input
                    type="time"
                    required
                    value={regForm.punchIn}
                    onChange={(e) => setRegForm((c) => ({ ...c, punchIn: e.target.value }))}
                  />
                </label>
                <label>
                  Proposed punch out
                  <input
                    type="time"
                    required
                    value={regForm.punchOut}
                    onChange={(e) => setRegForm((c) => ({ ...c, punchOut: e.target.value }))}
                  />
                </label>
                <label>
                  Reason
                  <textarea
                    required
                    rows={3}
                    maxLength={500}
                    value={regForm.reason}
                    placeholder="Why should these times be corrected?"
                    onChange={(e) => setRegForm((c) => ({ ...c, reason: e.target.value }))}
                  />
                </label>
                <div className="modal-actions">
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={() => setRegularizeSession(null)}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn primary" disabled={regBusy}>
                    {regBusy ? 'Submitting…' : 'Send to HR'}
                  </button>
                </div>
              </form>
            </div>
          </div>,
          getPortalRoot()
        )}

      {showCreate &&
        getPortalRoot() &&
        createPortal(
          <div
            className="modal-backdrop"
            onClick={() => !createBusy && setShowCreate(false)}
          >
            <div
              className="modal cal-create-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="cal-create-title"
              onClick={(e) => e.stopPropagation()}
            >
            <div className="row-between">
              <h2 id="cal-create-title">Add leave</h2>
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
                  {employeeOptions.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Leave type
                <select
                  value={createForm.leaveType}
                  onChange={(e) =>
                    setCreateForm((f) => {
                      const leaveType = e.target.value;
                      const rh =
                        leaveType === 'restricted'
                          ? restrictedHolidayOptions.find((h) => toYmd(h.startDate) === toYmd(f.startDate))
                          : null;
                      return {
                        ...f,
                        leaveType,
                        session: leaveType === 'restricted' ? 'full' : f.session,
                        startDate: leaveType === 'restricted' && !rh ? '' : f.startDate,
                        endDate: leaveType === 'restricted' ? (rh ? toYmd(rh.startDate) : '') : f.endDate,
                        reason: leaveType === 'restricted' ? rh?.userName || '' : f.reason,
                      };
                    })
                  }
                >
                  {Object.entries(APPLY_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              {createForm.leaveType !== 'restricted' && (
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
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              )}
              <label>
                {createForm.leaveType === 'restricted'
                  ? 'Restricted leave'
                  : createForm.session !== 'full'
                    ? 'Date'
                    : 'Start date'}
                {createForm.leaveType === 'restricted' ? (
                  <select
                    value={createForm.startDate}
                    onChange={(e) => {
                      const startDate = e.target.value;
                      if (startDate && !restrictedHolidayDates.has(startDate)) {
                        setErrorPopup({
                          title: 'Cannot apply leave',
                          message: RH_ONLY_PUBLISHED_DATES,
                        });
                        return;
                      }
                      const rh = restrictedHolidayOptions.find((h) => toYmd(h.startDate) === startDate);
                      setCreateForm((f) => ({
                        ...f,
                        startDate,
                        endDate: startDate,
                        session: 'full',
                        reason: rh?.userName || f.reason,
                      }));
                    }}
                    required
                  >
                    <option value="">Select from the RH list…</option>
                    {restrictedHolidayOptions.map((h) => (
                      <option key={h.id} value={toYmd(h.startDate)}>
                        {holidayDateLabel(h)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="date"
                    value={createForm.startDate}
                    onChange={(e) => {
                      const value = e.target.value;
                      const blocked = blockedRegularLeaveMessage(
                        value,
                        createForm.session !== 'full' ? value : createForm.endDate || value,
                        generalHolidayMap
                      );
                      if (blocked) {
                        setErrorPopup({ title: 'Cannot apply leave', message: blocked });
                        return;
                      }
                      setCreateForm((f) => ({
                        ...f,
                        startDate: value,
                        endDate:
                          f.session !== 'full'
                            ? value
                            : f.endDate || value,
                      }));
                    }}
                    required
                  />
                )}
              </label>
              {createForm.leaveType !== 'restricted' && createForm.session === 'full' && (
                <label>
                  End date
                  <input
                    type="date"
                    value={createForm.endDate}
                    onChange={(e) => {
                      const value = e.target.value;
                      const blocked = blockedRegularLeaveMessage(
                        createForm.startDate,
                        value,
                        generalHolidayMap
                      );
                      if (blocked) {
                        setErrorPopup({ title: 'Cannot apply leave', message: blocked });
                        return;
                      }
                      setCreateForm((f) => ({ ...f, endDate: value }));
                    }}
                    required
                  />
                </label>
              )}
              {createForm.leaveType === 'restricted' && !restrictedHolidayOptions.length && (
                <p className="form-error">
                  No restricted holidays are published yet. Add them under Company holidays first.
                </p>
              )}
              <label>
                Reason (optional)
                <input
                  value={createForm.reason}
                  onChange={(e) => setCreateForm((f) => ({ ...f, reason: e.target.value }))}
                />
              </label>
              {createErr && !errorPopup && <p className="form-error">{createErr}</p>}
              <div className="modal-actions">
                <button type="button" className="btn ghost" onClick={() => setShowCreate(false)}>
                  Cancel
                </button>
                <button className="btn primary" type="submit" disabled={createBusy}>
                  {createBusy ? 'Saving…' : 'Add leave'}
                </button>
              </div>
            </form>
          </div>
          </div>,
          getPortalRoot()
        )}
    </div>
  );
}
