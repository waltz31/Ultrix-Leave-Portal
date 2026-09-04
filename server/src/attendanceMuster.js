import { isWeekendYmd } from './leaveUtils.js';
import { todayIst } from './time.js';
import { summarizeDaySessions } from './punchSync.js';
import { attendanceRosterSql } from './attendanceRoster.js';

const LATE_AFTER = String(process.env.ATT4U_LATE_AFTER || '10:00:00').padEnd(8, ':00').slice(0, 8);

function pct(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 10000) / 100;
}

function matchesFilter(row, { location, department }) {
  if (location && String(row.location || '') !== location) return false;
  if (department && String(row.department || '') !== department) return false;
  return true;
}

function isLatePunch(punchIn) {
  return Boolean(punchIn && String(punchIn).slice(11, 19) > LATE_AFTER);
}

/**
 * Daily attendance muster: one row per active employee (scoped for managers).
 * Columns exclude shift timing, remarks, and actions — status + punches only.
 */
export async function buildAttendanceMuster(db, query = {}) {
  const date = String(query.date || todayIst()).slice(0, 10);
  const location = String(query.location || '').trim();
  const department = String(query.department || '').trim();
  const managerId = query.managerId != null ? Number(query.managerId) : null;

  const employeeSql = managerId
    ? `SELECT u.id, u.name, u.employee_number, u.role, u.active,
              ep.department, ep.location, ep.work_mode
       FROM users u
       LEFT JOIN employee_profiles ep ON ep.user_id = u.id
       WHERE ${attendanceRosterSql('u')}
         AND (u.manager_id = ? OR u.id = ?)`
    : `SELECT u.id, u.name, u.employee_number, u.role, u.active,
              ep.department, ep.location, ep.work_mode
       FROM users u
       LEFT JOIN employee_profiles ep ON ep.user_id = u.id
       WHERE ${attendanceRosterSql('u')}`;

  const employees = (
    await db.prepare(employeeSql).all(...(managerId ? [managerId, managerId] : []))
  ).filter((row) => matchesFilter(row, { location, department }));

  const employeeIds = new Set(employees.map((e) => e.id));

  const filters = {
    locations: [...new Set(employees.map((e) => e.location).filter(Boolean))].sort(),
    departments: [...new Set(employees.map((e) => e.department).filter(Boolean))].sort(),
  };

  const punchRows = await db
    .prepare(
      `SELECT p.id, p.user_id, p.device_user_code, p.punched_at, p.punch_date,
              p.serial_number, p.direction, u.name AS user_name, u.employee_number
       FROM punch_logs p
       LEFT JOIN users u ON u.id = p.user_id
       WHERE p.punch_date = ?
       ORDER BY p.punched_at`
    )
    .all(date);

  const leaveRows = await db
    .prepare(
      `SELECT user_id, leave_type, start_date, end_date, session
       FROM leave_requests
       WHERE status = 'approved' AND start_date <= ? AND end_date >= ?`
    )
    .all(date, date);

  const holiday = await db
    .prepare(
      `SELECT id, title, holiday_type
       FROM mandatory_leaves
       WHERE start_date <= ? AND end_date >= ?
         AND COALESCE(holiday_type, 'general') = 'general'
       LIMIT 1`
    )
    .get(date, date);

  const weekend = isWeekendYmd(date);
  const dayOff = Boolean(weekend || holiday);

  const sessions = summarizeDaySessions(
    punchRows
      .filter((p) => {
        if (p.user_id != null) return employeeIds.has(p.user_id);
        return !managerId;
      })
      .map((p) => ({
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

  const sessionByUser = new Map();
  for (const session of sessions) {
    if (session.userId && employeeIds.has(session.userId)) {
      sessionByUser.set(session.userId, session);
    }
  }

  const leaveByUser = new Map();
  for (const leave of leaveRows) {
    if (!employeeIds.has(leave.user_id)) continue;
    if (!leaveByUser.has(leave.user_id)) leaveByUser.set(leave.user_id, leave);
  }

  const rows = employees
    .map((emp) => {
      const session = sessionByUser.get(emp.id) || null;
      const leave = leaveByUser.get(emp.id) || null;
      const leaveType = leave?.leave_type || null;
      const isWfh = leaveType === 'wfh';
      const onLeave = Boolean(leave && !isWfh);
      let status = 'absent';
      if (session) {
        status = isLatePunch(session.punchIn) ? 'late' : 'present';
      } else if (onLeave) {
        status = 'on_leave';
      } else if (isWfh) {
        status = 'wfh';
      } else if (dayOff) {
        status = weekend ? 'weekend' : 'holiday';
      }

      return {
        userId: emp.id,
        userName: emp.name,
        employeeNumber: emp.employee_number || null,
        department: emp.department || null,
        location: emp.location || null,
        profilePhoto: null,
        punchIn: session?.punchIn || null,
        punchOut: session?.punchOut || null,
        workHours: session?.workHours || null,
        workMinutes: session?.workMinutes ?? null,
        stillIn: Boolean(session?.stillIn),
        leaveType,
        status,
      };
    })
    .sort((a, b) => String(a.userName || '').localeCompare(String(b.userName || ''), undefined, { sensitivity: 'base' }));

  let present = 0;
  let late = 0;
  let absent = 0;
  let onLeave = 0;
  let wfh = 0;
  let weekendHoliday = 0;
  for (const row of rows) {
    if (row.status === 'present') present += 1;
    else if (row.status === 'late') late += 1;
    else if (row.status === 'absent') absent += 1;
    else if (row.status === 'on_leave') onLeave += 1;
    else if (row.status === 'wfh') wfh += 1;
    else if (row.status === 'weekend' || row.status === 'holiday') weekendHoliday += 1;
  }

  const total = rows.length;
  const attendanceDenom = Math.max(0, total - weekendHoliday);
  const attendanceRate = pct(present + late + wfh, attendanceDenom || total);

  return {
    date,
    lateAfter: LATE_AFTER,
    dayOff: {
      weekend,
      holiday: holiday
        ? { id: holiday.id, title: holiday.title, holidayType: holiday.holiday_type || 'general' }
        : null,
    },
    filters,
    kpis: {
      totalEmployees: total,
      present,
      presentPct: pct(present, total),
      late,
      latePct: pct(late, total),
      absent,
      absentPct: pct(absent, total),
      onLeave,
      onLeavePct: pct(onLeave, total),
      wfh,
      wfhPct: pct(wfh, total),
      weekendHoliday,
      attendanceRate,
    },
    rows,
  };
}
