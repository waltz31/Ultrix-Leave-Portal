import { todayIst } from './time.js';
import { summarizeDaySessions } from './punchSync.js';
import { attendanceRosterSql } from './attendanceRoster.js';

const LATE_AFTER = String(process.env.ATT4U_LATE_AFTER || '11:30:00').padEnd(8, ':00').slice(0, 8);

function pct(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 10000) / 100;
}

function ymdParts(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  return { y, m, d };
}

function addDays(ymd, days) {
  const { y, m, d } = ymdParts(ymd);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const pad = (n) => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

function monthBounds(ymd) {
  const { y, m } = ymdParts(ymd);
  const pad = (n) => String(n).padStart(2, '0');
  const start = `${y}-${pad(m)}-01`;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start, end: `${y}-${pad(m)}-${pad(last)}` };
}

function matchesFilter(row, { location, department }) {
  if (location && String(row.location || '') !== location) return false;
  if (department && String(row.department || '') !== department) return false;
  return true;
}

function indexBy(list, keyFn) {
  const map = new Map();
  for (const item of list) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

function punchTime(stamp) {
  return String(stamp || '').slice(11, 19);
}

/**
 * Fast attendance overview:
 * - detailed punches only for the selected date (live + recent)
 * - month trend from per-user first/last aggregates (no full punch dump)
 */
export async function buildAttendanceOverview(db, query = {}) {
  const date = String(query.date || todayIst()).slice(0, 10);
  const today = todayIst();
  const location = String(query.location || '').trim();
  const department = String(query.department || '').trim();
  const managerId = query.managerId != null ? Number(query.managerId) : null;
  const { start: monthStart, end: monthEnd } = monthBounds(date);
  // Full month through today so the calendar has every past day, not only up to the selected date.
  const trendEnd = monthEnd < today ? monthEnd : today;

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

  const employeeIds = [...new Set(employees.map((e) => e.id))];
  const employeeIdSet = new Set(employeeIds);
  const employeeById = new Map(employees.map((e) => [e.id, e]));
  const filters = {
    locations: [...new Set(employees.map((e) => e.location).filter(Boolean))].sort(),
    departments: [...new Set(employees.map((e) => e.department).filter(Boolean))].sort(),
  };

  const idPlaceholders = employeeIds.length ? employeeIds.map(() => '?').join(',') : '';
  const scopedPunchFilter = employeeIds.length
    ? `AND (p.user_id IN (${idPlaceholders}) OR p.user_id IS NULL)`
    : 'AND 1=0';
  // Managers never need unmapped device punches.
  const punchUserFilter = managerId
    ? employeeIds.length
      ? `AND p.user_id IN (${idPlaceholders})`
      : 'AND 1=0'
    : scopedPunchFilter;
  const punchParams = employeeIds.length ? employeeIds : [];

  const pendingSql = managerId
    ? `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN substr(CAST(lr.created_at AS TEXT), 1, 10) <= ? THEN 1 ELSE 0 END) AS older_than_three,
         SUM(CASE WHEN substr(CAST(lr.created_at AS TEXT), 1, 10) >= ? THEN 1 ELSE 0 END) AS this_week
       FROM leave_requests lr
       JOIN users u ON u.id = lr.user_id
       WHERE lr.status IN ('pending_manager', 'pending_hr')
         AND (u.manager_id = ? OR u.id = ?)`
    : `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN substr(CAST(created_at AS TEXT), 1, 10) <= ? THEN 1 ELSE 0 END) AS older_than_three,
         SUM(CASE WHEN substr(CAST(created_at AS TEXT), 1, 10) >= ? THEN 1 ELSE 0 END) AS this_week
       FROM leave_requests
       WHERE status IN ('pending_manager', 'pending_hr')`;

  const threeDaysAgo = addDays(date, -3);
  const weekAgo = addDays(date, -7);

  const [todayPunches, dayStatsRows, monthLeaves, pendingAgg] = await Promise.all([
    db
      .prepare(
        `SELECT p.id, p.user_id, p.device_user_code, p.punched_at, p.punch_date,
                p.direction, u.name AS user_name, u.employee_number
         FROM punch_logs p
         LEFT JOIN users u ON u.id = p.user_id
         WHERE p.punch_date = ? ${punchUserFilter}
         ORDER BY p.punched_at`
      )
      .all(date, ...punchParams),
    employeeIds.length
      ? db
          .prepare(
            `SELECT p.punch_date, p.user_id,
                    MIN(p.punched_at) AS first_at,
                    MAX(p.punched_at) AS last_at,
                    COUNT(*) AS punch_count
             FROM punch_logs p
             WHERE p.punch_date >= ? AND p.punch_date <= ?
               AND p.user_id IN (${idPlaceholders})
             GROUP BY p.punch_date, p.user_id`
          )
          .all(monthStart, trendEnd, ...employeeIds)
      : Promise.resolve([]),
    employeeIds.length
      ? db
          .prepare(
            `SELECT lr.user_id, lr.leave_type, lr.session, lr.start_date, lr.end_date,
                    u.name AS user_name, u.employee_number,
                    ep.department, ep.location
             FROM leave_requests lr
             JOIN users u ON u.id = lr.user_id
             LEFT JOIN employee_profiles ep ON ep.user_id = u.id
             WHERE lr.status = 'approved' AND lr.start_date <= ? AND lr.end_date >= ?
               AND lr.user_id IN (${idPlaceholders})`
          )
          .all(trendEnd, monthStart, ...employeeIds)
      : Promise.resolve([]),
    db
      .prepare(pendingSql)
      .get(
        ...(managerId
          ? [threeDaysAgo, weekAgo, managerId, managerId]
          : [threeDaysAgo, weekAgo])
      ),
  ]);

  const leavesByUser = indexBy(monthLeaves, (l) => l.user_id);

  function coveringLeaveRows(userId, day, wfh) {
    const list = leavesByUser.get(userId);
    if (!list) return [];
    return list.filter((leave) => {
      if (leave.start_date > day || leave.end_date < day) return false;
      const isWfh = leave.leave_type === 'wfh';
      return wfh ? isWfh : !isWfh;
    });
  }

  function coveringLeave(userId, day, wfh) {
    return coveringLeaveRows(userId, day, wfh).length > 0;
  }

  const todaySessions = summarizeDaySessions(
    todayPunches.map((p) => ({
      id: p.id,
      userId: p.user_id,
      userName: p.user_name,
      employeeNumber: p.employee_number,
      deviceUserCode: p.device_user_code,
      punchedAt: p.punched_at,
      punchDate: p.punch_date,
      direction: p.direction,
    }))
  );

  const byUserToday = new Map();
  const unmappedToday = [];
  for (const session of todaySessions) {
    if (session.userId && employeeIdSet.has(session.userId)) {
      byUserToday.set(session.userId, session);
    } else if (!session.userId && !managerId) {
      unmappedToday.push(session);
    }
  }

  let lateToday = 0;
  let inOffice = 0;
  let checkedOut = 0;
  for (const session of byUserToday.values()) {
    if (session.punchIn && punchTime(session.punchIn) > LATE_AFTER) lateToday += 1;
    if (session.stillIn) inOffice += 1;
    else checkedOut += 1;
  }

  let onLeaveToday = 0;
  let wfhToday = 0;
  const accountedToday = new Set(byUserToday.keys());
  for (const emp of employees) {
    if (coveringLeave(emp.id, date, false)) {
      onLeaveToday += 1;
      accountedToday.add(emp.id);
    } else if (coveringLeave(emp.id, date, true)) {
      wfhToday += 1;
      accountedToday.add(emp.id);
    }
  }
  const presentMapped = byUserToday.size;
  const absentToday = Math.max(0, employees.length - accountedToday.size);
  const unmappedIn = unmappedToday.filter((s) => s.stillIn).length;
  const unmappedOut = unmappedToday.length - unmappedIn;
  const yetToCheckIn = Math.max(0, employees.length - presentMapped - onLeaveToday - wfhToday);

  // Trend: index first punch per user/day
  const firstByDayUser = new Map();
  for (const row of dayStatsRows) {
    firstByDayUser.set(`${row.punch_date}|${row.user_id}`, row);
  }

  const trend = [];
  for (let cursor = monthStart; cursor <= trendEnd; cursor = addDays(cursor, 1)) {
    const punchedUsers = new Set();
    let late = 0;
    for (const emp of employees) {
      const row = firstByDayUser.get(`${cursor}|${emp.id}`);
      if (!row) continue;
      punchedUsers.add(emp.id);
      if (punchTime(row.first_at) > LATE_AFTER) late += 1;
    }
    let onLeave = 0;
    let wfh = 0;
    const accounted = new Set(punchedUsers);
    for (const emp of employees) {
      if (coveringLeave(emp.id, cursor, false)) {
        onLeave += 1;
        accounted.add(emp.id);
      } else if (coveringLeave(emp.id, cursor, true)) {
        wfh += 1;
        accounted.add(emp.id);
      }
    }
    trend.push({
      date: cursor,
      present: punchedUsers.size,
      absent: Math.max(0, employees.length - accounted.size),
      onLeave,
      late,
      wfh,
      total: employees.length,
    });
  }

  const deptMap = new Map();
  for (const emp of employees) {
    const key = emp.department || 'Unassigned';
    if (!deptMap.has(key)) {
      deptMap.set(key, {
        department: key,
        total: 0,
        present: 0,
        absent: 0,
        onLeave: 0,
        late: 0,
        wfh: 0,
      });
    }
    const row = deptMap.get(key);
    row.total += 1;
    const session = byUserToday.get(emp.id);
    const onLeave = coveringLeave(emp.id, date, false);
    const wfh = coveringLeave(emp.id, date, true);
    if (session) {
      row.present += 1;
      if (session.punchIn && punchTime(session.punchIn) > LATE_AFTER) row.late += 1;
    } else if (onLeave) row.onLeave += 1;
    else if (wfh) row.wfh += 1;
    else row.absent += 1;
  }
  const byDepartment = [...deptMap.values()]
    .map((row) => ({
      ...row,
      attendancePct: pct(row.present, row.total),
    }))
    .sort((a, b) => b.total - a.total);

  const pending = {
    total: Number(pendingAgg?.total) || 0,
    olderThanThreeDays: Number(pendingAgg?.older_than_three) || 0,
    thisWeek: Number(pendingAgg?.this_week) || 0,
  };

  const dayPunches = todaySessions
    .filter((s) => (s.userId ? employeeIdSet.has(s.userId) : !managerId))
    .map((session) => {
      const emp = employeeById.get(session.userId);
      const late =
        session.punchIn && punchTime(session.punchIn) > LATE_AFTER ? true : false;
      return {
        ...session,
        late,
        department: emp?.department || null,
        location: emp?.location || null,
        profilePhoto: null,
      };
    })
    .sort((a, b) => String(a.userName || '').localeCompare(String(b.userName || '')));

  const dayLeaves = [];
  for (const emp of employees) {
    const leaveRows = coveringLeaveRows(emp.id, date, false);
    for (const leave of leaveRows) {
      dayLeaves.push({
        userId: emp.id,
        userName: emp.name,
        employeeNumber: emp.employee_number,
        department: emp.department || null,
        location: emp.location || null,
        leaveType: leave.leave_type,
        session: leave.session || 'full',
        startDate: leave.start_date,
        endDate: leave.end_date,
      });
    }
    const wfhRows = coveringLeaveRows(emp.id, date, true);
    for (const leave of wfhRows) {
      dayLeaves.push({
        userId: emp.id,
        userName: emp.name,
        employeeNumber: emp.employee_number,
        department: emp.department || null,
        location: emp.location || null,
        leaveType: leave.leave_type,
        session: leave.session || 'full',
        startDate: leave.start_date,
        endDate: leave.end_date,
      });
    }
  }
  dayLeaves.sort((a, b) => String(a.userName || '').localeCompare(String(b.userName || '')));

  const leaveOrWfhIds = new Set(dayLeaves.map((row) => row.userId));
  const punchedIds = new Set(dayPunches.map((s) => s.userId).filter(Boolean));
  const dayNotPunched = employees
    .filter((emp) => !punchedIds.has(emp.id) && !leaveOrWfhIds.has(emp.id))
    .map((emp) => ({
      userId: emp.id,
      userName: emp.name,
      employeeNumber: emp.employee_number,
      department: emp.department || null,
      location: emp.location || null,
    }))
    .sort((a, b) => String(a.userName || '').localeCompare(String(b.userName || '')));

  // Backward-compatible alias for older clients.
  const recentPunches = dayPunches.slice(0, 8);

  const total = employees.length;
  return {
    date,
    monthStart,
    monthEnd,
    lateAfter: LATE_AFTER,
    filters,
    kpis: {
      totalEmployees: total,
      locations: filters.locations.length,
      present: presentMapped + unmappedToday.length,
      presentPct: pct(presentMapped, total),
      unmatchedPunches: unmappedToday.length,
      absent: absentToday,
      absentPct: pct(absentToday, total),
      onLeave: onLeaveToday,
      onLeavePct: pct(onLeaveToday, total),
      late: lateToday,
      latePct: pct(lateToday, total),
      wfh: wfhToday,
      wfhPct: pct(wfhToday, total),
    },
    distribution: [
      { name: 'Present', value: presentMapped + unmappedToday.length, key: 'present' },
      { name: 'Absent', value: absentToday, key: 'absent' },
      { name: 'On leave', value: onLeaveToday, key: 'leave' },
      { name: 'Late', value: lateToday, key: 'late' },
    ],
    trend,
    byDepartment,
    live: {
      inOffice: inOffice + unmappedIn,
      wfh: wfhToday,
      yetToCheckIn,
      checkedOut: checkedOut + unmappedOut,
    },
    pending,
    recentPunches,
    dayPunches,
    dayLeaves,
    dayNotPunched,
  };
}
