import './time.js';

function parseDate(value) {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatYmd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Normalize DB/JSON date values to YYYY-MM-DD. */
export function asYmd(value) {
  if (value == null || value === '') return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  return text;
}

export function isWeekendYmd(value) {
  const ymd = asYmd(value);
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return false;
  const dow = new Date(y, m - 1, d).getDay();
  return dow === 0 || dow === 6;
}

/** All calendar days (incl. weekends) between two YYYY-MM-DD dates inclusive. */
export function eachCalendarDay(startDate, endDate) {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    return [];
  }
  const days = [];
  const cur = new Date(start);
  while (cur <= end) {
    days.push(formatYmd(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

/** Collapse sorted YYYY-MM-DD list into contiguous [start, end] ranges. */
export function contiguousRanges(dates) {
  if (!dates.length) return [];
  const sorted = [...dates].sort();
  const ranges = [];
  let rangeStart = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i < sorted.length; i += 1) {
    const day = sorted[i];
    const next = parseDate(prev);
    next.setDate(next.getDate() + 1);
    if (formatYmd(next) === day) {
      prev = day;
    } else {
      ranges.push({ startDate: rangeStart, endDate: prev });
      rangeStart = day;
      prev = day;
    }
  }
  ranges.push({ startDate: rangeStart, endDate: prev });
  return ranges;
}

/** Count weekdays (Mon–Fri) between two YYYY-MM-DD dates inclusive. */
export function countWeekdays(startDate, endDate, excludeDates = new Set()) {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error('Invalid date');
  }
  if (end < start) throw new Error('End date must be on or after start date');

  let days = 0;
  const cur = new Date(start);
  while (cur <= end) {
    const dow = cur.getDay();
    const ymd = formatYmd(cur);
    if (dow !== 0 && dow !== 6 && !excludeDates.has(ymd)) days += 1;
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

export const SESSIONS = ['full', 'morning', 'afternoon'];

/** Full-day weekday count, or 0.5 for morning/afternoon on a single weekday. */
export function countLeaveDays(startDate, endDate, session = 'full', excludeDates = new Set()) {
  const sess = SESSIONS.includes(session) ? session : 'full';
  if (sess !== 'full') {
    if (startDate !== endDate) {
      throw new Error('Morning/afternoon leave must be for a single day');
    }
    const weekdays = countWeekdays(startDate, endDate, excludeDates);
    if (weekdays <= 0) {
      throw new Error('Session leave must fall on a working day');
    }
    return 0.5;
  }
  return countWeekdays(startDate, endDate, excludeDates);
}

export function sessionsOverlap(a, b) {
  if (a.endDate < b.startDate || b.endDate < a.startDate) return false;
  const aHalf = a.session !== 'full' && a.startDate === a.endDate;
  const bHalf = b.session !== 'full' && b.startDate === b.endDate;
  if (aHalf && bHalf && a.startDate === b.startDate && a.session !== b.session) {
    return false;
  }
  return true;
}

export const LEAVE_TYPES = ['casual', 'earned', 'sick', 'restricted'];
export const REQUEST_TYPES = [...LEAVE_TYPES, 'wfh'];
export const DEFAULT_RESTRICTED_BALANCE = 2;

export function isBalanceType(type) {
  return LEAVE_TYPES.includes(type);
}

export function leaveTypeLabel(type) {
  const labels = {
    casual: 'Casual Leave',
    earned: 'Earned Leave',
    sick: 'Sick Leave',
    wfh: 'Work from Home',
    restricted: 'Restricted Leave',
    general: 'General Holiday',
    mandatory: 'Company Holiday',
  };
  return labels[type] || type;
}

export function mapMandatoryLeave(row) {
  if (!row) return null;
  const holidayType = row.holiday_type === 'restricted' ? 'restricted' : 'general';
  let days = 0;
  try {
    days = countWeekdays(row.start_date, row.end_date);
  } catch {
    days = 0;
  }
  return {
    id: `mandatory-${row.id}`,
    mandatoryId: row.id,
    isMandatory: true,
    holidayType,
    userId: null,
    userName: row.title,
    userEmail: null,
    employeeNumber: null,
    leaveType: holidayType,
    startDate: asYmd(row.start_date),
    endDate: asYmd(row.end_date),
    days,
    session: 'full',
    reason: row.note || null,
    status: 'approved',
    managerNote: null,
    managerId: null,
    managerName: null,
    managerReviewedAt: null,
    hrNote: row.note || null,
    hrId: row.created_by ?? null,
    hrName: row.created_by_name || null,
    hrReviewedAt: null,
    adminNote: row.note || null,
    createdAt: row.created_at,
    updatedAt: row.created_at,
  };
}

export function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    managerId: row.manager_id ?? null,
    managerName: row.manager_name ?? null,
    managerEmail: row.manager_email ?? null,
    employeeNumber: row.employee_number ?? null,
    active: Boolean(row.active),
    createdAt: row.created_at,
    profilePhoto: row.profile_photo || null,
  };
}

export function mapLeave(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.user_name,
    userEmail: row.user_email,
    employeeNumber: row.employee_number ?? null,
    leaveType: row.leave_type,
    startDate: row.start_date,
    endDate: row.end_date,
    days: row.days,
    session: row.session || 'full',
    reason: row.reason,
    status: row.status,
    managerNote: row.manager_note,
    managerId: row.manager_id,
    managerName: row.manager_reviewer_name || row.team_manager_name || null,
    managerReviewedAt: row.manager_reviewed_at,
    hrNote: row.hr_note,
    hrId: row.hr_id,
    hrName: row.hr_reviewer_name,
    hrReviewedAt: row.hr_reviewed_at,
    // back-compat aliases used in older UI
    adminNote: row.hr_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapBalance(row) {
  if (!row) {
    return { casual: 0, earned: 0, sick: 0, restricted: DEFAULT_RESTRICTED_BALANCE };
  }
  return {
    casual: row.casual ?? 0,
    earned: row.earned ?? 0,
    sick: row.sick ?? 0,
    restricted: row.restricted ?? row.compensation ?? DEFAULT_RESTRICTED_BALANCE,
    updatedAt: row.updated_at,
  };
}

export const LEAVE_SELECT = `
  SELECT lr.*,
         u.name AS user_name,
         u.email AS user_email,
         u.employee_number AS employee_number,
         team_mgr.name AS team_manager_name,
         mgr.name AS manager_reviewer_name,
         hr.name AS hr_reviewer_name
  FROM leave_requests lr
  JOIN users u ON u.id = lr.user_id
  LEFT JOIN users team_mgr ON team_mgr.id = u.manager_id
  LEFT JOIN users mgr ON mgr.id = lr.manager_id
  LEFT JOIN users hr ON hr.id = lr.hr_id
`;
