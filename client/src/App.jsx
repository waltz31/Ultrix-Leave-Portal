import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { ThemeProvider } from './theme';
import LoginPage from './pages/LoginPage';
import {
  HrApprovals,
  HrAttendance,
  HrCalendar,
  HrFeed,
  HrHistory,
  HrOnboarding,
  HrOverview,
  HrRegularization,
  HrUsers,
} from './pages/HrPages';
import {
  ManagerApprovals,
  ManagerApply,
  ManagerAttendance,
  ManagerCalendar,
  ManagerFeed,
  ManagerHistory,
  ManagerOverview,
  ManagerRegularization,
  ManagerSalary,
} from './pages/ManagerPages';
import { UserApply, UserAttendance, UserCalendar, UserFeed, UserHistory, UserHome, UserSalary } from './pages/UserPages';
import { UserRatings, ManagerRatings, HrRatings } from './pages/RatingsPages';
import { EmployeeInvoices, ManagerInvoices, HrInvoices } from './pages/InvoicePages';
import {
  UserReimbursements,
  ManagerReimbursements,
  HrReimbursements,
} from './pages/ReimbursementPages';
import { homePathForRole } from './utils';

function Protected({ role, children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="boot">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (role && user.role !== role) {
    return <Navigate to={homePathForRole(user.role)} replace />;
  }
  return children;
}

function HomeRedirect() {
  const { user, loading } = useAuth();
  if (loading) return <div className="boot">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={homePathForRole(user.role)} replace />;
}

function FeedScreen() {
  const { user } = useAuth();
  if (user?.role === 'hr') return <HrFeed />;
  if (user?.role === 'manager') return <ManagerFeed />;
  return <UserFeed />;
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<HomeRedirect />} />

          {/* Legacy admin URLs → HR */}
          <Route path="/admin/*" element={<Navigate to="/hr" replace />} />

          <Route
            path="/hr"
            element={
              <Protected role="hr">
                <HrOverview />
              </Protected>
            }
          />
          <Route path="/hr/apply" element={<Navigate to="/hr" replace />} />
          <Route path="/hr/salary" element={<Navigate to="/hr" replace />} />
          <Route
            path="/feed"
            element={
              <Protected>
                <FeedScreen />
              </Protected>
            }
          />
          <Route path="/hr/feed" element={<Navigate to="/feed" replace />} />
          <Route path="/manager/feed" element={<Navigate to="/feed" replace />} />
          <Route path="/app/feed" element={<Navigate to="/feed" replace />} />
          <Route
            path="/hr/approvals"
            element={
              <Protected role="hr">
                <HrApprovals />
              </Protected>
            }
          />
          <Route
            path="/hr/attendance"
            element={
              <Protected role="hr">
                <HrAttendance />
              </Protected>
            }
          />
          <Route
            path="/hr/regularization"
            element={
              <Protected role="hr">
                <HrRegularization />
              </Protected>
            }
          />
          <Route
            path="/hr/onboarding"
            element={
              <Protected role="hr">
                <HrOnboarding />
              </Protected>
            }
          />
          <Route
            path="/hr/users"
            element={
              <Protected role="hr">
                <HrUsers />
              </Protected>
            }
          />
          <Route
            path="/hr/calendar"
            element={
              <Protected role="hr">
                <HrCalendar />
              </Protected>
            }
          />
          <Route
            path="/hr/history"
            element={
              <Protected role="hr">
                <HrHistory />
              </Protected>
            }
          />
          <Route
            path="/hr/ratings"
            element={
              <Protected role="hr">
                <HrRatings />
              </Protected>
            }
          />
          <Route path="/hr/reports" element={<Navigate to="/hr" replace />} />

          <Route
            path="/hr/invoices"
            element={
              <Protected role="hr">
                <HrInvoices />
              </Protected>
            }
          />
          <Route
            path="/hr/reimbursements"
            element={
              <Protected role="hr">
                <HrReimbursements />
              </Protected>
            }
          />

          <Route
            path="/manager"
            element={
              <Protected role="manager">
                <ManagerOverview />
              </Protected>
            }
          />
          <Route
            path="/manager/attendance"
            element={
              <Protected role="manager">
                <ManagerAttendance />
              </Protected>
            }
          />
          <Route
            path="/manager/regularization"
            element={
              <Protected role="manager">
                <ManagerRegularization />
              </Protected>
            }
          />
          <Route
            path="/manager/apply"
            element={
              <Protected role="manager">
                <ManagerApply />
              </Protected>
            }
          />
          <Route
            path="/manager/approvals"
            element={
              <Protected role="manager">
                <ManagerApprovals />
              </Protected>
            }
          />
          <Route
            path="/manager/calendar"
            element={
              <Protected role="manager">
                <ManagerCalendar />
              </Protected>
            }
          />
          <Route
            path="/manager/history"
            element={
              <Protected role="manager">
                <ManagerHistory />
              </Protected>
            }
          />
          <Route
            path="/manager/ratings"
            element={
              <Protected role="manager">
                <ManagerRatings />
              </Protected>
            }
          />
          <Route path="/manager/reports" element={<Navigate to="/manager" replace />} />
          <Route
            path="/manager/salary"
            element={
              <Protected role="manager">
                <ManagerSalary />
              </Protected>
            }
          />
          <Route
            path="/manager/invoices"
            element={
              <Protected role="manager">
                <ManagerInvoices />
              </Protected>
            }
          />
          <Route
            path="/manager/reimbursements"
            element={
              <Protected role="manager">
                <ManagerReimbursements />
              </Protected>
            }
          />

          <Route
            path="/app"
            element={
              <Protected role="user">
                <UserHome />
              </Protected>
            }
          />
          <Route
            path="/app/attendance"
            element={
              <Protected role="user">
                <UserAttendance />
              </Protected>
            }
          />
          <Route
            path="/app/apply"
            element={
              <Protected role="user">
                <UserApply />
              </Protected>
            }
          />
          <Route
            path="/app/calendar"
            element={
              <Protected role="user">
                <UserCalendar />
              </Protected>
            }
          />
          <Route
            path="/app/salary"
            element={
              <Protected role="user">
                <UserSalary />
              </Protected>
            }
          />
          <Route
            path="/app/history"
            element={
              <Protected role="user">
                <UserHistory />
              </Protected>
            }
          />
          <Route
            path="/app/ratings"
            element={
              <Protected role="user">
                <UserRatings />
              </Protected>
            }
          />
          <Route
            path="/app/invoices"
            element={
              <Protected role="user">
                <EmployeeInvoices />
              </Protected>
            }
          />
          <Route
            path="/app/reimbursements"
            element={
              <Protected role="user">
                <UserReimbursements />
              </Protected>
            }
          />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </ThemeProvider>
  );
}
