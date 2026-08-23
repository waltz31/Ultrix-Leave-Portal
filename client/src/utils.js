export const LEAVE_LABELS = {
  casual: 'Casual Leave',
  earned: 'Earned Leave',
  sick: 'Sick Leave',
  restricted: 'Restricted Leave',
};

export const APPLY_LABELS = {
  ...LEAVE_LABELS,
  wfh: 'Work from Home',
};

export const REQUEST_LABELS = {
  ...APPLY_LABELS,
  general: 'General Holiday',
  mandatory: 'Company Holiday',
};

export const SESSION_LABELS = {
  full: 'Full day',
  morning: 'Morning',
  afternoon: 'Afternoon',
};

export const STATUS_LABELS = {
  pending_manager: 'Awaiting manager',
  pending_hr: 'Partially approved (awaiting HR)',
  pending: 'Pending',
  approved: 'Leave approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

export const ROLE_LABELS = {
  user: 'Employee',
  manager: 'Manager',
  hr: 'HR',
};

export function managerOptionLabel(manager) {
  if (!manager) return '';
  const suffix =
    manager.role === 'hr' ? ' (HR)' : manager.role === 'manager' ? ' (Manager)' : '';
  return `${manager.name || 'User'}${suffix}`;
}

/** App timezone — Indian Standard Time. */
export const APP_TIMEZONE = 'Asia/Kolkata';
export const APP_LOCALE = 'en-IN';

/** Parse a leave calendar date `YYYY-MM-DD` without shifting the day. */
export function parseLeaveDate(iso) {
  if (!iso) return null;
  const ymd = toYmd(iso);
  const [y, m, d] = String(ymd).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d));
}

export function toYmd(value) {
  if (value == null || value === '') return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  return text;
}

export function holidayDateLabel(holiday) {
  const date = toYmd(holiday?.startDate);
  const title = holiday?.userName || holiday?.title || 'Holiday';
  return date ? `${formatDate(date)} — ${title}` : title;
}

export function isWeekendYmd(value) {
  const d = parseLeaveDate(value);
  if (!d) return false;
  const dow = d.getUTCDay();
  return dow === 0 || dow === 6;
}

