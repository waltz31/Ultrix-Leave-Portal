import {
  EXPECTED_WORK_MINUTES,
  formatWorkHours,
  isShortWorkDay,
  workMinutesBetween,
} from './punchSync.js';

export { EXPECTED_WORK_MINUTES, isShortWorkDay };

export const REGULARIZE_SELECT = `
  SELECT r.id, r.user_id, r.punch_date,
         r.current_punch_in, r.current_punch_out, r.current_work_minutes,
         r.proposed_punch_in, r.proposed_punch_out, r.reason, r.status,
         r.hr_note, r.hr_id, r.hr_reviewed_at, r.created_at, r.updated_at,
         u.name AS user_name, u.employee_number, u.email, u.manager_id,
         ep.department, ep.designation, ep.profile_photo, ep.personal_mobile,
         hr.name AS hr_name
  FROM attendance_regularizations r
  JOIN users u ON u.id = r.user_id
  LEFT JOIN employee_profiles ep ON ep.user_id = u.id
  LEFT JOIN users hr ON hr.id = r.hr_id
`;

export function classifyRegularizeIssue(row) {
  const punchIn = row.current_punch_in || row.currentPunchIn;
  const punchOut = row.current_punch_out || row.currentPunchOut;
  if (!punchIn && !punchOut) return { key: 'absent', label: 'Full Day Absent' };
  if (!punchIn) return { key: 'missing_in', label: 'Missing Check-In' };
  if (!punchOut) return { key: 'missing_out', label: 'Missing Check-Out' };
  return { key: 'hours', label: 'Incorrect Hours' };
}

export function formatRegCode(id, punchDate) {
  const year = String(punchDate || '').slice(0, 4) || '0000';
  return `REG-${year}-${String(id).padStart(6, '0')}`;
}

export function mapRegularization(row) {
  if (!row) return null;
  const issue = classifyRegularizeIssue(row);
  const pending = row.status === 'pending';
  const changesRequested = pending && Boolean(row.hr_note) && Boolean(row.hr_id);
  return {
    id: row.id,
    code: formatRegCode(row.id, row.punch_date),
    userId: row.user_id,
    userName: row.user_name,
    employeeNumber: row.employee_number || null,
    email: row.email || null,
    department: row.department || null,
    designation: row.designation || null,
    profilePhoto: row.profile_photo || null,
    phone: row.personal_mobile || null,
    punchDate: row.punch_date,
    currentPunchIn: row.current_punch_in,
    currentPunchOut: row.current_punch_out,
    currentWorkMinutes: row.current_work_minutes != null ? Number(row.current_work_minutes) : null,
    currentWorkHours: formatWorkHours(
      row.current_work_minutes != null ? Number(row.current_work_minutes) : null
    ),
    proposedPunchIn: row.proposed_punch_in,
    proposedPunchOut: row.proposed_punch_out,
    proposedWorkMinutes: workMinutesBetween(row.proposed_punch_in, row.proposed_punch_out),
    proposedWorkHours: formatWorkHours(
      workMinutesBetween(row.proposed_punch_in, row.proposed_punch_out)
    ),
    reason: row.reason || '',
    status: row.status,
    displayStatus: changesRequested ? 'changes_requested' : row.status,
    issueKey: issue.key,
    issueLabel: issue.label,
    hrNote: row.hr_note || '',
    hrId: row.hr_id || null,
    hrName: row.hr_name || null,
    hrReviewedAt: row.hr_reviewed_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Normalize to `YYYY-MM-DD HH:mm:ss` IST wall time. */
export function normalizeIstStamp(value, punchDate) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(raw)) {
    const m = raw.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
    if (!m) return null;
    return `${m[1]} ${m[2]}:${m[3]}:${m[4] || '00'}`;
  }
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(raw) && punchDate) {
    const [hh, mm, ss = '00'] = raw.split(':');
    return `${String(punchDate).slice(0, 10)} ${hh}:${mm}:${ss}`;
  }
  return null;
}

export function applyApprovedOverride(session, override) {
  if (!session || !override) return session;
  const punchIn = override.proposed_punch_in || override.proposedPunchIn;
  const punchOut = override.proposed_punch_out || override.proposedPunchOut;
  const workMinutes = workMinutesBetween(punchIn, punchOut);
  return {
    ...session,
    punchIn,
    punchOut,
    workMinutes,
    workHours: formatWorkHours(workMinutes),
    stillIn: !punchOut,
    direction: punchOut ? 'out' : 'in',
    needsRegularize: isShortWorkDay(workMinutes),
    overridden: true,
  };
}

export function monthDateRange(ymd) {
  const [year, month] = String(ymd || '').split('-').map(Number);
  if (!year || !month) return { start: ymd, end: ymd };
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const pad = (n) => String(n).padStart(2, '0');
  return { start: `${year}-${pad(month)}-01`, end: `${year}-${pad(month)}-${pad(last)}` };
}

export function stampToMs(value) {
  const text = String(value || '').trim().replace(' ', 'T');
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? null : ms;
}

export function averageApprovalDays(rows) {
  const days = [];
  for (const row of rows) {
    if (row.status !== 'approved' && row.status !== 'rejected') continue;
    const start = stampToMs(row.created_at);
    const end = stampToMs(row.hr_reviewed_at);
    if (start == null || end == null || end < start) continue;
    days.push((end - start) / 86400000);
  }
  if (!days.length) return 0;
  return Math.round((days.reduce((sum, n) => sum + n, 0) / days.length) * 10) / 10;
}

export function regularizeScope(user) {
  if (user.role === 'hr') return { clauses: [], params: [] };
  if (user.role === 'manager') {
    return { clauses: ['u.manager_id = ?'], params: [user.id] };
  }
  return { clauses: ['r.user_id = ?'], params: [user.id] };
}
