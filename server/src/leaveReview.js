import db from './db.js';
import {
  countLeaveDays,
  REQUEST_TYPES,
  isBalanceType,
  mapLeave,
  LEAVE_SELECT,
  SESSIONS,
  DEFAULT_RESTRICTED_BALANCE,
} from './leaveUtils.js';
import { assertRegularLeaveWindow } from './holidays.js';
import { SQL_NOW_IST } from './sqlDialect.js';
import {
  mailManagerApproved,
  mailHrApproved,
  mailRejected,
} from './mail.js';

async function slackNotify(name, details) {
  try {
    const slack = await import('./slack.js');
    await slack[name](details);
  } catch (err) {
    console.error(`Slack ${name} failed:`, err.message);
  }
}

export class LeaveReviewError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function leaveLabel(type) {
  if (type === 'wfh') return 'Work from Home';
  if (type === 'casual') return 'Casual Leave';
  if (type === 'earned') return 'Earned Leave';
  if (type === 'sick') return 'Sick Leave';
  if (type === 'restricted') return 'Restricted Leave';
  return `${type} leave`;
}

async function getBalance(userId) {
  return (
    (await db.prepare('SELECT * FROM leave_balances WHERE user_id = ?').get(userId)) || {
      casual: 0,
      earned: 0,
      sick: 0,
      restricted: DEFAULT_RESTRICTED_BALANCE,
    }
  );
}

async function ensureBalanceRow(userId) {
  await db
    .prepare(
      `INSERT INTO leave_balances (user_id, casual, earned, sick, restricted)
       VALUES (?, 0, 0, 0, ?)
       ON CONFLICT(user_id) DO NOTHING`
    )
    .run(userId, DEFAULT_RESTRICTED_BALANCE);
}

async function getLeaveById(id) {
  return await db.prepare(`${LEAVE_SELECT} WHERE lr.id = ?`).get(id);
}

