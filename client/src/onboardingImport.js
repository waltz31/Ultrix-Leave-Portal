import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import {
  ASSET_CATEGORY_OPTIONS,
  BONUS_FREQUENCY_OPTIONS,
  EMPTY_ASSET,
  EMPTY_ONBOARDING_FORM,
  EMPLOYMENT_STATUS_OPTIONS,
  EMPLOYMENT_TYPE_OPTIONS,
  GENDER_OPTIONS,
  MARITAL_STATUS_OPTIONS,
  WORK_MODE_OPTIONS,
} from './components/EmployeeOnboardingForm';

const ASSET_SLOTS = 3;

export const ONBOARDING_COLUMNS = [
  { key: 'employeeNumber', header: 'Employee ID', example: 'EMP001' },
  { key: 'name', header: 'Full name', example: 'Ada Lovelace' },
  { key: 'dateOfBirth', header: 'Date of birth', example: '1994-05-18' },
  { key: 'gender', header: 'Gender', example: 'Female', list: 'gender' },
  { key: 'personalEmail', header: 'Personal email', example: 'ada@example.com' },
  { key: 'personalMobile', header: 'Personal mobile', example: '9876543210' },
  { key: 'address', header: 'Address', example: '12 Baker Street, Mumbai' },
  { key: 'emergencyContact', header: 'Emergency contact', example: 'Alan Turing 9000000000' },
  { key: 'nationality', header: 'Nationality', example: 'Indian' },
  { key: 'maritalStatus', header: 'Marital status', example: 'Single', list: 'maritalStatus' },
  { key: 'email', header: 'Work email', example: 'ada@company.com' },
  { key: 'password', header: 'Temporary password', example: 'Welcome123' },
  { key: 'dateOfJoining', header: 'Date of joining', example: '2026-08-01' },
  { key: 'employmentType', header: 'Employment type', example: 'Full-time', list: 'employmentType' },
  { key: 'department', header: 'Department', example: 'Engineering' },
  { key: 'designation', header: 'Designation', example: 'Software Engineer' },
  { key: 'jobLevel', header: 'Job level', example: 'L2' },
  { key: 'managerEmail', header: 'Reporting manager email', example: 'manager@company.com' },
  { key: 'location', header: 'Location', example: 'Bengaluru' },
  { key: 'workMode', header: 'Work mode', example: 'Hybrid', list: 'workMode' },
  { key: 'employmentStatus', header: 'Employment status', example: 'Active', list: 'employmentStatus' },
  { key: 'probationPeriod', header: 'Probation period', example: '3 months' },
  { key: 'confirmationDate', header: 'Confirmation date', example: '2026-11-01' },
  ...assetColumns(),
  { key: 'basicSalary', header: 'Basic salary', example: '50000' },
  { key: 'hra', header: 'HRA', example: '20000' },
  { key: 'allowances', header: 'Allowances', example: '8000' },
  { key: 'variablePay', header: 'Variable pay', example: '10000' },
  { key: 'bonuses', header: 'Bonuses', example: '0' },
  { key: 'deductions', header: 'Deductions', example: '2000' },
  { key: 'pfEpfDetails', header: 'PF / EPF details', example: 'UAN 100123' },
  { key: 'professionalTax', header: 'Professional tax', example: '200' },
  { key: 'tds', header: 'TDS', example: '1500' },
  { key: 'netSalary', header: 'Net salary', example: '74300' },
  { key: 'salaryHistory', header: 'Salary history', example: '' },
  { key: 'payslips', header: 'Payslips', example: '' },
  { key: 'bankAccountDetails', header: 'Bank account details', example: 'HDFC 000111 IFSC HDFC0001234' },
  { key: 'stipend', header: 'Stipend (intern)', example: '' },
  { key: 'fixedPay', header: 'Fixed pay (consultant)', example: '' },
  { key: 'joiningBonus', header: 'Joining bonus (consultant)', example: '' },
  { key: 'retentionBonus', header: 'Retention bonus (consultant)', example: '' },
  { key: 'esops', header: 'ESOPs (consultant)', example: '' },
  { key: 'bonusAmount', header: 'Bonus (consultant)', example: '' },
  { key: 'bonusFrequency', header: 'Bonus frequency (consultant)', example: 'Quarterly', list: 'bonusFrequency' },
];

