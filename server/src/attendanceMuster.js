import { asYmd, eachCalendarDay, isWeekendYmd, mapBalance } from './leaveUtils.js';
import { syncLeaveAccrualsForUsers, visibleEarnedBalance } from './leaveAccrual.js';
import { todayIst } from './time.js';
import { summarizeDaySessions } from './punchSync.js';
import { attendanceRosterSql } from './attendanceRoster.js';

const LATE_AFTER = String(process.env.ATT4U_LATE_AFTER || '11:30:00').padEnd(8, ':00').slice(0, 8);

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const LEAVE_CODE = {
  earned: 'EL',
  casual: 'CL',
  sick: 'SL',
  restricted: 'RH',
  celebration: 'L',
  wfh: 'P',
};

/** Columns shown beside the calendar dates: leave types + current balances. */
const BALANCE_COLUMNS = [
  { key: 'EL', field: 'earned', label: 'EL' },
  { key: 'SL', field: 'sick', label: 'SL' },
  { key: 'CL', field: 'casual', label: 'CL' },
  { key: 'RH', field: 'restricted', label: 'RH' },
  { key: 'Celeb', field: 'celebration', label: 'Celeb' },
];

const TOTAL_KEYS = BALANCE_COLUMNS.map((c) => c.key);

function pad(n) {
  return String(n).padStart(2, '0');
}

function monthFromQuery(query = {}) {
  const monthRaw = String(query.month || '').trim();
  if (/^\d{4}-\d{2}$/.test(monthRaw)) return monthRaw;
  const date = String(query.date || todayIst()).slice(0, 10);
  return date.slice(0, 7);
}

function monthBounds(month) {
  const [y, m] = month.split('-').map(Number);
  const start = `${y}-${pad(m)}-01`;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start, end: `${y}-${pad(m)}-${pad(last)}` };
}

function matchesFilter(row, { location, department, userId }) {
  if (location && String(row.location || '') !== location) return false;
  if (department && String(row.department || '') !== department) return false;
  if (userId && Number(row.id) !== Number(userId)) return false;
  return true;
}

function balanceTotals(row, dateOfJoining, todayYmd = todayIst()) {
  const bal = mapBalance(row);
  // Match /balances/me: EL stays 0 until the 7th month (after 6 completed months).
  bal.earned = visibleEarnedBalance(bal.earned, dateOfJoining, todayYmd);
  const out = {};
  for (const col of BALANCE_COLUMNS) {
    const n = Number(bal[col.field]);
    out[col.key] = Number.isFinite(n) ? n : 0;
  }
  return out;
}

function leaveCode(leaveType) {
  if (!leaveType) return null;
  return LEAVE_CODE[String(leaveType).toLowerCase()] || 'L';
}

function dayMeta(ymd, holidayByDate) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dow = new Date(y, m - 1, d).getDay();
  const weekend = isWeekendYmd(ymd);
  const holiday = holidayByDate.get(ymd) || null;
  return {
    ymd,
    day: d,
    weekday: WEEKDAYS[dow],
    isWeekend: weekend,
    holiday: holiday
      ? { id: holiday.id, title: holiday.title, holidayType: holiday.holiday_type || 'general' }
      : null,
  };
}

/**
 * Classify one employee-day for the monthly muster grid.
 * Codes: P, A, EL, CL, SL, RH, L, H, OFF, OD, ER, ?, -
 */
function classifyCell({ ymd, today, weekend, holiday, leave, hasPunch, late }) {
  if (ymd > today) return { code: '-', tone: 'future' };

  const leaveType = leave?.leave_type || null;
  const codeFromLeave = leaveCode(leaveType);
  const isWfh = leaveType === 'wfh';

  if (hasPunch) {
    return {
      code: 'P',
      tone: late ? 'grace' : 'present',
      late: Boolean(late),
      leaveType,
    };
  }

  if (leave && !isWfh && codeFromLeave) {
    return {
      code: codeFromLeave,
      tone: 'leave',
      leaveType,
    };
  }

  if (isWfh) {
    return { code: 'P', tone: 'present', leaveType: 'wfh' };
  }

  if (weekend) {
    return { code: 'OFF', tone: 'off' };
  }

  if (holiday) {
    return { code: 'H', tone: 'holiday', holidayTitle: holiday.title };
  }

  // Today with no punch yet — still open.
  if (ymd === today) {
    return { code: '-', tone: 'open' };
  }

  return { code: 'A', tone: 'absent' };
}

