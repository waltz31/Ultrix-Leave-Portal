export const LEAVE_LABELS = {
  casual: 'Casual Leave',
  earned: 'Earned Leave',
  sick: 'Sick Leave',
  compensation: 'Compensation Leave',
};

export const APPLY_LABELS = {
  ...LEAVE_LABELS,
  wfh: 'Work from Home',
  restricted: 'Restricted Holiday',
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

/** App timezone — Indian Standard Time. */
export const APP_TIMEZONE = 'Asia/Kolkata';
export const APP_LOCALE = 'en-IN';

/** Parse a leave calendar date `YYYY-MM-DD` without shifting the day. */
export function parseLeaveDate(iso) {
  if (!iso) return null;
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d));
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

