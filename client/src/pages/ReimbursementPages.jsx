import AppShell from '../components/AppShell';
import ReimbursementBoard from '../components/ReimbursementBoard';
import { useAuth } from '../auth';
import { HR_NAV, MANAGER_NAV, USER_NAV } from '../navConfig';

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
      <ReimbursementBoard mode="manager" />
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
