export const RESTRICTED_HOLIDAYS_PER_YEAR = 2;

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
    ? 'Restricted holiday — employees and managers may take up to 2 per year'
    : 'General holiday';
}

export function seedCompanyHolidaysSync(db) {
  const insert = db.prepare(
    `INSERT INTO mandatory_leaves (title, start_date, end_date, note, holiday_type)
     VALUES (?, ?, ?, ?, ?)`
  );
  const find = db.prepare(
    `SELECT id, holiday_type FROM mandatory_leaves WHERE start_date = ? AND end_date = ? AND title = ?`
  );
  const updateType = db.prepare(`UPDATE mandatory_leaves SET holiday_type = ? WHERE id = ?`);
  for (const holiday of HOLIDAYS_2026) {
    const existing = find.get(holiday.date, holiday.date, holiday.title);
    if (existing) {
      if (existing.holiday_type !== holiday.type) updateType.run(holiday.type, existing.id);
      continue;
    }
    insert.run(holiday.title, holiday.date, holiday.date, holidayNote(holiday.type), holiday.type);
  }
}

export async function seedCompanyHolidays(db) {
  for (const holiday of HOLIDAYS_2026) {
    const existing = await db
      .prepare(
        `SELECT id, holiday_type FROM mandatory_leaves WHERE start_date = ? AND end_date = ? AND title = ?`
      )
      .get(holiday.date, holiday.date, holiday.title);
    if (existing) {
      if (existing.holiday_type !== holiday.type) {
        await db
          .prepare(`UPDATE mandatory_leaves SET holiday_type = ? WHERE id = ?`)
          .run(holiday.type, existing.id);
      }
      continue;
    }
    await db
      .prepare(
        `INSERT INTO mandatory_leaves (title, start_date, end_date, note, holiday_type)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(holiday.title, holiday.date, holiday.date, holidayNote(holiday.type), holiday.type);
  }
}
