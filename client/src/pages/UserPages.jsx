import { useCallback, useEffect, useState } from 'react';
import { format, endOfMonth, startOfMonth } from 'date-fns';
import { api } from '../api';
import { useAuth } from '../auth';
import AppShell from '../components/AppShell';
import LeaveCalendar from '../components/LeaveCalendar';
import ApprovalProgress from '../components/ApprovalProgress';
import StatusCelebration from '../components/StatusCelebration';
import { LeaveReportCharts, UpcomingLeaveList } from '../components/LeaveReports';
import {
  LEAVE_LABELS,
  REQUEST_LABELS,
  SESSION_LABELS,
  STATUS_LABELS,
  appToday,
  formatDate,
  formatLeaveSpan,
  isWfh,
  canUserCancel,
} from '../utils';

const NAV = [
  { to: '/app', label: 'Home', end: true },
  { to: '/app/apply', label: 'Apply' },
  { to: '/app/calendar', label: 'My calendar' },
  { to: '/app/ratings', label: 'My ratings' },
  { to: '/app/history', label: 'History' },
];

function useLoad(loader, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    setLoading(true);
    setError('');
    loader()
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, deps);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, error, loading, reload };
}

async function cancelLeave(id, status, opts = {}) {
  const { date, cancelAll } = opts;
  let detail = '';
  if (date && !cancelAll) {
    detail = ` Only ${date} will be cancelled; other days stay active.`;
  } else if (status === 'approved') {
    detail = ' Leave days will be restored to your balance if applicable.';
  } else if (status === 'pending_hr') {
    detail = ' This leave is partially approved (manager approved, awaiting HR).';
  }
  const title =
    date && !cancelAll ? 'Cancel this leave day?' : 'Cancel this entire request?';
  const ok = window.confirm(`${title}${detail}`);
  if (!ok) return false;
  await api(`/leaves/${id}/cancel`, {
    method: 'PATCH',
    body: date && !cancelAll ? { date } : { cancelAll: true },
  });
  return true;
}

