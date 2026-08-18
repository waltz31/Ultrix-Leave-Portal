const MONTH_KEYS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/** Stable scenic photo per month via Picsum (public, no API key). */
export function calendarMonthImageUrl(monthIndex, variant = 'hero') {
  const key = MONTH_KEYS[monthIndex] || MONTH_KEYS[0];
  if (variant === 'thumb') {
    return `https://picsum.photos/seed/ultrix-leave-${key}/240/120`;
  }
  return `https://picsum.photos/seed/ultrix-leave-${key}/720/1080`;
}

export const CALENDAR_WEEKS = 6;
export const CALENDAR_COLUMNS = 7;
export const CALENDAR_CELLS = CALENDAR_WEEKS * CALENDAR_COLUMNS;