export function eachYmd(start, end) {
  const dates = [];
  const from = parseLeaveDate(start);
  const to = parseLeaveDate(end || start);
  if (!from || !to || to < from) return dates;
  const cur = new Date(from.getTime());
  while (cur <= to) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

export function generalHolidayMapFromList(items) {
  const map = new Map();
  for (const item of items || []) {
    const type = item.holidayType || item.leaveType;
    const isGeneral =
      type === 'general' || (item.isMandatory && type !== 'restricted');
    if (!isGeneral) continue;
    const start = toYmd(item.startDate);
    const end = toYmd(item.endDate) || start;
    const name = item.userName || item.title || 'General holiday';
    for (const ymd of eachYmd(start, end)) {
      if (!map.has(ymd)) map.set(ymd, name);
    }
  }
  return map;
}

export const WEEKEND_LEAVE_BLOCKED = 'Leave cannot be applied on Saturdays or Sundays.';
export const RH_ONLY_PUBLISHED_DATES =
  'Restricted holidays can only be taken on published RH dates. You cannot apply a restricted holiday on this day.';

export function generalHolidayBlockedMessage(name) {
  return name
    ? `Leave cannot be applied on general holidays. ${name} is already a company holiday.`
    : 'Leave cannot be applied on general holidays. This date is already a company holiday.';
}

export function insufficientRestrictedBalance(available = 0) {
  return `Insufficient restricted leave balance (${available} available). You start with 2 restricted leaves per year.`;
}

export function rhLimitReachedMessage(used, year, limit = 2) {
  return `You have already used ${used} restricted holiday${Number(used) === 1 ? '' : 's'} in ${year}. Only ${limit} restricted holidays can be taken per year.`;
}

export function blockedWorkingDateMessage(ymd, generalHolidayMap) {
  if (!ymd) return null;
  if (isWeekendYmd(ymd)) return WEEKEND_LEAVE_BLOCKED;
  if (generalHolidayMap?.has(ymd)) return generalHolidayBlockedMessage(generalHolidayMap.get(ymd));
  return null;
}

export function blockedRegularLeaveMessage(startDate, endDate, generalHolidayMap) {
  return (
    blockedWorkingDateMessage(startDate, generalHolidayMap) ||
    (endDate && endDate !== startDate
      ? blockedWorkingDateMessage(endDate, generalHolidayMap)
      : null)
  );
}

export function isApplyBlockError(message) {
  return /cannot be applied|restricted leave|restricted holiday|Saturdays or Sundays|insufficient|published RH/i.test(
    String(message || '')
  );
}

/**
 * Parse backend timestamp strings stored in IST (`YYYY-MM-DD HH:mm:ss`).
 * Also accepts ISO strings with offset / Z.
 */
export function parseAppDateTime(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw)) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const d = new Date(`${normalized}+05:30`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatRelativeTime(value) {
  const d = parseAppDateTime(value);
  if (!d) return value || '';
  const mins = Math.round(Math.max(0, Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return formatDateTime(value);
}

export function formatDate(iso) {
  const d = parseLeaveDate(iso);
  if (!d) return '—';
  return d.toLocaleDateString(APP_LOCALE, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** e.g. "01 Jan 2026" for holiday tables */
export function formatHolidayTableDate(iso) {
  const d = parseLeaveDate(iso);
  if (!d) return '—';
  return d.toLocaleDateString(APP_LOCALE, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** e.g. "26 Aug Wednesday" for overview holiday rows */
export function formatOverviewHolidayDate(iso) {
  const { date, weekday } = formatOverviewHolidayRow(iso);
  if (!weekday) return date;
  return `${date} ${weekday}`;
}

/** e.g. { date: "26 Aug", weekday: "Wednesday" } for overview holiday list rows */
export function formatOverviewHolidayRow(iso) {
  const d = parseLeaveDate(iso);
  if (!d) return { date: '—', weekday: '' };
  return {
    date: d.toLocaleDateString(APP_LOCALE, {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    }),
    weekday: d.toLocaleDateString(APP_LOCALE, {
      weekday: 'long',
      timeZone: 'UTC',
    }),
  };
}

export function formatDateTime(value) {
  const d = parseAppDateTime(value);
  if (!d) return value || '—';
  return d.toLocaleString(APP_LOCALE, {
    timeZone: APP_TIMEZONE,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/** Expected in-time is 11:00 IST. Before noon = on time, 12:xx = late, 1pm+ = very late. */
export function punchInLateness(value) {
  const parsed = parseAppDateTime(value);
  let hour = null;
  if (parsed) {
    hour = Number(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: APP_TIMEZONE,
        hour: '2-digit',
        hourCycle: 'h23',
      }).format(parsed)
    );
  } else {
    const match = String(value || '').match(/(\d{1,2}):(\d{2})/);
    if (match) hour = Number(match[1]);
  }
  if (hour == null || Number.isNaN(hour)) return null;
  if (hour < 12) return 'on-time';
  if (hour < 13) return 'late';
  return 'very-late';
}

export const REQUIRED_WORK_MINUTES = 540;

export function isUnderNineHours(workMinutes) {
  if (workMinutes == null || workMinutes === '') return false;
  return Number(workMinutes) < REQUIRED_WORK_MINUTES;
}

export function hasMissingPunchOut(session, todayYmd) {
  if (!session) return false;
  if (session.missingPunchOut) return true;
  if (session.punchOut) return false;
  const punchDate = String(session.punchDate || '').slice(0, 10);
  return Boolean(punchDate && todayYmd && punchDate < todayYmd);
}

/** Time only, e.g. "2:50 PM" — for punch times when the date is already shown. */
export function formatTime(value) {
  const d = parseAppDateTime(value);
  if (!d) return value || '—';
  return d.toLocaleTimeString(APP_LOCALE, {
    timeZone: APP_TIMEZONE,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export function formatLeaveSpan(leave) {
  const dates =
    leave.startDate === leave.endDate
      ? formatDate(leave.startDate)
      : `${formatDate(leave.startDate)} – ${formatDate(leave.endDate)}`;
  const session =
    leave.session && leave.session !== 'full'
      ? ` · ${SESSION_LABELS[leave.session] || leave.session}`
      : '';
  return `${dates}${session} · ${leave.days}d`;
}

export function isWfh(type) {
  return type === 'wfh';
}

export function homePathForRole(role) {
  if (role === 'hr') return '/hr';
  if (role === 'manager') return '/manager';
  return '/app';
}

export function feedPathForRole(_role) {
  return '/feed';
}

export function isPendingStatus(status) {
  return status === 'pending_manager' || status === 'pending_hr';
}

export function canUserCancel(status) {
  return ['approved', 'pending_manager', 'pending_hr'].includes(status);
}

/** Current calendar date in IST as a local Date (midnight), for UI “today”. */
export function appToday() {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(new Date())
    .split('-')
    .map(Number);
  return new Date(y, m - 1, d);
}

/** Current IST year (number). */
export function appYear() {
  return Number(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: APP_TIMEZONE,
      year: 'numeric',
    }).format(new Date())
  );
}

export const DEFAULT_AVATAR_SRC = '/assets/default-avatar.png';

export function avatarSrc(photo) {
  return photo || DEFAULT_AVATAR_SRC;
}

