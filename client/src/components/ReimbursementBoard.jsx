import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { useTheme } from '../theme';
import { formatINR } from '../invoiceUtils';
import { getPortalRoot } from '../portalRoot';
import { formatDate, formatDateTime } from '../utils';
import StatusCelebration from './StatusCelebration';

const CATEGORIES = [
  { value: 'travel', label: 'Travel' },
  { value: 'meal', label: 'Meal' },
  { value: 'office_supplies', label: 'Office Supplies' },
  { value: 'internet', label: 'Internet' },
  { value: 'other', label: 'Other' },
];

const TABS = [
  { key: 'all', label: 'All Requests' },
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'reimbursed', label: 'Reimbursed' },
];

const EMPTY_FORM = {
  category: '',
  expenseDate: '',
  description: '',
  amount: '',
  paymentMode: 'self',
  currency: 'INR',
  notes: '',
  receiptData: '',
  receiptName: '',
};

function statusClass(status) {
  if (status === 'approved' || status === 'reimbursed') return 'is-ok';
  if (status === 'pending') return 'is-pending';
  if (status === 'rejected') return 'is-bad';
  return 'is-muted';
}

function categoryClass(category) {
  return `rmb-cat rmb-cat-${category || 'other'}`;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

export default function ReimbursementBoard({ mode = 'self' }) {
  const { user } = useAuth();
  const { mode: themeMode } = useTheme();
  const isHr = mode === 'hr' || user?.role === 'hr';
  const [items, setItems] = useState([]);
  const [stats, setStats] = useState(null);
  const [tab, setTab] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(null);
  const [reviewNote, setReviewNote] = useState('');
  const [reviewBusy, setReviewBusy] = useState(false);
  const [submittedPopup, setSubmittedPopup] = useState(null);
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (tab !== 'all') params.set('status', tab);
      const [listRes, statsRes] = await Promise.all([
        api(`/reimbursements?${params}`),
        api('/reimbursements/stats'),
      ]);
      setItems(listRes.reimbursements || []);
      setStats(statsRes);
    } catch (err) {
      setError(err.message || 'Could not load reimbursements');
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    load();
  }, [load]);

  const kpis = stats?.kpis;
  const counts = useMemo(() => {
    const by = stats?.byStatus || {};
    return {
      all: stats?.totalRequests || 0,
      pending: by.pending?.count || 0,
      approved: by.approved?.count || 0,
      rejected: by.rejected?.count || 0,
      reimbursed: by.reimbursed?.count || 0,
    };
  }, [stats]);

  function openCreate() {
    setForm(EMPTY_FORM);
    setFormError('');
    setShowCreate(true);
  }

  async function onPickReceipt(file) {
    if (!file) return;
    const okType =
      /image\/(jpeg|jpg|png)/i.test(file.type) || file.type === 'application/pdf';
    if (!okType) {
      setFormError('JPG, PNG, or PDF files only');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setFormError('Max size 5MB per file');
      return;
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setForm((current) => ({
        ...current,
        receiptData: dataUrl,
        receiptName: file.name,
      }));
      setFormError('');
    } catch {
      setFormError('Could not read receipt file');
    }
  }

  async function onSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setFormError('');
    try {
      const data = await api('/reimbursements', {
        method: 'POST',
        body: {
          ...form,
          amount: Number(form.amount),
        },
      });
      const code = data?.reimbursement?.requestCode || 'your request';
      setShowCreate(false);
      setSubmittedPopup({
        message: 'Reimbursement submitted',
        detail: `${code} is pending HR review.`,
      });
      await load();
    } catch (err) {
      setFormError(err.message || 'Could not submit request');
    } finally {
      setBusy(false);
    }
  }

  async function openDetail(item) {
    try {
      const data = await api(`/reimbursements/${item.id}`);
      setSelected(data.reimbursement);
      setReviewNote('');
    } catch (err) {
      setError(err.message || 'Could not open request');
    }
  }

  async function downloadReceipt(item) {
    try {
      const data = await api(`/reimbursements/${item.id}/receipt`);
      const a = document.createElement('a');
      a.href = data.receiptData;
      a.download = data.receiptName || `${item.requestCode}-receipt`;
      a.click();
    } catch (err) {
      setError(err.message || 'Could not download receipt');
    }
  }

  async function review(action) {
    if (!selected) return;
    setReviewBusy(true);
    try {
      const data = await api(`/reimbursements/${selected.id}/review`, {
        method: 'PATCH',
        body: { action, note: reviewNote },
      });
      setSelected(data.reimbursement);
      await load();
    } catch (err) {
      setError(err.message || 'Could not update request');
    } finally {
      setReviewBusy(false);
    }
  }

  async function cancelMine(item) {
    if (!window.confirm(`Cancel ${item.requestCode}?`)) return;
    try {
      await api(`/reimbursements/${item.id}/cancel`, { method: 'PATCH', body: {} });
      if (selected?.id === item.id) setSelected(null);
      await load();
    } catch (err) {
      setError(err.message || 'Could not cancel request');
    }
  }

  const overlays = (() => {
    const root = getPortalRoot();
    if (!root) return null;
    return createPortal(
          <>
            <StatusCelebration
              show={Boolean(submittedPopup)}
              onDone={() => setSubmittedPopup(null)}
              message={submittedPopup?.message || 'Request submitted'}
              detail={submittedPopup?.detail || ''}
              imageSrc="/assets/request-submitted.gif"
              durationMs={3200}
            />

            {showCreate ? (
              <div
                className="modal-backdrop rmb-backdrop"
                data-theme={themeMode}
                onClick={() => setShowCreate(false)}
              >
                <div
                  className="rmb-sheet rmb-sheet-create"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="rmb-create-title"
                  onClick={(e) => e.stopPropagation()}
                >
                  <header className="rmb-sheet-head">
                    <div>
                      <h2 id="rmb-create-title">Create Reimbursement</h2>
                      <p className="muted">
                        Fill in the details below to submit your reimbursement request
                      </p>
                    </div>
                    <button
                      type="button"
                      className="rmb-sheet-close"
                      onClick={() => setShowCreate(false)}
                      aria-label="Close"
                    >
                      ×
                    </button>
                  </header>

                  {formError ? <p className="rmb-sheet-error">{formError}</p> : null}

                  <form className="rmb-create-form" onSubmit={onSubmit}>
                    <section className="rmb-section">
                      <h3>Reimbursement Details</h3>
                      <div className="rmb-create-row">
                        <label>
                          <span className="rmb-field-label">Category *</span>
                          <select
                            value={form.category}
                            required
                            onChange={(e) => setForm((c) => ({ ...c, category: e.target.value }))}
                          >
                            <option value="">Select Category</option>
                            {CATEGORIES.map((c) => (
                              <option key={c.value} value={c.value}>
                                {c.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          <span className="rmb-field-label">Date of Expense *</span>
                          <input
                            type="date"
                            required
                            value={form.expenseDate}
                            onChange={(e) =>
                              setForm((c) => ({ ...c, expenseDate: e.target.value }))
                            }
                          />
                        </label>
                      </div>
                      <label>
                        <span className="rmb-field-label">Description *</span>
                        <textarea
                          required
                          maxLength={300}
                          rows={3}
                          value={form.description}
                          placeholder="Enter a brief description of the expense"
                          onChange={(e) =>
                            setForm((c) => ({ ...c, description: e.target.value }))
                          }
                        />
                        <span className="rmb-counter">{form.description.length}/300</span>
                      </label>
                      <div className="rmb-create-row">
                        <label>
                          <span className="rmb-field-label">Amount (₹) *</span>
                          <input
                            type="number"
                            min="0.01"
                            step="0.01"
                            required
                            value={form.amount}
                            placeholder="Enter Amount"
                            onChange={(e) => setForm((c) => ({ ...c, amount: e.target.value }))}
                          />
                        </label>
                        <label>
                          <span className="rmb-field-label">Bill Currency</span>
                          <select
                            value={form.currency}
                            onChange={(e) => setForm((c) => ({ ...c, currency: e.target.value }))}
                          >
                            <option value="INR">INR (₹)</option>
                          </select>
                        </label>
                      </div>
                      <div className="rmb-payment">
                        <span className="rmb-field-label">Payment Mode *</span>
                        <div className="rmb-payment-options">
                          <label className="rmb-radio">
                            <input
                              type="radio"
                              name="paymentMode"
                              checked={form.paymentMode === 'self'}
                              onChange={() => setForm((c) => ({ ...c, paymentMode: 'self' }))}
                            />
                            Paid by Me
                          </label>
                          <label className="rmb-radio">
                            <input
                              type="radio"
                              name="paymentMode"
                              checked={form.paymentMode === 'company'}
                              onChange={() => setForm((c) => ({ ...c, paymentMode: 'company' }))}
                            />
                            Paid by Company
                          </label>
                        </div>
                      </div>
                    </section>

                    <section className="rmb-section">
                      <h3>Upload Documents *</h3>
                      <p className="muted rmb-section-hint">
                        Upload clear photos or scanned copies of bills / receipts.
                      </p>
                      <div
                        className={`rmb-drop${form.receiptName ? ' has-file' : ''}`}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          onPickReceipt(e.dataTransfer.files?.[0]);
                        }}
                      >
                        <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden>
                          <path
                            d="M12 16V7m0 0 3.5 3.5M12 7 8.5 10.5M5 16.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-1.5"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.7"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                        <p>Drag and drop files here or</p>
                        <button
                          type="button"
                          className="btn secondary"
                          onClick={() => fileRef.current?.click()}
                        >
                          Browse Files
                        </button>
                        <input
                          ref={fileRef}
                          type="file"
                          accept="image/jpeg,image/png,application/pdf"
                          hidden
                          onChange={(e) => onPickReceipt(e.target.files?.[0])}
                        />
                        {form.receiptName ? (
                          <p className="rmb-file-name">{form.receiptName}</p>
                        ) : (
                          <p className="muted">JPG, PNG, PDF files only. Max size 5MB per file.</p>
                        )}
                      </div>
                    </section>

                    <section className="rmb-section">
                      <label>
                        <span className="rmb-field-label">Additional Notes (Optional)</span>
                        <textarea
                          maxLength={300}
                          rows={2}
                          value={form.notes}
                          placeholder="Add any additional information (if any)"
                          onChange={(e) => setForm((c) => ({ ...c, notes: e.target.value }))}
                        />
                        <span className="rmb-counter">{form.notes.length}/300</span>
                      </label>
                    </section>

                    <div className="rmb-sheet-actions">
                      <button
                        type="button"
                        className="btn secondary"
                        onClick={() => setShowCreate(false)}
                      >
                        Cancel
                      </button>
                      <button type="submit" className="btn primary" disabled={busy}>
                        {busy ? 'Submitting…' : 'Submit Request'}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            ) : null}

            {selected ? (
              <div
                className="modal-backdrop rmb-backdrop"
                data-theme={themeMode}
                onClick={() => setSelected(null)}
              >
                <div
                  className="rmb-sheet rmb-sheet-view"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="rmb-view-title"
                  onClick={(e) => e.stopPropagation()}
                >
                  <header className="rmb-sheet-head">
                    <div>
                      <h2 id="rmb-view-title">{selected.requestCode}</h2>
                      <p className="muted">
                        {selected.userName}
                        {selected.employeeNumber ? ` · ${selected.employeeNumber}` : ''}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="rmb-sheet-close"
                      onClick={() => setSelected(null)}
                      aria-label="Close"
                    >
                      ×
                    </button>
                  </header>

                  <div className="rmb-view-body">
                    <dl className="rmb-detail">
                      <div>
                        <dt>Status</dt>
                        <dd>
                          <span className={`rmb-status ${statusClass(selected.status)}`}>
                            {selected.statusLabel || selected.status}
                          </span>
                        </dd>
                      </div>
                      <div>
                        <dt>Category</dt>
                        <dd>
                          <span className={categoryClass(selected.category)}>
                            {selected.categoryLabel || selected.category}
                          </span>
                        </dd>
                      </div>
                      <div>
                        <dt>Expense date</dt>
                        <dd>{formatDate(selected.expenseDate)}</dd>
                      </div>
                      <div>
                        <dt>Amount</dt>
                        <dd>{formatINR(selected.amount)}</dd>
                      </div>
                      <div>
                        <dt>Payment</dt>
                        <dd>
                          {selected.paymentMode === 'company' ? 'Paid by Company' : 'Paid by Me'}
                        </dd>
                      </div>
                      <div>
                        <dt>Submitted</dt>
                        <dd>{formatDateTime(selected.createdAt)}</dd>
                      </div>
                    </dl>

                    <div className="rmb-view-block">
                      <h3>Description</h3>
                      <p>{selected.description || '—'}</p>
                    </div>
                    {selected.notes ? (
                      <div className="rmb-view-block">
                        <h3>Notes</h3>
                        <p>{selected.notes}</p>
                      </div>
                    ) : null}
                    {selected.hrNote ? (
                      <div className="rmb-view-block">
                        <h3>HR note</h3>
                        <p>{selected.hrNote}</p>
                      </div>
                    ) : null}

                    {isHr && selected.status === 'pending' ? (
                      <div className="rmb-review">
                        <label>
                          <span className="rmb-field-label">HR note</span>
                          <textarea
                            rows={2}
                            value={reviewNote}
                            onChange={(e) => setReviewNote(e.target.value)}
                            placeholder="Optional note"
                          />
                        </label>
                        <div className="rmb-sheet-actions">
                          <button
                            type="button"
                            className="btn secondary"
                            disabled={reviewBusy}
                            onClick={() => review('reject')}
                          >
                            Reject
                          </button>
                          <button
                            type="button"
                            className="btn primary"
                            disabled={reviewBusy}
                            onClick={() => review('approve')}
                          >
                            Approve
                          </button>
                        </div>
                      </div>
                    ) : null}

                    {isHr && selected.status === 'approved' ? (
                      <div className="rmb-review">
                        <label>
                          <span className="rmb-field-label">Payment note</span>
                          <textarea
                            rows={2}
                            value={reviewNote}
                            onChange={(e) => setReviewNote(e.target.value)}
                            placeholder="Optional"
                          />
                        </label>
                        <div className="rmb-sheet-actions">
                          <button
                            type="button"
                            className="btn primary"
                            disabled={reviewBusy}
                            onClick={() => review('reimburse')}
                          >
                            Mark reimbursed
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="rmb-sheet-actions rmb-sheet-footer">
                    {selected.hasReceipt ? (
                      <button
                        type="button"
                        className="btn secondary"
                        onClick={() => downloadReceipt(selected)}
                      >
                        Download receipt
                      </button>
                    ) : null}
                    {!isHr && selected.status === 'pending' ? (
                      <button
                        type="button"
                        className="btn secondary"
                        onClick={() => cancelMine(selected)}
                      >
                        Cancel request
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={() => setSelected(null)}
                    >
                      Close
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </>,
          root
        );
  })();

  return (
    <div className="rmb-board">
      {overlays}

      <header className="rmb-head">
        <div>
          <h2>Reimbursements</h2>
          <p className="muted">
            {isHr
              ? 'Review and manage reimbursement requests by status'
              : 'Track and manage your reimbursement requests'}
          </p>
        </div>
        {!isHr ? (
          <button type="button" className="btn primary" onClick={openCreate}>
            + Create Reimbursement
          </button>
        ) : null}
      </header>

      {error ? <p className="form-error">{error}</p> : null}

      {kpis ? (
        <div className="rmb-kpis">
          <article className="rmb-kpi">
            <span>Total Requests</span>
            <strong>{kpis.totalRequests}</strong>
            <em>This Year</em>
          </article>
          <article className="rmb-kpi">
            <span>Approved</span>
            <strong>{kpis.approved}</strong>
            <em>{formatINR(kpis.approvedAmount)}</em>
          </article>
          <article className="rmb-kpi">
            <span>Pending</span>
            <strong>{kpis.pending}</strong>
            <em>{formatINR(kpis.pendingAmount)}</em>
          </article>
          <article className="rmb-kpi">
            <span>Rejected</span>
            <strong>{kpis.rejected}</strong>
            <em>{formatINR(kpis.rejectedAmount)}</em>
          </article>
          <article className="rmb-kpi">
            <span>Total Reimbursed</span>
            <strong>{formatINR(kpis.totalReimbursed)}</strong>
            <em>This Year</em>
          </article>
        </div>
      ) : null}

      <div className="rmb-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={tab === t.key ? 'is-active' : ''}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {t.key !== 'all' ? ` (${counts[t.key] || 0})` : ''}
          </button>
        ))}
      </div>

      {loading && <p className="muted">Loading reimbursements…</p>}
      {!loading && !items.length && <p className="empty">No reimbursement requests yet.</p>}

      {!!items.length && (
        <div className="table-wrap">
          <table className="rmb-table">
            <thead>
              <tr>
                <th>Request ID</th>
                {isHr ? <th>Employee</th> : null}
                <th>Date</th>
                <th>Category</th>
                <th>Description</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{item.requestCode}</td>
                  {isHr ? (
                    <td>
                      {item.userName}
                      <div className="sub">{item.employeeNumber || ''}</div>
                    </td>
                  ) : null}
                  <td>{formatDate(item.expenseDate)}</td>
                  <td>
                    <span className={categoryClass(item.category)}>
                      {item.categoryLabel || item.category}
                    </span>
                  </td>
                  <td>{item.description}</td>
                  <td>{formatINR(item.amount)}</td>
                  <td>
                    <span className={`rmb-status ${statusClass(item.status)}`}>
                      {item.statusLabel || item.status}
                    </span>
                  </td>
                  <td className="rmb-actions">
                    <button type="button" className="btn secondary" onClick={() => openDetail(item)}>
                      View
                    </button>
                    {item.hasReceipt &&
                    (item.status === 'approved' || item.status === 'reimbursed') ? (
                      <button
                        type="button"
                        className="btn secondary"
                        onClick={() => downloadReceipt(item)}
                      >
                        Download
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
