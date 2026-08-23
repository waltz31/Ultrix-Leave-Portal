import { todayIst } from './time.js';
import { summarizeDaySessions } from './punchSync.js';

const LATE_AFTER = String(process.env.ATT4U_LATE_AFTER || '10:00:00').padEnd(8, ':00').slice(0, 8);

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

export async function buildAttendanceOverview(db, query = {}) {
  const date = String(query.date || todayIst()).slice(0, 10);
  const location = String(query.location || '').trim();
  const department = String(query.department || '').trim();
  const { start: monthStart, end: monthEnd } = monthBounds(date);

  const employees = (
    await db
      .prepare(
        `SELECT u.id, u.name, u.employee_number, u.role, u.active,
                ep.department, ep.location, ep.profile_photo, ep.work_mode
         FROM users u
         LEFT JOIN employee_profiles ep ON ep.user_id = u.id
         WHERE u.active = 1 AND u.role IN ('user', 'manager', 'hr')`
      )
      .all()
  ).filter((row) => matchesFilter(row, { location, department }));

  const employeeIds = new Set(employees.map((e) => e.id));
  const filters = {
    locations: [
      ...new Set(
        employees.map((e) => e.location).filter(Boolean)
      ),
    ].sort(),
    departments: [
      ...new Set(
        employees.map((e) => e.department).filter(Boolean)
      ),
    ].sort(),
  };

  const monthPunches = await db
    .prepare(
      `SELECT p.id, p.user_id, p.device_user_code, p.punched_at, p.punch_date,
              p.serial_number, p.direction, u.name AS user_name, u.employee_number
       FROM punch_logs p
       LEFT JOIN users u ON u.id = p.user_id
       WHERE p.punch_date >= ? AND p.punch_date <= ?
       ORDER BY p.punched_at`
    )
    .all(monthStart, monthEnd);

  const monthLeaves = await db
    .prepare(
      `SELECT user_id, leave_type, start_date, end_date
       FROM leave_requests
       WHERE status = 'approved' AND start_date <= ? AND end_date >= ?`
    )
    .all(monthEnd, monthStart);

  const pendingRows = await db
    .prepare(
      `SELECT lr.id, lr.created_at, lr.status, u.name AS user_name
       FROM leave_requests lr
       JOIN users u ON u.id = lr.user_id
       WHERE lr.status IN ('pending_manager', 'pending_hr')
       ORDER BY lr.created_at DESC`
    )
    .all();

  function coveringLeave(userId, day, wfh) {
    return monthLeaves.some((leave) => {
      if (leave.user_id !== userId) return false;
      if (leave.start_date > day || leave.end_date < day) return false;
      const isWfh = leave.leave_type === 'wfh';
      return wfh ? isWfh : !isWfh;
    });
  }

  function sessionsForDay(day) {
    const rows = monthPunches.filter((p) => p.punch_date === day);
    const scoped = rows.filter(
      (p) => p.user_id == null || employeeIds.has(p.user_id)
    );
    return summarizeDaySessions(
      scoped.map((p) => ({
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
  }

  function statsForDay(day) {
    const sessions = sessionsForDay(day);
    const byUser = new Map();
    const unmapped = [];
    for (const session of sessions) {
      if (session.userId && employeeIds.has(session.userId)) {
        byUser.set(session.userId, session);
      } else if (!session.userId) {
        unmapped.push(session);
      }
    }
    let late = 0;
    let inOffice = 0;
    let checkedOut = 0;
    for (const session of byUser.values()) {
      if (session.punchIn && session.punchIn.slice(11) > LATE_AFTER) late += 1;
      if (session.stillIn) inOffice += 1;
      else checkedOut += 1;
    }
    const presentMapped = byUser.size;
    let onLeave = 0;
    let wfh = 0;
    for (const emp of employees) {
      if (coveringLeave(emp.id, day, false)) onLeave += 1;
      else if (coveringLeave(emp.id, day, true)) wfh += 1;
    }
    const total = employees.length;
    const accounted = new Set([
      ...byUser.keys(),
      ...employees
        .filter((e) => coveringLeave(e.id, day, false) || coveringLeave(e.id, day, true))
        .map((e) => e.id),
    ]);
    const absent = Math.max(0, employees.length - accounted.size);
    let unmappedIn = 0;
    let unmappedOut = 0;
    for (const session of unmapped) {
      if (session.stillIn) unmappedIn += 1;
      else unmappedOut += 1;
    }
    const yetToCheckIn = Math.max(0, employees.length - presentMapped - onLeave - wfh);
    return {
      total,
      present: presentMapped,
      presentMapped,
      unmapped: unmapped.length,
      absent,
      onLeave,
      wfh,
      late,
      inOffice: inOffice + unmappedIn,
      checkedOut: checkedOut + unmappedOut,
      yetToCheckIn,
      sessions,
    };
  }

  const today = statsForDay(date);
  const trend = [];
  for (let cursor = monthStart; cursor <= monthEnd && cursor <= date; cursor = addDays(cursor, 1)) {
    const day = statsForDay(cursor);
    trend.push({
      date: cursor,
      present: day.presentMapped + day.unmapped,
      absent: day.absent,
      onLeave: day.onLeave,
      late: day.late,
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
    const session = today.sessions.find((p) => p.userId === emp.id);
    const onLeave = coveringLeave(emp.id, date, false);
    const wfh = coveringLeave(emp.id, date, true);
    if (session) {
      row.present += 1;
      if (session.punchIn && session.punchIn.slice(11) > LATE_AFTER) row.late += 1;
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

  const threeDaysAgo = addDays(date, -3);
  const weekAgo = addDays(date, -7);
  const pending = {
    total: pendingRows.length,
    olderThanThreeDays: pendingRows.filter((r) => String(r.created_at).slice(0, 10) <= threeDaysAgo).length,
    thisWeek: pendingRows.filter((r) => String(r.created_at).slice(0, 10) >= weekAgo).length,
  };

  const recentPunches = today.sessions.slice(0, 8).map((session) => {
    const emp = employees.find((e) => e.id === session.userId);
    return {
      ...session,
      department: emp?.department || null,
      location: emp?.location || null,
      profilePhoto: emp?.profile_photo || null,
    };
  });

  const total = today.total || employees.length;
  return {
    date,
    lateAfter: LATE_AFTER,
    filters,
    kpis: {
      totalEmployees: total,
      locations: filters.locations.length,
      present: today.presentMapped + today.unmapped,
      presentPct: pct(today.presentMapped, total),
      unmatchedPunches: today.unmapped,
      absent: today.absent,
      absentPct: pct(today.absent, total),
      onLeave: today.onLeave,
      onLeavePct: pct(today.onLeave, total),
      late: today.late,
      latePct: pct(today.late, total),
      wfh: today.wfh,
      wfhPct: pct(today.wfh, total),
    },
    distribution: [
      { name: 'Present', value: today.presentMapped + today.unmapped, key: 'present' },
      { name: 'Absent', value: today.absent, key: 'absent' },
      { name: 'On leave', value: today.onLeave, key: 'leave' },
      { name: 'Late', value: today.late, key: 'late' },
    ],
    trend,
    byDepartment,
    live: {
      inOffice: today.inOffice,
      wfh: today.wfh,
      yetToCheckIn: today.yetToCheckIn,
      checkedOut: today.checkedOut,
    },
    pending,
    recentPunches,
  };
}
