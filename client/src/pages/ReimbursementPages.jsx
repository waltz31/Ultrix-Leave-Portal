import AppShell from '../components/AppShell';
import ReimbursementBoard from '../components/ReimbursementBoard';
import { useAuth } from '../auth';

const USER_NAV = [
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

const MANAGER_NAV = [
  { to: '/manager', label: 'Overview', end: true, icon: '/assets/nav-searchlist.png' },
  { to: '/feed', label: 'Feed', icon: '/assets/nav-onboarding.png' },
  { to: '/manager/attendance', label: 'Attendance', icon: '/assets/nav-hourglass.png' },
  { to: '/manager/regularization', label: 'Regularization', icon: '/assets/nav-approved.png' },
  { to: '/manager/apply', label: 'Apply', icon: '/assets/nav-apply.png' },
  { to: '/manager/approvals', label: 'Approvals', icon: '/assets/nav-approved.png' },
  { to: '/manager/reimbursements', label: 'Reimbursement', icon: '/assets/nav-searchlist.png' },
  { to: '/manager/ratings', label: 'Ratings', icon: '/assets/rating-star.png' },
  { to: '/manager/salary', label: 'Salary', icon: '/assets/nav-searchlist.png' },
  { to: '/manager/invoices', label: 'Invoices', icon: '/assets/nav-searchlist.png' },
  { to: '/manager/calendar', label: 'Team calendar', icon: '/assets/nav-calendar.png' },
  { to: '/manager/history', label: 'History', icon: '/assets/nav-hourglass.png' },
];

const HR_NAV = [
  { to: '/hr', label: 'Overview', end: true, icon: '/assets/nav-searchlist.png' },
  { to: '/feed', label: 'Feed', icon: '/assets/nav-onboarding.png' },
  { to: '/hr/attendance', label: 'Attendance', icon: '/assets/nav-hourglass.png' },
  { to: '/hr/regularization', label: 'Regularization', icon: '/assets/nav-approved.png' },
  { to: '/hr/approvals', label: 'HR approvals', icon: '/assets/nav-approved.png' },
  { to: '/hr/reimbursements', label: 'Reimbursement', icon: '/assets/nav-searchlist.png' },
  { to: '/hr/onboarding', label: 'Onboarding', icon: '/assets/nav-onboarding.png' },
  { to: '/hr/users', label: 'Leave Management', icon: '/assets/nav-team.png' },
  { to: '/hr/ratings', label: 'Ratings', icon: '/assets/rating-star.png' },
  { to: '/hr/invoices', label: 'Invoices', icon: '/assets/nav-searchlist.png' },
  { to: '/hr/calendar', label: 'Team calendar', icon: '/assets/nav-calendar.png' },
  { to: '/hr/history', label: 'History', icon: '/assets/nav-hourglass.png' },
];

export function UserReimbursements() {
  const { user } = useAuth();
  return (
    <AppShell title={`Reimbursement · ${user?.name || ''}`} nav={USER_NAV}>
      <ReimbursementBoard mode="self" />
    </AppShell>
  );
}

export function ManagerReimbursements() {
  const { user } = useAuth();
  return (
    <AppShell title={`Reimbursement · ${user?.name || ''}`} nav={MANAGER_NAV}>
      <ReimbursementBoard mode="self" />
    </AppShell>
  );
}

export function HrReimbursements() {
  const { user } = useAuth();
  return (
    <AppShell title={`Reimbursement · ${user?.name || ''}`} nav={HR_NAV}>
      <ReimbursementBoard mode="hr" />
    </AppShell>
  );
}
