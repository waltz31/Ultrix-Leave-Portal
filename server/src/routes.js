import { Router } from 'express';
import db from './db.js';
import {
  authRequired,
  hrRequired,
  managerRequired,
  managerOrHrRequired,
  hashPassword,
  verifyPassword,
  signToken,
} from './auth.js';
import {
  countLeaveDays,
  REQUEST_TYPES,
  isBalanceType,
  publicUser,
  mapLeave,
  mapBalance,
  LEAVE_SELECT,
  LEAVE_TYPES,
  SESSIONS,
  sessionsOverlap,
  eachCalendarDay,
  contiguousRanges,
} from './leaveUtils.js';
import { notifyLeaveApplied } from './slack.js';
import {
  mailLeaveApplied,
  mailManagerApproved,
  mailHrApproved,
  mailRejected,
  mailCancelled,
} from './mail.js';
import { todayIst } from './time.js';
import { SQL_NOW_IST, SQL_TODAY_IST, isUniqueViolation } from './sqlDialect.js';
import { mapRating, RATING_SELECT } from './ratingUtils.js';
import { mapInvoice, validateInvoicePayload, INVOICE_SELECT } from './invoiceUtils.js';

const router = Router();

async function getRatingById(id) {
  return await db.prepare(`${RATING_SELECT} WHERE er.id = ?`).get(id);
}

async function getBalance(userId) {
  return (
    (await db.prepare('SELECT * FROM leave_balances WHERE user_id = ?').get(userId)) || {
      casual: 0,
      earned: 0,
      sick: 0,
    }
  );
}

async function ensureBalanceRow(userId) {
  await db.prepare(
    `INSERT INTO leave_balances (user_id, casual, earned, sick)
     VALUES (?, 0, 0, 0)
     ON CONFLICT(user_id) DO NOTHING`
  ).run(userId);
}

async function getLeaveById(id) {
  return await db.prepare(`${LEAVE_SELECT} WHERE lr.id = ?`).get(id);
}

async function notifyUser({ userId, leaveId, type, title, message }) {
  if (!userId) return;
  await db.prepare(
    `INSERT INTO notifications (user_id, leave_id, type, title, message)
     VALUES (?, ?, ?, ?, ?)`
  ).run(userId, leaveId ?? null, type, title, message);
}

async function notifyMany(userIds, payload) {
  const unique = [...new Set(userIds.filter(Boolean))];
  for (const userId of unique) {
    await notifyUser({ ...payload, userId });
  }
}

async function getHrIds() {
  return (await db
    .prepare(`SELECT id FROM users WHERE role = 'hr' AND active = 1`)
    .all())
    .map((r) => r.id);
}

function leaveLabel(type) {
  return type === 'wfh' ? 'WFH' : `${type} leave`;
}

// ——— Auth ———
router.post('/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  const user = await db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (!user || !user.active || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  res.json({ token: signToken(user), user: publicUser(user) });
});

router.get('/auth/me', authRequired, async (req, res) => {
  res.json({ user: publicUser(req.user) });
});

router.patch('/auth/password', authRequired, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new password are required' });
  }
  if (String(newPassword).length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!verifyPassword(currentPassword, user.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  await db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(
    hashPassword(newPassword),
    user.id
  );
  res.json({ ok: true });
});

router.patch('/auth/profile', authRequired, hrRequired, async (req, res) => {
  const { name } = req.body || {};
  const nextName = String(name || '').trim();
  if (!nextName || nextName.length < 2) {
    return res.status(400).json({ error: 'Name must be at least 2 characters' });
  }
  if (nextName.length > 80) {
    return res.status(400).json({ error: 'Name is too long' });
  }
  await db.prepare(`UPDATE users SET name = ? WHERE id = ?`).run(nextName, req.user.id);
  const updated = await db.prepare(`SELECT * FROM users WHERE id = ?`).get(req.user.id);
  res.json({ user: publicUser(updated) });
});

// ——— Directory helpers ———
router.get('/managers', authRequired, hrRequired, async (_req, res) => {
  const managers = (await db
    .prepare(
      `SELECT id, name, email, role, active, created_at
       FROM users WHERE role = 'manager' ORDER BY name COLLATE NOCASE`
    )
    .all())
    .map(publicUser);
  res.json({ managers });
});

// ——— Users (HR) ———
router.get('/users', authRequired, managerOrHrRequired, async (req, res) => {
  if (req.user.role === 'manager') {
    const users = (await db
      .prepare(
        `SELECT u.*, b.casual, b.earned, b.sick, m.name AS manager_name,
                COALESCE((
                  SELECT SUM(lr.days) FROM leave_requests lr
                  WHERE lr.user_id = u.id AND lr.status = 'approved' AND lr.leave_type = 'wfh'
                ), 0) AS wfh_days
         FROM users u
         LEFT JOIN leave_balances b ON b.user_id = u.id
         LEFT JOIN users m ON m.id = u.manager_id
         WHERE u.role = 'user' AND u.manager_id = ?
         ORDER BY u.name COLLATE NOCASE`
      )
      .all(req.user.id))
      .map((row) => ({
        ...publicUser(row),
        balances: mapBalance(row),
        wfhDays: row.wfh_days || 0,
      }));
    return res.json({ users });
  }

  const users = (await db
    .prepare(
      `SELECT u.*, b.casual, b.earned, b.sick, m.name AS manager_name,
              COALESCE((
                SELECT SUM(lr.days) FROM leave_requests lr
                WHERE lr.user_id = u.id AND lr.status = 'approved' AND lr.leave_type = 'wfh'
              ), 0) AS wfh_days
       FROM users u
       LEFT JOIN leave_balances b ON b.user_id = u.id
       LEFT JOIN users m ON m.id = u.manager_id
       WHERE u.role = 'user'
       ORDER BY u.name COLLATE NOCASE`
    )
    .all())
    .map((row) => ({
      ...publicUser(row),
      balances: mapBalance(row),
      wfhDays: row.wfh_days || 0,
    }));
  res.json({ users });
});

