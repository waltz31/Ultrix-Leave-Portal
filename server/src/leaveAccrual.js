import db from './db.js';
import { SQL_NOW_IST } from './sqlDialect.js';
import { todayIst } from './time.js';

export const CASUAL_ACCRUAL_PER_MONTH = 0.33;
export const EARNED_ACCRUAL_PER_MONTH = 1.5;
/** Sick leave: 1 day credited for every 30 calendar days from joining. */
export const SICK_ACCRUAL_PER_30_DAYS = 1;
/**
 * Earned leave stays locked through the first 6 completed months.
 * In the 7th employment month (completedMonths >= 6) it unlocks and credits
 * all 7 months at once (7 × 1.5 = 10.5). Before that, UI must show 0.
 *
 * Rule (employees + managers):
 *   completedMonths < 6  → locked, visible EL = 0, no EL accrual credits
 *   completedMonths >= 6 → unlocked, credit (completedMonths + 1) × 1.5
 *     e.g. completed=6 → 7 × 1.5 = 10.5
 *          completed=7 → 8 × 1.5 = 12.0
 */
export const EARNED_UNLOCK_COMPLETED_MONTHS = 6;
export const CELEBRATION_LEAVE_PER_YEAR = 1;

const CASUAL_NOTE_PREFIX = 'auto-accrual:casual:';
const EARNED_NOTE_PREFIX = 'auto-accrual:earned:';
const SICK_NOTE_PREFIX = 'auto-accrual:sick:';
const CELEBRATION_NOTE_PREFIX = 'auto-accrual:celebration:';

/** Skip re-running accrual for the same user within the same IST day. */
const syncedToday = new Map();
const SYNCED_TODAY_MAX = 2_000;

/** Normalize join/today inputs to YYYY-MM-DD (handles Date / ISO strings). */
export function asJoinYmd(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const text = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  return '';
}

/** Full calendar months completed since joining (IST dates). */
export function completedEmploymentMonths(joinYmd, todayYmd = todayIst()) {
  const join = asJoinYmd(joinYmd);
  const today = asJoinYmd(todayYmd) || String(todayYmd || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(join) || !/^\d{4}-\d{2}-\d{2}$/.test(today) || today < join) {
    return 0;
  }

  const [jy, jm, jd] = join.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  let months = (ty - jy) * 12 + (tm - jm);
  if (td < jd) months -= 1;
  return Math.max(0, months);
}

/** Completed 30-day periods since joining (day 0 → 0, day 30 → 1, …). */
export function completedThirtyDayPeriods(joinYmd, todayYmd = todayIst()) {
  const join = asJoinYmd(joinYmd);
  const today = asJoinYmd(todayYmd) || String(todayYmd || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(join) || !/^\d{4}-\d{2}-\d{2}$/.test(today) || today < join) {
    return 0;
  }

  const [jy, jm, jd] = join.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  const days = Math.floor(
    (Date.UTC(ty, tm - 1, td) - Date.UTC(jy, jm - 1, jd)) / 86_400_000
  );
  return Math.max(0, Math.floor(days / 30));
}

/**
 * Months of earned leave that should be credited (employees and managers).
 *
 * - Not yet in 7th month (completedMonths < 6): locked → 0
 * - 7th month (completedMonths === 6): unlock and credit months 1–7 (= 10.5 days)
 * - Later: keep accruing +1.5 per employment month (completed + 1)
 */
export function earnedMonthsDue(joinYmd, todayYmd = todayIst()) {
  const completed = completedEmploymentMonths(joinYmd, todayYmd);
  if (completed < EARNED_UNLOCK_COMPLETED_MONTHS) return 0;
  return completed + 1;
}

/** True once 6 months are completed (employee/manager is in the 7th month). */
export function isEarnedLeaveUnlocked(joinYmd, todayYmd = todayIst()) {
  const join = asJoinYmd(joinYmd);
  if (!join) return false;
  return completedEmploymentMonths(join, todayYmd) >= EARNED_UNLOCK_COMPLETED_MONTHS;
}

/** Balance exposed in UI/APIs: always 0 until unlock. */
export function visibleEarnedBalance(storedEarned, joinYmd, todayYmd = todayIst()) {
  if (!isEarnedLeaveUnlocked(joinYmd, todayYmd)) return 0;
  const n = Number(storedEarned);
  return Number.isFinite(n) ? n : 0;
}

