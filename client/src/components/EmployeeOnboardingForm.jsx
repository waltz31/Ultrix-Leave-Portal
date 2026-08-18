import { useState } from 'react';

export const EMPLOYMENT_TYPE_OPTIONS = [
  { value: 'full_time', label: 'Full-time' },
  { value: 'part_time', label: 'Part-time' },
  { value: 'contract', label: 'Contract' },
  { value: 'intern', label: 'Intern' },
  { value: 'consultant', label: 'Consultant' },
];

export const WORK_MODE_OPTIONS = [
  { value: 'office', label: 'Office' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'remote', label: 'Remote' },
];

export const EMPLOYMENT_STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'notice_period', label: 'Notice Period' },
  { value: 'resigned', label: 'Resigned' },
  { value: 'terminated', label: 'Terminated' },
];

export const GENDER_OPTIONS = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'other', label: 'Other' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
];

export const MARITAL_STATUS_OPTIONS = [
  { value: 'single', label: 'Single' },
  { value: 'married', label: 'Married' },
  { value: 'divorced', label: 'Divorced' },
  { value: 'widowed', label: 'Widowed' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
];

export const ASSET_CATEGORY_OPTIONS = [
  { value: 'laptop_desktop', label: 'Laptop / Desktop' },
  { value: 'mobile_phone', label: 'Mobile phone' },
  { value: 'access_card', label: 'Access card' },
  { value: 'other', label: 'Other' },
];

export const BONUS_FREQUENCY_OPTIONS = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'half_yearly', label: 'Half yearly' },
  { value: 'yearly', label: 'Yearly' },
];

export function payStructureKind(employmentType) {
  const type = String(employmentType || '').trim().toLowerCase();
  if (type === 'intern') return 'intern';
  if (type === 'consultant') return 'consultant';
  return 'employee';
}

