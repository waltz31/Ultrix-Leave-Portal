export const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'contract', 'intern', 'consultant'];
export const WORK_MODES = ['office', 'hybrid', 'remote'];
export const EMPLOYMENT_STATUSES = ['active', 'notice_period', 'resigned', 'terminated'];
export const GENDERS = ['male', 'female', 'other', 'prefer_not_to_say'];
export const MARITAL_STATUSES = ['single', 'married', 'divorced', 'widowed', 'prefer_not_to_say'];

export const EMPLOYMENT_TYPE_LABELS = {
  full_time: 'Full-time',
  part_time: 'Part-time',
  contract: 'Contract',
  intern: 'Intern',
  consultant: 'Consultant',
};

export const BONUS_FREQUENCIES = ['monthly', 'quarterly', 'half_yearly', 'yearly'];

export const BONUS_FREQUENCY_LABELS = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  half_yearly: 'Half yearly',
  yearly: 'Yearly',
};

export function payStructureKind(employmentType) {
  const type = String(employmentType || '').trim().toLowerCase();
  if (type === 'intern') return 'intern';
  if (type === 'consultant') return 'consultant';
  return 'employee';
}

export const WORK_MODE_LABELS = {
  office: 'Office',
  hybrid: 'Hybrid',
  remote: 'Remote',
};

export const EMPLOYMENT_STATUS_LABELS = {
  active: 'Active',
  notice_period: 'Notice Period',
  resigned: 'Resigned',
  terminated: 'Terminated',
};

export const GENDER_LABELS = {
  male: 'Male',
  female: 'Female',
  other: 'Other',
  prefer_not_to_say: 'Prefer not to say',
};

export const MARITAL_STATUS_LABELS = {
  single: 'Single',
  married: 'Married',
  divorced: 'Divorced',
  widowed: 'Widowed',
  prefer_not_to_say: 'Prefer not to say',
};

/** Extra columns added after initial employee_profiles create */
export const PROFILE_EXTRA_COLUMNS = [
  ['laptop_desktop_assigned', 'TEXT'],
  ['asset_id', 'TEXT'],
  ['company_mobile', 'TEXT'],
  ['access_card', 'TEXT'],
  ['equipment_issue_date', 'TEXT'],
  ['equipment_return_date', 'TEXT'],
  ['software_access_provisioning', 'TEXT'],
  ['company_email_account', 'TEXT'],
  ['basic_salary', 'DOUBLE PRECISION'],
  ['hra', 'DOUBLE PRECISION'],
  ['allowances', 'DOUBLE PRECISION'],
  ['variable_pay', 'DOUBLE PRECISION'],
  ['bonuses', 'DOUBLE PRECISION'],
  ['deductions', 'DOUBLE PRECISION'],
  ['pf_epf_details', 'TEXT'],
  ['professional_tax', 'DOUBLE PRECISION'],
  ['tds', 'DOUBLE PRECISION'],
  ['net_salary', 'DOUBLE PRECISION'],
  ['salary_history', 'TEXT'],
  ['payslips', 'TEXT'],
  ['bank_account_details', 'TEXT'],
  ['stipend', 'DOUBLE PRECISION'],
  ['fixed_pay', 'DOUBLE PRECISION'],
  ['joining_bonus', 'DOUBLE PRECISION'],
  ['retention_bonus', 'DOUBLE PRECISION'],
  ['esops', 'TEXT'],
  ['bonus_amount', 'DOUBLE PRECISION'],
  ['bonus_frequency', 'TEXT'],
];

export function activeFromEmploymentStatus(status) {
  return status === 'active' || status === 'notice_period' || !status ? 1 : 0;
}

