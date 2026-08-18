import * as XLSX from 'xlsx';
import {
  ASSET_CATEGORIES,
  ASSET_CATEGORY_LABELS,
  BONUS_FREQUENCIES,
  BONUS_FREQUENCY_LABELS,
  EMPLOYMENT_STATUS_LABELS,
  EMPLOYMENT_STATUSES,
  EMPLOYMENT_TYPE_LABELS,
  EMPLOYMENT_TYPES,
  GENDER_LABELS,
  GENDERS,
  MARITAL_STATUS_LABELS,
  MARITAL_STATUSES,
  WORK_MODE_LABELS,
  WORK_MODES,
} from './employeeProfileUtils.js';

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const ASSET_SLOTS = 3;

const EMPTY_ASSET = {
  assetCategory: 'laptop_desktop',
  deviceAssigned: '',
  assetId: '',
  mobileNumber: '',
  accessCard: '',
  issueDate: '',
  returnDate: '',
  softwareAccess: '',
  companyEmail: '',
};

const COLUMN_HEADERS = [
  ['employeeNumber', 'Employee ID'],
  ['name', 'Full name'],
  ['dateOfBirth', 'Date of birth'],
  ['gender', 'Gender'],
  ['personalEmail', 'Personal email'],
  ['personalMobile', 'Personal mobile'],
  ['address', 'Address'],
  ['emergencyContact', 'Emergency contact'],
  ['nationality', 'Nationality'],
  ['maritalStatus', 'Marital status'],
  ['email', 'Work email'],
  ['password', 'Temporary password'],
  ['dateOfJoining', 'Date of joining'],
  ['employmentType', 'Employment type'],
  ['department', 'Department'],
  ['designation', 'Designation'],
  ['jobLevel', 'Job level'],
  ['managerEmail', 'Reporting manager email'],
  ['location', 'Location'],
  ['workMode', 'Work mode'],
  ['employmentStatus', 'Employment status'],
  ['probationPeriod', 'Probation period'],
  ['confirmationDate', 'Confirmation date'],
  ['basicSalary', 'Basic salary'],
  ['hra', 'HRA'],
  ['allowances', 'Allowances'],
  ['variablePay', 'Variable pay'],
  ['bonuses', 'Bonuses'],
  ['deductions', 'Deductions'],
  ['pfEpfDetails', 'PF / EPF details'],
  ['professionalTax', 'Professional tax'],
  ['tds', 'TDS'],
  ['netSalary', 'Net salary'],
  ['salaryHistory', 'Salary history'],
  ['payslips', 'Payslips'],
  ['bankAccountDetails', 'Bank account details'],
  ['stipend', 'Stipend (intern)'],
  ['fixedPay', 'Fixed pay (consultant)'],
  ['joiningBonus', 'Joining bonus (consultant)'],
  ['retentionBonus', 'Retention bonus (consultant)'],
  ['esops', 'ESOPs (consultant)'],
  ['bonusAmount', 'Bonus (consultant)'],
  ['bonusFrequency', 'Bonus frequency (consultant)'],
];