function assetColumns() {
  const cols = [];
  for (let i = 1; i <= ASSET_SLOTS; i += 1) {
    cols.push(
      { key: `asset${i}_assetCategory`, header: `Asset ${i} category`, example: i === 1 ? 'Laptop / Desktop' : '', list: 'assetCategory' },
      { key: `asset${i}_deviceAssigned`, header: `Asset ${i} device`, example: i === 1 ? 'MacBook Pro 14' : '' },
      { key: `asset${i}_assetId`, header: `Asset ${i} ID`, example: i === 1 ? 'IT-1042' : '' },
      { key: `asset${i}_mobileNumber`, header: `Asset ${i} mobile`, example: '' },
      { key: `asset${i}_accessCard`, header: `Asset ${i} access card`, example: i === 1 ? 'AC-88' : '' },
      { key: `asset${i}_issueDate`, header: `Asset ${i} issue date`, example: i === 1 ? '2026-08-01' : '' },
      { key: `asset${i}_returnDate`, header: `Asset ${i} return date`, example: '' },
      { key: `asset${i}_softwareAccess`, header: `Asset ${i} software access`, example: i === 1 ? 'VPN, Slack, GitHub' : '' },
      { key: `asset${i}_companyEmail`, header: `Asset ${i} company email`, example: '' }
    );
  }
  return cols;
}

const HEADER_TO_KEY = Object.fromEntries(
  ONBOARDING_COLUMNS.flatMap((col) => [
    [normHeader(col.header), col.key],
    [normHeader(col.key), col.key],
  ])
);

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
  tempPassword: 'password',
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

const GENDER_ALIASES = {
  m: 'male',
  f: 'female',
  male: 'male',
  female: 'female',
  o: 'other',
};

function normHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

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
  if (typeof value === 'number' && Number.isFinite(value)) {
    return excelSerialToYmd(value);
  }
  const text = String(value).trim();
  if (!text) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const dmy = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return ymdFromParts(y, m, d);
  }
  const mdy = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2})$/);
  if (mdy) {
    const a = Number(mdy[1]);
    const b = Number(mdy[2]);
    const y = Number(mdy[3]) + 2000;
    if (a > 12) return ymdFromParts(y, b, a);
    return ymdFromParts(y, a, b);
  }
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

