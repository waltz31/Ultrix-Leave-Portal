import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { appToday, formatDate } from '../utils';
import {
  ACCRUAL_RULES,
  APPROVAL_RULES,
  APPROVAL_STATUSES,
  BALANCE_RULES,
  CONFIG_PARAMETERS,
  HOLIDAY_CATEGORIES,
  HOLIDAY_RULES,
  KEY_DEFINITIONS,
  LEAVE_POLICY_VERSION,
  LEAVE_TYPES_TABLE,
  OPEN_DECISIONS,
  POLICY_FAQS,
  POLICY_TABS,
  PURPOSE_TEXT,
} from '../leavePolicyContent';

function displayDate(value) {
  if (!value) {
    return appToday().toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }
  const parsed = new Date(String(value).includes('T') ? value : String(value).replace(' ', 'T'));
  if (Number.isNaN(parsed.getTime())) return formatDate(value) || String(value);
  return parsed.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function DetailSection({ title, children }) {
  return (
    <details className="leave-policy-detail">
      <summary className="leave-policy-detail-toggle">
        <span className="leave-policy-detail-title">{title}</span>
        <span className="leave-policy-detail-action" aria-hidden="true" />
      </summary>
      <div className="leave-policy-detail-body">{children}</div>
    </details>
  );
}

export default function LeavePolicyPanel() {
  const { user } = useAuth();
  const year = appToday().getFullYear();
  const [tab, setTab] = useState('overview');
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ack, setAck] = useState(null);
  const [holidays, setHolidays] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api('/leave-policy/acknowledgement')
      .then((data) => {
        if (cancelled) return;
        setAck(data);
        if (data.acknowledged) setChecked(true);
      })
      .catch(() => {
        if (!cancelled) {
          setAck({
            policyVersion: LEAVE_POLICY_VERSION,
            acknowledged: false,
            employee: {
              name: user?.name || 'Employee',
              employeeNumber: user?.employeeNumber || null,
              department: user?.department || null,
            },
          });
        }
      });
    api(`/holidays?year=${year}`)
      .then((data) => {
        if (!cancelled) setHolidays(data);
      })
      .catch(() => {
        if (!cancelled) setHolidays(null);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.name, user?.employeeNumber, user?.department, year]);

  const employee = useMemo(
    () => ({
      name: ack?.employee?.name || user?.name || 'Employee',
      employeeNumber: ack?.employee?.employeeNumber || user?.employeeNumber || '—',
      department: ack?.employee?.department || user?.department || '—',
    }),
    [ack, user]
  );

  const acknowledged = Boolean(ack?.acknowledged);
  const holidayRows = useMemo(() => {
    const general = holidays?.general || [];
    const restricted = holidays?.restricted || [];
    return [
      ...general.map((h) => ({ ...h, kind: 'General' })),
      ...restricted.map((h) => ({ ...h, kind: 'Restricted' })),
    ].sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
  }, [holidays]);

  async function acknowledge() {
    if (!checked || acknowledged || busy) return;
    setBusy(true);
    setError('');
    try {
      const data = await api('/leave-policy/acknowledge', { method: 'POST', body: {} });
      setAck(data);
      setChecked(true);
    } catch (err) {
      setError(err.message || 'Could not record acknowledgement');
    } finally {
      setBusy(false);
    }
  }

  function downloadPdf() {
    const win = window.open('', '_blank', 'noopener,noreferrer,width=900,height=1100');
    if (!win) return;
    const rows = LEAVE_TYPES_TABLE.map(
      (row) =>
        `<tr><td>${row.type}</td><td>${row.code}</td><td>${row.entitlement}</td><td>${row.accrual}</td><td>${row.accruesFrom}</td><td>${row.yearEnd}</td></tr>`
    ).join('');
    win.document.write(`<!doctype html><html><head><title>Ultrix Leave Policy</title>
      <style>
        body{font-family:Georgia,serif;color:#152033;padding:32px;line-height:1.45}
        h1{font-size:28px;margin:0 0 8px} p.sub{color:#5b6578;margin:0 0 24px}
        h2{font-size:18px;margin:28px 0 10px} table{width:100%;border-collapse:collapse;font-size:12px}
        th,td{border:1px solid #d7deea;padding:8px;text-align:left} th{background:#eef3fb}
        ul{margin:8px 0 0 18px} li{margin:4px 0}
      </style></head><body>
      <h1>Ultrix Leave Policy</h1>
      <p class="sub">Guidelines for a happy, balanced and productive workplace · Version ${LEAVE_POLICY_VERSION}</p>
      <h2>1. Purpose &amp; Scope</h2><p>${PURPOSE_TEXT}</p>
      <h2>3. Leave Types at a Glance</h2>
      <table><thead><tr><th>Leave Type</th><th>Code</th><th>Entitlement</th><th>Accrual</th><th>Accrues From</th><th>Year End</th></tr></thead>
      <tbody>${rows}</tbody></table>
      <p><strong>Rule:</strong> No leave can be availed without the reporting manager's approval. An absence taken without an approved leave request is recorded as Loss of Pay (LOP).</p>
      <h2>Approval</h2><p>Every leave type follows the same approval chain. The system never auto-approves a request.</p>
      <script>window.onload=function(){window.print()}<\/script>
      </body></html>`);
    win.document.close();
  }

  return (
    <section className="leave-policy" aria-labelledby="leave-policy-title">
      <header className="leave-policy-head">
        <div>
          <h2 id="leave-policy-title">Leave Policy</h2>
          <p>Guidelines for a happy, balanced and productive workplace.</p>
        </div>
        <button type="button" className="btn secondary leave-policy-download" onClick={downloadPdf}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 19h14" />
          </svg>
          Download PDF
        </button>
      </header>

      <nav className="leave-policy-tabs" aria-label="Leave policy sections">
        {POLICY_TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`leave-policy-tab${tab === item.id ? ' is-active' : ''}`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="leave-policy-layout">
        <div className="leave-policy-main">
          {tab === 'overview' && (
            <>
              <div className="leave-policy-banner" aria-hidden="true">
                <div className="leave-policy-banner-copy">
                  <strong>Work Smart. Take Time. Be Your Best.</strong>
                  <span>Leave is part of how we stay sharp and sustainable.</span>
                </div>
                <div className="leave-policy-banner-art">
                  <span className="leave-policy-orb is-a" />
                  <span className="leave-policy-orb is-b" />
                  <span className="leave-policy-orb is-c" />
                </div>
              </div>

              <div className="leave-policy-detail-list">
                <DetailSection title="1. Purpose & Scope">
                  <p>{PURPOSE_TEXT}</p>
                </DetailSection>
                <DetailSection title="2. Key Definitions">
                  <div className="leave-policy-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Term</th>
                          <th>Definition</th>
                        </tr>
                      </thead>
                      <tbody>
                        {KEY_DEFINITIONS.map((row) => (
                          <tr key={row.term}>
                            <td>{row.term}</td>
                            <td>{row.definition}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </DetailSection>
                <DetailSection title="3. Leave Types at a Glance">
                  <div className="leave-policy-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Leave Type</th>
                          <th>Code</th>
                          <th>Entitlement</th>
                          <th>Accrual</th>
                          <th>Accrues From</th>
                          <th>Year End</th>
                        </tr>
                      </thead>
                      <tbody>
                        {LEAVE_TYPES_TABLE.map((row) => (
                          <tr key={row.code}>
                            <td>{row.type}</td>
                            <td>
                              <code>{row.code}</code>
                            </td>
                            <td>{row.entitlement}</td>
                            <td>{row.accrual}</td>
                            <td>{row.accruesFrom}</td>
                            <td>{row.yearEnd}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="leave-policy-callout">
                    No leave can be availed without the reporting manager&apos;s approval. An absence
                    taken without an approved leave request is recorded as Loss of Pay (LOP).
                  </p>
                </DetailSection>
                <DetailSection title="4. Accrual & Eligibility Rules">
                  {ACCRUAL_RULES.map((rule) => (
                    <div key={rule.title} className="leave-policy-rule-block">
                      <strong>{rule.title}</strong>
                      <ul>
                        {rule.points.map((point) => (
                          <li key={point}>{point}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </DetailSection>
                <DetailSection title="5. Holiday List">
                  <ul>
                    {HOLIDAY_RULES.map((rule) => (
                      <li key={rule}>{rule}</li>
                    ))}
                  </ul>
                </DetailSection>
                <DetailSection title="6. Approval Workflow">
                  <ul>
                    {APPROVAL_RULES.map((rule) => (
                      <li key={rule}>{rule}</li>
                    ))}
                  </ul>
                </DetailSection>
                <DetailSection title="7. Balances, Carry Forward & Lapse">
                  <ul>
                    {BALANCE_RULES.map((rule) => (
                      <li key={rule}>{rule}</li>
                    ))}
                  </ul>
                </DetailSection>
                <DetailSection title="8. Configurable Parameters">
                  <div className="leave-policy-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Parameter</th>
                          <th>Default</th>
                          <th>Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {CONFIG_PARAMETERS.map((row) => (
                          <tr key={row.parameter}>
                            <td>{row.parameter}</td>
                            <td>{row.defaultValue}</td>
                            <td>{row.notes}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </DetailSection>
                <DetailSection title="9. Open Decisions">
                  <ul>
                    {OPEN_DECISIONS.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </DetailSection>
              </div>
            </>
          )}

          {tab === 'types' && (
            <article className="leave-policy-section">
              <h3>Leave Types</h3>
              <div className="leave-policy-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Leave Type</th>
                      <th>Code</th>
                      <th>Entitlement</th>
                      <th>Accrual</th>
                      <th>Year End</th>
                    </tr>
                  </thead>
                  <tbody>
                    {LEAVE_TYPES_TABLE.map((row) => (
                      <tr key={row.code}>
                        <td>{row.type}</td>
                        <td>
                          <code>{row.code}</code>
                        </td>
                        <td>{row.entitlement}</td>
                        <td>{row.accrual}</td>
                        <td>{row.yearEnd}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {ACCRUAL_RULES.map((rule) => (
                <div key={rule.title} className="leave-policy-rule-block">
                  <strong>{rule.title}</strong>
                  <ul>
                    {rule.points.map((point) => (
                      <li key={point}>{point}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </article>
          )}

          {tab === 'rules' && (
            <article className="leave-policy-section">
              <h3>Rules &amp; Guidelines</h3>
              <p className="leave-policy-callout">
                No leave can be availed without the reporting manager&apos;s approval. An absence
                taken without an approved leave request is recorded as Loss of Pay (LOP).
              </p>
              <h4>Balances, carry forward &amp; lapse</h4>
              <ul>
                {BALANCE_RULES.map((rule) => (
                  <li key={rule}>{rule}</li>
                ))}
              </ul>
              {ACCRUAL_RULES.map((rule) => (
                <div key={rule.title} className="leave-policy-rule-block">
                  <strong>{rule.title}</strong>
                  <ul>
                    {rule.points.map((point) => (
                      <li key={point}>{point}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </article>
          )}

          {tab === 'holidays' && (
            <article className="leave-policy-section">
              <h3>Holiday List</h3>
              <ul>
                {HOLIDAY_RULES.map((rule) => (
                  <li key={rule}>{rule}</li>
                ))}
              </ul>
              <div className="leave-policy-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Category</th>
                      <th>Behaviour</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {HOLIDAY_CATEGORIES.map((row) => (
                      <tr key={row.category}>
                        <td>{row.category}</td>
                        <td>{row.behaviour}</td>
                        <td>{row.notes}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <h4>{year} published holidays</h4>
              {!holidayRows.length ? (
                <p className="muted">No holidays published for {year} yet.</p>
              ) : (
                <div className="leave-policy-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Holiday</th>
                        <th>Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {holidayRows.map((row) => (
                        <tr key={`${row.id || row.title}-${row.startDate}`}>
                          <td>{formatDate(row.startDate)}</td>
                          <td>{row.title}</td>
                          <td>{row.kind}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </article>
          )}

          {tab === 'approvals' && (
            <article className="leave-policy-section">
              <h3>Approval Workflow</h3>
              <ul>
                {APPROVAL_RULES.map((rule) => (
                  <li key={rule}>{rule}</li>
                ))}
              </ul>
              <div className="leave-policy-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Status</th>
                      <th>Meaning</th>
                      <th>Available Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {APPROVAL_STATUSES.map((row) => (
                      <tr key={row.status}>
                        <td>{row.status}</td>
                        <td>{row.meaning}</td>
                        <td>{row.actions}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          )}

          {tab === 'faqs' && (
            <article className="leave-policy-section">
              <h3>FAQs</h3>
              <div className="leave-policy-faq-list">
                {POLICY_FAQS.map((item) => (
                  <details key={item.q} className="leave-policy-faq">
                    <summary>{item.q}</summary>
                    <p>{item.a}</p>
                  </details>
                ))}
              </div>
            </article>
          )}
        </div>

        <aside className="leave-policy-ack" aria-label="Acknowledge leave policy">
          <div className="leave-policy-ack-head">
            <span className="leave-policy-ack-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M12 3 4 6v6c0 5 3.4 8.8 8 10 4.6-1.2 8-5 8-10V6l-8-3z" />
                <path d="m9 12 2 2 4-4" />
              </svg>
            </span>
            <div>
              <h3>Acknowledge Leave Policy</h3>
              {acknowledged ? (
                <p className="leave-policy-ack-done">Acknowledged on {displayDate(ack?.acknowledgedAt)}</p>
              ) : (
                <p>Confirm that you have read and will follow this policy.</p>
              )}
            </div>
          </div>

          <label className={`leave-policy-check${acknowledged ? ' is-locked' : ''}`}>
            <input
              type="checkbox"
              checked={checked}
              disabled={acknowledged || busy}
              onChange={(event) => setChecked(event.target.checked)}
            />
            <span>
              I have read and understood the Ultrix Leave Policy, including all leave types, rules,
              eligibility conditions and the approval process. I agree to adhere to the policy and
              comply with the guidelines as applicable.
            </span>
          </label>

          <dl className="leave-policy-meta">
            <div>
              <dt>Employee Name</dt>
              <dd>{employee.name}</dd>
            </div>
            <div>
              <dt>Employee ID</dt>
              <dd>{employee.employeeNumber || '—'}</dd>
            </div>
            <div>
              <dt>Department</dt>
              <dd>{employee.department || '—'}</dd>
            </div>
            <div>
              <dt>Date</dt>
              <dd>{displayDate(ack?.acknowledgedAt)}</dd>
            </div>
          </dl>

          {error ? <p className="form-error">{error}</p> : null}

          <button
            type="button"
            className="btn primary leave-policy-ack-btn"
            disabled={!checked || acknowledged || busy}
            onClick={acknowledge}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m5 12 5 5L20 7" />
            </svg>
            {acknowledged ? 'Acknowledged' : busy ? 'Saving…' : 'Acknowledge & Confirm'}
          </button>
          <p className="leave-policy-ack-note">
            {acknowledged
              ? 'Your acknowledgement is recorded and visible to HR.'
              : 'Your acknowledgement will be recorded and notified to the leave-approval channel.'}
          </p>
        </aside>
      </div>
    </section>
  );
}