const HEADER_ALIASES = {
  empid: 'employeeNumber',
  empcode: 'employeeNumber',
  employeecode: 'employeeNumber',
  employeeid: 'employeeNumber',
  staffid: 'employeeNumber',
  employeename: 'name',
  fullname: 'name',
  candidatename: 'name',
  dob: 'dateOfBirth',
  birthdate: 'dateOfBirth',
  dateofbirth: 'dateOfBirth',
  sex: 'gender',
  mobile: 'personalMobile',
  phone: 'personalMobile',
  mobileno: 'personalMobile',
  mobilenumber: 'personalMobile',
  personalphone: 'personalMobile',
  contactnumber: 'personalMobile',
  contactno: 'personalMobile',
  phonenumber: 'personalMobile',
  personalmail: 'personalEmail',
  personalemailid: 'personalEmail',
  workemail: 'email',
  officeemail: 'email',
  officialemail: 'email',
  companyemail: 'email',
  emailid: 'email',
  officialmail: 'email',
  temppassword: 'password',
  doj: 'dateOfJoining',
  joiningdate: 'dateOfJoining',
  dateofjoin: 'dateOfJoining',
  emptype: 'employmentType',
  type: 'employmentType',
  dept: 'department',
  role: 'designation',
  jobtitle: 'designation',
  title: 'designation',
  grade: 'jobLevel',
  level: 'jobLevel',
  reportingmanager: 'managerEmail',
  manager: 'managerEmail',
  managername: 'managerEmail',
  reportingto: 'managerEmail',
  office: 'location',
  city: 'location',
  worklocation: 'location',
  mode: 'workMode',
  status: 'employmentStatus',
  probation: 'probationPeriod',
  confirmation: 'confirmationDate',
  basicsal: 'basicSalary',
  basic: 'basicSalary',
  pf: 'pfEpfDetails',
  epf: 'pfEpfDetails',
  uan: 'pfEpfDetails',
  pt: 'professionalTax',
  bank: 'bankAccountDetails',
  bankdetails: 'bankAccountDetails',
  accountnumber: 'bankAccountDetails',
  internstipend: 'stipend',
};

const ASSET_HEADER_SUFFIX = {
  category: 'assetCategory',
  device: 'deviceAssigned',
  deviceassigned: 'deviceAssigned',
  id: 'assetId',
  assetid: 'assetId',
  mobile: 'mobileNumber',
  accesscard: 'accessCard',
  issuedate: 'issueDate',
  returndate: 'returnDate',
  softwareaccess: 'softwareAccess',
  companyemail: 'companyEmail',
};

const GENDER_ALIASES = { m: 'male', f: 'female', male: 'male', female: 'female', o: 'other' };

function optionsFrom(values, labels) {
  return values.map((value) => ({ value, label: labels[value] || value }));
}

const GENDER_OPTIONS = optionsFrom(GENDERS, GENDER_LABELS);
const MARITAL_OPTIONS = optionsFrom(MARITAL_STATUSES, MARITAL_STATUS_LABELS);
const EMPLOYMENT_TYPE_OPTIONS = optionsFrom(EMPLOYMENT_TYPES, EMPLOYMENT_TYPE_LABELS);
const WORK_MODE_OPTIONS = optionsFrom(WORK_MODES, WORK_MODE_LABELS);
const EMPLOYMENT_STATUS_OPTIONS = optionsFrom(EMPLOYMENT_STATUSES, EMPLOYMENT_STATUS_LABELS);
const ASSET_CATEGORY_OPTIONS = optionsFrom(ASSET_CATEGORIES, ASSET_CATEGORY_LABELS);
const BONUS_FREQUENCY_OPTIONS = optionsFrom(BONUS_FREQUENCIES, BONUS_FREQUENCY_LABELS);

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function normHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

const HEADER_TO_KEY = Object.fromEntries(
  COLUMN_HEADERS.flatMap(([key, header]) => [
    [normHeader(header), key],
    [normHeader(key), key],
  ])
);

function headerToKey(header) {
  const n = normHeader(header);
  if (!n) return '';
  if (HEADER_TO_KEY[n]) return HEADER_TO_KEY[n];
  if (HEADER_ALIASES[n]) return HEADER_ALIASES[n];
  const asset = n.match(
    /^asset(\d+)(category|device|deviceassigned|id|assetid|mobile|accesscard|issuedate|returndate|softwareaccess|companyemail)$/
  );
  if (asset) {
    const slot = Number(asset[1]);
    const field = ASSET_HEADER_SUFFIX[asset[2]];
    if (slot >= 1 && field) return `asset${slot}_${field}`;
  }
  return '';
}

function matchOption(options, raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  const lower = text.toLowerCase();
  const compact = lower.replace(/[\s\-/]+/g, '_');
  const found = options.find(
    (o) =>
      o.value === compact ||
      o.value === lower ||
      o.label.toLowerCase() === lower ||
      o.label.toLowerCase().replace(/[\s\-/]+/g, '_') === compact
  );
  if (found) return found.value;
  const prefixed = options.filter(
    (o) => o.label.toLowerCase().startsWith(lower) || o.value.startsWith(compact)
  );
  if (prefixed.length === 1) return prefixed[0].value;
  return '';
}

