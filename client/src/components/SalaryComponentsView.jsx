import { useState } from 'react';

export function formatMoney(value) {
  if (value === undefined || value === null || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  });
}

export const SALARY_COMPONENT_FIELDS = [
  { key: 'basicSalary', label: 'Basic salary', money: true },
  { key: 'hra', label: 'HRA', money: true },
  { key: 'allowances', label: 'Allowances', money: true },
  { key: 'variablePay', label: 'Variable pay / incentives', money: true },
  { key: 'bonuses', label: 'Bonuses', money: true },
  { key: 'deductions', label: 'Deductions', money: true, negative: true },
  { key: 'pfEpfDetails', label: 'PF / EPF details', money: false },
  { key: 'professionalTax', label: 'Professional tax', money: true, negative: true },
  { key: 'tds', label: 'TDS', money: true, negative: true },
  { key: 'netSalary', label: 'Net salary', money: true, highlight: true },
];

export const INTERN_PAY_FIELDS = [{ key: 'stipend', label: 'Stipend', money: true, highlight: true }];

export const CONSULTANT_PAY_FIELDS = [
  { key: 'fixedPay', label: 'Fixed pay', money: true, highlight: true },
  { key: 'joiningBonus', label: 'Joining bonus', money: true },
  { key: 'retentionBonus', label: 'Retention bonus', money: true },
  { key: 'esops', label: 'ESOPs', money: false },
  { key: 'bonusAmount', label: 'Bonus', money: true },
  { key: 'bonusFrequency', label: 'Bonus frequency', money: false },
];

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

export function payrollFieldsFor(employmentType) {
  const kind = payStructureKind(employmentType);
  if (kind === 'intern') return INTERN_PAY_FIELDS;
  if (kind === 'consultant') return CONSULTANT_PAY_FIELDS;
  return SALARY_COMPONENT_FIELDS;
}

export function formatPayrollValue(field, payroll) {
  const value = payroll?.[field.key];
  if (field.key === 'bonusFrequency') {
    return BONUS_FREQUENCY_LABELS[value] || value || '—';
  }
  if (field.money) return formatMoney(value);
  return value || '—';
}

export const SALARY_SENSITIVE_FIELDS = [
  { key: 'salaryHistory', label: 'Salary history' },
  { key: 'payslips', label: 'Payslips' },
  { key: 'bankAccountDetails', label: 'Bank account details' },
];

export const IT_FIELDS = [
  { key: 'laptopDesktopAssigned', label: 'Laptop / desktop assigned' },
  { key: 'assetId', label: 'Asset ID' },
  { key: 'companyMobile', label: 'Mobile phone' },
  { key: 'accessCard', label: 'Access card' },
  { key: 'equipmentIssueDate', label: 'Equipment issue date', date: true },
  { key: 'equipmentReturnDate', label: 'Equipment return date', date: true },
  { key: 'softwareAccessProvisioning', label: 'Software / access provisioning' },
  { key: 'companyEmailAccount', label: 'Company email / account' },
];

const MASK = '••••••••';

