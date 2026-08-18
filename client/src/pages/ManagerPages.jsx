import { Link } from 'react-router-dom';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import AppShell from '../components/AppShell';
import LeaveCalendar from '../components/LeaveCalendar';
import ApprovalProgress from '../components/ApprovalProgress';
import StatusCelebration from '../components/StatusCelebration';
import { LeaveReportSection } from '../components/LeaveReports';
import OverviewPanels from '../components/OverviewPanels';
import LeaveBalanceDashboard from '../components/LeaveBalanceDashboard';
import { APPLY_LABELS, REQUEST_LABELS, SESSION_LABELS, STATUS_LABELS, appToday, formatLeaveSpan, isWfh } from '../utils';
import { SalaryComponentsView } from '../components/SalaryComponentsView';

const NAV = [
  { to: '/manager', label: 'Overview', end: true, icon: '/assets/nav-searchlist.png' },
  { to: '/manager/apply', label: 'Apply', icon: '/assets/nav-apply.png' },
  { to: '/manager/approvals', label: 'Approvals', icon: '/assets/nav-approved.png' },
  { to: '/manager/ratings', label: 'Ratings', icon: '/assets/rating-star.png' },
  { to: '/manager/salary', label: 'Salary', icon: '/assets/nav-searchlist.png' },
  { to: '/manager/invoices', label: 'Invoices', icon: '/assets/nav-searchlist.png' },
  { to: '/manager/calendar', label: 'Team calendar', icon: '/assets/nav-calendar.png' },
  { to: '/manager/history', label: 'History', icon: '/assets/nav-hourglass.png' },
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

export function ManagerOverview() {
  const { user } = useAuth();
  const { data: stats, error, loading } = useLoad(() => api('/dashboard/stats'));
  const { data: report } = useLoad(() => api('/reports/overview'));

  return (
    <AppShell title={`Welcome ${user?.name || ''}`} nav={NAV}>
      {loading && <p className="muted">Loading…</p>}
      {error && <p className="form-error">{error}</p>}
      {stats && (
        <div className="stat-row">
          <Link to="/manager/approvals" className="stat stat-link">
            <span>Awaiting your approval</span>
            <strong>{stats.pendingManager}</strong>
          </Link>
          <Link to="/manager/history" className="stat stat-link">
            <span>Team members</span>
            <strong>{stats.users}</strong>
          </Link>
          <Link to="/manager/calendar" className="stat stat-link">
            <span>On leave today</span>
            <strong>{stats.onLeaveToday}</strong>
          </Link>
        </div>
      )}

      <OverviewPanels
        todayOnLeave={report?.todayOnLeave || []}
        teamTitle="Team on leave"
        calendarTo="/manager/calendar"
        holidaysTo="/manager/calendar"
        canApplyRestricted
      />

      <LeaveReportSection />

    </AppShell>
  );
}

export function ManagerApprovals() {
  const { data, error, loading, reload } = useLoad(() =>
    api('/leaves?status=pending_manager').then((d) => d.leaves)
  );
  const [active, setActive] = useState(null);
  const [form, setForm] = useState({
    leaveType: 'casual',
    startDate: '',
    endDate: '',
    session: 'full',
    adminNote: '',
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [celebrate, setCelebrate] = useState(false);

  function openReview(leave) {
    setActive(leave);
    setForm({
      leaveType: leave.leaveType,
      startDate: leave.startDate,
      endDate: leave.endDate,
      session: leave.session || 'full',
      adminNote: '',
    });
    setMsg('');
  }

  async function review(action) {
    if (!active) return;
    setBusy(true);
    setMsg('');
    try {
      await api(`/leaves/${active.id}/review`, {
        method: 'PATCH',
        body: { action, ...form },
      });
      setActive(null);
      if (action === 'approve') setCelebrate(true);
      reload();
    } catch (err) {
      setMsg(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell title="Manager approvals" nav={NAV}>
      <StatusCelebration
        show={celebrate}
        onDone={() => setCelebrate(false)}
        message="Manager approved"
        detail="Request sent to HR for final approval."
        imageSrc="/assets/icon-manager-approved.gif"
        durationMs={2800}
      />
      {loading && <p className="muted">Loading…</p>}
      {error && <p className="form-error">{error}</p>}
      {!loading && data?.length === 0 && (
        <p className="empty">No team requests awaiting your approval.</p>
      )}
      <div className="stack tight">
        {(data || []).map((leave) => (
          <section key={leave.id} className="panel">
            <div className="row-between">
              <div>
                <strong className="employee-name">{leave.userName}</strong>
                <div className="sub">{leave.userEmail}</div>
              </div>
              <button type="button" className="btn review-manager" onClick={() => openReview(leave)}>
                Review
              </button>
            </div>
            <p>
              <span className={`badge type-${leave.leaveType}`}>
                {REQUEST_LABELS[leave.leaveType]}
              </span>{' '}
              {formatLeaveSpan(leave)}
              {leave.reason ? ` · ${leave.reason}` : ''}
            </p>
            <ApprovalProgress leave={leave} />
          </section>
        ))}
      </div>

      {active && (
        <div className="modal-backdrop" onClick={() => setActive(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>
              Manager review — {active.userName} ({isWfh(active.leaveType) ? 'WFH' : 'leave'})
            </h2>
            <ApprovalProgress leave={active} />
            <div className="form-grid">
              <label>
                Request type
                <select
                  value={form.leaveType}
                  onChange={(e) => setForm((f) => ({ ...f, leaveType: e.target.value }))}
                >
                  {Object.entries(APPLY_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Session
                <select
                  value={form.session}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      session: e.target.value,
                      endDate: e.target.value !== 'full' ? f.startDate : f.endDate,
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
                Start
                <input
                  type="date"
                  value={form.startDate}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      startDate: e.target.value,
                      endDate: f.session !== 'full' ? e.target.value : f.endDate,
                    }))
                  }
                />
              </label>
              {form.session === 'full' && (
                <label>
                  End
                  <input
                    type="date"
                    value={form.endDate}
                    onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
                  />
                </label>
              )}
              <label className="full">
                Manager note
                <textarea
                  rows={3}
                  value={form.adminNote}
                  onChange={(e) => setForm((f) => ({ ...f, adminNote: e.target.value }))}
                />
              </label>
            </div>
            {msg && <p className="form-error">{msg}</p>}
            <div className="modal-actions">
              <button type="button" className="btn ghost" onClick={() => setActive(null)}>
                Close
              </button>
              <button
                type="button"
                className="btn danger"
                disabled={busy}
                onClick={() => review('reject')}
              >
                Reject
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={busy}
                onClick={() => review('approve')}
              >
                Approve → HR
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

export function ManagerApply() {
  return (
    <AppShell title="Apply" nav={NAV}>
      <LeaveBalanceDashboard restrictedOnly />
    </AppShell>
  );
}

export function ManagerCalendar() {
  const now = appToday();
  const year = now.getFullYear();
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const { data, error, loading, reload } = useLoad(
    () =>
      Promise.all([
        api(`/leaves/calendar?from=${from}&to=${to}`).then((d) => d.leaves),
        api('/users').then((d) => d.users),
      ]).then(([leaves, users]) => ({
        leaves,
        users,
        balancesByUserId: Object.fromEntries(
          users.map((u) => [
            u.id,
            u.balances || { casual: 0, earned: 0, sick: 0, restricted: 2 },
          ])
        ),
      })),
    [from, to]
  );

  return (
    <AppShell title="Team calendar" nav={NAV}>
      {loading && <p className="muted">Loading…</p>}
      {error && <p className="form-error">{error}</p>}
      {data && (
        <LeaveCalendar
          leaves={data.leaves}
          showNames
          balancesByUserId={data.balancesByUserId}
          employees={data.users}
        />
      )}
    </AppShell>
  );
}

export function ManagerHistory() {
  const [status, setStatus] = useState('all');
  const { data, error, loading } = useLoad(
    () => api(`/leaves?status=${status}`).then((d) => d.leaves),
    [status]
  );

  return (
    <AppShell title="Team history" nav={NAV}>
      <div className="filters">
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">All</option>
            <option value="pending_manager">Awaiting manager</option>
            <option value="pending_hr">Awaiting HR</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
      </div>
      {loading && <p className="muted">Loading…</p>}
      {error && <p className="form-error">{error}</p>}
      <div className="stack tight">
        {(data || []).map((leave) => (
          <section key={leave.id} className="panel">
            <div className="row-between">
              <div>
                <strong className="employee-name">{leave.userName}</strong> ·{' '}
                {REQUEST_LABELS[leave.leaveType]} · {formatLeaveSpan(leave)}
              </div>
              <span className={`badge status-${leave.status}`}>
                {STATUS_LABELS[leave.status]}
              </span>
            </div>
            <ApprovalProgress leave={leave} compact />
          </section>
        ))}
      </div>
    </AppShell>
  );
}

export function ManagerSalary() {
  const { data, error, loading } = useLoad(() =>
    api('/profiles/me').then((d) => d.profile)
  );

  return (
    <AppShell title="My salary" nav={NAV}>
      {loading && <p className="muted">Loading…</p>}
      {error && <p className="form-error">{error}</p>}
      {!loading && !data && !error && (
        <p className="empty">No salary profile on file yet. Ask HR to add your details in Onboarding.</p>
      )}
      {data && (
        <SalaryComponentsView
          payroll={data.payroll}
          employmentType={data.employment?.employmentType}
          showSensitive
          title={`${data.name} · salary components`}
        />
      )}
    </AppShell>
  );
}