/**
 * Monthly attendance muster: employees × calendar days with status codes.
 */
export async function buildAttendanceMuster(db, query = {}) {
  const month = monthFromQuery(query);
  const { start, end } = monthBounds(month);
  const today = todayIst();
  const location = String(query.location || '').trim();
  const department = String(query.department || query.category || '').trim();
  const userIdFilter = query.userId != null && query.userId !== '' ? Number(query.userId) : null;
  const managerId = query.managerId != null ? Number(query.managerId) : null;

  const employeeSql = managerId
    ? `SELECT u.id, u.name, u.employee_number, u.role, u.active,
              ep.department, ep.location, ep.work_mode, ep.designation, ep.date_of_joining
       FROM users u
       LEFT JOIN employee_profiles ep ON ep.user_id = u.id
       WHERE ${attendanceRosterSql('u')}
         AND (u.manager_id = ? OR u.id = ?)`
    : `SELECT u.id, u.name, u.employee_number, u.role, u.active,
              ep.department, ep.location, ep.work_mode, ep.designation, ep.date_of_joining
       FROM users u
       LEFT JOIN employee_profiles ep ON ep.user_id = u.id
       WHERE ${attendanceRosterSql('u')}`;

  const allEmployees = await db
    .prepare(employeeSql)
    .all(...(managerId ? [managerId, managerId] : []));

  const employees = allEmployees.filter((row) =>
    matchesFilter(row, { location, department, userId: userIdFilter })
  );

  const employeeIdList = employees.map((e) => e.id);
  const employeeIds = new Set(employeeIdList);

  // Accrual sync is expensive over remote Postgres — never block muster on it.
  // Run in the background so balances catch up on the next refresh.
  if (employeeIdList.length) {
    void syncLeaveAccrualsForUsers(employeeIdList).catch((err) => {
      console.error('Muster background accrual sync failed:', err?.message || err);
    });
  }

  const filters = {
    locations: [...new Set(allEmployees.map((e) => e.location).filter(Boolean))].sort(),
    departments: [...new Set(allEmployees.map((e) => e.department).filter(Boolean))].sort(),
    employees: allEmployees
      .map((e) => ({
        id: e.id,
        name: e.name,
        employeeNumber: e.employee_number || null,
      }))
      .sort((a, b) =>
        String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' })
      ),
  };

  const idPlaceholders = employeeIdList.length ? employeeIdList.map(() => '?').join(',') : '';
  const punchUserFilter = managerId
    ? employeeIdList.length
      ? `AND p.user_id IN (${idPlaceholders})`
      : 'AND 1=0'
    : employeeIdList.length
      ? `AND (p.user_id IN (${idPlaceholders}) OR p.user_id IS NULL)`
      : 'AND 1=0';

  const [punchRows, leaveRows, holidayRows, balanceRows] = await Promise.all([
    employeeIdList.length
      ? db
          .prepare(
            `SELECT p.id, p.user_id, p.device_user_code, p.punched_at, p.punch_date,
                    p.serial_number, p.direction, u.name AS user_name, u.employee_number
             FROM punch_logs p
             LEFT JOIN users u ON u.id = p.user_id
             WHERE p.punch_date >= ? AND p.punch_date <= ? ${punchUserFilter}
             ORDER BY p.punched_at`
          )
          .all(start, end, ...employeeIdList)
      : Promise.resolve([]),
    employeeIdList.length
      ? db
          .prepare(
            `SELECT user_id, leave_type, start_date, end_date, session
             FROM leave_requests
             WHERE status = 'approved' AND start_date <= ? AND end_date >= ?
               AND user_id IN (${idPlaceholders})`
          )
          .all(end, start, ...employeeIdList)
      : Promise.resolve([]),
    db
      .prepare(
        `SELECT id, title, holiday_type, start_date, end_date
         FROM mandatory_leaves
         WHERE start_date <= ? AND end_date >= ?
           AND COALESCE(holiday_type, 'general') <> 'restricted'`
      )
      .all(end, start),
    employeeIdList.length
      ? db
          .prepare(
            `SELECT user_id, casual, earned, sick, restricted, celebration
             FROM leave_balances
             WHERE user_id IN (${idPlaceholders})`
          )
          .all(...employeeIdList)
      : Promise.resolve([]),
  ]);

  const balanceByUser = new Map(balanceRows.map((b) => [b.user_id, b]));

  const days = eachCalendarDay(start, end);
  const holidayByDate = new Map();
  for (const h of holidayRows) {
    for (const ymd of eachCalendarDay(asYmd(h.start_date), asYmd(h.end_date))) {
      if (ymd < start || ymd > end) continue;
      if (!holidayByDate.has(ymd)) holidayByDate.set(ymd, h);
    }
  }

  const dayColumns = days.map((ymd) => dayMeta(ymd, holidayByDate));

  const sessions = summarizeDaySessions(
    punchRows.map((p) => ({
      id: p.id,
      userId: p.user_id,
      userName: p.user_name,
      employeeNumber: p.employee_number,
      deviceUserCode: p.device_user_code,
      punchedAt: p.punched_at,
      punchDate: p.punch_date,
      serialNumber: p.serial_number,
      direction: p.direction,
    }))
  );

  const sessionByUserDate = new Map();
  for (const session of sessions) {
    if (!session.userId || !employeeIds.has(session.userId)) continue;
    const ymd = asYmd(session.punchDate);
    sessionByUserDate.set(`${session.userId}|${ymd}`, session);
  }

  const leaveByUserDate = new Map();
  for (const leave of leaveRows) {
    if (!employeeIds.has(leave.user_id)) continue;
    for (const ymd of eachCalendarDay(asYmd(leave.start_date), asYmd(leave.end_date))) {
      if (ymd < start || ymd > end) continue;
      const key = `${leave.user_id}|${ymd}`;
      if (!leaveByUserDate.has(key)) leaveByUserDate.set(key, leave);
    }
  }

  const rows = employees
    .map((emp) => {
      const cells = {};
      for (const col of dayColumns) {
        const key = `${emp.id}|${col.ymd}`;
        const session = sessionByUserDate.get(key) || null;
        const leave = leaveByUserDate.get(key) || null;
        const late = Boolean(
          session?.punchIn && String(session.punchIn).slice(11, 19) > LATE_AFTER
        );
        cells[col.ymd] = classifyCell({
          ymd: col.ymd,
          today,
          weekend: col.isWeekend,
          holiday: col.holiday,
          leave,
          hasPunch: Boolean(session?.punchIn),
          late,
        });
      }

      const roleBits = [emp.designation, emp.location || emp.department].filter(Boolean);

      return {
        userId: emp.id,
        userName: emp.name,
        employeeNumber: emp.employee_number || null,
        designation: emp.designation || null,
        department: emp.department || null,
        location: emp.location || null,
        subtitle: roleBits.join(', ') || null,
        cells,
        totals: balanceTotals(balanceByUser.get(emp.id), emp.date_of_joining, today),
      };
    })
    .sort((a, b) =>
      String(a.userName || '').localeCompare(String(b.userName || ''), undefined, { sensitivity: 'base' })
    );

  return {
    month,
    from: start,
    to: end,
    today,
    cycle: 'Default Attendance Cycle',
    days: dayColumns,
    filters,
    totalKeys: TOTAL_KEYS,
    balanceColumns: BALANCE_COLUMNS,
    legend: [
      { code: 'P', label: 'Present', tone: 'present' },
      { code: 'A', label: 'Absent', tone: 'absent' },
      { code: 'EL', label: 'Earned Leave', tone: 'leave' },
      { code: 'CL', label: 'Casual Leave', tone: 'leave' },
      { code: 'SL', label: 'Sick Leave', tone: 'leave' },
      { code: 'RH', label: 'Restricted Holiday', tone: 'leave' },
      { code: 'L', label: 'Celebration Leave', tone: 'leave' },
      { code: 'OFF', label: 'Off Day', tone: 'off' },
      { code: 'H', label: 'Holiday', tone: 'holiday' },
      { code: 'Grace', label: 'Grace / late', tone: 'grace' },
    ],
    rows,
  };
}