async function notifyUser({ userId, leaveId, type, title, message }) {
  if (!userId) return;
  await db
    .prepare(
      `INSERT INTO notifications (user_id, leave_id, type, title, message)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(userId, leaveId ?? null, type, title, message);
}

async function notifyMany(userIds, payload) {
  const unique = [...new Set(userIds.filter(Boolean))];
  for (const userId of unique) {
    await notifyUser({ ...payload, userId });
  }
}

async function getHrIds() {
  return (
    await db.prepare(`SELECT id FROM users WHERE role = 'hr' AND active = 1`).all()
  ).map((r) => r.id);
}

/**
 * Shared leave approve/reject for portal + Slack.
 * @param {{ leaveId: number, action: 'approve'|'reject', actor: object, note?: string, leaveType?: string, startDate?: string, endDate?: string, session?: string }} opts
 */
export async function reviewLeaveRequest(opts) {
  const {
    leaveId,
    action,
    actor,
    note,
    leaveType,
    startDate,
    endDate,
    session,
  } = opts;
  const adminNote = note?.trim() || null;
  const id = Number(leaveId);

  if (!['approve', 'reject'].includes(action)) {
    throw new LeaveReviewError(400, 'action must be approve or reject');
  }
  if (!actor?.id || !['manager', 'hr'].includes(actor.role)) {
    throw new LeaveReviewError(403, 'Only managers or HR can review leave');
  }

  const leave = await db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(id);
  if (!leave) throw new LeaveReviewError(404, 'Leave request not found');

  const employee = await db.prepare('SELECT * FROM users WHERE id = ?').get(leave.user_id);
  if (!employee) throw new LeaveReviewError(404, 'Employee not found');

  // ——— Manager stage ———
  if (actor.role === 'manager') {
    if (leave.status !== 'pending_manager') {
      throw new LeaveReviewError(400, 'This request is not awaiting manager approval');
    }
    if (employee.manager_id !== actor.id) {
      throw new LeaveReviewError(403, 'Not your team member');
    }

    if (action === 'reject') {
      await db
        .prepare(
          `UPDATE leave_requests
           SET status = 'rejected',
               manager_note = ?,
               manager_id = ?,
               manager_reviewed_at = ${SQL_NOW_IST},
               updated_at = ${SQL_NOW_IST}
           WHERE id = ?`
        )
        .run(adminNote, actor.id, id);
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
        managerName: actor.name,
        leaveType: leave.leave_type,
        startDate: leave.start_date,
        endDate: leave.end_date,
        days: leave.days,
        session: leave.session,
        note: adminNote,
      });
      return {
        leave: mapLeave(await getLeaveById(id)),
        outcome: 'rejected',
        stage: 'manager',
      };
    }

    let nextStart = startDate || leave.start_date;
    let nextEnd = endDate || leave.end_date;
    const nextSession = SESSIONS.includes(session) ? session : leave.session || 'full';
    if (nextSession !== 'full') nextEnd = nextStart;
    const nextType =
      leaveType && REQUEST_TYPES.includes(leaveType) ? leaveType : leave.leave_type;
    let days;
    try {
      if (nextType === 'restricted') {
        days = 1;
      } else {
        const holidays = await assertRegularLeaveWindow(db, nextStart, nextEnd);
        days = countLeaveDays(nextStart, nextEnd, nextSession, holidays);
      }
    } catch (err) {
      throw new LeaveReviewError(err.status || 400, err.message);
    }
    if (days <= 0) {
      throw new LeaveReviewError(
        400,
        'Leave cannot be applied only on weekends or general holidays. Pick working days.'
      );
    }

    await db
      .prepare(
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
      )
      .run(
        nextType,
        nextStart,
        nextEnd,
        days,
        nextSession,
        adminNote,
        actor.id,
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
      managerName: actor.name,
      leaveType: nextType,
      startDate: nextStart,
      endDate: nextEnd,
      days,
      session: nextSession,
      note: adminNote,
    });
    void slackNotify('notifyLeaveManagerApproved', {
      leaveId: id,
      employeeName: employee.name,
      managerName: actor.name,
      leaveType: nextType,
      startDate: nextStart,
      endDate: nextEnd,
      days,
      session: nextSession,
      note: adminNote,
    });
    return {
      leave: mapLeave(await getLeaveById(id)),
      outcome: 'approved',
      stage: 'manager',
    };
  }

  // ——— HR stage ———
  if (actor.role !== 'hr') {
    throw new LeaveReviewError(403, 'Forbidden');
  }
  if (leave.status !== 'pending_hr') {
    throw new LeaveReviewError(400, 'This request is not awaiting HR approval');
  }

  if (action === 'reject') {
    await db
      .prepare(
        `UPDATE leave_requests
         SET status = 'rejected',
             hr_note = ?,
             hr_id = ?,
             hr_reviewed_at = ${SQL_NOW_IST},
             updated_at = ${SQL_NOW_IST}
         WHERE id = ?`
      )
      .run(adminNote, actor.id, id);
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
        ? (await db.prepare('SELECT name FROM users WHERE id = ?').get(employee.manager_id))
            ?.name
        : null,
      leaveType: leave.leave_type,
      startDate: leave.start_date,
      endDate: leave.end_date,
      days: leave.days,
      session: leave.session,
      note: adminNote,
    });
    return {
      leave: mapLeave(await getLeaveById(id)),
      outcome: 'rejected',
      stage: 'hr',
    };
  }

  const nextType =
    leaveType && REQUEST_TYPES.includes(leaveType) ? leaveType : leave.leave_type;
  let nextStart = startDate || leave.start_date;
  let nextEnd = endDate || leave.end_date;
  const nextSession = SESSIONS.includes(session) ? session : leave.session || 'full';
  if (nextSession !== 'full') nextEnd = nextStart;
  let days;
  try {
    if (nextType === 'restricted') {
      days = 1;
    } else {
      const holidays = await assertRegularLeaveWindow(db, nextStart, nextEnd);
      days = countLeaveDays(nextStart, nextEnd, nextSession, holidays);
    }
  } catch (err) {
    throw new LeaveReviewError(err.status || 400, err.message);
  }
  if (days <= 0) {
    throw new LeaveReviewError(
      400,
      'Leave cannot be applied only on weekends or general holidays. Pick working days.'
    );
  }

  if (isBalanceType(nextType)) {
    await ensureBalanceRow(leave.user_id);
    const bal = await getBalance(leave.user_id);
    if (bal[nextType] < days) {
      throw new LeaveReviewError(
        400,
        `Insufficient ${nextType} balance to approve (${bal[nextType]} available, ${days} days)`
      );
    }
  }

  await db.transaction(async () => {
    if (isBalanceType(nextType)) {
      await db
        .prepare(
          `UPDATE leave_balances
           SET ${nextType} = ${nextType} - ?, updated_at = ${SQL_NOW_IST}
           WHERE user_id = ?`
        )
        .run(days, leave.user_id);
    }
    await db
      .prepare(
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
      )
      .run(
        nextType,
        nextStart,
        nextEnd,
        days,
        nextSession,
        adminNote,
        actor.id,
        id
      );
  });

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
  const managerName = employee.manager_id
    ? (await db.prepare('SELECT name FROM users WHERE id = ?').get(employee.manager_id))?.name
    : null;
  void mailHrApproved({
    employeeId: leave.user_id,
    managerId: employee.manager_id,
    employeeName: employee.name,
    managerName,
    leaveType: nextType,
    startDate: nextStart,
    endDate: nextEnd,
    days,
    session: nextSession,
    note: adminNote,
  });
  void slackNotify('notifyLeaveHrApproved', {
    leaveId: id,
    employeeName: employee.name,
    managerName,
    hrName: actor.name,
    leaveType: nextType,
    startDate: nextStart,
    endDate: nextEnd,
    days,
    session: nextSession,
    note: adminNote,
  });

  return {
    leave: mapLeave(await getLeaveById(id)),
    outcome: 'approved',
    stage: 'hr',
  };
}
