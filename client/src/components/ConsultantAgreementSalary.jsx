function formatMoney(value) {
  if (value === undefined || value === null || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  });
}

function InfoIcon() {
  return (
    <svg className="cas-info-icon" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 10.5v5.2M12 7.8h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function GiftIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <rect x="3.5" y="10" width="17" height="10.5" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M3.5 14h17M12 10v10.5" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M12 10c-2.2 0-3.8-1.5-3.8-3.2S9.8 4 12 6.2C14.2 4 15.8 5.1 15.8 6.8S14.2 10 12 10Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DocIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        d="M7 3.5h7.2L19 8.3V20a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 6 20V5A1.5 1.5 0 0 1 7.5 3.5H7Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M14 3.5V8h4.8M9 12.5h6M9 16h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <rect x="5" y="11" width="14" height="9.5" rx="2" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8.2 11V8.2a3.8 3.8 0 0 1 7.6 0V11" fill="none" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

export function monthlyFromAnnualInput(annual) {
  if (annual === '' || annual == null) return '';
  const n = Number(annual);
  if (!Number.isFinite(n)) return '';
  return String(Math.round((n / 12) * 100) / 100);
}

/**
 * HR onboarding form: Bonus & Consultant Agreement + Service Fees (mockup layout).
 * @param {{ form: object, setForm: Function, requireAnnual?: boolean }} props
 */
export function ConsultantAgreementForm({ form, setForm, requireAnnual = false }) {
  function setAnnual(annual) {
    const monthly = monthlyFromAnnualInput(annual);
    setForm((f) => ({
      ...f,
      serviceFeeAnnual: annual,
      fixedPay: monthly,
    }));
  }

  return (
    <div className="cas-panel">
      <section className="cas-block">
        <header className="cas-block-head">
          <span className="cas-block-icon is-gift" aria-hidden="true">
            <GiftIcon />
          </span>
          <div>
            <h3>Bonus &amp; Consultant Agreement Details</h3>
            <p>Enter the applicable bonus amounts and consultant service fees as per the agreement.</p>
          </div>
        </header>

        <div className="cas-grid cas-grid-2">
          <label className="cas-field">
            <span className="cas-label">
              Joining Bonus <InfoIcon />
            </span>
            <span className="cas-input-wrap">
              <span className="cas-prefix" aria-hidden="true">
                ₹
              </span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.joiningBonus}
                placeholder="50,000"
                onChange={(e) => setForm((f) => ({ ...f, joiningBonus: e.target.value }))}
              />
            </span>
            <span className="cas-hint">One-time bonus paid on joining.</span>
          </label>

          <label className="cas-field">
            <span className="cas-label">
              Retention Bonus <InfoIcon />
            </span>
            <span className="cas-input-wrap">
              <span className="cas-prefix" aria-hidden="true">
                ₹
              </span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.retentionBonus}
                placeholder="1,00,000"
                onChange={(e) => setForm((f) => ({ ...f, retentionBonus: e.target.value }))}
              />
            </span>
            <span className="cas-hint">Bonus to be paid as per retention terms.</span>
          </label>

          <label className="cas-field">
            <span className="cas-label">
              Joining Clause <InfoIcon />
            </span>
            <span className="cas-input-wrap has-suffix">
              <input
                type="number"
                min="0"
                step="1"
                value={form.joiningBonusMonths}
                placeholder="12"
                onChange={(e) => setForm((f) => ({ ...f, joiningBonusMonths: e.target.value }))}
              />
              <span className="cas-suffix" aria-hidden="true">
                Months
              </span>
            </span>
            <span className="cas-hint">
              Number of months the joining bonus clause applies as per the agreement.
            </span>
          </label>

          <label className="cas-field">
            <span className="cas-label">
              Retention Clause <InfoIcon />
            </span>
            <span className="cas-input-wrap has-suffix">
              <input
                type="number"
                min="0"
                step="1"
                value={form.retentionBonusMonths}
                placeholder="12"
                onChange={(e) => setForm((f) => ({ ...f, retentionBonusMonths: e.target.value }))}
              />
              <span className="cas-suffix" aria-hidden="true">
                Months
              </span>
            </span>
            <span className="cas-hint">
              Number of months the consultant must remain as per the agreement.
            </span>
          </label>
        </div>
      </section>

      <section className="cas-block">
        <header className="cas-block-head">
          <span className="cas-block-icon is-doc" aria-hidden="true">
            <DocIcon />
          </span>
          <div>
            <h3>Consultant Service Fees (As per Agreement)</h3>
          </div>
        </header>

        <div className="cas-grid cas-grid-2">
          <label className="cas-field">
            <span className="cas-label">
              Annual Service Fee {requireAnnual ? <em className="cas-req">*</em> : null}
            </span>
            <span className="cas-input-wrap">
              <span className="cas-prefix" aria-hidden="true">
                ₹
              </span>
              <input
                type="number"
                min="0"
                step="0.01"
                required={requireAnnual}
                value={form.serviceFeeAnnual}
                placeholder="12,00,000"
                onChange={(e) => setAnnual(e.target.value)}
              />
            </span>
            <span className="cas-hint">Total annual consultant service fees as per agreement.</span>
          </label>

          <div className="cas-field">
            <span className="cas-label">
              Monthly Service Fee <InfoIcon />
            </span>
            <div className="cas-monthly-row">
              <span className="cas-input-wrap is-locked">
                <span className="cas-prefix" aria-hidden="true">
                  ₹
                </span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  readOnly
                  tabIndex={-1}
                  value={form.fixedPay}
                  placeholder="1,00,000"
                  title="Calculated from Annual Service Fee ÷ 12"
                />
                <span className="cas-lock" aria-hidden="true">
                  <LockIcon />
                </span>
              </span>
              <span className="cas-auto-pill">Auto-calculated</span>
            </div>
            <span className="cas-hint">Monthly fee is calculated automatically (Annual fee ÷ 12).</span>
          </div>
        </div>

        <p className="cas-banner" role="note">
          <InfoIcon />
          <span>
            Monthly Service Fee will be updated automatically when the Annual Service Fee is changed.
          </span>
        </p>
      </section>
    </div>
  );
}

