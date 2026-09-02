import db from './db.js';
import { SQL_NOW_IST } from './sqlDialect.js';
import { todayIst } from './time.js';

export const CASUAL_ACCRUAL_PER_MONTH = 0.33;
export const EARNED_ACCRUAL_PER_MONTH = 1.5;
export const CELEBRATION_LEAVE_PER_YEAR = 1;

const CASUAL_NOTE_PREFIX = 'auto-accrual:casual:';
const EARNED_NOTE_PREFIX = 'auto-accrual:earned:';
const CELEBRATION_NOTE_PREFIX = 'auto-accrual:celebration:';

/** Full calendar months completed since joining (IST dates). */
export function completedEmploymentMonths(joinYmd, todayYmd = todayIst()) {
  const join = String(joinYmd || '').slice(0, 10);
  const today = String(todayYmd || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(join) || today < join) return 0;

  const [jy, jm, jd] = join.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  let months = (ty - jy) * 12 + (tm - jm);
  if (td < jd) months -= 1;
  return Math.max(0, months);
}

/** Birthday in a given year as YYYY-MM-DD (handles Feb 29 → Feb 28 in non-leap years). */
export function birthdayInYear(dobYmd, year) {
  const dob = String(dobYmd || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null;
  const mmdd = dob.slice(5);
  const y = Number(year);
  if (!y) return null;
  if (mmdd === '02-29') {
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    return `${y}-${leap ? '02-29' : '02-28'}`;
  }
  return `${y}-${mmdd}`;
}

async function accrualCreditorId() {
  if (accrualCreditorId.cached != null) return accrualCreditorId.cached;
  const hr = await db
    .prepare(`SELECT id FROM users WHERE role = 'hr' AND active = 1 ORDER BY id LIMIT 1`)
    .get();
  accrualCreditorId.cached = hr?.id ?? null;
  return accrualCreditorId.cached;
}
accrualCreditorId.cached = null;

async function creditMonthlyAccrual({
  userId,
  leaveType,
  amount,
  notePrefix,
  monthsDue,
}) {
  if (monthsDue <= 0) return;

  const creditedRows = await db
    .prepare(
      `SELECT note FROM balance_credits
       WHERE user_id = ? AND leave_type = ? AND note LIKE ?`
    )
    .all(userId, leaveType, `${notePrefix}%`);
  if (creditedRows.length >= monthsDue) return;

  const creditorId = await accrualCreditorId();
  if (!creditorId) return;

  const credited = new Set(creditedRows.map((row) => row.note));
  const pending = [];
  for (let monthIndex = 1; monthIndex <= monthsDue; monthIndex += 1) {
    const note = `${notePrefix}${monthIndex}`;
    if (!credited.has(note)) pending.push({ note });
  }
  if (!pending.length) return;

  await db.transaction(async () => {
    const bal = await db
      .prepare(`SELECT ${leaveType} AS value FROM leave_balances WHERE user_id = ?`)
      .get(userId);
    let current = Number(bal?.value ?? 0);
    for (const { note } of pending) {
      current = Math.round((current + amount) * 100) / 100;
      await db
        .prepare(
          `UPDATE leave_balances
           SET ${leaveType} = ?, updated_at = ${SQL_NOW_IST}
           WHERE user_id = ?`
        )
        .run(current, userId);
      await db
        .prepare(
          `INSERT INTO balance_credits (user_id, leave_type, amount, note, credited_by)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(userId, leaveType, amount, note, creditorId);
    }
  });
}

/** Credit 0.33 casual leave for each completed employment month not yet accrued. */
export async function syncCasualLeaveAccrual(userId) {
  const profile = await db
    .prepare(`SELECT date_of_joining FROM employee_profiles WHERE user_id = ?`)
    .get(userId);
  const joinYmd = profile?.date_of_joining;
  if (!joinYmd) return;

  await creditMonthlyAccrual({
    userId,
    leaveType: 'casual',
    amount: CASUAL_ACCRUAL_PER_MONTH,
    notePrefix: CASUAL_NOTE_PREFIX,
    monthsDue: completedEmploymentMonths(joinYmd),
  });
}

/** Credit 1.5 earned leave for each completed employment month not yet accrued. */
export async function syncEarnedLeaveAccrual(userId) {
  const profile = await db
    .prepare(`SELECT date_of_joining FROM employee_profiles WHERE user_id = ?`)
    .get(userId);
  const joinYmd = profile?.date_of_joining;
  if (!joinYmd) return;

  await creditMonthlyAccrual({
    userId,
    leaveType: 'earned',
    amount: EARNED_ACCRUAL_PER_MONTH,
    notePrefix: EARNED_NOTE_PREFIX,
    monthsDue: completedEmploymentMonths(joinYmd),
  });
}

/**
 * Credit 1 celebration leave per calendar year once the employee's birthday
 * for that year has arrived (requires date_of_birth).
 */
export async function syncCelebrationLeaveAccrual(userId, todayYmd = todayIst()) {
  const profile = await db
    .prepare(`SELECT date_of_birth, date_of_joining FROM employee_profiles WHERE user_id = ?`)
    .get(userId);
  const dob = String(profile?.date_of_birth || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return;

  const today = String(todayYmd || todayIst()).slice(0, 10);
  const join = String(profile?.date_of_joining || '').slice(0, 10);
  const startYear = /^\d{4}-\d{2}-\d{2}$/.test(join)
    ? Number(join.slice(0, 4))
    : Number(dob.slice(0, 4)) + 1;
  const endYear = Number(today.slice(0, 4));
  if (!startYear || !endYear || endYear < startYear) return;

  const yearsDue = [];
  for (let year = startYear; year <= endYear; year += 1) {
    const birthday = birthdayInYear(dob, year);
    if (!birthday) continue;
    if (join && birthday < join) continue;
    if (birthday > today) continue;
    yearsDue.push(year);
  }
  if (!yearsDue.length) return;

  const creditorId = await accrualCreditorId();
  if (!creditorId) return;

  const creditedRows = await db
    .prepare(
      `SELECT note FROM balance_credits
       WHERE user_id = ? AND leave_type = 'celebration' AND note LIKE ?`
    )
    .all(userId, `${CELEBRATION_NOTE_PREFIX}%`);
  const credited = new Set(creditedRows.map((row) => row.note));
  const pending = yearsDue
    .map((year) => `${CELEBRATION_NOTE_PREFIX}${year}`)
    .filter((note) => !credited.has(note));
  if (!pending.length) return;

  await db.transaction(async () => {
    const bal = await db
      .prepare(`SELECT celebration FROM leave_balances WHERE user_id = ?`)
      .get(userId);
    let current = Number(bal?.celebration ?? 0);
    for (const note of pending) {
      current = Math.round((current + CELEBRATION_LEAVE_PER_YEAR) * 100) / 100;
      await db
        .prepare(
          `UPDATE leave_balances
           SET celebration = ?, updated_at = ${SQL_NOW_IST}
           WHERE user_id = ?`
        )
        .run(current, userId);
      await db
        .prepare(
          `INSERT INTO balance_credits (user_id, leave_type, amount, note, credited_by)
           VALUES (?, 'celebration', ?, ?, ?)`
        )
        .run(userId, CELEBRATION_LEAVE_PER_YEAR, note, creditorId);
    }
  });
}

export async function syncLeaveAccruals(userId) {
  await syncCasualLeaveAccrual(userId);
  await syncEarnedLeaveAccrual(userId);
  await syncCelebrationLeaveAccrual(userId);
}

/**
 * Celebration leave: single full day on the employee's birthday.
 * Returns { days: 1 } or throws an Error with .status = 400.
 */
export async function assertCelebrationLeaveRequest(userId, startDate, endDate, session = 'full') {
  if (session !== 'full' || startDate !== endDate) {
    throw Object.assign(new Error('Celebration leave is a single full day on your birthday.'), {
      status: 400,
    });
  }
  const profile = await db
    .prepare(`SELECT date_of_birth FROM employee_profiles WHERE user_id = ?`)
    .get(userId);
  const dob = String(profile?.date_of_birth || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
    throw Object.assign(
      new Error('Add a date of birth on the employee profile to use celebration leave.'),
      { status: 400 }
    );
  }
  const birthday = birthdayInYear(dob, startDate.slice(0, 4));
  if (!birthday || startDate !== birthday) {
    throw Object.assign(
      new Error(`Celebration leave can only be applied on the birthday (${dob.slice(5)}).`),
      { status: 400 }
    );
  }
  return { days: CELEBRATION_LEAVE_PER_YEAR, birthday, dateOfBirth: dob };
}

/** One-shot backfill for all active employees (and managers). */
export async function syncLeaveAccrualsForAllActiveUsers() {
  const rows = await db
    .prepare(`SELECT id FROM users WHERE active = 1 AND role IN ('user', 'manager')`)
    .all();
  for (const row of rows) {
    await ensureBalanceRowLocal(row.id);
    await syncLeaveAccruals(row.id);
  }
  return { users: rows.length };
}

async function ensureBalanceRowLocal(userId) {
  await db
    .prepare(
      `INSERT INTO leave_balances (user_id, casual, earned, sick, restricted, celebration)
       VALUES (?, 0, 0, 0, 2, 0)
       ON CONFLICT(user_id) DO NOTHING`
    )
    .run(userId);
}
