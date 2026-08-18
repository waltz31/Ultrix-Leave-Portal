import { format } from 'date-fns';
import * as XLSX from 'xlsx';

const MONTHS = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function normalizeHeader(value) {
  return String(value ?? '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function holidayHeaderToKey(header) {
  const key = normalizeHeader(header);
  if (!key) return null;
  if (['slno', 'sno', 'serialno', 'serialnumber', 'srno', 'no'].includes(key)) {
    return null;
  }
  if (['date', 'holidaydate', 'startdate', 'start', 'from', 'day'].includes(key)) {
    return 'date';
  }
  if (['holiday', 'holidayname', 'title', 'name', 'leave', 'leavetitle', 'occasion'].includes(key)) {
    return 'holiday';
  }
  if (['holidaytype', 'type', 'category', 'kind'].includes(key)) {
    return 'holidayType';
  }
  if (['note', 'notes', 'reason', 'description', 'remarks'].includes(key)) {
    return 'note';
  }
  if (['enddate', 'end', 'to'].includes(key)) {
    return 'endDate';
  }
  return null;
}

function cellText(value) {
  if (value == null) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return format(value, 'yyyy-MM-dd');
  }
  return String(value).trim();
}

function readSheetCell(cell) {
  if (!cell) return '';
  const value = cell.v ?? cell.w ?? '';
  if (value instanceof Date) return value;
  return value;
}

function usedRange(sheet) {
  if (!sheet?.['!ref']) return null;
  return XLSX.utils.decode_range(sheet['!ref']);
}

function findHolidayHeaderRow(sheet, range) {
  let bestRow = range.s.r;
  let bestCount = -1;
  const scanTo = Math.min(range.s.r + 20, range.e.r);
  for (let r = range.s.r; r <= scanTo; r += 1) {
    let count = 0;
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      const header = cellText(readSheetCell(sheet[XLSX.utils.encode_cell({ r, c })]));
      if (holidayHeaderToKey(header)) count += 1;
    }
    if (count > bestCount) {
      bestCount = count;
      bestRow = r;
    }
  }
  return { headerRow: bestRow, mappedCols: bestCount };
}