export const EMPTY_ASSET = {
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

export const EMPTY_ONBOARDING_FORM = {
  employeeNumber: '',
  name: '',
  profilePhoto: '',
  dateOfBirth: '',
  gender: '',
  personalEmail: '',
  personalMobile: '',
  address: '',
  emergencyContact: '',
  nationality: '',
  maritalStatus: '',
  email: '',
  password: '',
  dateOfJoining: '',
  employmentType: '',
  department: '',
  designation: '',
  jobLevel: '',
  role: 'user',
  managerId: '',
  location: '',
  workMode: '',
  employmentStatus: '',
  probationPeriod: '',
  confirmationDate: '',
  assets: [{ ...EMPTY_ASSET }],
  basicSalary: '',
  hra: '',
  allowances: '',
  variablePay: '',
  bonuses: '',
  deductions: '',
  pfEpfDetails: '',
  professionalTax: '',
  tds: '',
  netSalary: '',
  salaryHistory: '',
  payslips: '',
  bankAccountDetails: '',
  stipend: '',
  fixedPay: '',
  joiningBonus: '',
  retentionBonus: '',
  esops: '',
  bonusAmount: '',
  bonusFrequency: '',
};

function assetsFromProfile(profile) {
  if (Array.isArray(profile.assets) && profile.assets.length) {
    return profile.assets.map((a) => ({
      assetCategory: a.assetCategory || 'other',
      deviceAssigned: a.deviceAssigned || '',
      assetId: a.assetId || '',
      mobileNumber: a.mobileNumber || '',
      accessCard: a.accessCard || '',
      issueDate: a.issueDate || '',
      returnDate: a.returnDate || '',
      softwareAccess: a.softwareAccess || '',
      companyEmail: a.companyEmail || '',
    }));
  }
  const it = profile.it;
  if (
    it &&
    (it.laptopDesktopAssigned ||
      it.assetId ||
      it.companyMobile ||
      it.accessCard ||
      it.equipmentIssueDate ||
      it.equipmentReturnDate ||
      it.softwareAccessProvisioning ||
      it.companyEmailAccount)
  ) {
    return [
      {
        assetCategory: 'laptop_desktop',
        deviceAssigned: it.laptopDesktopAssigned || '',
        assetId: it.assetId || '',
        mobileNumber: it.companyMobile || '',
        accessCard: it.accessCard || '',
        issueDate: it.equipmentIssueDate || '',
        returnDate: it.equipmentReturnDate || '',
        softwareAccess: it.softwareAccessProvisioning || '',
        companyEmail: it.companyEmailAccount || '',
      },
    ];
  }
  return [{ ...EMPTY_ASSET }];
}

export function profileToForm(profile) {
  if (!profile) return { ...EMPTY_ONBOARDING_FORM, assets: [{ ...EMPTY_ASSET }] };
  return {
    ...EMPTY_ONBOARDING_FORM,
    employeeNumber: profile.employeeNumber || '',
    name: profile.name || '',
    profilePhoto: profile.personal?.profilePhoto || '',
    dateOfBirth: profile.personal?.dateOfBirth || '',
    gender: profile.personal?.gender || '',
    personalEmail: profile.personal?.personalEmail || '',
    personalMobile: profile.personal?.personalMobile || '',
    address: profile.personal?.address || '',
    emergencyContact: profile.personal?.emergencyContact || '',
    nationality: profile.personal?.nationality || '',
    maritalStatus: profile.personal?.maritalStatus || '',
    email: profile.email || '',
    password: '',
    dateOfJoining: profile.employment?.dateOfJoining || '',
    employmentType: profile.employment?.employmentType || '',
    department: profile.employment?.department || '',
    designation: profile.employment?.designation || '',
    jobLevel: profile.employment?.jobLevel || '',
    role: profile.role === 'manager' ? 'manager' : 'user',
    managerId: profile.managerId ? String(profile.managerId) : '',
    location: profile.employment?.location || '',
    workMode: profile.employment?.workMode || '',
    employmentStatus: profile.employment?.employmentStatus || '',
    probationPeriod: profile.employment?.probationPeriod || '',
    confirmationDate: profile.employment?.confirmationDate || '',
    assets: assetsFromProfile(profile),
    basicSalary: profile.payroll?.basicSalary ?? '',
    hra: profile.payroll?.hra ?? '',
    allowances: profile.payroll?.allowances ?? '',
    variablePay: profile.payroll?.variablePay ?? '',
    bonuses: profile.payroll?.bonuses ?? '',
    deductions: profile.payroll?.deductions ?? '',
    pfEpfDetails: profile.payroll?.pfEpfDetails || '',
    professionalTax: profile.payroll?.professionalTax ?? '',
    tds: profile.payroll?.tds ?? '',
    netSalary: profile.payroll?.netSalary ?? '',
    salaryHistory: profile.payroll?.salaryHistory || '',
    payslips: profile.payroll?.payslips || '',
    bankAccountDetails: profile.payroll?.bankAccountDetails || '',
    stipend: profile.payroll?.stipend ?? '',
    fixedPay: profile.payroll?.fixedPay ?? '',
    joiningBonus: profile.payroll?.joiningBonus ?? '',
    retentionBonus: profile.payroll?.retentionBonus ?? '',
    esops: profile.payroll?.esops || '',
    bonusAmount: profile.payroll?.bonusAmount ?? '',
    bonusFrequency: profile.payroll?.bonusFrequency || '',
  };
}

const MAX_PHOTO_BYTES = 350 * 1024;

export function readProfilePhoto(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      resolve('');
      return;
    }
    if (!file.type.startsWith('image/')) {
      reject(new Error('Profile photo must be an image'));
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      reject(new Error('Profile photo must be under 350KB'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read photo'));
    reader.readAsDataURL(file);
  });
}

function CollapsibleSection({ id, title, open, onToggle, children, hint }) {
  return (
    <section className={`onboarding-category ${open ? 'is-open' : 'is-collapsed'}`}>
      <button
        type="button"
        className="onboarding-section-toggle"
        onClick={() => onToggle(id)}
        aria-expanded={open}
      >
        <span>{title}</span>
        <span className="onboarding-chevron" aria-hidden>
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open && (
        <div className="onboarding-section-body">
          {hint && <p className="muted">{hint}</p>}
          {children}
        </div>
      )}
    </section>
  );
}

export const PORTAL_ROLE_OPTIONS = [
  { value: 'user', label: 'Employee' },
  { value: 'manager', label: 'Manager' },
];