function EyeIcon({ open }) {
  if (open) {
    return (
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path
          fill="currentColor"
          d="M12 5c-5 0-9.3 3.1-11 7 1.7 3.9 6 7 11 7s9.3-3.1 11-7c-1.7-3.9-6-7-11-7Zm0 12a5 5 0 1 1 0-10 5 5 0 0 1 0 10Zm0-2.5A2.5 2.5 0 1 0 12 9a2.5 2.5 0 0 0 0 5Z"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        fill="currentColor"
        d="M3.3 2.3a1 1 0 0 0-1.4 1.4l2.1 2.1C2.2 7.1.8 8.9.1 11c1.7 3.9 6 7 11.9 7 2.1 0 4-.5 5.7-1.3l3 3a1 1 0 0 0 1.4-1.4L3.3 2.3ZM12 16c-3.5 0-6.5-1.9-8.2-5 .7-1.3 1.8-2.5 3.1-3.4l1.7 1.7A5 5 0 0 0 12 17Zm0-10c3.5 0 6.5 1.9 8.2 5-.4.8-1 1.5-1.6 2.2l1.5 1.5c1-.9 1.8-2 2.4-3.2-1.7-3.9-6-7-11.5-7-1.1 0-2.1.1-3.1.4l1.7 1.7c.5-.1 1-.1 1.4-.1Z"
      />
    </svg>
  );
}

function maskValue(raw) {
  if (raw === undefined || raw === null || raw === '' || raw === '—') return '—';
  return MASK;
}

function displayValue(raw, revealed) {
  if (!revealed) return maskValue(raw);
  return raw || '—';
}

export function DetailList({ items }) {
  return (
    <dl className="detail-list">
      {items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value || '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SalaryComponentsView({
  payroll,
  employmentType,
  showSensitive = false,
  title = 'Salary components',
}) {
  const [revealed, setRevealed] = useState(false);

  if (!payroll) {
    return (
      <section className="panel salary-slip">
        <h2>{title}</h2>
        <p className="empty">No salary details available.</p>
      </section>
    );
  }

  const kind = payStructureKind(employmentType);
  const fields = payrollFieldsFor(employmentType);
  const highlightField =
    fields.find((f) => f.highlight) || fields.find((f) => f.key === 'netSalary') || fields[0];
  const lineFields = fields.filter((f) => f.key !== highlightField?.key);

  const earnings = lineFields.filter((f) => !f.negative);
  const deductions = lineFields.filter((f) => f.negative);

  const sensitive =
    showSensitive && kind === 'employee'
      ? SALARY_SENSITIVE_FIELDS.map((f) => ({
          label: f.label,
          value: payroll[f.key] || '—',
        })).filter((item) => item.value && item.value !== '—')
      : [];

  const headlineRaw = formatPayrollValue(highlightField, payroll);
  const structureLabel =
    kind === 'intern' ? 'Internship stipend' : kind === 'consultant' ? 'Consultant pay' : 'Monthly CTC view';

  return (
    <section className={`panel salary-slip${revealed ? ' is-revealed' : ' is-masked'}`}>
      <div className="salary-slip-top">
        <div>
          <p className="salary-slip-kicker">{structureLabel}</p>
          <h2 className="salary-slip-title">{title}</h2>
        </div>
        <button
          type="button"
          className="salary-eye-btn"
          onClick={() => setRevealed((v) => !v)}
          aria-pressed={revealed}
          aria-label={revealed ? 'Hide salary amounts' : 'Show salary amounts'}
          title={revealed ? 'Hide amounts' : 'Show amounts'}
        >
          <EyeIcon open={revealed} />
          <span>{revealed ? 'Hide' : 'Show'}</span>
        </button>
      </div>

      <div className="salary-hero">
        <span className="salary-hero-label">{highlightField?.label || 'Take-home'}</span>
        <strong className={`salary-hero-value${revealed ? '' : ' is-masked'}`}>
          {displayValue(headlineRaw, revealed)}
        </strong>
      </div>

      <div className="salary-slip-grid">
        {!!earnings.length && (
          <div className="salary-slip-block">
            <h3>Earnings</h3>
            <ul className="salary-lines">
              {earnings.map((f) => {
                const raw = formatPayrollValue(f, payroll);
                return (
                  <li key={f.key}>
                    <span>{f.label}</span>
                    <strong className={revealed ? '' : 'is-masked'}>
                      {displayValue(raw, revealed)}
                    </strong>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {!!deductions.length && (
          <div className="salary-slip-block salary-slip-deductions">
            <h3>Deductions</h3>
            <ul className="salary-lines">
              {deductions.map((f) => {
                const raw = formatPayrollValue(f, payroll);
                return (
                  <li key={f.key}>
                    <span>{f.label}</span>
                    <strong className={revealed ? '' : 'is-masked'}>
                      {displayValue(raw, revealed)}
                    </strong>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      {!!sensitive.length && (
        <div className="salary-slip-block salary-slip-bank">
          <h3>Bank &amp; records</h3>
          <ul className="salary-lines salary-lines-stack">
            {sensitive.map((item) => (
              <li key={item.label}>
                <span>{item.label}</span>
                <strong className={revealed ? '' : 'is-masked'}>
                  {displayValue(item.value, revealed)}
                </strong>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export function ItAssetsView({ it, assets, formatDate }) {
  const list =
    Array.isArray(assets) && assets.length
      ? assets
      : it
        ? [
            {
              assetCategory: 'laptop_desktop',
              deviceAssigned: it.laptopDesktopAssigned,
              assetId: it.assetId,
              mobileNumber: it.companyMobile,
              accessCard: it.accessCard,
              issueDate: it.equipmentIssueDate,
              returnDate: it.equipmentReturnDate,
              softwareAccess: it.softwareAccessProvisioning,
              companyEmail: it.companyEmailAccount,
            },
          ]
        : [];

  if (!list.length) {
    return (
      <section className="panel">
        <h2>IT / Asset information</h2>
        <p className="empty">No assets tagged.</p>
      </section>
    );
  }

  return (
    <section className="panel">
      <h2>IT / Asset information</h2>
      <div className="asset-detail-list">
        {list.map((asset, idx) => (
          <div className="asset-detail-card" key={asset.id || idx}>
            {list.length > 1 && <h3 className="salary-subhead">Asset {idx + 1}</h3>}
            <DetailList
              items={[
                { label: 'Device / item', value: asset.deviceAssigned || '—' },
                { label: 'Asset ID', value: asset.assetId || '—' },
                { label: 'Mobile number', value: asset.mobileNumber || '—' },
                { label: 'Access card', value: asset.accessCard || '—' },
                {
                  label: 'Issue date',
                  value:
                    asset.issueDate && formatDate ? formatDate(asset.issueDate) : asset.issueDate || '—',
                },
                {
                  label: 'Return date',
                  value:
                    asset.returnDate && formatDate
                      ? formatDate(asset.returnDate)
                      : asset.returnDate || '—',
                },
                { label: 'Software / access', value: asset.softwareAccess || '—' },
                { label: 'Company email / account', value: asset.companyEmail || '—' },
              ]}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