export function mapEmployeeProfile(row, options = {}) {
  if (!row) return null;
  const includeSensitive = options.includeSensitive !== false;
  const includeIt = options.includeIt !== false;

  const payroll = {
    structure: payStructureKind(row.employment_type),
    basicSalary: numOrNull(row.basic_salary),
    hra: numOrNull(row.hra),
    allowances: numOrNull(row.allowances),
    variablePay: numOrNull(row.variable_pay),
    bonuses: numOrNull(row.bonuses),
    deductions: numOrNull(row.deductions),
    pfEpfDetails: row.pf_epf_details || null,
    professionalTax: numOrNull(row.professional_tax),
    tds: numOrNull(row.tds),
    netSalary: numOrNull(row.net_salary),
    stipend: numOrNull(row.stipend),
    fixedPay: numOrNull(row.fixed_pay),
    joiningBonus: numOrNull(row.joining_bonus),
    retentionBonus: numOrNull(row.retention_bonus),
    esops: row.esops || null,
    bonusAmount: numOrNull(row.bonus_amount),
    bonusFrequency: row.bonus_frequency || null,
  };

  if (includeSensitive) {
    payroll.salaryHistory = row.salary_history || null;
    payroll.payslips = row.payslips || null;
    payroll.bankAccountDetails = row.bank_account_details || null;
  }

  const profile = {
    id: row.profile_id ?? row.id,
    userId: row.user_id,
    name: row.name,
    email: row.email,
    employeeNumber: row.employee_number ?? null,
    managerId: row.manager_id ?? null,
    managerName: row.manager_name ?? null,
    managerEmail: row.manager_email ?? null,
    active: Boolean(row.active),
    role: row.role,
    createdAt: row.user_created_at || row.created_at,
    personal: {
      dateOfBirth: row.date_of_birth || null,
      gender: row.gender || null,
      personalEmail: row.personal_email || null,
      personalMobile: row.personal_mobile || null,
      address: row.address || null,
      emergencyContact: row.emergency_contact || null,
      nationality: row.nationality || null,
      maritalStatus: row.marital_status || null,
      profilePhoto: row.profile_photo || null,
    },
    employment: {
      dateOfJoining: row.date_of_joining || null,
      employmentType: row.employment_type || null,
      department: row.department || null,
      designation: row.designation || null,
      jobLevel: row.job_level || null,
      location: row.location || null,
      workMode: row.work_mode || null,
      employmentStatus: row.employment_status || 'active',
      probationPeriod: row.probation_period || null,
      confirmationDate: row.confirmation_date || null,
      employeeCategory: row.employee_category || null,
    },
    payroll,
  };

  if (includeIt) {
    profile.assets = Array.isArray(options.assets) ? options.assets : [];
    // Legacy single-object shape (first asset) for older UI paths
    const first = profile.assets[0];
    profile.it = first
      ? {
          laptopDesktopAssigned: first.deviceAssigned,
          assetId: first.assetId,
          companyMobile: first.mobileNumber,
          accessCard: first.accessCard,
          equipmentIssueDate: first.issueDate,
          equipmentReturnDate: first.returnDate,
          softwareAccessProvisioning: first.softwareAccess,
          companyEmailAccount: first.companyEmail,
        }
      : {
          laptopDesktopAssigned: row.laptop_desktop_assigned || null,
          assetId: row.asset_id || null,
          companyMobile: row.company_mobile || null,
          accessCard: row.access_card || null,
          equipmentIssueDate: row.equipment_issue_date || null,
          equipmentReturnDate: row.equipment_return_date || null,
          softwareAccessProvisioning: row.software_access_provisioning || null,
          companyEmailAccount: row.company_email_account || null,
        };
  }

  return profile;
}

export const ASSET_CATEGORIES = ['laptop_desktop', 'mobile_phone', 'access_card', 'other'];

export const ASSET_CATEGORY_LABELS = {
  laptop_desktop: 'Laptop / Desktop',
  mobile_phone: 'Mobile phone',
  access_card: 'Access card',
  other: 'Other',
};

export function mapAsset(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    assetCategory: row.asset_category || 'other',
    deviceAssigned: row.device_assigned || null,
    assetId: row.asset_id || null,
    mobileNumber: row.mobile_number || null,
    accessCard: row.access_card || null,
    issueDate: row.issue_date || null,
    returnDate: row.return_date || null,
    softwareAccess: row.software_access || null,
    companyEmail: row.company_email || null,
    sortOrder: Number(row.sort_order) || 0,
  };
}

