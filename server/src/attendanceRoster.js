/** People who should not appear on Attendance Muster / Attendance Info rosters. */
export const ATTENDANCE_ROSTER_EXCLUDED_EMAILS = [
  'hr@ultrix.co',
  'parth@ultrix.co',
  'rahul@getstan.app',
];

const EXCLUDED = new Set(ATTENDANCE_ROSTER_EXCLUDED_EMAILS.map((e) => e.toLowerCase()));

/** SQL fragment: active non-HR roster employees, excluding board/HR accounts. */
export function attendanceRosterSql(alias = 'u') {
  const emails = [...EXCLUDED].map((e) => `'${e.replace(/'/g, "''")}'`).join(', ');
  return `${alias}.active = 1
    AND ${alias}.role IN ('user', 'manager')
    AND LOWER(COALESCE(${alias}.email, '')) NOT IN (${emails})`;
}

export function includeInAttendanceRoster(user) {
  if (!user) return false;
  if (user.active === false || user.active === 0) return false;
  if (user.role === 'hr') return false;
  if (user.role !== 'user' && user.role !== 'manager') return false;
  const email = String(user.email || '').trim().toLowerCase();
  if (email && EXCLUDED.has(email)) return false;
  return true;
}