export default function EmployeeOnboardingForm({
  form,
  setForm,
  managers,
  onSubmit,
  busy,
  submitLabel = 'Create employee profile',
  showPassword = true,
  onBulkImport,
  editingUserId,
}) {
  const [photoError, setPhotoError] = useState('');
  const [importMsg, setImportMsg] = useState('');
  const [importErr, setImportErr] = useState('');
  const [uploadProgress, setUploadProgress] = useState(null);
  const [openSections, setOpenSections] = useState(() => ({
    personal: true,
    employment: false,
    portal: true,
    it: false,
    payroll: false,
  }));
  const [openAssets, setOpenAssets] = useState({ 0: true });

  async function downloadTemplate(kind) {
    const { downloadOnboardingTemplate } = await import('../onboardingImport.js');
    await downloadOnboardingTemplate(kind);
  }

  function readFileWithProgress(file, onProgress) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onprogress = (e) => {
        if (e.lengthComputable && e.total) {
          onProgress(Math.min(85, Math.round((e.loaded / e.total) * 85)));
        }
      };
      reader.onload = () => {
        onProgress(90);
        resolve(reader.result);
      };
      reader.onerror = () => reject(new Error('Could not read that file'));
      reader.readAsArrayBuffer(file);
    });
  }

  async function onSpreadsheetUpload(e, kind) {
    const file = e.target.files?.[0];
    e.target.value = '';
    setImportMsg('');
    setImportErr('');
    if (!file) return;
    setUploadProgress({ percent: 8, name: file.name, kind });
    try {
      const { parseOnboardingFile, rowToForm } = await import('../onboardingImport.js');
      const buffer = await readFileWithProgress(file, (percent) => {
        setUploadProgress({ percent, name: file.name, kind });
      });
      setUploadProgress({ percent: 94, name: file.name, kind });
      const rows = await parseOnboardingFile(buffer);
      const forms = rows.map((row) => rowToForm(row, managers));
      if (forms.length > 1 && typeof onBulkImport === 'function') {
        setUploadProgress({ percent: 97, name: file.name, kind });
        await onBulkImport(
          forms.map((next, i) => ({
            ...next,
            _excelRow: rows[i]._excelRow,
          }))
        );
        setUploadProgress({ percent: 100, name: file.name, kind });
        await new Promise((r) => setTimeout(r, 250));
        return;
      }
      const next = forms[0];
      setForm(next);
      setOpenSections({
        personal: true,
        employment: true,
        portal: true,
        it: true,
        payroll: true,
      });
      setOpenAssets(Object.fromEntries((next.assets || [{}]).map((_, i) => [i, true])));
      setUploadProgress({ percent: 100, name: file.name, kind });
      await new Promise((r) => setTimeout(r, 350));
      const extra = forms.length - 1;
      setImportMsg(
        extra
          ? `Loaded the first of ${forms.length} employees from ${file.name}. Open Create employee profile and upload again to import every row.`
          : `Loaded employee details from ${file.name}. Review and save.`
      );
    } catch (err) {
      setImportErr(err.message || 'Could not read that file');
    } finally {
      setUploadProgress(null);
    }
  }

  function toggleSection(id) {
    setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function toggleAsset(index) {
    setOpenAssets((prev) => ({ ...prev, [index]: !prev[index] }));
  }

  async function onPhotoChange(e) {
    const file = e.target.files?.[0];
    setPhotoError('');
    if (!file) {
      setForm((f) => ({ ...f, profilePhoto: '' }));
      return;
    }
    try {
      const dataUrl = await readProfilePhoto(file);
      setForm((f) => ({ ...f, profilePhoto: dataUrl }));
    } catch (err) {
      setPhotoError(err.message);
      e.target.value = '';
      setForm((f) => ({ ...f, profilePhoto: '' }));
    }
  }

  function field(key) {
    return {
      value: form[key] ?? '',
      onChange: (e) => setForm((f) => ({ ...f, [key]: e.target.value })),
    };
  }

  function updateAsset(index, key, value) {
    setForm((f) => ({
      ...f,
      assets: (f.assets || []).map((asset, i) =>
        i === index ? { ...asset, [key]: value } : asset
      ),
    }));
  }

  function addAsset() {
    const nextIndex = (form.assets || []).length;
    setForm((f) => ({
      ...f,
      assets: [...(f.assets || []), { ...EMPTY_ASSET }],
    }));
    setOpenAssets((prev) => ({ ...prev, [nextIndex]: true }));
  }

  function removeAsset(index) {
    setForm((f) => {
      const next = (f.assets || []).filter((_, i) => i !== index);
      return { ...f, assets: next.length ? next : [{ ...EMPTY_ASSET }] };
    });
    setOpenAssets((prev) => {
      const next = {};
      Object.keys(prev).forEach((key) => {
        const i = Number(key);
        if (i < index) next[i] = prev[i];
        else if (i > index) next[i - 1] = prev[i];
      });
      if (!Object.keys(next).length) next[0] = true;
      return next;
    });
  }

  const assets = form.assets?.length ? form.assets : [{ ...EMPTY_ASSET }];

  return (
    <form className="onboarding-form" onSubmit={onSubmit}>
      <div className="onboarding-import">
        <p className="muted">
          All fields are optional. Download the template, fill one employee per row, then upload
          Excel or CSV. Every filled cell and every data row is imported.
        </p>
        <div className="onboarding-import-actions">
          <button
            type="button"
            className="onboarding-icon-btn"
            onClick={() => downloadTemplate('xlsx')}
            aria-label="Download template"
            disabled={Boolean(uploadProgress)}
          >
            <img src="/assets/file.png" alt="" />
            <span className="onboarding-icon-tip">Download template</span>
          </button>
          <label className={`onboarding-icon-btn ${uploadProgress?.kind === 'xlsx' ? 'is-selected' : ''} ${uploadProgress ? 'is-disabled' : ''}`}>
            <img src="/assets/sheets.png" alt="" />
            <span className="onboarding-icon-tip">Upload Excel</span>
            <input
              type="file"
              accept=".xlsx,.xls,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => onSpreadsheetUpload(e, 'xlsx')}
              hidden
              disabled={Boolean(uploadProgress)}
            />
          </label>
          <label className={`onboarding-icon-btn ${uploadProgress?.kind === 'csv' ? 'is-selected' : ''} ${uploadProgress ? 'is-disabled' : ''}`}>
            <img src="/assets/document.png" alt="" />
            <span className="onboarding-icon-tip">Upload CSV</span>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => onSpreadsheetUpload(e, 'csv')}
              hidden
              disabled={Boolean(uploadProgress)}
            />
          </label>
        </div>
        {uploadProgress && (
          <div className="onboarding-upload-progress" role="status" aria-live="polite">
            <div
              className="onboarding-progress-ring"
              style={{ '--progress': uploadProgress.percent }}
            >
              <span>{uploadProgress.percent}%</span>
            </div>
            <div className="onboarding-upload-copy">
              <strong>Uploading {uploadProgress.name}</strong>
              <div className="onboarding-progress-track">
                <div
                  className="onboarding-progress-fill"
                  style={{ width: `${uploadProgress.percent}%` }}
                />
              </div>
            </div>
          </div>
        )}
        {importMsg && <p className="form-ok">{importMsg}</p>}
        {importErr && <p className="form-error">{importErr}</p>}
      </div>
      <CollapsibleSection
        id="personal"
        title="Employee personal details"
        open={openSections.personal}
        onToggle={toggleSection}
      >
        <div className="form-grid">
          <label>
            Employee ID
            <input {...field('employeeNumber')} maxLength={40} placeholder="e.g. EMP001" />
          </label>
          <label>
            Full name
            <input {...field('name')} autoFocus />
          </label>
          <label className="full">
            Profile photo
            <input type="file" accept="image/*" onChange={onPhotoChange} />
          </label>
          {form.profilePhoto && (
            <div className="full onboarding-photo-preview">
              <img src={form.profilePhoto} alt="Profile preview" />
              <button
                type="button"
                className="btn ghost"
                onClick={() => setForm((f) => ({ ...f, profilePhoto: '' }))}
              >
                Remove photo
              </button>
            </div>
          )}
          {photoError && <p className="form-error full">{photoError}</p>}
          <label>
            Date of birth
            <input type="date" {...field('dateOfBirth')} />
          </label>
          <label>
            Gender
            <select {...field('gender')}>
              <option value="">Select…</option>
              {GENDER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Personal email
            <input type="email" {...field('personalEmail')} />
          </label>
          <label>
            Personal mobile number
            <input {...field('personalMobile')} inputMode="tel" />
          </label>
          <label className="full">
            Current / permanent address
            <textarea {...field('address')} rows={2} />
          </label>
          <label className="full">
            Emergency contact
            <input {...field('emergencyContact')} placeholder="Name and phone number" />
          </label>
          <label>
            Nationality
            <input {...field('nationality')} />
          </label>
          <label>
            Marital status
            <select {...field('maritalStatus')}>
              <option value="">Select…</option>
              {MARITAL_STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        id="employment"
        title="Employment details"
        open={openSections.employment}
        onToggle={toggleSection}
      >
        <div className="form-grid">
          <label>
            Date of joining
            <input type="date" {...field('dateOfJoining')} />
          </label>
          <label>
            Employment type
            <select {...field('employmentType')}>
              <option value="">Select…</option>
              {EMPLOYMENT_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Department
            <input {...field('department')} />
          </label>
          <label>
            Designation / job title
            <input {...field('designation')} />
          </label>
          <label>
            Job level / grade
            <input {...field('jobLevel')} />
          </label>
          <label>
            Reporting manager
            <select {...field('managerId')}>
              <option value="">No reporting manager</option>
              {(managers || [])
                .filter(
                  (m) =>
                    String(m.id) !== String(editingUserId || '') && m.active !== false
                )
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.email ? `${m.name} (${m.email})` : m.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Location
            <input {...field('location')} />
          </label>
          <label>
            Work mode
            <select {...field('workMode')}>
              <option value="">Select…</option>
              {WORK_MODE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Employment status
            <select {...field('employmentStatus')}>
              <option value="">Select…</option>
              {EMPLOYMENT_STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Probation period
            <input {...field('probationPeriod')} placeholder="e.g. 3 months" />
          </label>
          <label>
            Confirmation date
            <input type="date" {...field('confirmationDate')} />
          </label>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        id="portal"
        title="Portal access"
        open={openSections.portal}
        onToggle={toggleSection}
        hint="Work email + temporary password are used to log in. Personal email above is not for login."
      >
        <div className="form-grid">
          <label>
            Role
            <select
              value={form.role || 'user'}
              onChange={(e) => {
                const role = e.target.value === 'manager' ? 'manager' : 'user';
                setForm((f) => ({
                  ...f,
                  role,
                }));
              }}
            >
              {PORTAL_ROLE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Work email (login)
            <input type="email" {...field('email')} placeholder="name@company.com" autoComplete="off" />
          </label>
          {showPassword && (
            <label>
              Temporary password
              <input
                type="text"
                {...field('password')}
                placeholder="Min 6 characters (or leave blank to auto-generate)"
                autoComplete="new-password"
              />
            </label>
          )}
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        id="it"
        title="IT / Asset information"
        open={openSections.it}
        onToggle={toggleSection}
        hint="Tag multiple devices or cards to this employee."
      >
        <div className="asset-list">
          {assets.map((asset, index) => {
            const assetOpen = openAssets[index] !== false;
            const categoryLabel =
              ASSET_CATEGORY_OPTIONS.find((o) => o.value === asset.assetCategory)?.label ||
              'Asset';
            return (
              <div
                className={`asset-card ${assetOpen ? 'is-open' : 'is-collapsed'}`}
                key={index}
              >
                <div className="row-between asset-card-head">
                  <button
                    type="button"
                    className="onboarding-section-toggle asset-toggle"
                    onClick={() => toggleAsset(index)}
                    aria-expanded={assetOpen}
                  >
                    <span>
                      {categoryLabel} {assets.length > 1 ? `#${index + 1}` : ''}
                    </span>
                    <span className="onboarding-chevron" aria-hidden>
                      {assetOpen ? '▾' : '▸'}
                    </span>
                  </button>
                  {assets.length > 1 && (
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => removeAsset(index)}
                    >
                      Remove
                    </button>
                  )}
                </div>
                {assetOpen && (
                  <div className="form-grid">
                    <label>
                      Category
                      <select
                        value={asset.assetCategory || 'other'}
                        onChange={(e) => updateAsset(index, 'assetCategory', e.target.value)}
                      >
                        {ASSET_CATEGORY_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Device / item assigned
                      <input
                        value={asset.deviceAssigned || ''}
                        onChange={(e) => updateAsset(index, 'deviceAssigned', e.target.value)}
                        placeholder="e.g. MacBook Pro 14"
                      />
                    </label>
                    <label>
                      Asset ID
                      <input
                        value={asset.assetId || ''}
                        onChange={(e) => updateAsset(index, 'assetId', e.target.value)}
                      />
                    </label>
                    <label>
                      Mobile number
                      <input
                        value={asset.mobileNumber || ''}
                        onChange={(e) => updateAsset(index, 'mobileNumber', e.target.value)}
                        inputMode="tel"
                      />
                    </label>
                    <label>
                      Access card
                      <input
                        value={asset.accessCard || ''}
                        onChange={(e) => updateAsset(index, 'accessCard', e.target.value)}
                      />
                    </label>
                    <label>
                      Issue date
                      <input
                        type="date"
                        value={asset.issueDate || ''}
                        onChange={(e) => updateAsset(index, 'issueDate', e.target.value)}
                      />
                    </label>
                    <label>
                      Return date
                      <input
                        type="date"
                        value={asset.returnDate || ''}
                        onChange={(e) => updateAsset(index, 'returnDate', e.target.value)}
                      />
                    </label>
                    <label className="full">
                      Software / access provisioning
                      <textarea
                        value={asset.softwareAccess || ''}
                        onChange={(e) => updateAsset(index, 'softwareAccess', e.target.value)}
                        rows={2}
                        placeholder="VPN, Slack, GitHub, etc."
                      />
                    </label>
                    <label>
                      Company email / account
                      <input
                        type="email"
                        value={asset.companyEmail || ''}
                        onChange={(e) => updateAsset(index, 'companyEmail', e.target.value)}
                      />
                    </label>
                  </div>
                )}
              </div>
            );
          })}
          <button type="button" className="btn ghost asset-add-btn" onClick={addAsset}>
            + Add another asset
          </button>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        id="payroll"
        title="Payroll & salary details"
        open={openSections.payroll}
        onToggle={toggleSection}
        hint={
          payStructureKind(form.employmentType) === 'intern'
            ? 'Intern pay structure: stipend only.'
            : payStructureKind(form.employmentType) === 'consultant'
              ? 'Consultant pay structure: fixed pay, bonuses, and ESOPs.'
              : 'Employee salary components.'
        }
      >
        <div className="form-grid">
          {payStructureKind(form.employmentType) === 'intern' && (
            <label>
              Stipend
              <input type="number" min="0" step="0.01" {...field('stipend')} />
            </label>
          )}

          {payStructureKind(form.employmentType) === 'consultant' && (
            <>
              <label>
                Fixed pay
                <input type="number" min="0" step="0.01" {...field('fixedPay')} />
              </label>
              <label>
                Joining bonus
                <input type="number" min="0" step="0.01" {...field('joiningBonus')} />
              </label>
              <label>
                Retention bonus
                <input type="number" min="0" step="0.01" {...field('retentionBonus')} />
              </label>
              <label className="full">
                ESOPs
                <input {...field('esops')} placeholder="Grant size, vesting notes" />
              </label>
              <label>
                Bonus
                <input type="number" min="0" step="0.01" {...field('bonusAmount')} />
              </label>
              <label>
                Bonus frequency
                <select {...field('bonusFrequency')}>
                  <option value="">Select…</option>
                  {BONUS_FREQUENCY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}

          {payStructureKind(form.employmentType) === 'employee' && (
            <>
              <label>
                Basic salary
                <input type="number" min="0" step="0.01" {...field('basicSalary')} />
              </label>
              <label>
                HRA
                <input type="number" min="0" step="0.01" {...field('hra')} />
              </label>
              <label>
                Allowances
                <input type="number" min="0" step="0.01" {...field('allowances')} />
              </label>
              <label>
                Variable pay / incentives
                <input type="number" min="0" step="0.01" {...field('variablePay')} />
              </label>
              <label>
                Bonuses
                <input type="number" min="0" step="0.01" {...field('bonuses')} />
              </label>
              <label>
                Deductions
                <input type="number" min="0" step="0.01" {...field('deductions')} />
              </label>
              <label className="full">
                PF / EPF details
                <input {...field('pfEpfDetails')} placeholder="UAN, contribution notes" />
              </label>
              <label>
                Professional tax
                <input type="number" min="0" step="0.01" {...field('professionalTax')} />
              </label>
              <label>
                TDS
                <input type="number" min="0" step="0.01" {...field('tds')} />
              </label>
              <label>
                Net salary
                <input type="number" min="0" step="0.01" {...field('netSalary')} />
              </label>
              <label className="full">
                Salary history
                <textarea {...field('salaryHistory')} rows={2} placeholder="Past revisions / notes" />
              </label>
              <label className="full">
                Payslips
                <textarea {...field('payslips')} rows={2} placeholder="Links or storage notes" />
              </label>
              <label className="full">
                Bank account details for salary
                <textarea
                  {...field('bankAccountDetails')}
                  rows={2}
                  placeholder="Bank name, account number, IFSC"
                />
              </label>
            </>
          )}
        </div>
      </CollapsibleSection>

      <div className="onboarding-actions">
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
