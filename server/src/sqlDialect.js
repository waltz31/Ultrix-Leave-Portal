import 'dotenv/config';
import { APP_TIMEZONE } from './time.js';

export const isPostgres = Boolean(String(process.env.DATABASE_URL || '').trim());

/** Current IST timestamp as SQL (sqlite vs postgres). */
export const SQL_NOW_IST = isPostgres
  ? `to_char((now() AT TIME ZONE '${APP_TIMEZONE}'), 'YYYY-MM-DD HH24:MI:SS')`
  : "datetime('now', '+5 hours', '30 minutes')";

export const SQL_TODAY_IST = isPostgres
  ? `to_char((now() AT TIME ZONE '${APP_TIMEZONE}'), 'YYYY-MM-DD')`
  : "date('now', '+5 hours', '30 minutes')";

export function translateSql(sql) {
  if (!isPostgres) return sql;
  let s = sql;
  s = s.replace(/COLLATE NOCASE/gi, '');
  s = s.replace(
    /strftime\('%Y-%m',\s*lr\.start_date\)/g,
    "to_char(lr.start_date::date, 'YYYY-MM')"
  );
  s = s.replace(
    /strftime\('%Y-%m',\s*'now',\s*'\+5 hours',\s*'30 minutes'\)/g,
    `to_char((now() AT TIME ZONE '${APP_TIMEZONE}'), 'YYYY-MM')`
  );
  s = s.replace(
    /date\('now',\s*'\+5 hours',\s*'30 minutes',\s*'-5 months',\s*'start of month'\)/g,
    `(date_trunc('month', (now() AT TIME ZONE '${APP_TIMEZONE}') - interval '5 months'))::date`
  );
  s = s.replace(/\bdate\((er\.created_at)\)/g, '($1)::date');
  // leave_requests dates are stored as TEXT — cast when compared to date expressions
  s = s.replace(
    /\b(lr\.)?(start_date|end_date)\s*(>=|<=|>|<)\s*\(/gi,
    (_, lrPrefix, col, op) => `${lrPrefix || ''}${col}::date ${op} (`
  );
  s = s.replace(/ON CONFLICT\(user_id\)/gi, 'ON CONFLICT (user_id)');
  s = s.replace(/ON CONFLICT\(key\)/gi, 'ON CONFLICT (key)');
  s = s.replace(
    /ON CONFLICT\(device_user_code, punched_at, serial_number\)/gi,
    'ON CONFLICT (device_user_code, punched_at, serial_number)'
  );
  return s;
}

export function toPgPlaceholders(sql) {
  let n = 0;
  return sql.replace(/'(?:''|[^'])*'|\?/g, (m) => (m === '?' ? `$${++n}` : m));
}

export function isUniqueViolation(err) {
  return (
    err?.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    err?.code === '23505' ||
    String(err?.message || '').includes('UNIQUE constraint')
  );
}