function ymdFromParts(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return '';
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function excelSerialToYmd(value) {
  const serial = Math.round(Number(value));
  if (!Number.isFinite(serial)) return '';
  const utc = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
  return ymdFromParts(utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate());
}

function toIsoDate(value) {
  if (value == null || value === '') return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return ymdFromParts(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  if (typeof value === 'number' && Number.isFinite(value)) return excelSerialToYmd(value);
  const text = String(value).trim();
  if (!text) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const dmy = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) return ymdFromParts(dmy[3], dmy[2], dmy[1]);
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return ymdFromParts(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate());
  }
  return '';
}

function isExcelDateFormat(fmt) {
  if (!fmt) return false;
  const z = String(fmt);
  return /[yYdDmM]/.test(z) && !/[hHsS]/.test(z);
}

function readSheetCell(cell) {
  if (!cell) return '';
  if (cell.t === 'd' && cell.v instanceof Date) return cell.v;
  if (cell.t === 'b') return cell.v ? 'TRUE' : 'FALSE';
  if (cell.t === 'n') {
    if (isExcelDateFormat(cell.z)) return cell.v;
    if (cell.w != null && String(cell.w).trim() !== '') return String(cell.w).trim();
    return cell.v;
  }
  if (cell.w != null && String(cell.w).trim() !== '') return String(cell.w).trim();
  if (cell.v == null || cell.v === '') return '';
  return cell.v;
}

function cellText(value) {
  if (value == null) return '';
  if (value instanceof Date) return toIsoDate(value);
  return String(value).trim();
}

function isTemplateExampleRow(raw) {
  const name = cellText(raw.name).toLowerCase();
  const email = cellText(raw.email).toLowerCase();
  const emp = cellText(raw.employeeNumber).toLowerCase();
  return (
    name === 'ada lovelace' ||
    email === 'ada@company.com' ||
    email === 'ada@example.com' ||
    (emp === 'emp001' && name === 'ada lovelace')
  );
}

function usedRange(sheet) {
  let minR = Infinity;
  let minC = Infinity;
  let maxR = -1;
  let maxC = -1;
  for (const key of Object.keys(sheet)) {
    if (key[0] === '!') continue;
    const cell = XLSX.utils.decode_cell(key);
    minR = Math.min(minR, cell.r);
    minC = Math.min(minC, cell.c);
    maxR = Math.max(maxR, cell.r);
    maxC = Math.max(maxC, cell.c);
  }
  if (sheet['!ref']) {
    const ref = XLSX.utils.decode_range(sheet['!ref']);
    minR = Math.min(minR, ref.s.r);
    minC = Math.min(minC, ref.s.c);
    maxR = Math.max(maxR, ref.e.r);
    maxC = Math.max(maxC, ref.e.c);
  }
  if (maxR < 0) return null;
  return { s: { r: minR, c: minC }, e: { r: maxR, c: maxC } };
}