export function parseAssetsList(body) {
  const raw = Array.isArray(body?.assets) ? body.assets : [];
  const assets = [];
  for (let i = 0; i < raw.length; i += 1) {
    const a = raw[i] || {};
    const asset = {
      assetCategory:
        normalizeEnum(a.assetCategory, ASSET_CATEGORIES, 'asset category') || 'other',
      deviceAssigned: normalizeOptional(a.deviceAssigned, 200),
      assetId: normalizeOptional(a.assetId, 80),
      mobileNumber: normalizeOptional(a.mobileNumber, 40),
      accessCard: normalizeOptional(a.accessCard, 80),
      issueDate: normalizeDate(a.issueDate, 'Equipment issue date'),
      returnDate: normalizeDate(a.returnDate, 'Equipment return date'),
      softwareAccess: normalizeOptional(a.softwareAccess, 1000),
      companyEmail: normalizeOptional(a.companyEmail, 120),
      sortOrder: i,
    };
    const hasContent = Object.entries(asset).some(
      ([k, v]) => k !== 'assetCategory' && k !== 'sortOrder' && v != null && v !== ''
    );
    if (hasContent) assets.push(asset);
  }
  return assets;
}

function numOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function normalizeOptional(value, maxLen = 200) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (text.length > maxLen) {
    const err = new Error(`Value exceeds ${maxLen} characters`);
    err.status = 400;
    throw err;
  }
  return text;
}

export function normalizeEnum(value, allowed, label) {
  if (value === undefined || value === null || value === '') return null;
  const v = String(value).trim();
  if (!allowed.includes(v)) {
    const err = new Error(`Invalid ${label}`);
    err.status = 400;
    throw err;
  }
  return v;
}

export function normalizeDate(value, label) {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const err = new Error(`${label} must be YYYY-MM-DD`);
    err.status = 400;
    throw err;
  }
  return text;
}

export function normalizeMoney(value, label) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    const err = new Error(`${label} must be a valid non-negative amount`);
    err.status = 400;
    throw err;
  }
  return Math.round(n * 100) / 100;
}

/** Max ~350KB decoded → ~470KB base64 data URL */
const MAX_PHOTO_CHARS = 500_000;

export function normalizeProfilePhoto(value) {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value);
  if (!text.startsWith('data:image/')) {
    const err = new Error('Profile photo must be an image');
    err.status = 400;
    throw err;
  }
  if (text.length > MAX_PHOTO_CHARS) {
    const err = new Error('Profile photo is too large (max ~350KB)');
    err.status = 400;
    throw err;
  }
  return text;
}

export function parseItFields(body, existing = {}) {
  // Deprecated single-asset parser — kept for partial PATCH without assets array
  const pick = (key, normalize, fallbackKey) => {
    if (body[key] !== undefined) return normalize(body[key]);
    return existing[fallbackKey] ?? null;
  };
  return {
    laptopDesktopAssigned: pick(
      'laptopDesktopAssigned',
      (v) => normalizeOptional(v, 200),
      'laptop_desktop_assigned'
    ),
    assetId: pick('assetId', (v) => normalizeOptional(v, 80), 'asset_id'),
    companyMobile: pick('companyMobile', (v) => normalizeOptional(v, 40), 'company_mobile'),
    accessCard: pick('accessCard', (v) => normalizeOptional(v, 80), 'access_card'),
    equipmentIssueDate: pick(
      'equipmentIssueDate',
      (v) => normalizeDate(v, 'Equipment issue date'),
      'equipment_issue_date'
    ),
    equipmentReturnDate: pick(
      'equipmentReturnDate',
      (v) => normalizeDate(v, 'Equipment return date'),
      'equipment_return_date'
    ),
    softwareAccessProvisioning: pick(
      'softwareAccessProvisioning',
      (v) => normalizeOptional(v, 1000),
      'software_access_provisioning'
    ),
    companyEmailAccount: pick(
      'companyEmailAccount',
      (v) => normalizeOptional(v, 120),
      'company_email_account'
    ),
  };
}

