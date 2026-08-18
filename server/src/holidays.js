import { eachCalendarDay, isWeekendYmd } from './leaveUtils.js';

export const RESTRICTED_HOLIDAYS_PER_YEAR = 2;

export const RH_ONLY_PUBLISHED_DATES =
  'Restricted holidays can only be taken on published RH dates. You cannot apply a restricted holiday on this day.';

export function rhLimitReachedMessage(used, year = new Date().getFullYear()) {
  return `You have already used ${used} restricted holiday${Number(used) === 1 ? '' : 's'} in ${year}. Only ${RESTRICTED_HOLIDAYS_PER_YEAR} restricted holidays can be taken per year.`;
}

export const WEEKEND_LEAVE_BLOCKED = 'Leave cannot be applied on Saturdays or Sundays.';
export const GENERAL_HOLIDAY_LEAVE_BLOCKED =
  'Leave cannot be applied on general holidays. This date is already a company holiday.';

export const HOLIDAYS_2026 = [
  { date: '2026-01-01', title: 'New Year', type: 'general' },
  { date: '2026-01-15', title: 'Sankranti/Ponga', type: 'restricted' },
  { date: '2026-01-26', title: 'Republic Day', type: 'general' },
  { date: '2026-03-04', title: 'Holi', type: 'general' },
  { date: '2026-03-19', title: 'Ugadi Festival', type: 'restricted' },
  { date: '2026-03-20', title: 'Eid-ul-Fitr', type: 'restricted' },
  { date: '2026-04-03', title: 'Good Friday', type: 'restricted' },
  { date: '2026-04-14', title: 'Tamil New Year', type: 'restricted' },
  { date: '2026-05-01', title: 'May Day', type: 'general' },
  { date: '2026-05-28', title: 'Bakrid', type: 'restricted' },
  { date: '2026-08-15', title: 'Independence Day', type: 'general' },
  { date: '2026-08-26', title: 'Eid e Milad', type: 'restricted' },
  { date: '2026-08-28', title: 'Rakshabandhan', type: 'restricted' },
  { date: '2026-09-14', title: 'Ganesh Chathurthi', type: 'restricted' },
  { date: '2026-10-02', title: 'Gandhi Jayanthi', type: 'general' },
  { date: '2026-10-21', title: 'Vijayadasami/Dussehra', type: 'general' },
  { date: '2026-11-10', title: 'Balipadyami, Deepavali', type: 'general' },
  { date: '2026-11-24', title: 'Guru Nanak Chathurthi', type: 'restricted' },
  { date: '2026-12-25', title: 'Christmas', type: 'general' },
];

export function parseHolidayType(value) {
  const text = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z]+/g, '');
  if (text.startsWith('restrict') || text === 'rh') return 'restricted';
  return 'general';
}

export function holidayNote(type) {
  return type === 'restricted'
    ? 'Restricted leave — employees and managers start with 2 per year'
    : 'General holiday';
}

export async function loadGeneralHolidays(db, startDate, endDate) {
  const rows = await db
    .prepare(
      `SELECT title, start_date, end_date FROM mandatory_leaves
       WHERE COALESCE(holiday_type, 'general') = 'general'
         AND end_date >= ? AND start_date <= ?`
    )
    .all(startDate, endDate);
  const dates = new Set();
  const names = new Map();
  for (const row of rows) {
    for (const day of eachCalendarDay(row.start_date, row.end_date)) {
      dates.add(day);
      if (!names.has(day)) names.set(day, row.title);
    }
  }
  return { dates, names };
}

export function blockedWorkingDateMessage(ymd, holidayDates, holidayNames) {
  if (!ymd) return null;
  if (isWeekendYmd(ymd)) return WEEKEND_LEAVE_BLOCKED;
  if (holidayDates?.has(ymd)) {
    const name = holidayNames?.get(ymd);
    return name
      ? `Leave cannot be applied on general holidays. ${name} is already a company holiday.`
      : GENERAL_HOLIDAY_LEAVE_BLOCKED;
  }
  return null;
}

export function blockedRegularLeaveMessage(startDate, endDate, holidayDates, holidayNames) {
  return (
    blockedWorkingDateMessage(startDate, holidayDates, holidayNames) ||
    (endDate && endDate !== startDate
      ? blockedWorkingDateMessage(endDate, holidayDates, holidayNames)
      : null)
  );
}

export async function assertRegularLeaveWindow(db, startDate, endDate) {
  const { dates, names } = await loadGeneralHolidays(db, startDate, endDate);
  const blocked = blockedRegularLeaveMessage(startDate, endDate, dates, names);
  if (blocked) {
    throw Object.assign(new Error(blocked), { status: 400 });
  }
  return dates;
}

export function seedCompanyHolidaysSync(db) {
  const insert = db.prepare(
    `INSERT INTO mandatory_leaves (title, start_date, end_date, note, holiday_type)
     VALUES (?, ?, ?, ?, ?)`
  );
  const find = db.prepare(
    `SELECT id FROM mandatory_leaves WHERE start_date = ? AND end_date = ?`
  );
  const update = db.prepare(
    `UPDATE mandatory_leaves SET title = ?, holiday_type = ?, note = COALESCE(note, ?) WHERE id = ?`
  );
  for (const holiday of HOLIDAYS_2026) {
    const existing = find.get(holiday.date, holiday.date);
    const note = holidayNote(holiday.type);
    if (existing) {
      update.run(holiday.title, holiday.type, note, existing.id);
      continue;
    }
    insert.run(holiday.title, holiday.date, holiday.date, note, holiday.type);
  }
}

export async function seedCompanyHolidays(db) {
  for (const holiday of HOLIDAYS_2026) {
    const existing = await db
      .prepare(`SELECT id FROM mandatory_leaves WHERE start_date = ? AND end_date = ?`)
      .get(holiday.date, holiday.date);
    const note = holidayNote(holiday.type);
    if (existing) {
      await db
        .prepare(
          `UPDATE mandatory_leaves SET title = ?, holiday_type = ?, note = COALESCE(note, ?) WHERE id = ?`
        )
        .run(holiday.title, holiday.type, note, existing.id);
      continue;
    }
    await db
      .prepare(
        `INSERT INTO mandatory_leaves (title, start_date, end_date, note, holiday_type)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(holiday.title, holiday.date, holiday.date, note, holiday.type);
  }
}
