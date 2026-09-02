import { Link } from 'react-router-dom';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import AppShell from '../components/AppShell';
import LeaveCalendar from '../components/LeaveCalendar';
import HrEmployeeBalanceDirectory from '../components/HrEmployeeBalanceDirectory';
import ApprovalProgress from '../components/ApprovalProgress';
import StatusCelebration from '../components/StatusCelebration';
import { LeaveReportSection } from '../components/LeaveReports';
import OverviewPanels from '../components/OverviewPanels';
import LeaveBalanceDashboard from '../components/LeaveBalanceDashboard';
import CompanyFeed from '../components/CompanyFeed';
import { APPLY_LABELS, REQUEST_LABELS, SESSION_LABELS, STATUS_LABELS, appToday, formatLeaveSpan, includeInAttendanceRoster, isWfh } from '../utils';
import AttendanceMuster from '../components/AttendanceMuster';
import HrAttendanceOverview from '../components/HrAttendanceOverview';
import RegularizationInbox from '../components/RegularizationInbox';
import HistoryWorkspace from '../components/HistoryWorkspace';
import LeaveHistoryPanel from '../components/LeaveHistoryPanel';
import RegularizationHistoryPanel from '../components/RegularizationHistoryPanel';
import { SalaryComponentsView } from '../components/SalaryComponentsView';
import { MANAGER_NAV as NAV } from '../navConfig';

function useLoad(loader, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const reload = useCallback((silent = false) => {
    if (!silent) {
      setLoading(true);
      setError('');
    }
    loader()
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => {
        if (!silent) setLoading(false);
      });
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

      <HrAttendanceOverview scope="manager" />

      <OverviewPanels
        todayOnLeave={report?.teamLeavesThisMonth || []}
        teamTitle="Teams Leave"
        calendarTo="/manager/calendar"
        holidaysTo="/manager/calendar"
        attendanceTo="/manager/muster"
        canApplyRestricted
      />

      <LeaveReportSection />

    </AppShell>
  );
}

export function ManagerMuster() {
  return (
    <AppShell title="Attendance Muster" nav={NAV}>
      <AttendanceMuster />
    </AppShell>
  );
}

export function ManagerRegularization() {
  return (
    <AppShell title="Regularization" nav={NAV}>
      <RegularizationInbox />
    </AppShell>
  );
}

export function ManagerFeed() {
  return (
    <AppShell title="Feed" nav={NAV}>
      <CompanyFeed />
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
      reload(true);
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
    <AppShell title="Apply Leave" nav={NAV}>
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
            u.balances || { casual: 0, earned: 0, sick: 0, restricted: 2, celebration: 0 },
          ])
        ),
      })),
    [from, to]
  );

  return (
    <AppShell title="Attendance Info" nav={NAV}>
      {loading && <p className="muted">Loading…</p>}
      {error && <p className="form-error">{error}</p>}
      {data && (
        <div className="leave-mgmt-stack">
          <HrEmployeeBalanceDirectory
            users={(data.users || []).filter((u) => includeInAttendanceRoster(u))}
          />
          <LeaveCalendar
            leaves={data.leaves}
            showNames
            layout="roster"
            balancesByUserId={data.balancesByUserId}
            employees={(data.users || []).filter((u) => includeInAttendanceRoster(u))}
          />
        </div>
      )}
    </AppShell>
  );
}

export function ManagerHistory() {
  return (
    <AppShell title="History" nav={NAV}>
      <HistoryWorkspace
        leave={<LeaveHistoryPanel showEmployee />}
        regularization={<RegularizationHistoryPanel />}
      />
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
