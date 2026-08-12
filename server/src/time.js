/** App-wide timezone: Indian Standard Time (UTC+05:30, no DST). */
export const APP_TIMEZONE = 'Asia/Kolkata';
export const APP_TIMEZONE_LABEL = 'IST';
export const APP_UTC_OFFSET = '+05:30';

/** Force Node `Date` helpers to use IST when possible. */
process.env.TZ = APP_TIMEZONE;

/** Current IST wall-clock as `YYYY-MM-DD HH:mm:ss`. */
export function nowIst() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
    .format(new Date())
    .replace(',', '');
}

/** Current IST calendar date as `YYYY-MM-DD`. */
export function todayIst() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
