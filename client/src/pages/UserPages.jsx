import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import AppShell from '../components/AppShell';
import LeaveCalendar from '../components/LeaveCalendar';
import ApprovalProgress from '../components/ApprovalProgress';
import OverviewPanels from '../components/OverviewPanels';
import LeaveBalanceDashboard from '../components/LeaveBalanceDashboard';
import CompanyFeed from '../components/CompanyFeed';
import { LeaveReportCharts } from '../components/LeaveReports';
import PunchBoard from '../components/PunchBoard';
import HistoryWorkspace from '../components/HistoryWorkspace';
import LeaveHistoryPanel from '../components/LeaveHistoryPanel';
import RegularizationHistoryPanel from '../components/RegularizationHistoryPanel';
import {
  LEAVE_LABELS,
  REQUEST_LABELS,
  STATUS_LABELS,
  appToday,
  formatLeaveSpan,
  canUserCancel,
} from '../utils';
import { SalaryComponentsView } from '../components/SalaryComponentsView';

const NAV = [
  { to: '/app', label: 'Home', end: true },
  { to: '/feed', label: 'Feed' },
  { to: '/app/attendance', label: 'Attendance' },
  { to: '/app/apply', label: 'Apply' },
  { to: '/app/reimbursements', label: 'Reimbursement' },
  { to: '/app/calendar', label: 'My calendar' },
  { to: '/app/salary', label: 'Salary' },
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
        <div className="stat-row four">
          {Object.entries(LEAVE_LABELS).map(([key, label]) => (
            <div key={key} className="stat">
              <span>{label}</span>
              <strong>{balances[key] ?? 0}</strong>
            </div>
          ))}
        </div>
      )}

      <OverviewPanels
        todayOnLeave={report?.todayOnLeave || []}
        teamTitle="On leave today"
        calendarTo="/app/calendar"
        holidaysTo="/app/calendar"
        attendanceTo="/app/attendance"
        canApplyRestricted
        onRestrictedApplied={() => {
          reloadLeaves();
          reloadBalances();
        }}
      />

      <section className="panel">
        <h2>Active requests</h2>
          {!active.length && <p className="empty">No active requests.</p>}
          <div className="stack tight">
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

      {report && (
        <>
          <h2 className="section-title">My leave report</h2>
          <LeaveReportCharts byType={report.byType} byMonth={report.byMonth} />
        </>
      )}
    </AppShell>
  );
}

export function UserAttendance() {
  return (
    <AppShell title="Attendance" nav={NAV}>
      <PunchBoard />
    </AppShell>
  );
}

export function UserFeed() {
  return (
    <AppShell title="Feed" nav={NAV}>
      <CompanyFeed />
    </AppShell>
  );
}

export function UserApply() {
  return (
    <AppShell title="Apply" nav={NAV}>
      <LeaveBalanceDashboard />
    </AppShell>
  );
}

export function UserCalendar() {
  const { user } = useAuth();
  const now = appToday();
  const year = now.getFullYear();
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
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
      {loading && <p className="muted">Loading…</p>}
      {error && <p className="form-error">{error}</p>}
      {cancelErr && <p className="form-error">{cancelErr}</p>}
      {data && (
        <LeaveCalendar
          leaves={data}
          onCancel={onCancel}
          busyId={busyId}
          layout="roster"
          employees={user ? [user] : []}
        />
      )}
    </AppShell>
  );
}

export function UserHistory() {
  return (
    <AppShell title="History" nav={NAV}>
      <HistoryWorkspace
        leave={<LeaveHistoryPanel canCancel />}
        regularization={<RegularizationHistoryPanel />}
      />
    </AppShell>
  );
}

export function UserSalary() {
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