router.post('/users', authRequired, hrRequired, async (req, res) => {
  const { name, email, password, role = 'user', managerId, employeeNumber } = req.body || {};
  if (!name?.trim() || !email?.trim() || !password || password.length < 6) {
    return res.status(400).json({
      error: 'Name, email, and password (min 6 chars) are required',
    });
  }
  if (!['user', 'manager'].includes(role)) {
    return res.status(400).json({ error: 'role must be user or manager' });
  }

  const empNo = String(employeeNumber || '').trim();
  if (role === 'user') {
    if (!empNo) {
      return res.status(400).json({ error: 'Employee number is required for employees' });
    }
    if (empNo.length > 40) {
      return res.status(400).json({ error: 'Employee number is too long' });
    }
  }

  let mgrId = null;
  if (role === 'user') {
    if (!managerId) {
      return res.status(400).json({ error: 'Employees must be assigned a manager' });
    }
    const mgr = await db
      .prepare(`SELECT id FROM users WHERE id = ? AND role = 'manager' AND active = 1`)
      .get(Number(managerId));
    if (!mgr) return res.status(400).json({ error: 'Invalid manager' });
    mgrId = mgr.id;
  }

  try {
    const result = await db
      .prepare(
        `INSERT INTO users (name, email, password_hash, role, manager_id, employee_number)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        name.trim(),
        email.toLowerCase().trim(),
        hashPassword(password),
        role,
        mgrId,
        role === 'user' ? empNo : empNo || null
      );
    await ensureBalanceRow(result.lastInsertRowid);
    const user = await db
      .prepare(
        `SELECT u.*, m.name AS manager_name FROM users u
         LEFT JOIN users m ON m.id = u.manager_id WHERE u.id = ?`
      )
      .get(result.lastInsertRowid);
    res.status(201).json({ user: publicUser(user) });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      const msg = String(err.message).toLowerCase();
      if (msg.includes('employee_number') || msg.includes('idx_users_employee_number')) {
        return res.status(409).json({ error: 'Employee number already exists' });
      }
      return res.status(409).json({ error: 'Email already exists' });
    }
    throw err;
  }
});

router.patch('/users/:id', authRequired, hrRequired, async (req, res) => {
  const id = Number(req.params.id);
  const user = await db
    .prepare(`SELECT * FROM users WHERE id = ? AND role IN ('user', 'manager')`)
    .get(id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const { name, email, password, active, managerId, employeeNumber } = req.body || {};
  const nextName = name?.trim() || user.name;
  const nextEmail = email?.trim() ? email.toLowerCase().trim() : user.email;
  const nextActive = typeof active === 'boolean' ? (active ? 1 : 0) : user.active;
  const nextHash = password ? hashPassword(password) : user.password_hash;

  let nextEmployeeNumber = user.employee_number;
  if (employeeNumber !== undefined) {
    const empNo = String(employeeNumber || '').trim();
    if (user.role === 'user' && !empNo) {
      return res.status(400).json({ error: 'Employee number is required for employees' });
    }
    if (empNo.length > 40) {
      return res.status(400).json({ error: 'Employee number is too long' });
    }
    nextEmployeeNumber = empNo || null;
  }

  let nextManagerId = user.manager_id;
  if (user.role === 'user' && managerId !== undefined) {
    if (managerId === null || managerId === '') {
      return res.status(400).json({ error: 'Employees must be assigned a manager' });
    }
    const mgr = await db
      .prepare(`SELECT id FROM users WHERE id = ? AND role = 'manager' AND active = 1`)
      .get(Number(managerId));
    if (!mgr) return res.status(400).json({ error: 'Invalid manager' });
    nextManagerId = mgr.id;
  }

  try {
    await db.prepare(
      `UPDATE users SET name = ?, email = ?, password_hash = ?, active = ?, manager_id = ?, employee_number = ?
       WHERE id = ?`
    ).run(nextName, nextEmail, nextHash, nextActive, nextManagerId, nextEmployeeNumber, id);
    const updated = await db
      .prepare(
        `SELECT u.*, m.name AS manager_name FROM users u
         LEFT JOIN users m ON m.id = u.manager_id WHERE u.id = ?`
      )
      .get(id);
    res.json({ user: publicUser(updated) });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      const msg = String(err.message).toLowerCase();
      if (msg.includes('employee_number') || msg.includes('idx_users_employee_number')) {
        return res.status(409).json({ error: 'Employee number already exists' });
      }
      return res.status(409).json({ error: 'Email already exists' });
    }
    throw err;
  }
});

router.delete('/users/:id', authRequired, hrRequired, async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) {
    return res.status(400).json({ error: 'You cannot delete your own account' });
  }
  const user = await db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.role !== 'user') {
    return res.status(400).json({ error: 'Only employees can be deleted from here' });
  }

  await db.transaction(async () => {
    await db.prepare(`DELETE FROM notifications WHERE user_id = ?`).run(id);
    await db.prepare(`DELETE FROM balance_credits WHERE user_id = ? OR credited_by = ?`).run(id, id);
    await db.prepare(`DELETE FROM leave_requests WHERE user_id = ?`).run(id);
    await db.prepare(`DELETE FROM leave_balances WHERE user_id = ?`).run(id);
    await db.prepare(`DELETE FROM users WHERE id = ?`).run(id);
  });

  res.json({ ok: true });
});

// ——— Balances ———
router.get('/balances/me', authRequired, async (req, res) => {
  await ensureBalanceRow(req.user.id);
  res.json({ balances: mapBalance(await getBalance(req.user.id)) });
});

router.get('/balances/credits', authRequired, hrRequired, async (_req, res) => {
  const credits = (await db
    .prepare(
      `SELECT c.id, c.user_id, c.leave_type, c.amount, c.note, c.credited_by, c.created_at,
              u.name AS user_name, u.email AS user_email,
              hr.name AS credited_by_name
       FROM balance_credits c
       JOIN users u ON u.id = c.user_id
       JOIN users hr ON hr.id = c.credited_by
       ORDER BY c.created_at DESC, c.id DESC
       LIMIT 200`
    )
    .all())
    .map((row) => ({
      id: row.id,
      userId: row.user_id,
      userName: row.user_name,
      userEmail: row.user_email,
      leaveType: row.leave_type,
      amount: row.amount,
      note: row.note,
      creditedById: row.credited_by,
      creditedByName: row.credited_by_name,
      createdAt: row.created_at,
    }));
  res.json({ credits });
});

router.post('/balances/credit', authRequired, hrRequired, async (req, res) => {
  const { userId, leaveType, amount, note } = req.body || {};
  if (!userId || !LEAVE_TYPES.includes(leaveType)) {
    return res.status(400).json({ error: 'Valid userId and leaveType required' });
  }
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    return res.status(400).json({ error: 'Amount must be a positive number' });
  }
  const user = await db.prepare(`SELECT id FROM users WHERE id = ? AND role = 'user'`).get(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  await ensureBalanceRow(userId);
  const balances = await db.transaction(async () => {
    await db.prepare(
      `UPDATE leave_balances
       SET ${leaveType} = ${leaveType} + ?, updated_at = ${SQL_NOW_IST}
       WHERE user_id = ?`
    ).run(amt, userId);
    await db.prepare(
      `INSERT INTO balance_credits (user_id, leave_type, amount, note, credited_by)
       VALUES (?, ?, ?, ?, ?)`
    ).run(userId, leaveType, amt, note || null, req.user.id);
    return mapBalance(await getBalance(userId));
  });
  const typeLabel =
    leaveType === 'casual'
      ? 'Casual'
      : leaveType === 'earned'
        ? 'Earned'
        : leaveType === 'sick'
          ? 'Sick'
          : leaveType;
  const dayLabel = amt === 1 ? 'day' : 'days';
  await notifyUser({
    userId,
    leaveId: null,
    type: 'balance_credited',
    title: 'Leave balance credited',
    message: `HR credited ${amt} ${typeLabel} leave ${dayLabel} to your account.${
      note ? ` Note: ${note}` : ''
    }`,
  });

  res.json({ balances, credited: { userId, leaveType, amount: amt } });
});

// ——— Leave requests ———
router.get('/leaves', authRequired, async (req, res) => {
  const { status, userId, from, to, leaveType } = req.query;
  const clauses = [];
  const params = [];

  if (req.user.role === 'user') {
    clauses.push('lr.user_id = ?');
    params.push(req.user.id);
  } else if (req.user.role === 'manager') {
    clauses.push('u.manager_id = ?');
    params.push(req.user.id);
    if (userId) {
      clauses.push('lr.user_id = ?');
      params.push(Number(userId));
    }
  } else if (req.user.role === 'hr' && userId) {
    clauses.push('lr.user_id = ?');
    params.push(Number(userId));
  }

  if (status && status !== 'all') {
    if (status === 'pending') {
      clauses.push(`lr.status IN ('pending_manager', 'pending_hr')`);
    } else {
      clauses.push('lr.status = ?');
      params.push(status);
    }
  }
  if (leaveType && leaveType !== 'all') {
    clauses.push('lr.leave_type = ?');
    params.push(leaveType);
  }
  if (from) {
    clauses.push('lr.end_date >= ?');
    params.push(from);
  }
  if (to) {
    clauses.push('lr.start_date <= ?');
    params.push(to);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = (await db
    .prepare(`${LEAVE_SELECT} ${where} ORDER BY lr.created_at DESC`)
    .all(...params))
    .map(mapLeave);

  res.json({ leaves: rows });
});

router.get('/leaves/calendar', authRequired, async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) {
    return res.status(400).json({ error: 'from and to query params required (YYYY-MM-DD)' });
  }

  // Employees see their active requests (including pending / partially approved) so they can cancel from the calendar.
  // Managers and HR only see fully approved team/org leave.
  const statusClause =
    req.user.role === 'user'
      ? "lr.status IN ('pending_manager', 'pending_hr', 'approved')"
      : "lr.status = 'approved'";

  const clauses = [statusClause, 'lr.end_date >= ?', 'lr.start_date <= ?'];
  const params = [from, to];

  if (req.user.role === 'user') {
    clauses.push('lr.user_id = ?');
    params.push(req.user.id);
  } else if (req.user.role === 'manager') {
    clauses.push('u.manager_id = ?');
    params.push(req.user.id);
  }

  const rows = (await db
    .prepare(`${LEAVE_SELECT} WHERE ${clauses.join(' AND ')} ORDER BY lr.start_date`)
    .all(...params))
    .map(mapLeave);

  res.json({ leaves: rows });
});

router.post('/leaves', authRequired, async (req, res) => {
  if (req.user.role !== 'user') {
    return res.status(400).json({ error: 'Only employees can apply for leave/WFH' });
  }

  const employee = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!employee.manager_id) {
    return res.status(400).json({
      error: 'No manager assigned. Ask HR to assign a manager before applying.',
    });
  }

  const { leaveType, startDate, endDate, reason, session } = req.body || {};
  if (!REQUEST_TYPES.includes(leaveType) || !startDate || !endDate) {
    return res.status(400).json({
      error: 'leaveType (casual/earned/sick/wfh), startDate, and endDate are required',
    });
  }
  const leaveSession = SESSIONS.includes(session) ? session : 'full';
  const resolvedEnd = leaveSession === 'full' ? endDate : startDate;

  let days;
  try {
    days = countLeaveDays(startDate, resolvedEnd, leaveSession);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (days <= 0) {
    return res.status(400).json({ error: 'Request must include at least one weekday' });
  }

  if (isBalanceType(leaveType)) {
    await ensureBalanceRow(req.user.id);
    const bal = await getBalance(req.user.id);
    if (bal[leaveType] < days) {
      return res.status(400).json({
        error: `Insufficient ${leaveType} leave balance (${bal[leaveType]} available, ${days} requested)`,
      });
    }
  }

  const candidates = await db
    .prepare(
      `SELECT id, start_date, end_date, session FROM leave_requests
       WHERE user_id = ?
         AND status IN ('pending_manager', 'pending_hr', 'approved')
         AND end_date >= ?
         AND start_date <= ?`
    )
    .all(req.user.id, startDate, resolvedEnd);
  const overlap = candidates.find((row) =>
    sessionsOverlap(
      { startDate, endDate: resolvedEnd, session: leaveSession },
      {
        startDate: row.start_date,
        endDate: row.end_date,
        session: row.session || 'full',
      }
    )
  );
  if (overlap) {
    return res.status(409).json({ error: 'Overlapping leave/WFH request already exists' });
  }

  const result = await db
    .prepare(
      `INSERT INTO leave_requests
         (user_id, leave_type, start_date, end_date, days, session, reason, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_manager')`
    )
    .run(
      req.user.id,
      leaveType,
      startDate,
      resolvedEnd,
      days,
      leaveSession,
      reason?.trim() || null
    );

  const leaveId = result.lastInsertRowid;
  const sessionNote = leaveSession === 'full' ? '' : ` (${leaveSession} session)`;
  await notifyUser({
    userId: employee.manager_id,
    leaveId,
    type: 'pending_manager',
    title: 'New leave request',
    message: `${req.user.name} submitted a ${leaveLabel(leaveType)} request (${startDate} to ${resolvedEnd})${sessionNote}.`,
  });

  const manager = await db
    .prepare('SELECT name, email FROM users WHERE id = ?')
    .get(employee.manager_id);
  // Fire-and-forget; never block leave apply if Slack / mail is down
  void notifyLeaveApplied({
    employeeName: req.user.name,
    managerName: manager?.name,
    leaveType,
    startDate,
    endDate: resolvedEnd,
    days,
    session: leaveSession,
    reason,
  });
  void mailLeaveApplied({
    employeeId: req.user.id,
    managerId: employee.manager_id,
    employeeName: req.user.name,
    managerName: manager?.name,
    leaveType,
    startDate,
    endDate: resolvedEnd,
    days,
    session: leaveSession,
    reason: reason?.trim() || null,
  });

  res.status(201).json({ leave: mapLeave(await getLeaveById(leaveId)) });
});

router.patch('/leaves/:id/review', authRequired, managerOrHrRequired, async (req, res) => {
  const id = Number(req.params.id);
  const { action, leaveType, note, startDate, endDate, session } = req.body || {};
  const adminNote = note ?? req.body?.adminNote;

  if (!['approve', 'reject'].includes(action)) {
    return res.status(400).json({ error: 'action must be approve or reject' });
  }

  const leave = await db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(id);
  if (!leave) return res.status(404).json({ error: 'Leave request not found' });

  const employee = await db.prepare('SELECT * FROM users WHERE id = ?').get(leave.user_id);

  // ——— Manager stage ———
  if (req.user.role === 'manager') {
    if (leave.status !== 'pending_manager') {
      return res.status(400).json({ error: 'This request is not awaiting manager approval' });
    }
    if (employee.manager_id !== req.user.id) {
      return res.status(403).json({ error: 'Not your team member' });
    }

    if (action === 'reject') {
      await db.prepare(
        `UPDATE leave_requests
         SET status = 'rejected',
             manager_note = ?,
             manager_id = ?,
             manager_reviewed_at = ${SQL_NOW_IST},
             updated_at = ${SQL_NOW_IST}
         WHERE id = ?`
      ).run(adminNote?.trim() || null, req.user.id, id);
      await notifyUser({
        userId: leave.user_id,
        leaveId: id,
        type: 'rejected',
        title: 'Request rejected by manager',
        message: `Your ${leaveLabel(leave.leave_type)} request was rejected by your manager.`,
      });
      void mailRejected({
        employeeId: leave.user_id,
        byRole: 'manager',
        employeeName: employee.name,
        managerName: req.user.name,
        leaveType: leave.leave_type,
        startDate: leave.start_date,
        endDate: leave.end_date,
        days: leave.days,
        session: leave.session,
        note: adminNote?.trim() || null,
      });
    } else {
      let nextStart = startDate || leave.start_date;
      let nextEnd = endDate || leave.end_date;
      const nextSession = SESSIONS.includes(session)
        ? session
        : leave.session || 'full';
      if (nextSession !== 'full') nextEnd = nextStart;
      let days;
      try {
        days = countLeaveDays(nextStart, nextEnd, nextSession);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
      if (days <= 0) {
        return res.status(400).json({ error: 'Request must include at least one weekday' });
      }
      const nextType =
        leaveType && REQUEST_TYPES.includes(leaveType) ? leaveType : leave.leave_type;

      await db.prepare(
        `UPDATE leave_requests
         SET status = 'pending_hr',
             leave_type = ?,
             start_date = ?,
             end_date = ?,
             days = ?,
             session = ?,
             manager_note = ?,
             manager_id = ?,
             manager_reviewed_at = ${SQL_NOW_IST},
             updated_at = ${SQL_NOW_IST}
         WHERE id = ?`
      ).run(
        nextType,
        nextStart,
        nextEnd,
        days,
        nextSession,
        adminNote?.trim() || null,
        req.user.id,
        id
      );
      await notifyUser({
        userId: leave.user_id,
        leaveId: id,
        type: 'pending_hr',
        title: 'Manager approved — pending HR',
        message: `Your manager approved your ${leaveLabel(nextType)} request. Waiting for HR.`,
      });
      await notifyMany(await getHrIds(), {
        leaveId: id,
        type: 'pending_hr',
        title: 'Awaiting HR approval',
        message: `${employee.name}'s ${leaveLabel(nextType)} request was approved by manager and needs HR review.`,
      });
      void mailManagerApproved({
        employeeId: leave.user_id,
        hrUserIds: await getHrIds(),
        employeeName: employee.name,
        managerName: req.user.name,
        leaveType: nextType,
        startDate: nextStart,
        endDate: nextEnd,
        days,
        session: nextSession,
        note: adminNote?.trim() || null,
      });
    }

    return res.json({ leave: mapLeave(await getLeaveById(id)) });
  }

  // ——— HR stage ———
  if (leave.status !== 'pending_hr') {
    return res.status(400).json({ error: 'This request is not awaiting HR approval' });
  }

  if (action === 'reject') {
    await db.prepare(
      `UPDATE leave_requests
       SET status = 'rejected',
           hr_note = ?,
           hr_id = ?,
           hr_reviewed_at = ${SQL_NOW_IST},
           updated_at = ${SQL_NOW_IST}
       WHERE id = ?`
    ).run(adminNote?.trim() || null, req.user.id, id);
    await notifyUser({
      userId: leave.user_id,
      leaveId: id,
      type: 'rejected',
      title: 'Request rejected by HR',
      message: `Your ${leaveLabel(leave.leave_type)} request was rejected by HR.`,
    });
    if (employee.manager_id) {
      await notifyUser({
        userId: employee.manager_id,
        leaveId: id,
        type: 'rejected',
        title: 'HR rejected a team request',
        message: `HR rejected ${employee.name}'s ${leaveLabel(leave.leave_type)} request.`,
      });
    }
    void mailRejected({
      employeeId: leave.user_id,
      managerId: employee.manager_id,
      byRole: 'hr',
      employeeName: employee.name,
      managerName: employee.manager_id
        ? (await db.prepare('SELECT name FROM users WHERE id = ?').get(employee.manager_id))?.name
        : null,
      leaveType: leave.leave_type,
      startDate: leave.start_date,
      endDate: leave.end_date,
      days: leave.days,
      session: leave.session,
      note: adminNote?.trim() || null,
    });
  } else {
    const nextType =
      leaveType && REQUEST_TYPES.includes(leaveType) ? leaveType : leave.leave_type;
    let nextStart = startDate || leave.start_date;
    let nextEnd = endDate || leave.end_date;
    const nextSession = SESSIONS.includes(session)
      ? session
      : leave.session || 'full';
    if (nextSession !== 'full') nextEnd = nextStart;
    let days;
    try {
      days = countLeaveDays(nextStart, nextEnd, nextSession);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    if (days <= 0) {
      return res.status(400).json({ error: 'Request must include at least one weekday' });
    }

    if (isBalanceType(nextType)) {
      await ensureBalanceRow(leave.user_id);
      const bal = await getBalance(leave.user_id);
      if (bal[nextType] < days) {
        return res.status(400).json({
          error: `Insufficient ${nextType} balance to approve (${bal[nextType]} available, ${days} days)`,
        });
      }
    }

    await db.transaction(async () => {
      if (isBalanceType(nextType)) {
        await db.prepare(
          `UPDATE leave_balances
           SET ${nextType} = ${nextType} - ?, updated_at = ${SQL_NOW_IST}
           WHERE user_id = ?`
        ).run(days, leave.user_id);
      }
      await db.prepare(
        `UPDATE leave_requests
         SET status = 'approved',
             leave_type = ?,
             start_date = ?,
             end_date = ?,
             days = ?,
             session = ?,
             hr_note = ?,
             hr_id = ?,
             hr_reviewed_at = ${SQL_NOW_IST},
             updated_at = ${SQL_NOW_IST}
         WHERE id = ?`
      ).run(
        nextType,
        nextStart,
        nextEnd,
        days,
        nextSession,
        adminNote?.trim() || null,
        req.user.id,
        id
      );
      await notifyUser({
        userId: leave.user_id,
        leaveId: id,
        type: 'approved',
        title: 'Leave approved',
        message: `Your ${leaveLabel(nextType)} request is fully approved.`,
      });
      if (employee.manager_id) {
        await notifyUser({
          userId: employee.manager_id,
          leaveId: id,
          type: 'approved',
          title: 'Team leave approved',
          message: `HR fully approved ${employee.name}'s ${leaveLabel(nextType)} request.`,
        });
      }
      void mailHrApproved({
        employeeId: leave.user_id,
        managerId: employee.manager_id,
        employeeName: employee.name,
        managerName: employee.manager_id
          ? (await db.prepare('SELECT name FROM users WHERE id = ?').get(employee.manager_id))?.name
          : null,
        leaveType: nextType,
        startDate: nextStart,
        endDate: nextEnd,
        days,
        session: nextSession,
        note: adminNote?.trim() || null,
      });
    });
    }

  res.json({ leave: mapLeave(await getLeaveById(id)) });
});

router.patch('/leaves/:id/cancel', authRequired, async (req, res) => {
  if (req.user.role !== 'user') {
    return res.status(400).json({ error: 'Only employees can cancel their requests' });
  }

  const id = Number(req.params.id);
  const leave = await db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(id);
  if (!leave) return res.status(404).json({ error: 'Leave request not found' });
  if (leave.user_id !== req.user.id) {
    return res.status(403).json({ error: 'You can only cancel your own requests' });
  }
  if (!['approved', 'pending_manager', 'pending_hr'].includes(leave.status)) {
    return res.status(400).json({
      error: 'Only pending or approved requests can be cancelled',
    });
  }

  const cancelDate =
    typeof req.body?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.date)
      ? req.body.date
      : null;
  const cancelAll = Boolean(req.body?.cancelAll) || !cancelDate;

  const employee = await db.prepare('SELECT * FROM users WHERE id = ?').get(leave.user_id);
  const priorStatus = leave.status;
  const session = leave.session || 'full';

  // Half-day sessions are always a single day — cancel the whole request.
  const isPartial =
    !cancelAll &&
    cancelDate &&
    session === 'full' &&
    !(leave.start_date === leave.end_date && leave.start_date === cancelDate);

  if (cancelDate && (cancelDate < leave.start_date || cancelDate > leave.end_date)) {
    return res.status(400).json({ error: 'Cancel date is outside this leave range' });
  }

  let restoredDays = 0;
  let resultLeaves = [];
  let notifyMessage = '';

  const restoreBalance = async (amount) => {
    if (priorStatus !== 'approved' || !isBalanceType(leave.leave_type) || amount <= 0) {
      return;
    }
    await ensureBalanceRow(leave.user_id);
    await db.prepare(
      `UPDATE leave_balances
       SET ${leave.leave_type} = ${leave.leave_type} + ?, updated_at = ${SQL_NOW_IST}
       WHERE user_id = ?`
    ).run(amount, leave.user_id);
    restoredDays += amount;
  };

  await db.transaction(async () => {
    if (!isPartial) {
      await restoreBalance(leave.days);
      await db.prepare(
        `UPDATE leave_requests
         SET status = 'cancelled', updated_at = ${SQL_NOW_IST}
         WHERE id = ?`
      ).run(id);
      resultLeaves = [await getLeaveById(id)];
      notifyMessage = `${req.user.name} cancelled their ${leaveLabel(leave.leave_type)} request.`;
      return;
    }

    const remainingDays = eachCalendarDay(leave.start_date, leave.end_date).filter(
      (d) => d !== cancelDate
    );
    const ranges = contiguousRanges(remainingDays)
      .map((range) => {
        try {
          const days = countLeaveDays(range.startDate, range.endDate, session);
          return days > 0 ? { ...range, days } : null;
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    if (!ranges.length) {
      await restoreBalance(leave.days);
      await db.prepare(
        `UPDATE leave_requests
         SET status = 'cancelled', updated_at = ${SQL_NOW_IST}
         WHERE id = ?`
      ).run(id);
      resultLeaves = [await getLeaveById(id)];
      notifyMessage = `${req.user.name} cancelled their ${leaveLabel(leave.leave_type)} request.`;
      return;
    }

    const keptDays = ranges.reduce((sum, r) => sum + r.days, 0);
    await restoreBalance(Math.max(0, leave.days - keptDays));

    const [first, ...rest] = ranges;
    await db.prepare(
      `UPDATE leave_requests
       SET start_date = ?, end_date = ?, days = ?, updated_at = ${SQL_NOW_IST}
       WHERE id = ?`
    ).run(first.startDate, first.endDate, first.days, id);

    const insertedIds = [];
    const insert = await db.prepare(
      `INSERT INTO leave_requests (
         user_id, leave_type, start_date, end_date, days, session, reason, status,
         manager_note, manager_id, manager_reviewed_at,
         hr_note, hr_id, hr_reviewed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const range of rest) {
      const info = await insert.run(
        leave.user_id,
        leave.leave_type,
        range.startDate,
        range.endDate,
        range.days,
        session,
        leave.reason,
        leave.status,
        leave.manager_note,
        leave.manager_id,
        leave.manager_reviewed_at,
        leave.hr_note,
        leave.hr_id,
        leave.hr_reviewed_at
      );
      insertedIds.push(info.lastInsertRowid);
    }

    resultLeaves = [
      await getLeaveById(id),
      ...(await Promise.all(insertedIds.map((rid) => getLeaveById(rid)))),
    ];
    notifyMessage = `${req.user.name} cancelled ${leaveLabel(leave.leave_type)} on ${cancelDate} (other days kept).`;
  });

  const targets = [];
  if (employee.manager_id) targets.push(employee.manager_id);
  if (priorStatus === 'pending_hr' || priorStatus === 'approved') {
    targets.push(...await getHrIds());
  }
  await notifyMany(targets, {
    leaveId: id,
    type: 'cancelled',
    title: isPartial ? 'Leave day cancelled' : 'Request cancelled',
    message: notifyMessage,
  });

  const restored =
    restoredDays > 0
      ? ` ${restoredDays} day(s) restored to your ${leave.leave_type} balance.`
      : '';
  await notifyUser({
    userId: req.user.id,
    leaveId: id,
    type: 'cancelled',
    title: isPartial ? 'Leave day cancelled' : 'Your leave was cancelled',
    message: isPartial
      ? `Cancelled ${leaveLabel(leave.leave_type)} for ${cancelDate}. Remaining days stay active.${restored}`
      : `Your ${leaveLabel(leave.leave_type)} request (${leave.start_date} – ${leave.end_date}) was cancelled.${restored}`,
  });

  void mailCancelled({
    targetUserIds: targets,
    employeeId: req.user.id,
    employeeName: req.user.name,
    leaveType: leave.leave_type,
    startDate: leave.start_date,
    endDate: leave.end_date,
    days: leave.days,
    session: leave.session,
    partial: Boolean(isPartial),
    cancelDate,
    message: isPartial
      ? `${req.user.name} cancelled ${leaveLabel(leave.leave_type)} on ${cancelDate} (other days kept).`
      : notifyMessage,
    employeeMessage: isPartial
      ? `Cancelled ${leaveLabel(leave.leave_type)} for ${cancelDate}. Remaining days stay active.${restored}`
      : `Your ${leaveLabel(leave.leave_type)} request (${leave.start_date} – ${leave.end_date}) was cancelled.${restored}`,
  });

  res.json({
    leave: mapLeave(resultLeaves[0]),
    leaves: resultLeaves.map(mapLeave),
    partial: Boolean(isPartial),
    cancelledDate: isPartial ? cancelDate : null,
    restoredDays,
  });
});

// ——— Notifications (all roles) ———
router.get('/notifications', authRequired, async (req, res) => {
  const notifications = (await db
    .prepare(
      `SELECT id, leave_id, type, title, message, read, created_at
       FROM notifications
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT 40`
    )
    .all(req.user.id))
    .map((n) => ({
      id: n.id,
      leaveId: n.leave_id,
      type: n.type,
      title: n.title,
      message: n.message,
      read: Boolean(n.read),
      createdAt: n.created_at,
    }));
  const unreadCount = (await db
    .prepare(
      `SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read = 0`
    )
    .get(req.user.id)).c;
  res.json({ notifications, unreadCount });
});

router.patch('/notifications/read', authRequired, async (req, res) => {
  const { ids } = req.body || {};
  if (Array.isArray(ids) && ids.length) {
    const mark = await db.prepare(
      `UPDATE notifications SET read = 1 WHERE user_id = ? AND id = ?`
    );
    await db.transaction(async () => {
      for (const id of ids) await mark.run(req.user.id, Number(id));
    });
  } else {
    await db.prepare(`UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0`).run(
      req.user.id
    );
  }
  const unreadCount = (await db
    .prepare(
      `SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read = 0`
    )
    .get(req.user.id)).c;
  res.json({ ok: true, unreadCount });
});

router.delete('/notifications', authRequired, async (req, res) => {
  await db.prepare(`DELETE FROM notifications WHERE user_id = ?`).run(req.user.id);
  res.json({ ok: true, unreadCount: 0 });
});

router.get('/dashboard/stats', authRequired, managerOrHrRequired, async (req, res) => {
  if (req.user.role === 'manager') {
    const pendingManager = (await db
      .prepare(
        `SELECT COUNT(*) AS c FROM leave_requests lr
         JOIN users u ON u.id = lr.user_id
         WHERE lr.status = 'pending_manager' AND u.manager_id = ?`
      )
      .get(req.user.id)).c;
    const team = (await db
      .prepare(
        `SELECT COUNT(*) AS c FROM users WHERE role = 'user' AND active = 1 AND manager_id = ?`
      )
      .get(req.user.id)).c;
    const onLeaveToday = (await db
      .prepare(
        `SELECT COUNT(DISTINCT lr.user_id) AS c FROM leave_requests lr
         JOIN users u ON u.id = lr.user_id
         WHERE lr.status = 'approved'
           AND lr.leave_type != 'wfh'
           AND u.manager_id = ?
           AND ${SQL_TODAY_IST} BETWEEN lr.start_date AND lr.end_date`
      )
      .get(req.user.id)).c;
    const onWfhToday = (await db
      .prepare(
        `SELECT COUNT(DISTINCT lr.user_id) AS c FROM leave_requests lr
         JOIN users u ON u.id = lr.user_id
         WHERE lr.status = 'approved'
           AND lr.leave_type = 'wfh'
           AND u.manager_id = ?
           AND ${SQL_TODAY_IST} BETWEEN lr.start_date AND lr.end_date`
      )
      .get(req.user.id)).c;
    return res.json({ pendingManager, pendingHr: 0, users: team, onLeaveToday, onWfhToday });
  }

  const pendingManager = (await db
    .prepare(`SELECT COUNT(*) AS c FROM leave_requests WHERE status = 'pending_manager'`)
    .get()).c;
  const pendingHr = (await db
    .prepare(`SELECT COUNT(*) AS c FROM leave_requests WHERE status = 'pending_hr'`)
    .get()).c;
  const users = (await db
    .prepare(`SELECT COUNT(*) AS c FROM users WHERE role = 'user' AND active = 1`)
    .get()).c;
  const onLeaveToday = (await db
    .prepare(
      `SELECT COUNT(DISTINCT user_id) AS c FROM leave_requests
       WHERE status = 'approved'
         AND leave_type != 'wfh'
         AND ${SQL_TODAY_IST} BETWEEN start_date AND end_date`
    )
    .get()).c;
  const onWfhToday = (await db
    .prepare(
      `SELECT COUNT(DISTINCT user_id) AS c FROM leave_requests
       WHERE status = 'approved'
         AND leave_type = 'wfh'
         AND ${SQL_TODAY_IST} BETWEEN start_date AND end_date`
    )
    .get()).c;
  res.json({ pendingManager, pendingHr, pending: pendingHr, users, onLeaveToday, onWfhToday });
});

router.get('/reports/overview', authRequired, async (req, res) => {
  const role = req.user.role;
  const filterUserId = req.query.userId ? Number(req.query.userId) : null;

  if (filterUserId != null && Number.isNaN(filterUserId)) {
    return res.status(400).json({ error: 'Invalid employee filter' });
  }
  if (filterUserId != null && role === 'user') {
    return res.status(403).json({ error: 'Employees cannot filter by other users' });
  }
  if (filterUserId != null && (role === 'manager' || role === 'hr')) {
    const employee = await db
      .prepare(`SELECT id, manager_id, role FROM users WHERE id = ? AND role = 'user'`)
      .get(filterUserId);
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    if (role === 'manager' && employee.manager_id !== req.user.id) {
      return res.status(403).json({ error: 'Not on your team' });
    }
  }

  const listParams =
    role === 'manager' || role === 'user' ? [req.user.id] : [];

  const chartJoin = role === 'manager' ? 'JOIN users u ON u.id = lr.user_id' : '';
  const chartWhere = [];
  const chartParams = [];
  if (role === 'manager') {
    chartWhere.push('u.manager_id = ?');
    chartParams.push(req.user.id);
  } else if (role === 'user') {
    chartWhere.push('lr.user_id = ?');
    chartParams.push(req.user.id);
  }
  if (filterUserId != null && (role === 'manager' || role === 'hr')) {
    chartWhere.push('lr.user_id = ?');
    chartParams.push(filterUserId);
  }
  const chartWhereSql = chartWhere.length ? `AND ${chartWhere.join(' AND ')}` : '';

  const upcoming = (await db
    .prepare(
      `${LEAVE_SELECT}
       WHERE lr.status = 'approved'
         AND lr.end_date >= ${SQL_TODAY_IST}
         ${role === 'manager' ? 'AND u.manager_id = ?' : ''}
         ${role === 'user' ? 'AND lr.user_id = ?' : ''}
       ORDER BY lr.start_date ASC
       LIMIT 12`
    )
    .all(...listParams))
    .map(mapLeave);

  const todayOnLeave = (await db
    .prepare(
      `${LEAVE_SELECT}
       WHERE lr.status = 'approved'
         AND ${SQL_TODAY_IST} BETWEEN lr.start_date AND lr.end_date
         ${role === 'manager' ? 'AND u.manager_id = ?' : ''}
         ${role === 'user' ? 'AND lr.user_id = ?' : ''}
       ORDER BY u.name COLLATE NOCASE`
    )
    .all(...listParams))
    .map(mapLeave);

  const byTypeRows = await db
    .prepare(
      `SELECT lr.leave_type AS type, COALESCE(SUM(lr.days), 0) AS days, COUNT(*) AS count
       FROM leave_requests lr
       ${chartJoin}
       WHERE lr.status = 'approved'
         AND strftime('%Y-%m', lr.start_date) = strftime('%Y-%m', 'now', '+5 hours', '30 minutes')
         ${chartWhereSql}
       GROUP BY lr.leave_type`
    )
    .all(...chartParams);

  const byMonthRows = await db
    .prepare(
      `SELECT strftime('%Y-%m', lr.start_date) AS month, COALESCE(SUM(lr.days), 0) AS days
       FROM leave_requests lr
       ${chartJoin}
       WHERE lr.status = 'approved'
         AND lr.start_date >= date('now', '+5 hours', '30 minutes', '-5 months', 'start of month')
         ${chartWhereSql}
       GROUP BY strftime('%Y-%m', lr.start_date)
       ORDER BY month ASC`
    )
    .all(...chartParams);

  // Fill last 6 months including zeros (IST calendar)
  const months = [];
  const [ty, tm] = todayIst().split('-').map(Number);
  for (let i = 5; i >= 0; i -= 1) {
    const monthIndex = tm - 1 - i;
    const d = new Date(Date.UTC(ty, monthIndex, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const found = byMonthRows.find((r) => r.month === key);
    months.push({
      month: key,
      label: d.toLocaleString('en-IN', { month: 'short', timeZone: 'UTC' }),
      days: found ? found.days : 0,
    });
  }

  const allTypes = ['casual', 'earned', 'sick', 'wfh'];
  const byType = allTypes.map((type) => {
    const row = byTypeRows.find((r) => r.type === type);
    return { type, days: row ? row.days : 0, count: row ? row.count : 0 };
  });

  res.json({
    upcoming,
    todayOnLeave,
    byType,
    byMonth: months,
  });
});

// ——— Employee ratings ———
router.get('/ratings/employees', authRequired, managerOrHrRequired, async (req, res) => {
  const rows = (await db
    .prepare(
      `SELECT u.id, u.name, u.email, u.employee_number,
              m.name AS manager_name
       FROM users u
       LEFT JOIN users m ON m.id = u.manager_id
       WHERE u.role = 'user' AND u.active = 1
       ORDER BY u.name COLLATE NOCASE`
    )
    .all())
    .map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      employeeNumber: u.employee_number,
      managerName: u.manager_name,
    }));
  res.json({ employees: rows });
});

router.get('/ratings', authRequired, async (req, res) => {
  const { userId, managerId, from, to } = req.query;
  const clauses = ['1=1'];
  const params = [];

  if (req.user.role === 'user') {
    clauses.push('er.user_id = ?');
    params.push(req.user.id);
  } else if (req.user.role === 'manager') {
    if (managerId && Number(managerId) !== req.user.id) {
      return res.status(403).json({ error: 'Managers can only filter by their own ratings' });
    }
    clauses.push('er.manager_id = ?');
    params.push(req.user.id);
    if (userId) {
      clauses.push('er.user_id = ?');
      params.push(Number(userId));
    }
  } else if (req.user.role === 'hr') {
    if (userId) {
      clauses.push('er.user_id = ?');
      params.push(Number(userId));
    }
    if (managerId) {
      clauses.push('er.manager_id = ?');
      params.push(Number(managerId));
    }
  }

  if (from) {
    clauses.push('date(er.created_at) >= ?');
    params.push(from);
  }
  if (to) {
    clauses.push('date(er.created_at) <= ?');
    params.push(to);
  }

  const rows = (await db
    .prepare(
      `${RATING_SELECT} WHERE ${clauses.join(' AND ')} ORDER BY er.created_at DESC`
    )
    .all(...params))
    .map(mapRating);

  res.json({ ratings: rows });
});

router.post('/ratings', authRequired, managerRequired, async (req, res) => {
  const { userId, score, feedback, periodLabel } = req.body || {};
  const employeeId = Number(userId);
  const numericScore = Number(score);

  if (!employeeId) {
    return res.status(400).json({ error: 'userId is required' });
  }
  if (!Number.isFinite(numericScore) || numericScore < 1 || numericScore > 10) {
    return res.status(400).json({ error: 'score must be between 1 and 10' });
  }
  const trimmedFeedback = String(feedback || '').trim();
  if (trimmedFeedback.length < 10) {
    return res.status(400).json({ error: 'feedback is required (at least 10 characters)' });
  }

  const employee = await db
    .prepare(`SELECT id, name, role, active FROM users WHERE id = ?`)
    .get(employeeId);
  if (!employee || employee.role !== 'user' || !employee.active) {
    return res.status(400).json({ error: 'Invalid or inactive employee' });
  }

  const normalizedPeriod = periodLabel?.trim() || null;
  if (!normalizedPeriod) {
    return res.status(400).json({ error: 'period (month and year) is required' });
  }

  const existing = await db
    .prepare(
      `SELECT er.id, mgr.name AS manager_name
       FROM employee_ratings er
       LEFT JOIN users mgr ON mgr.id = er.manager_id
       WHERE er.user_id = ? AND er.period_label = ?`
    )
    .get(employeeId, normalizedPeriod);
  if (existing) {
    const by = existing.manager_name ? ` by ${existing.manager_name}` : '';
    return res.status(409).json({
      error: `A rating for ${normalizedPeriod} already exists for ${employee.name}${by}.`,
    });
  }

  let result;
  try {
    result = await db
      .prepare(
        `INSERT INTO employee_ratings (user_id, manager_id, score, feedback, period_label)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        employeeId,
        req.user.id,
        Math.round(numericScore),
        trimmedFeedback,
        normalizedPeriod
      );
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({
        error: `A rating for ${normalizedPeriod} already exists for ${employee.name}.`,
      });
    }
    throw err;
  }

  const rating = await getRatingById(result.lastInsertRowid);

  await notifyUser({
    userId: employeeId,
    leaveId: null,
    type: 'rating_received',
    title: 'New performance rating',
    message: `${req.user.name} rated you ${rating.score}/10. View feedback in My ratings.`,
  });

  res.status(201).json({ rating: mapRating(rating) });
});

// ——— Invoices ———
router.post('/invoices', authRequired, async (req, res) => {
  if (req.user.role !== 'user' && req.user.role !== 'manager') {
    return res.status(403).json({ error: 'Only employees and managers can submit invoices' });
  }

  const validated = validateInvoicePayload(req.body || {});
  if (validated.error) {
    return res.status(400).json({ error: validated.error });
  }

  const { data, totalAmount } = validated;
  const pdfData = String(req.body?.pdfData || '').trim() || null;

  const duplicate = await db
    .prepare(`SELECT id FROM invoices WHERE user_id = ? AND invoice_number = ?`)
    .get(req.user.id, data.invoiceNumber);
  if (duplicate) {
    return res.status(409).json({
      error: `You already submitted invoice ${data.invoiceNumber}.`,
    });
  }

  let result;
  try {
    result = await db
      .prepare(
        `INSERT INTO invoices
           (user_id, invoice_number, invoice_date, billing_period, consultant, total_amount, data_json, pdf_data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        req.user.id,
        data.invoiceNumber,
        data.invoiceDate,
        data.billingPeriod,
        data.consultant,
        totalAmount,
        JSON.stringify(data),
        pdfData
      );
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({
        error: `You already submitted invoice ${data.invoiceNumber}.`,
      });
    }
    throw err;
  }

  const invoice = mapInvoice(
    await db.prepare(`${INVOICE_SELECT} WHERE i.id = ?`).get(result.lastInsertRowid)
  );

  const hrUsers = await db
    .prepare(`SELECT id FROM users WHERE role = 'hr' AND active = 1`)
    .all();
  for (const hr of hrUsers) {
    await notifyUser({
      userId: hr.id,
      leaveId: null,
      type: 'invoice_submitted',
      title: 'New invoice submitted',
      message: `${req.user.name} submitted invoice ${data.invoiceNumber} for ${data.billingPeriod}.`,
    });
  }

  res.status(201).json({ invoice });
});

router.get('/invoices/mine', authRequired, async (req, res) => {
  const rows = (await db
    .prepare(`${INVOICE_SELECT} WHERE i.user_id = ? ORDER BY i.created_at DESC`)
    .all(req.user.id))
    .map(mapInvoice);
  res.json({ invoices: rows });
});

router.get('/invoices/submitters', authRequired, hrRequired, async (_req, res) => {
  const rows = (await db
    .prepare(
      `SELECT DISTINCT u.id, u.name, u.email, u.employee_number, u.role
       FROM invoices i
       JOIN users u ON u.id = i.user_id
       ORDER BY u.name COLLATE NOCASE`
    )
    .all())
    .map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      employeeNumber: u.employee_number,
      role: u.role,
    }));
  res.json({ users: rows });
});

router.get('/invoices', authRequired, hrRequired, async (req, res) => {
  const { billingPeriod, userId } = req.query;
  const clauses = ['1=1'];
  const params = [];

  if (billingPeriod) {
    clauses.push('i.billing_period = ?');
    params.push(String(billingPeriod));
  }
  if (userId) {
    const id = Number(userId);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'Invalid employee filter' });
    }
    clauses.push('i.user_id = ?');
    params.push(id);
  }

  const rows = (await db
    .prepare(
      `${INVOICE_SELECT} WHERE ${clauses.join(' AND ')} ORDER BY i.created_at DESC`
    )
    .all(...params))
    .map(mapInvoice);

  res.json({ invoices: rows });
});

router.get('/invoices/:id', authRequired, async (req, res) => {
  const id = Number(req.params.id);
  const row = await db.prepare(`${INVOICE_SELECT} WHERE i.id = ?`).get(id);
  if (!row) return res.status(404).json({ error: 'Invoice not found' });

  if (req.user.role !== 'hr' && row.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Not allowed' });
  }

  res.json({ invoice: mapInvoice(row) });
});

router.get('/invoices/:id/pdf', authRequired, async (req, res) => {
  const id = Number(req.params.id);
  const row = await db
    .prepare(`SELECT user_id, invoice_number, pdf_data FROM invoices WHERE id = ?`)
    .get(id);
  if (!row) return res.status(404).json({ error: 'Invoice not found' });

  if (req.user.role !== 'hr' && row.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Not allowed' });
  }

  if (!row.pdf_data) {
    return res.status(404).json({ error: 'PDF not stored for this invoice' });
  }

  const base64 = row.pdf_data.replace(/^data:application\/pdf;base64,/, '');
  const buffer = Buffer.from(base64, 'base64');
  const filename = `${row.invoice_number || 'invoice'}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
});

export default router;
