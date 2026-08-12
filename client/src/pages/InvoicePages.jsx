import { useCallback, useEffect, useMemo, useState } from 'react';
import { downloadInvoicePdf } from '../downloadInvoice';
import { api } from '../api';
import { useAuth } from '../auth';
import AppShell from '../components/AppShell';
import InvoiceGenerator from '../components/InvoiceGenerator';
import InvoiceRetentionNotice from '../components/InvoiceRetentionNotice';
import {
  billingPeriodFromMonthYear,
  formatBillingPeriod,
  formatDeletesOn,
  formatINR,
  PERIOD_MONTHS,
} from '../invoiceUtils';
import { appYear, formatDateTime } from '../utils';

const MANAGER_NAV = [
  { to: '/manager', label: 'Overview', end: true, icon: '/assets/nav-searchlist.png' },
  { to: '/manager/approvals', label: 'Approvals', icon: '/assets/nav-approved.png' },
  { to: '/manager/ratings', label: 'Ratings', icon: '/assets/rating-star.png' },
  { to: '/manager/invoices', label: 'Invoices', icon: '/assets/nav-searchlist.png' },
  { to: '/manager/calendar', label: 'Team calendar', icon: '/assets/nav-calendar.png' },
  { to: '/manager/history', label: 'History', icon: '/assets/nav-hourglass.png' },
];

const HR_NAV = [
  { to: '/hr', label: 'Overview', end: true, icon: '/assets/nav-searchlist.png' },
  { to: '/hr/approvals', label: 'HR approvals', icon: '/assets/nav-approved.png' },
  { to: '/hr/users', label: 'Users', icon: '/assets/nav-team.png' },
  { to: '/hr/ratings', label: 'Ratings', icon: '/assets/rating-star.png' },
  { to: '/hr/invoices', label: 'Invoices', icon: '/assets/nav-searchlist.png' },
  { to: '/hr/calendar', label: 'Team calendar', icon: '/assets/nav-calendar.png' },
  { to: '/hr/history', label: 'History', icon: '/assets/nav-hourglass.png' },
];

export function EmployeeInvoices() {
  const { user } = useAuth();
  return (
    <AppShell title={`Invoices · ${user?.name || ''}`}>
      <InvoiceGenerator />
    </AppShell>
  );
}

export function ManagerInvoices() {
  const { user } = useAuth();
  return (
    <AppShell title={`Invoices · ${user?.name || ''}`} nav={MANAGER_NAV}>
      <InvoiceGenerator />
    </AppShell>
  );
}

export function HrInvoices() {
  const { user } = useAuth();
  const [invoices, setInvoices] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [month, setMonth] = useState(String(new Date().getMonth() + 1));
  const [year, setYear] = useState(String(appYear()));
  const [employeeId, setEmployeeId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

  const billingPeriod = billingPeriodFromMonthYear(month, year);
  const periodYears = useMemo(
    () => Array.from({ length: 4 }, (_, i) => String(appYear() - i)),
    []
  );

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    if (billingPeriod) params.set('billingPeriod', billingPeriod);
    if (employeeId) params.set('userId', employeeId);
    api(`/invoices?${params.toString()}`)
      .then((d) => setInvoices(d.invoices || []))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [billingPeriod, employeeId]);

  useEffect(() => {
    api('/invoices/submitters')
      .then((d) => setEmployees(d.users || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function deleteInvoice(inv) {
    const ok = window.confirm(
      `Permanently delete invoice ${inv.invoiceNumber} from ${inv.userName}? This removes it for HR and cannot be undone.`
    );
    if (!ok) return;
    setBusyId(inv.id);
    setError('');
    try {
      await api(`/invoices/${inv.id}`, { method: 'DELETE' });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <AppShell title={`Invoices · ${user?.name || ''}`} nav={HR_NAV}>
      <InvoiceRetentionNotice className="invoice-retention-notice-hr" />
      <section className="panel employee-ratings-section">
        <header className="employee-ratings-header">
          <div>
            <h2>Employee invoices</h2>
            <p className="muted">
              Invoices submitted by employees and managers. Filter by month and employee.
            </p>
          </div>
        </header>

        <div className="export-filters employee-ratings-filters employee-ratings-filters-simple">
          <label>
            Month
            <select value={month} onChange={(e) => setMonth(e.target.value)}>
              {PERIOD_MONTHS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </label>
          <label>
            Year
            <select value={year} onChange={(e) => setYear(e.target.value)}>
              {periodYears.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </label>
          <label>
            Employee
            <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">All employees</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                  {e.employeeNumber ? ` · ${e.employeeNumber}` : ''}
                </option>
              ))}
            </select>
          </label>
        </div>

        <p className="muted">
          Showing {invoices.length} invoice{invoices.length === 1 ? '' : 's'}
          {billingPeriod ? ` for ${formatBillingPeriod(billingPeriod)}` : ''}
        </p>

        {loading && <p className="muted">Loading invoices…</p>}
        {error && <p className="form-error">{error}</p>}

        {!loading && !error && invoices.length === 0 && (
          <p className="muted">No invoices match the selected filters.</p>
        )}

        {invoices.length > 0 && (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Consultant</th>
                  <th>Invoice #</th>
                  <th>Period</th>
                  <th>Total (INR)</th>
                  <th>Submitted</th>
                  <th>Deletes on</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td>
                      {inv.userName}
                      {inv.employeeNumber ? ` · ${inv.employeeNumber}` : ''}
                      {inv.hiddenFromSubmitter ? (
                        <span className="badge invoice-hidden-badge">Removed by submitter</span>
                      ) : null}
                    </td>
                    <td>{inv.consultant}</td>
                    <td>{inv.invoiceNumber}</td>
                    <td>{formatBillingPeriod(inv.billingPeriod)}</td>
                    <td>{formatINR(inv.totalAmount)}</td>
                    <td>{formatDateTime(inv.createdAt)}</td>
                    <td>{formatDeletesOn(inv.deletesOn)}</td>
                    <td className="invoice-row-actions">
                      {inv.hasPdf ? (
                        <button
                          type="button"
                          className="btn ghost small"
                          disabled={busyId === inv.id}
                          onClick={() =>
                            downloadInvoicePdf(inv.id, `${inv.invoiceNumber}.pdf`).catch(
                              (err) => setError(err.message)
                            )
                          }
                        >
                          Download PDF
                        </button>
                      ) : (
                        <span className="muted">—</span>
                      )}
                      <button
                        type="button"
                        className="btn ghost small invoice-delete-btn"
                        disabled={busyId === inv.id}
                        onClick={() => deleteInvoice(inv)}
                      >
                        {busyId === inv.id ? 'Deleting…' : 'Delete'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AppShell>
  );
}