function objectsFromSheet(sheet) {
  const range = usedRange(sheet);
  if (!range) return [];
  let bestRow = range.s.r;
  let bestCount = -1;
  const scanTo = Math.min(range.s.r + 15, range.e.r);
  for (let r = range.s.r; r <= scanTo; r += 1) {
    let count = 0;
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      const header = cellText(readSheetCell(sheet[XLSX.utils.encode_cell({ r, c })]));
      if (headerToKey(header)) count += 1;
    }
    if (count > bestCount) {
      bestCount = count;
      bestRow = r;
    }
  }
  if (!bestCount) {
    throw httpError(
      400,
      'Could not recognize any onboarding columns. Use the downloaded template or keep headers such as Full name, Work email, Employee ID.'
    );
  }

  const keysByCol = {};
  for (let c = range.s.c; c <= range.e.c; c += 1) {
    const header = cellText(readSheetCell(sheet[XLSX.utils.encode_cell({ r: bestRow, c })]));
    const key = headerToKey(header);
    if (key) keysByCol[c] = key;
  }
  const maxAssetSlot = Math.max(
    ASSET_SLOTS,
    ...Object.values(keysByCol).map((key) => {
      const m = String(key).match(/^asset(\d+)_/);
      return m ? Number(m[1]) : 0;
    })
  );

  const rows = [];
  for (let r = bestRow + 1; r <= range.e.r; r += 1) {
    const mapped = { _excelRow: r + 1, _maxAssetSlot: maxAssetSlot };
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      const key = keysByCol[c];
      if (!key) continue;
      const value = readSheetCell(sheet[XLSX.utils.encode_cell({ r, c })]);
      if (mapped[key] == null || mapped[key] === '') mapped[key] = value;
    }
    const hasValue = Object.entries(mapped).some(
      ([k, v]) => k !== '_excelRow' && k !== '_maxAssetSlot' && cellText(v)
    );
    if (!hasValue) continue;
    if (isTemplateExampleRow(mapped)) continue;
    rows.push(mapped);
  }
  return rows;
}

export function detectSpreadsheetKind(filename, buffer) {
  const name = String(filename || '').toLowerCase();
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b) return 'xlsx';
  if (
    bytes.length >= 8 &&
    bytes[0] === 0xd0 &&
    bytes[1] === 0xcf &&
    bytes[2] === 0x11 &&
    bytes[3] === 0xe0
  ) {
    return 'xls';
  }
  if (name.endsWith('.xlsx')) return 'xlsx';
  if (name.endsWith('.xls')) return 'xls';
  if (name.endsWith('.csv') || name.endsWith('.txt')) return 'csv';
  const sample = bytes.subarray(0, 800).toString('utf8');
  if (/[,;\t]/.test(sample) && /[\r\n]/.test(sample)) return 'csv';
  throw httpError(400, 'Upload a CSV or Excel file (.csv, .xlsx, or .xls)');
}

export function decodeUploadedSpreadsheet(body = {}) {
  const filename = String(body.filename || body.fileName || 'upload');
  const raw = String(body.content || body.fileBase64 || body.data || '').replace(
    /^data:[^;]+;base64,/,
    ''
  );
  if (!raw.trim()) throw httpError(400, 'Upload a CSV or Excel file');
  let buffer;
  try {
    buffer = Buffer.from(raw, 'base64');
  } catch {
    throw httpError(400, 'Could not read the uploaded file');
  }
  if (!buffer.length) throw httpError(400, 'File is empty');
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw httpError(400, 'File is too large (max 8 MB)');
  }
  const fileType = detectSpreadsheetKind(filename, buffer);
  return { filename, buffer, fileType };
}

export function parseOnboardingBuffer(buffer, fileType) {
  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    cellDates: true,
    cellNF: true,
    raw: fileType !== 'csv',
  });
  const skip = new Set(['instructions', 'lists']);
  const sheetName =
    workbook.SheetNames.find((n) => n.toLowerCase() === 'data') ||
    workbook.SheetNames.find((n) => !skip.has(n.toLowerCase())) ||
    workbook.SheetNames[0];
  if (!sheetName) throw httpError(400, 'Spreadsheet is empty');
  const rows = objectsFromSheet(workbook.Sheets[sheetName]);
  if (!rows.length) {
    throw httpError(
      400,
      'No employee rows found. Keep the header row and add one employee per row below it.'
    );
  }
  return rows;
}