export function parsePayrollFields(body, existing = {}) {
  const pick = (key, normalize, fallbackKey) => {
    if (body[key] !== undefined) return normalize(body[key]);
    return existing[fallbackKey] ?? null;
  };
  return {
    basicSalary: pick('basicSalary', (v) => normalizeMoney(v, 'Basic salary'), 'basic_salary'),
    hra: pick('hra', (v) => normalizeMoney(v, 'HRA'), 'hra'),
    allowances: pick('allowances', (v) => normalizeMoney(v, 'Allowances'), 'allowances'),
    variablePay: pick('variablePay', (v) => normalizeMoney(v, 'Variable pay'), 'variable_pay'),
    bonuses: pick('bonuses', (v) => normalizeMoney(v, 'Bonuses'), 'bonuses'),
    deductions: pick('deductions', (v) => normalizeMoney(v, 'Deductions'), 'deductions'),
    pfEpfDetails: pick('pfEpfDetails', (v) => normalizeOptional(v, 500), 'pf_epf_details'),
    professionalTax: pick(
      'professionalTax',
      (v) => normalizeMoney(v, 'Professional tax'),
      'professional_tax'
    ),
    tds: pick('tds', (v) => normalizeMoney(v, 'TDS'), 'tds'),
    netSalary: pick('netSalary', (v) => normalizeMoney(v, 'Net salary'), 'net_salary'),
    salaryHistory: pick('salaryHistory', (v) => normalizeOptional(v, 4000), 'salary_history'),
    payslips: pick('payslips', (v) => normalizeOptional(v, 4000), 'payslips'),
    bankAccountDetails: pick(
      'bankAccountDetails',
      (v) => normalizeOptional(v, 500),
      'bank_account_details'
    ),
    stipend: pick('stipend', (v) => normalizeMoney(v, 'Stipend'), 'stipend'),
    fixedPay: pick('fixedPay', (v) => normalizeMoney(v, 'Fixed pay'), 'fixed_pay'),
    joiningBonus: pick('joiningBonus', (v) => normalizeMoney(v, 'Joining bonus'), 'joining_bonus'),
    retentionBonus: pick(
      'retentionBonus',
      (v) => normalizeMoney(v, 'Retention bonus'),
      'retention_bonus'
    ),
    esops: pick('esops', (v) => normalizeOptional(v, 500), 'esops'),
    bonusAmount: pick('bonusAmount', (v) => normalizeMoney(v, 'Bonus'), 'bonus_amount'),
    bonusFrequency: pick(
      'bonusFrequency',
      (v) => normalizeEnum(v, BONUS_FREQUENCIES, 'bonus frequency'),
      'bonus_frequency'
    ),
  };
}

export function applyPayStructure(payroll, kind) {
  const emptyEmployee = {
    basicSalary: null,
    hra: null,
    allowances: null,
    variablePay: null,
    bonuses: null,
    deductions: null,
    pfEpfDetails: null,
    professionalTax: null,
    tds: null,
    netSalary: null,
  };
  const emptyIntern = { stipend: null };
  const emptyConsultant = {
    fixedPay: null,
    joiningBonus: null,
    retentionBonus: null,
    esops: null,
    bonusAmount: null,
    bonusFrequency: null,
  };

  if (kind === 'intern') {
    return {
      ...payroll,
      ...emptyEmployee,
      ...emptyConsultant,
      stipend: payroll.stipend,
    };
  }
  if (kind === 'consultant') {
    return {
      ...payroll,
      ...emptyEmployee,
      ...emptyIntern,
      fixedPay: payroll.fixedPay,
      joiningBonus: payroll.joiningBonus,
      retentionBonus: payroll.retentionBonus,
      esops: payroll.esops,
      bonusAmount: payroll.bonusAmount,
      bonusFrequency: payroll.bonusFrequency,
    };
  }
  return {
    ...payroll,
    ...emptyIntern,
    ...emptyConsultant,
  };
}

export function parseItPayrollForCreate(body) {
  return {
    assets: parseAssetsList(body),
    payroll: parsePayrollFields(body, {}),
  };
}