export function rowToForm(raw, managers = []) {
  const form = {
    ...EMPTY_ONBOARDING_FORM,
    assets: [{ ...EMPTY_ASSET }],
  };

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
  set('maritalStatus', matchOption(MARITAL_STATUS_OPTIONS, raw.maritalStatus));
  set('email', cellText(raw.email));
  set('password', cellText(raw.password));
  set('dateOfJoining', toIsoDate(raw.dateOfJoining));
  set('employmentType', matchOption(EMPLOYMENT_TYPE_OPTIONS, raw.employmentType) || form.employmentType);
  set('department', cellText(raw.department));
  set('designation', cellText(raw.designation));
  set('jobLevel', cellText(raw.jobLevel));
  set('location', cellText(raw.location));
  set('workMode', matchOption(WORK_MODE_OPTIONS, raw.workMode) || form.workMode);
  set('employmentStatus', matchOption(EMPLOYMENT_STATUS_OPTIONS, raw.employmentStatus) || form.employmentStatus);
  set('probationPeriod', cellText(raw.probationPeriod));
  set('confirmationDate', toIsoDate(raw.confirmationDate));

  const managerLookup = cellText(raw.managerEmail).toLowerCase();
  if (managerLookup) {
    const mgr = (managers || []).find(
      (m) =>
        String(m.email || '').toLowerCase() === managerLookup ||
        String(m.name || '').toLowerCase() === managerLookup
    );
    if (mgr) form.managerId = String(mgr.id);
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
  set('bonusFrequency', matchOption(BONUS_FREQUENCY_OPTIONS, raw.bonusFrequency) || form.bonusFrequency);

  const assetSlots = Math.max(
    ASSET_SLOTS,
    Number(raw._maxAssetSlot) || 0,
    ...Object.keys(raw)
      .map((key) => {
        const m = String(key).match(/^asset(\d+)_/);
        return m ? Number(m[1]) : 0;
      })
  );
  const assets = [];
  for (let i = 1; i <= assetSlots; i += 1) {
    const asset = {
      assetCategory: matchOption(ASSET_CATEGORY_OPTIONS, raw[`asset${i}_assetCategory`]) || 'laptop_desktop',
      deviceAssigned: cellText(raw[`asset${i}_deviceAssigned`]),
      assetId: cellText(raw[`asset${i}_assetId`]),
      mobileNumber: cellText(raw[`asset${i}_mobileNumber`]),
      accessCard: cellText(raw[`asset${i}_accessCard`]),
      issueDate: toIsoDate(raw[`asset${i}_issueDate`]),
      returnDate: toIsoDate(raw[`asset${i}_returnDate`]),
      softwareAccess: cellText(raw[`asset${i}_softwareAccess`]),
      companyEmail: cellText(raw[`asset${i}_companyEmail`]),
    };
    const hasContent = Object.entries(asset).some(
      ([k, v]) => k !== 'assetCategory' && v
    );
    if (hasContent) assets.push(asset);
  }
  form.assets = assets.length ? assets : [{ ...EMPTY_ASSET }];
  return form;
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

function findHeaderRow(sheet, range) {
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
  return { headerRow: bestRow, mappedCols: bestCount };
}

function objectsFromSheet(sheet) {
  const range = usedRange(sheet);
  if (!range) return [];

  const { headerRow, mappedCols } = findHeaderRow(sheet, range);
  if (!mappedCols) {
    throw new Error(
      'Could not recognize any onboarding columns. Use the downloaded template or keep headers such as Full name, Work email, Employee ID.'
    );
  }

  const keysByCol = {};
  for (let c = range.s.c; c <= range.e.c; c += 1) {
    const header = cellText(readSheetCell(sheet[XLSX.utils.encode_cell({ r: headerRow, c })]));
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
  for (let r = headerRow + 1; r <= range.e.r; r += 1) {
    const mapped = { _excelRow: r + 1 };
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      const key = keysByCol[c];
      if (!key) continue;
      const value = readSheetCell(sheet[XLSX.utils.encode_cell({ r, c })]);
      if (mapped[key] == null || mapped[key] === '') mapped[key] = value;
    }
    mapped._maxAssetSlot = maxAssetSlot;
    const hasValue = Object.entries(mapped).some(
      ([k, v]) => k !== '_excelRow' && k !== '_maxAssetSlot' && cellText(v)
    );
    if (!hasValue) continue;
    if (isTemplateExampleRow(mapped)) continue;
    rows.push(mapped);
  }
  return rows;
}

export async function parseOnboardingFile(fileOrBuffer) {
  let buffer;
  if (fileOrBuffer instanceof ArrayBuffer) {
    buffer = fileOrBuffer;
  } else if (ArrayBuffer.isView(fileOrBuffer)) {
    buffer = fileOrBuffer.buffer.slice(
      fileOrBuffer.byteOffset,
      fileOrBuffer.byteOffset + fileOrBuffer.byteLength
    );
  } else {
    buffer = await fileOrBuffer.arrayBuffer();
  }
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true, cellNF: true });
  const skip = new Set(['instructions', 'lists']);
  const sheetName =
    workbook.SheetNames.find((n) => n.toLowerCase() === 'data') ||
    workbook.SheetNames.find((n) => !skip.has(n.toLowerCase())) ||
    workbook.SheetNames[0];
  if (!sheetName) throw new Error('Spreadsheet is empty');
  const rows = objectsFromSheet(workbook.Sheets[sheetName]);
  if (!rows.length) {
    throw new Error('No employee rows found. Keep the header row and add one employee per row below it.');
  }
  return rows;
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const DROPDOWN_LISTS = {
  gender: GENDER_OPTIONS.map((o) => o.label),
  maritalStatus: MARITAL_STATUS_OPTIONS.map((o) => o.label),
  employmentType: EMPLOYMENT_TYPE_OPTIONS.map((o) => o.label),
  workMode: WORK_MODE_OPTIONS.map((o) => o.label),
  employmentStatus: EMPLOYMENT_STATUS_OPTIONS.map((o) => o.label),
  assetCategory: ASSET_CATEGORY_OPTIONS.map((o) => o.label),
  bonusFrequency: BONUS_FREQUENCY_OPTIONS.map((o) => o.label),
};

const DATA_ROW_START = 2;
const DATA_ROW_END = 500;

function colLetter(index) {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function buildWorkbook() {
  const headers = ONBOARDING_COLUMNS.map((c) => c.header);
  const example = ONBOARDING_COLUMNS.map((c) => c.example);
  const dataSheet = XLSX.utils.aoa_to_sheet([headers, example]);
  dataSheet['!cols'] = headers.map((h) => ({ wch: Math.min(36, Math.max(16, h.length + 2)) }));

  const listKeys = Object.keys(DROPDOWN_LISTS);
  const listHeader = listKeys.map((key) => key);
  const maxLen = Math.max(...listKeys.map((key) => DROPDOWN_LISTS[key].length));
  const listRows = [listHeader];
  for (let r = 0; r < maxLen; r += 1) {
    listRows.push(listKeys.map((key) => DROPDOWN_LISTS[key][r] || ''));
  }
  const listsSheet = XLSX.utils.aoa_to_sheet(listRows);
  listsSheet['!cols'] = listKeys.map((key) => ({
    wch: Math.max(18, ...DROPDOWN_LISTS[key].map((v) => v.length + 2)),
  }));

  const instructions = XLSX.utils.aoa_to_sheet([
    ['Ultrix employee onboarding template'],
    [''],
    ['1. Fill one employee per row on the Data sheet. All filled cells are imported.'],
    ['2. Columns with a dropdown (Gender, Employment type, Work mode, etc.) must be picked from the list.'],
    ['3. Dates must be YYYY-MM-DD (example: 2026-08-01).'],
    ['4. Intern pay: use Stipend only. Consultant pay: Fixed pay, joining/retention bonus, ESOPs, bonus + frequency.'],
    ['5. Reporting manager email must match an existing manager in the portal.'],
    ['6. Up to 3 IT assets per employee in the template. Extra Asset N columns are also imported.'],
    ['7. Do not edit the Lists sheet — it powers the dropdowns.'],
    ['8. Replace the example row or add more rows below it, then upload the file. Every employee row is imported.'],
  ]);
  instructions['!cols'] = [{ wch: 110 }];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, dataSheet, 'Data');
  XLSX.utils.book_append_sheet(workbook, instructions, 'Instructions');
  XLSX.utils.book_append_sheet(workbook, listsSheet, 'Lists');
  workbook.Workbook = {
    Sheets: [{ Hidden: 0 }, { Hidden: 0 }, { Hidden: 1 }],
  };
  return workbook;
}

function dataValidationsXml() {
  const listKeys = Object.keys(DROPDOWN_LISTS);
  const items = [];
  ONBOARDING_COLUMNS.forEach((col, index) => {
    if (!col.list) return;
    const listIndex = listKeys.indexOf(col.list);
    if (listIndex < 0) return;
    const listCol = colLetter(listIndex);
    const listLen = DROPDOWN_LISTS[col.list].length;
    const dataCol = colLetter(index);
    items.push(
      `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" errorStyle="warning" errorTitle="Pick from the list" error="Please choose a value from the dropdown." sqref="${dataCol}${DATA_ROW_START}:${dataCol}${DATA_ROW_END}"><formula1>Lists!$${listCol}$2:$${listCol}$${listLen + 1}</formula1></dataValidation>`
    );
  });
  return `<dataValidations count="${items.length}">${items.join('')}</dataValidations>`;
}

function insertDataValidations(xml, block) {
  if (xml.includes('<dataValidations')) {
    xml = xml.replace(/<dataValidations[\s\S]*?<\/dataValidations>/, '');
  }
  if (xml.includes('<ignoredErrors')) {
    return xml.replace('<ignoredErrors', `${block}<ignoredErrors`);
  }
  if (xml.includes('<hyperlinks')) {
    return xml.replace('<hyperlinks', `${block}<hyperlinks`);
  }
  return xml.replace('</worksheet>', `${block}</worksheet>`);
}

async function findSheetPath(zip, sheetName) {
  const wbXml = await zip.file('xl/workbook.xml')?.async('string');
  const relsXml = await zip.file('xl/_rels/workbook.xml.rels')?.async('string');
  if (!wbXml || !relsXml) return 'xl/worksheets/sheet1.xml';
  const sheetMatch = wbXml.match(
    new RegExp(`<sheet[^>]*name="${sheetName}"[^>]*r:id="([^"]+)"`, 'i')
  );
  const rId = sheetMatch?.[1];
  if (!rId) return 'xl/worksheets/sheet1.xml';
  const relMatch = relsXml.match(
    new RegExp(`<Relationship[^>]*Id="${rId}"[^>]*Target="([^"]+)"`, 'i')
  ) || relsXml.match(
    new RegExp(`<Relationship[^>]*Target="([^"]+)"[^>]*Id="${rId}"`, 'i')
  );
  const target = relMatch?.[1] || 'worksheets/sheet1.xml';
  return target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
}

async function workbookToXlsxWithDropdowns(workbook) {
  const raw = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const zip = await JSZip.loadAsync(raw);
  const sheetPath = await findSheetPath(zip, 'Data');
  const file = zip.file(sheetPath);
  if (file) {
    const xml = await file.async('string');
    zip.file(sheetPath, insertDataValidations(xml, dataValidationsXml()));
  }
  return zip.generateAsync({
    type: 'arraybuffer',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

export async function downloadOnboardingTemplate(kind = 'xlsx') {
  const workbook = buildWorkbook();
  if (kind === 'csv') {
    const csv = XLSX.utils.sheet_to_csv(workbook.Sheets.Data);
    downloadBlob(
      'employee-onboarding-template.csv',
      new Blob([csv], { type: 'text/csv;charset=utf-8' })
    );
    return;
  }
  const out = await workbookToXlsxWithDropdowns(workbook);
  downloadBlob(
    'employee-onboarding-template.xlsx',
    new Blob([out], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
  );
}