function hasPayrollValue(value) {
  return value !== undefined && value !== null && value !== '';
}

function formatMonths(value, revealed, mask) {
  if (!hasPayrollValue(value)) return null;
  if (!revealed) return mask;
  const n = Number(value);
  return `${value} month${n === 1 ? '' : 's'}`;
}

/**
 * Employee / manager salary display for the same agreement fields.
 */
export function ConsultantAgreementDisplay({ payroll, revealed = true, mask = '••••••••' }) {
  const money = (v) => (revealed ? formatMoney(v) : v == null || v === '' ? '—' : mask);
  const joiningClause = formatMonths(payroll?.joiningBonusMonths, revealed, mask);
  const retentionClause = formatMonths(payroll?.retentionBonusMonths, revealed, mask);
  const clauseItems = [
    joiningClause != null ? { label: 'Joining Clause', value: joiningClause } : null,
    retentionClause != null ? { label: 'Retention Clause', value: retentionClause } : null,
  ].filter(Boolean);

  return (
    <div className="cas-panel cas-display">
      <section className="cas-block">
        <header className="cas-block-head">
          <span className="cas-block-icon is-gift" aria-hidden="true">
            <GiftIcon />
          </span>
          <div>
            <h3>Bonus &amp; Consultant Agreement Details</h3>
            <p>Bonus amounts and retention terms as per the agreement.</p>
          </div>
        </header>
        <dl className="cas-facts cas-grid cas-grid-2">
          <div>
            <dt>Joining Bonus</dt>
            <dd>{money(payroll?.joiningBonus)}</dd>
          </div>
          <div>
            <dt>Retention Bonus</dt>
            <dd>{money(payroll?.retentionBonus)}</dd>
          </div>
        </dl>
        {clauseItems.length ? (
          <dl
            className={`cas-facts cas-grid ${clauseItems.length === 1 ? 'cas-grid-1' : 'cas-grid-2'} cas-facts-clauses`}
          >
            {clauseItems.map((item) => (
              <div key={item.label}>
                <dt>{item.label}</dt>
                <dd>{item.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </section>

      <section className="cas-block">
        <header className="cas-block-head">
          <span className="cas-block-icon is-doc" aria-hidden="true">
            <DocIcon />
          </span>
          <div>
            <h3>Consultant Service Fees (As per Agreement)</h3>
          </div>
        </header>
        <dl className="cas-facts cas-grid cas-grid-2">
          <div>
            <dt>Annual Service Fee</dt>
            <dd>{money(payroll?.serviceFeeAnnual)}</dd>
          </div>
          <div>
            <dt>
              Monthly Service Fee <span className="cas-auto-pill">Auto-calculated</span>
            </dt>
            <dd>{money(payroll?.fixedPay)}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