export function parseHolidayDate(value) {
  if (value == null || value === '') return '';

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return format(value, 'yyyy-MM-dd');
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
    }
  }

  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);

  const dmy = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (dmy) {
    let year = dmy[3];
    if (year.length === 2) year = `20${year}`;
    return `${year}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  }

  const named = text.match(/^(\d{1,2})[\s./-]+([A-Za-z]+)[\s./-]+(\d{2,4})$/);
  if (named) {
    const month = MONTHS[named[2].toLowerCase().replace(/\./g, '')];
    let year = named[3];
    if (year.length === 2) year = `20${year}`;
    if (month) {
      return `${year}-${String(month).padStart(2, '0')}-${named[1].padStart(2, '0')}`;
    }
  }

  const parsedMs = Date.parse(text);
  if (!Number.isNaN(parsedMs)) {
    const d = new Date(parsedMs);
    if (!Number.isNaN(d.getTime())) return format(d, 'yyyy-MM-dd');
  }

  return '';
}

function isHeaderEcho(title, holidayType) {
  const titleKey = normalizeHeader(title);
  const typeKey = normalizeHeader(holidayType);
  return (
    !titleKey ||
    ['date', 'holiday', 'holidaytype', 'type', 'slno', 'serialno', 'sno'].includes(titleKey) ||
    ['date', 'holiday', 'holidaytype', 'type'].includes(typeKey)
  );
}

function rowsFromHolidaySheet(sheet) {
  const range = usedRange(sheet);
  if (!range) return [];

  const { headerRow, mappedCols } = findHolidayHeaderRow(sheet, range);
  if (mappedCols < 2) return [];

  const keysByCol = {};
  for (let c = range.s.c; c <= range.e.c; c += 1) {
    const header = cellText(readSheetCell(sheet[XLSX.utils.encode_cell({ r: headerRow, c })]));
    const key = holidayHeaderToKey(header);
    if (key) keysByCol[c] = key;
  }

  const rows = [];
  for (let r = headerRow + 1; r <= range.e.r; r += 1) {
    const mapped = {};
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      const key = keysByCol[c];
      if (!key) continue;
      const value = readSheetCell(sheet[XLSX.utils.encode_cell({ r, c })]);
      if (mapped[key] == null || mapped[key] === '') mapped[key] = value;
    }

    const startDate = parseHolidayDate(mapped.date);
    const endDate = parseHolidayDate(mapped.endDate) || startDate;
    const title = cellText(mapped.holiday) || cellText(mapped.title) || '';
    const typeRaw = cellText(mapped.holidayType);
    const holidayType = /restrict|^rh$/i.test(typeRaw) ? 'restricted' : 'general';
    const note = cellText(mapped.note) || null;

    if (!startDate || !title || isHeaderEcho(title, typeRaw)) continue;
    rows.push({ title, startDate, endDate, note, holidayType });
  }

  return rows;
}

function rowsFromHolidayJson(sheet) {
  const jsonRows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true });
  return jsonRows
    .map((row) => {
      const entries = Object.entries(row || {});
      const pick = (names) => {
        for (const name of names) {
          const want = normalizeHeader(name);
          const hit = entries.find(([k]) => normalizeHeader(k) === want);
          if (hit) return hit[1];
        }
        return undefined;
      };

      const startDate = parseHolidayDate(pick(['date', 'start_date', 'start', 'from', 'holiday date']));
      const endDate = parseHolidayDate(pick(['end_date', 'end', 'to'])) || startDate;
      const title = cellText(pick(['holiday', 'title', 'name', 'leave', 'leave title'])) || '';
      const typeRaw = cellText(pick(['holiday type', 'holiday_type', 'type', 'holidaytype']));
      const holidayType = /restrict|^rh$/i.test(typeRaw) ? 'restricted' : 'general';
      const note = cellText(pick(['note', 'notes', 'reason', 'description'])) || null;
      return { title, startDate, endDate, note, holidayType };
    })
    .filter((row) => row.startDate && row.title && !isHeaderEcho(row.title, row.holidayType));
}

export const HOLIDAY_UPLOAD_ACCEPT =
  '.csv,.xlsx,.xls,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,application/csv';

const HOLIDAY_UPLOAD_EXTENSIONS = /\.(csv|xlsx|xls)$/i;

export function isHolidayUploadFile(file) {
  if (!file) return false;
  const name = String(file.name || '').toLowerCase();
  if (HOLIDAY_UPLOAD_EXTENSIONS.test(name)) return true;
  const type = String(file.type || '').toLowerCase();
  return [
    'text/csv',
    'application/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ].includes(type);
}

function readHolidayWorkbook(file, buffer) {
  const name = String(file?.name || '').toLowerCase();
  if (name.endsWith('.csv') || String(file?.type || '').toLowerCase().includes('csv')) {
    const text = new TextDecoder('utf-8').decode(buffer);
    return XLSX.read(text, { type: 'string', cellDates: true, cellNF: true, raw: true });
  }
  return XLSX.read(buffer, { type: 'array', cellDates: true, cellNF: true });
}

export function parseHolidayWorkbook(workbook) {
  const skip = new Set(['instructions', 'lists', 'readme']);
  const sheetName =
    workbook.SheetNames.find((n) => n.toLowerCase() === 'holidays') ||
    workbook.SheetNames.find((n) => !skip.has(n.toLowerCase())) ||
    workbook.SheetNames[0];
  if (!sheetName) return [];

  const sheet = workbook.Sheets[sheetName];
  const rows = rowsFromHolidaySheet(sheet);
  if (rows.length) return rows;
  return rowsFromHolidayJson(sheet);
}

export async function parseHolidayFile(file) {
  if (!isHolidayUploadFile(file)) {
    throw new Error('Upload a CSV, XLSX, or Excel (.xls) file.');
  }
  const buffer = await file.arrayBuffer();
  const workbook = readHolidayWorkbook(file, buffer);
  return parseHolidayWorkbook(workbook);
}

export function buildHolidayTemplateRows() {
  return [
    ['Sl No.', 'Date', 'Holiday', 'Holiday Type'],
    [1, '01 Jan 2026', 'New Year', 'General'],
    [2, '15 Jan 2026', 'Sankranti/Ponga', 'Restricted'],
    [3, '26 Jan 2026', 'Republic Day', 'General'],
    [4, '04 Mar 2026', 'Holi', 'General'],
    [5, '19 Mar 2026', 'Ugadi Festival', 'Restricted'],
    [6, '20 Mar 2026', 'Eid-ul-Fitr', 'Restricted'],
    [7, '03 Apr 2026', 'Good Friday', 'Restricted'],
    [8, '14 Apr 2026', 'Tamil New Year', 'Restricted'],
    [9, '01 May 2026', 'May Day', 'General'],
    [10, '28 May 2026', 'Bakrid', 'Restricted'],
    [11, '15 Aug 2026', 'Independence Day', 'General'],
    [12, '26 Aug 2026', 'Eid e Milad', 'Restricted'],
    [13, '28 Aug 2026', 'Rakshabandhan', 'Restricted'],
    [14, '14 Sep 2026', 'Ganesh Chathurthi', 'Restricted'],
    [15, '02 Oct 2026', 'Gandhi Jayanthi', 'General'],
    [16, '21 Oct 2026', 'Vijayadasami/Dussehra', 'General'],
    [17, '10 Nov 2026', 'Balipadyami, Deepavali', 'General'],
    [18, '24 Nov 2026', 'Guru Nanak Chathurthi', 'Restricted'],
    [19, '25 Dec 2026', 'Christmas', 'General'],
  ];
}