export function UserHome() {
  const { user } = useAuth();
  const {
    data: balances,
    loading,
    error,
    reload: reloadBalances,
  } = useLoad(() => api('/balances/me').then((d) => d.balances));
  const { data: leaves, reload: reloadLeaves } = useLoad(() =>
    api('/leaves').then((d) => d.leaves)
  );
  const { data: report } = useLoad(() => api('/reports/overview'));
  const [cancelErr, setCancelErr] = useState('');
  const [busyId, setBusyId] = useState(null);

  const active = (leaves || []).filter((l) =>
    ['pending_manager', 'pending_hr', 'approved'].includes(l.status)
  );

  async function onCancel(leave) {
    setCancelErr('');
    setBusyId(leave.id);
    try {
      const done = await cancelLeave(leave.id, leave.status);
      if (done) {
        reloadLeaves();
        reloadBalances();
      }
    } catch (err) {
      setCancelErr(err.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <AppShell title={`Welcome ${user?.name || ''}`} nav={NAV}>
      {loading && <p className="muted">Loading…</p>}
      {error && <p className="form-error">{error}</p>}
      {cancelErr && <p className="form-error">{cancelErr}</p>}
      {balances && (
        <div className="stat-row">
          <div className="stat">
            <span>Casual</span>
            <strong>{balances.casual}</strong>
          </div>
          <div className="stat">
            <span>Earned</span>
            <strong>{balances.earned}</strong>
          </div>
          <div className="stat">
            <span>Sick</span>
            <strong>{balances.sick}</strong>
          </div>
        </div>
      )}

      <div className="overview-grid">
        <section className="panel">
          <h2>Upcoming leave</h2>
          <UpcomingLeaveList items={report?.upcoming || []} showEmployee={false} />
        </section>
        <section className="panel">
          <h2>Active requests</h2>
          {!active.length && <p className="empty">No active requests.</p>}
          <div className="stack" style={{ gap: 12 }}>
            {active.slice(0, 4).map((leave) => (
              <div key={leave.id} className="request-card">
                <div className="row-between">
                  <div>
                    <span className={`badge type-${leave.leaveType}`}>
                      {REQUEST_LABELS[leave.leaveType]}
                    </span>{' '}
                    {formatLeaveSpan(leave)}
                  </div>
                  {canUserCancel(leave.status) && (
                    <button
                      type="button"
                      className="btn danger ghost-danger"
                      disabled={busyId === leave.id}
                      onClick={() => onCancel(leave)}
                    >
                      Cancel
                    </button>
                  )}
                </div>
                <ApprovalProgress leave={leave} compact />
              </div>
            ))}
          </div>
        </section>
      </div>

      {report && (
        <>
          <h2 className="section-title">My leave report</h2>
          <LeaveReportCharts byType={report.byType} byMonth={report.byMonth} />
        </>
      )}
    </AppShell>
  );
}

export function UserApply() {
  const { data: balances, reload } = useLoad(() =>
    api('/balances/me').then((d) => d.balances)
  );
  const [form, setForm] = useState({
    leaveType: 'casual',
    startDate: '',
    endDate: '',
    session: 'full',
    reason: '',
  });
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [submittedPopup, setSubmittedPopup] = useState(null);
  const wfh = isWfh(form.leaveType);
  const halfDay = form.session !== 'full';

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setMsg('');
    setErr('');
    try {
      const body = {
        ...form,
        endDate: halfDay ? form.startDate : form.endDate,
      };
      await api('/leaves', { method: 'POST', body });
      setSubmittedPopup({
        message: wfh ? 'WFH submitted' : 'Leave submitted',
        detail: 'Your request is waiting for manager approval, then HR.',
      });
      setMsg(
        wfh
          ? 'WFH submitted — waiting for manager, then HR.'
          : 'Leave submitted — waiting for manager, then HR.'
      );
      setForm({
        leaveType: form.leaveType,
        startDate: '',
        endDate: '',
        session: 'full',
        reason: '',
      });
      reload();
    } catch (error) {
      setErr(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell title="Apply" nav={NAV}>
      <StatusCelebration
        show={Boolean(submittedPopup)}
        onDone={() => setSubmittedPopup(null)}
        message={submittedPopup?.message || 'Request submitted'}
        detail={submittedPopup?.detail || ''}
        imageSrc="/assets/request-submitted.gif"
        durationMs={3200}
      />
      <div className="apply-layout">
        <div className="apply-main">
          <div className="seg-tabs" role="tablist" aria-label="Request type">
            <button
              type="button"
              role="tab"
              className={!wfh ? 'active' : ''}
              aria-selected={!wfh}
              onClick={() => setForm((f) => ({ ...f, leaveType: 'casual' }))}
            >
              Leave
            </button>
            <button
              type="button"
              role="tab"
              className={wfh ? 'active' : ''}
              aria-selected={wfh}
              onClick={() => setForm((f) => ({ ...f, leaveType: 'wfh' }))}
            >
              WFH
            </button>
          </div>

          <section className="panel apply-form-panel">
            <h2>{wfh ? 'Work from home' : 'Leave request'}</h2>
            <p className="muted slim">
              {wfh
                ? 'WFH does not use leave balance. Choose full day or a half-day session.'
                : 'Select leave type, full day or morning/afternoon session. Needs Manager, then HR.'}
            </p>
            <form className="stack-form" onSubmit={onSubmit}>
              {!wfh && (
                <label>
                  Leave type
                  <select
                    value={form.leaveType}
                    onChange={(e) => setForm((f) => ({ ...f, leaveType: e.target.value }))}
                  >
                    {Object.entries(LEAVE_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                Session
                <select
                  value={form.session}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      session: e.target.value,
                      endDate:
                        e.target.value !== 'full' ? f.startDate || f.endDate : f.endDate,
                    }))
                  }
                >
                  {Object.entries(SESSION_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {halfDay ? 'Date' : 'Start date'}
                <input
                  type="date"
                  value={form.startDate}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      startDate: e.target.value,
                      endDate: halfDay ? e.target.value : f.endDate,
                    }))
                  }
                  required
                />
              </label>
              {!halfDay && (
                <label>
                  End date
                  <input
                    type="date"
                    value={form.endDate}
                    onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
                    required
                  />
                </label>
              )}
              {halfDay && (
                <p className="muted slim">Half-day session counts as 0.5 day.</p>
              )}
              <label>
                Reason
                <textarea
                  rows={3}
                  value={form.reason}
                  onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                  placeholder="Optional"
                />
              </label>
              {msg && <p className="form-ok">{msg}</p>}
              {err && <p className="form-error">{err}</p>}
              <button className="btn primary" type="submit" disabled={busy}>
                {busy ? 'Submitting…' : wfh ? 'Submit WFH' : 'Submit leave'}
              </button>
            </form>
          </section>
        </div>

        <aside className="panel balance-side">
          <h2>Leave balances</h2>
          {balances ? (
            <ul className="balance-list">
              <li>
                <span>Casual</span>
                <strong>{balances.casual}</strong>
              </li>
              <li>
                <span>Earned</span>
                <strong>{balances.earned}</strong>
              </li>
              <li>
                <span>Sick</span>
                <strong>{balances.sick}</strong>
              </li>
            </ul>
          ) : (
            <p className="muted">Loading balances…</p>
          )}
          {wfh && (
            <p className="balance-note">WFH requests do not deduct from these balances.</p>
          )}
        </aside>
      </div>
    </AppShell>
  );
}

export function UserCalendar() {
  const now = appToday();
  const from = format(startOfMonth(now), 'yyyy-MM-dd');
  const toEnd = new Date(now);
  toEnd.setMonth(toEnd.getMonth() + 2);
  const to = format(endOfMonth(toEnd), 'yyyy-MM-dd');
  const { data, error, loading, reload } = useLoad(
    () => api(`/leaves/calendar?from=${from}&to=${to}`).then((d) => d.leaves),
    [from, to]
  );
  const [cancelErr, setCancelErr] = useState('');
  const [busyId, setBusyId] = useState(null);

  async function onCancel(leave, opts = {}) {
    setCancelErr('');
    setBusyId(leave.id);
    try {
      const done = await cancelLeave(leave.id, leave.status, opts);
      if (done) reload();
      return done;
    } catch (err) {
      setCancelErr(err.message);
      return false;
    } finally {
      setBusyId(null);
    }
  }

  return (
    <AppShell title="My calendar" nav={NAV}>
      <p className="lede">
        Your active leave appears here, colored by leave type. Tap a day to cancel just that
        day, or cancel the full multi-day request.
      </p>
      {loading && <p className="muted">Loading…</p>}
      {error && <p className="form-error">{error}</p>}
      {cancelErr && <p className="form-error">{cancelErr}</p>}
      {data && (
        <LeaveCalendar leaves={data} onCancel={onCancel} busyId={busyId} />
      )}
    </AppShell>
  );
}

export function UserHistory() {
  const [status, setStatus] = useState('all');
  const { data, error, loading, reload } = useLoad(
    () => api(`/leaves?status=${status}`).then((d) => d.leaves),
    [status]
  );
  const [cancelErr, setCancelErr] = useState('');
  const [busyId, setBusyId] = useState(null);

  async function onCancel(leave) {
    setCancelErr('');
    setBusyId(leave.id);
    try {
      const done = await cancelLeave(leave.id, leave.status);
      if (done) reload();
    } catch (err) {
      setCancelErr(err.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <AppShell title="History" nav={NAV}>
      <div className="filters">
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">All</option>
            <option value="pending_manager">Awaiting manager</option>
            <option value="pending_hr">Partially approved (awaiting HR)</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
      </div>
      {loading && <p className="muted">Loading…</p>}
      {error && <p className="form-error">{error}</p>}
      {cancelErr && <p className="form-error">{cancelErr}</p>}
      <div className="stack" style={{ gap: 12 }}>
        {(data || []).map((leave) => (
          <section key={leave.id} className="panel">
            <div className="row-between">
              <div>
                {REQUEST_LABELS[leave.leaveType]} · {formatLeaveSpan(leave)}
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span className={`badge status-${leave.status}`}>
                  {STATUS_LABELS[leave.status]}
                </span>
                {canUserCancel(leave.status) && (
                  <button
                    type="button"
                    className="btn danger ghost-danger"
                    disabled={busyId === leave.id}
                    onClick={() => onCancel(leave)}
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
            <ApprovalProgress leave={leave} />
          </section>
        ))}
      </div>
    </AppShell>
  );
}