export function rowToOnboardingBody(raw, managers = []) {
  const form = { role: 'user', assets: [{ ...EMPTY_ASSET }] };
  const set = (key, value) => {
    if (value === undefined || value === null || value === '') return;
    form[key] = value;
  };

  set('employeeNumber', cellText(raw.employeeNumber));
  set('name', cellText(raw.name));
  set('dateOfBirth', toIsoDate(raw.dateOfBirth));
  set(
    'gender',
    matchOption(GENDER_OPTIONS, raw.gender) ||
      GENDER_ALIASES[String(raw.gender || '').trim().toLowerCase()] ||
      ''
  );
  set('personalEmail', cellText(raw.personalEmail));
  set('personalMobile', cellText(raw.personalMobile));
  set('address', cellText(raw.address));
  set('emergencyContact', cellText(raw.emergencyContact));
  set('nationality', cellText(raw.nationality));
  set('maritalStatus', matchOption(MARITAL_OPTIONS, raw.maritalStatus));
  set('email', cellText(raw.email));
  set('password', cellText(raw.password));
  set('dateOfJoining', toIsoDate(raw.dateOfJoining));
  set('employmentType', matchOption(EMPLOYMENT_TYPE_OPTIONS, raw.employmentType));
  set('department', cellText(raw.department));
  set('designation', cellText(raw.designation));
  set('jobLevel', cellText(raw.jobLevel));
  set('location', cellText(raw.location));
  set('workMode', matchOption(WORK_MODE_OPTIONS, raw.workMode));
  set('employmentStatus', matchOption(EMPLOYMENT_STATUS_OPTIONS, raw.employmentStatus));
  set('probationPeriod', cellText(raw.probationPeriod));
  set('confirmationDate', toIsoDate(raw.confirmationDate));

  const managerLookup = cellText(raw.managerEmail).toLowerCase();
  if (managerLookup) {
    const mgr = (managers || []).find(
      (m) =>
        String(m.email || '').toLowerCase() === managerLookup ||
        String(m.name || '').toLowerCase() === managerLookup
    );
    if (mgr) form.managerId = mgr.id;
  }

  const moneyKeys = [
    'basicSalary',
    'hra',
    'allowances',
    'variablePay',
    'bonuses',
    'deductions',
    'professionalTax',
    'tds',
    'netSalary',
    'stipend',
    'fixedPay',
    'joiningBonus',
    'retentionBonus',
    'bonusAmount',
  ];
  for (const key of moneyKeys) {
    const text = cellText(raw[key]).replace(/[,₹$]/g, '').replace(/\s/g, '');
    if (text) form[key] = text;
  }
  set('pfEpfDetails', cellText(raw.pfEpfDetails));
  set('salaryHistory', cellText(raw.salaryHistory));
  set('payslips', cellText(raw.payslips));
  set('bankAccountDetails', cellText(raw.bankAccountDetails));
  set('esops', cellText(raw.esops));
  set('bonusFrequency', matchOption(BONUS_FREQUENCY_OPTIONS, raw.bonusFrequency));

  const assetSlots = Math.max(
    ASSET_SLOTS,
    Number(raw._maxAssetSlot) || 0,
    ...Object.keys(raw).map((key) => {
      const m = String(key).match(/^asset(\d+)_/);
      return m ? Number(m[1]) : 0;
    })
  );
  const assets = [];
  for (let i = 1; i <= assetSlots; i += 1) {
    const asset = {
      assetCategory:
        matchOption(ASSET_CATEGORY_OPTIONS, raw[`asset${i}_assetCategory`]) || 'laptop_desktop',
      deviceAssigned: cellText(raw[`asset${i}_deviceAssigned`]),
      assetId: cellText(raw[`asset${i}_assetId`]),
      mobileNumber: cellText(raw[`asset${i}_mobileNumber`]),
      accessCard: cellText(raw[`asset${i}_accessCard`]),
      issueDate: toIsoDate(raw[`asset${i}_issueDate`]),
      returnDate: toIsoDate(raw[`asset${i}_returnDate`]),
      softwareAccess: cellText(raw[`asset${i}_softwareAccess`]),
      companyEmail: cellText(raw[`asset${i}_companyEmail`]),
    };
    const hasContent = Object.entries(asset).some(([k, v]) => k !== 'assetCategory' && v);
    if (hasContent) assets.push(asset);
  }
  form.assets = assets.length ? assets : [{ ...EMPTY_ASSET }];
  form._excelRow = raw._excelRow;
  return form;
}