/**
 * While EL is locked, remove any premature auto-accrual credits and subtract
 * them from the stored earned balance so DB + UI stay at 0.
 */
async function clawbackLockedEarnedAutoAccrual(userId, joinYmd, todayYmd = todayIst()) {
  if (isEarnedLeaveUnlocked(joinYmd, todayYmd)) return { clawed: 0 };

  const sumRow = await db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM balance_credits
       WHERE user_id = ?
         AND leave_type = 'earned'
         AND note LIKE ?`
    )
    .get(userId, `${EARNED_NOTE_PREFIX}%`);
  const autoTotal = Math.round(Number(sumRow?.total || 0) * 100) / 100;

  await db.transaction(async () => {
    if (autoTotal > 0) {
      await db
        .prepare(
          `DELETE FROM balance_credits
           WHERE user_id = ?
             AND leave_type = 'earned'
             AND note LIKE ?`
        )
        .run(userId, `${EARNED_NOTE_PREFIX}%`);
    }

    const bal = await db
      .prepare(`SELECT earned FROM leave_balances WHERE user_id = ?`)
      .get(userId);
    const current = Number(bal?.earned ?? 0);
    // Drop auto portion; keep any non-auto remainder floored at 0.
    // While locked, visible API balance is always 0 anyway.
    const next = Math.max(0, Math.round((current - autoTotal) * 100) / 100);
    if (next !== current || autoTotal > 0) {
      await db
        .prepare(
          `UPDATE leave_balances
           SET earned = ?, updated_at = ${SQL_NOW_IST}
           WHERE user_id = ?`
        )
        .run(next, userId);
    }
  });

  return { clawed: autoTotal };
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
  creditorId,
}) {
  if (monthsDue <= 0 || !creditorId || !(amount > 0)) return;

  // One read of existing notes — skip COUNT round-trip.
  const creditedRows = await db
    .prepare(
      `SELECT note FROM balance_credits
       WHERE user_id = ? AND leave_type = ? AND note LIKE ?`
    )
    .all(userId, leaveType, `${notePrefix}%`);
  if (creditedRows.length >= monthsDue) return;

  const credited = new Set(creditedRows.map((row) => row.note));
  const pending = [];
  for (let monthIndex = 1; monthIndex <= monthsDue; monthIndex += 1) {
    const note = `${notePrefix}${monthIndex}`;
    if (!credited.has(note)) pending.push(note);
  }
  if (!pending.length) return;

  const totalCredit = Math.round(pending.length * amount * 100) / 100;
  await db.transaction(async () => {
    const bal = await db
      .prepare(`SELECT ${leaveType} AS value FROM leave_balances WHERE user_id = ?`)
      .get(userId);
    const next = Math.round((Number(bal?.value ?? 0) + totalCredit) * 100) / 100;
    await db
      .prepare(
        `UPDATE leave_balances
         SET ${leaveType} = ?, updated_at = ${SQL_NOW_IST}
         WHERE user_id = ?`
      )
      .run(next, userId);

    const insert = db.prepare(
      `INSERT INTO balance_credits (user_id, leave_type, amount, note, credited_by)
       VALUES (?, ?, ?, ?, ?)`
    );
    for (const note of pending) {
      await insert.run(userId, leaveType, amount, note, creditorId);
    }
  });
}

async function creditCelebrationAccrual(userId, profile, todayYmd, creditorId) {
  if (!creditorId) return;
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

  const creditedRows = await db
    .prepare(
      `SELECT note FROM balance_credits
       WHERE user_id = ? AND leave_type = 'celebration' AND note LIKE ?`
    )
    .all(userId, `${CELEBRATION_NOTE_PREFIX}%`);
  if (creditedRows.length >= yearsDue.length) return;

  const credited = new Set(creditedRows.map((row) => row.note));
  const pending = yearsDue
    .map((year) => `${CELEBRATION_NOTE_PREFIX}${year}`)
    .filter((note) => !credited.has(note));
  if (!pending.length) return;

  const totalCredit = Math.round(pending.length * CELEBRATION_LEAVE_PER_YEAR * 100) / 100;
  await db.transaction(async () => {
    const bal = await db
      .prepare(`SELECT celebration FROM leave_balances WHERE user_id = ?`)
      .get(userId);
    const next = Math.round((Number(bal?.celebration ?? 0) + totalCredit) * 100) / 100;
    await db
      .prepare(
        `UPDATE leave_balances
         SET celebration = ?, updated_at = ${SQL_NOW_IST}
         WHERE user_id = ?`
      )
      .run(next, userId);

    const insert = db.prepare(
      `INSERT INTO balance_credits (user_id, leave_type, amount, note, credited_by)
       VALUES (?, 'celebration', ?, ?, ?)`
    );
    for (const note of pending) {
      await insert.run(userId, CELEBRATION_LEAVE_PER_YEAR, note, creditorId);
    }
  });
}

/** Credit 0.33 casual leave for each completed employment month not yet accrued. */
export async function syncCasualLeaveAccrual(userId) {
  const profile = await db
    .prepare(`SELECT date_of_joining FROM employee_profiles WHERE user_id = ?`)
    .get(userId);
  if (!profile?.date_of_joining) return;
  const creditorId = await accrualCreditorId();
  await creditMonthlyAccrual({
    userId,
    leaveType: 'casual',
    amount: CASUAL_ACCRUAL_PER_MONTH,
    notePrefix: CASUAL_NOTE_PREFIX,
    monthsDue: completedEmploymentMonths(profile.date_of_joining),
    creditorId,
  });
}

/** Credit 1.5 earned leave for each completed employment month after the 6-month unlock. */
export async function syncEarnedLeaveAccrual(userId) {
  const profile = await db
    .prepare(`SELECT date_of_joining FROM employee_profiles WHERE user_id = ?`)
    .get(userId);
  if (!profile?.date_of_joining) return;
  const creditorId = await accrualCreditorId();
  await creditMonthlyAccrual({
    userId,
    leaveType: 'earned',
    amount: EARNED_ACCRUAL_PER_MONTH,
    notePrefix: EARNED_NOTE_PREFIX,
    monthsDue: earnedMonthsDue(profile.date_of_joining),
    creditorId,
  });
}

/** Credit 1 sick leave for every 30 days completed since joining. */
export async function syncSickLeaveAccrual(userId, todayYmd = todayIst()) {
  const profile = await db
    .prepare(`SELECT date_of_joining FROM employee_profiles WHERE user_id = ?`)
    .get(userId);
  if (!profile?.date_of_joining) return;
  const creditorId = await accrualCreditorId();
  await creditMonthlyAccrual({
    userId,
    leaveType: 'sick',
    amount: SICK_ACCRUAL_PER_30_DAYS,
    notePrefix: SICK_NOTE_PREFIX,
    monthsDue: completedThirtyDayPeriods(profile.date_of_joining, todayYmd),
    creditorId,
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
  const creditorId = await accrualCreditorId();
  await creditCelebrationAccrual(userId, profile, todayYmd, creditorId);
}

export async function syncLeaveAccruals(userId) {
  const today = todayIst();
  if (syncedToday.get(userId) === today) return;

  const profile = await db
    .prepare(`SELECT date_of_joining, date_of_birth FROM employee_profiles WHERE user_id = ?`)
    .get(userId);

  // No profile dates → nothing to accrue; still mark synced for today.
  if (!profile?.date_of_joining && !profile?.date_of_birth) {
    if (syncedToday.size >= SYNCED_TODAY_MAX) syncedToday.clear();
    syncedToday.set(userId, today);
    return;
  }

  const creditorId = await accrualCreditorId();
  if (!creditorId) {
    if (syncedToday.size >= SYNCED_TODAY_MAX) syncedToday.clear();
    syncedToday.set(userId, today);
    return;
  }

  const join = profile?.date_of_joining || null;
  const monthsDue = completedEmploymentMonths(join);
  const earnedDue = earnedMonthsDue(join, today);
  const sickDue = completedThirtyDayPeriods(join, today);

  // Never keep premature EL credits while still locked (< 7th month).
  await clawbackLockedEarnedAutoAccrual(userId, join, today);

  // Sequential credits avoid stampeding the Postgres pool (max ~10).
  await creditMonthlyAccrual({
    userId,
    leaveType: 'casual',
    amount: CASUAL_ACCRUAL_PER_MONTH,
    notePrefix: CASUAL_NOTE_PREFIX,
    monthsDue,
    creditorId,
  });
  // EL only credits once unlocked (earnedDue is 0 while locked).
  await creditMonthlyAccrual({
    userId,
    leaveType: 'earned',
    amount: EARNED_ACCRUAL_PER_MONTH,
    notePrefix: EARNED_NOTE_PREFIX,
    monthsDue: earnedDue,
    creditorId,
  });
  await creditMonthlyAccrual({
    userId,
    leaveType: 'sick',
    amount: SICK_ACCRUAL_PER_30_DAYS,
    notePrefix: SICK_NOTE_PREFIX,
    monthsDue: sickDue,
    creditorId,
  });
  await creditCelebrationAccrual(userId, profile, today, creditorId);

  if (syncedToday.size >= SYNCED_TODAY_MAX) syncedToday.clear();
  syncedToday.set(userId, today);
}

async function mapPool(items, concurrency, worker) {
  if (!items.length) return;
  const limit = Math.max(1, Math.min(concurrency, items.length));
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        await worker(items[index], index);
      }
    })
  );
}

/** Ensure balance rows exist and run accrual sync for many users (muster / HR views). */
export async function syncLeaveAccrualsForUsers(userIds = [], { force = false, concurrency = 2 } = {}) {
  const today = todayIst();
  const ids = [...new Set((userIds || []).map((id) => Number(id)).filter((id) => id > 0))];
  const pending = force ? ids : ids.filter((id) => syncedToday.get(id) !== today);
  if (!pending.length) return { users: 0 };

  await mapPool(pending, concurrency, async (id) => {
    await ensureBalanceRowLocal(id);
    if (force) syncedToday.delete(id);
    await syncLeaveAccruals(id);
  });
  return { users: pending.length };
}

/**
 * Reject earned-leave applications until the 7th employment month
 * (after completing 6 months from joining).
 */
export async function assertEarnedLeaveUnlocked(userId) {
  const profile = await db
    .prepare(`SELECT date_of_joining FROM employee_profiles WHERE user_id = ?`)
    .get(userId);
  const join = profile?.date_of_joining || null;
  const completedMonths = completedEmploymentMonths(join);
  const unlocked = isEarnedLeaveUnlocked(join);
  if (!unlocked) {
    throw Object.assign(
      new Error(
        `Earned leave unlocks in the 7th month after completing ${EARNED_UNLOCK_COMPLETED_MONTHS} months from joining. Completed: ${completedMonths} of ${EARNED_UNLOCK_COMPLETED_MONTHS}.`
      ),
      { status: 400, completedMonths, unlocked: false }
    );
  }
  return { unlocked: true, completedMonths, dateOfJoining: join };
}

export async function getEarnedLeaveUnlockInfo(userId) {
  const profile = await db
    .prepare(`SELECT date_of_joining FROM employee_profiles WHERE user_id = ?`)
    .get(userId);
  const join = profile?.date_of_joining || null;
  const completedMonths = completedEmploymentMonths(join);
  const monthsDue = earnedMonthsDue(join);
  return {
    unlocked: isEarnedLeaveUnlocked(join),
    completedMonths,
    monthsDue,
    daysDue: monthsDue * EARNED_ACCRUAL_PER_MONTH,
    unlockAfterMonths: EARNED_UNLOCK_COMPLETED_MONTHS,
    dateOfJoining: join,
  };
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

async function ensureBalanceRowLocal(userId) {
  await db
    .prepare(
      `INSERT INTO leave_balances (user_id, casual, earned, sick, restricted, celebration)
       VALUES (?, 0, 0, 0, 2, 0)
       ON CONFLICT(user_id) DO NOTHING`
    )
    .run(userId);
}

/** One-shot backfill for all active employees (and managers). */
export async function syncLeaveAccrualsForAllActiveUsers() {
  const rows = await db
    .prepare(`SELECT id FROM users WHERE active = 1 AND role IN ('user', 'manager')`)
    .all();
  return syncLeaveAccrualsForUsers(
    rows.map((row) => row.id),
    { force: true }
  );
}
