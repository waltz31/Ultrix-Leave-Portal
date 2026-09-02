import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import AppShell from '../components/AppShell';
import EmployeeDashboard from '../components/EmployeeDashboard';
import LeaveBalanceDashboard from '../components/LeaveBalanceDashboard';
import CompanyFeed from '../components/CompanyFeed';
import MyAttendanceHub from '../components/MyAttendanceHub';
import HistoryWorkspace from '../components/HistoryWorkspace';
import LeaveHistoryPanel from '../components/LeaveHistoryPanel';
import RegularizationHistoryPanel from '../components/RegularizationHistoryPanel';
import { SalaryComponentsView } from '../components/SalaryComponentsView';
import { USER_NAV as NAV } from '../navConfig';
import { appYear } from '../utils';

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

export function UserHome() {
  const year = appYear();
  const { data, error, loading, reload } = useLoad(
    () =>
      Promise.all([
        api('/balances/me').then((d) => d.balances),
        api(`/leaves?from=${year}-01-01&to=${year}-12-31`).then((d) => d.leaves),
        api('/reports/overview?lite=1'),
      ]).then(([balances, leaves, report]) => ({ balances, leaves, report })),
    [year]
  );

  const balances = data?.balances;
  const leaves = data?.leaves;
  const report = data?.report;

  function reloadAll() {
    reload();
  }

  return (
    <AppShell title="Dashboard" nav={NAV}>
      <EmployeeDashboard
        balances={balances}
        leaves={leaves}
        report={report}
        loading={loading}
        error={error}
        calendarTo="/app/history"
        holidaysTo="/app/attendance"
        attendanceTo="/app/attendance"
        canApplyRestricted
        onRestrictedApplied={reloadAll}
      />
    </AppShell>
  );
}

export function UserAttendance() {
  return (
    <AppShell title="My Attendance" nav={NAV}>
      <MyAttendanceHub />
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
    <AppShell title="Apply Leave" nav={NAV}>
      <LeaveBalanceDashboard />
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
