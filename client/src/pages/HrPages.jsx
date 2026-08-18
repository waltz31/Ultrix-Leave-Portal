import { Link } from 'react-router-dom';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import AppShell from '../components/AppShell';
import LeaveCalendar from '../components/LeaveCalendar';
import ApprovalProgress from '../components/ApprovalProgress';
import StatusCelebration from '../components/StatusCelebration';
import { LeaveExportPanel, LeaveReportSection } from '../components/LeaveReports';
import OnboardingIdCard from '../components/OnboardingIdCard';
import OverviewPanels from '../components/OverviewPanels';
import HrEmployeeBalanceDirectory from '../components/HrEmployeeBalanceDirectory';
import CompanyFeed from '../components/CompanyFeed';
import EmployeeOnboardingForm, {
  ASSET_CATEGORY_OPTIONS,
  EMPTY_ASSET,
  EMPTY_ONBOARDING_FORM,
  EMPLOYMENT_STATUS_OPTIONS,
  EMPLOYMENT_TYPE_OPTIONS,
  GENDER_OPTIONS,
  MARITAL_STATUS_OPTIONS,
  PORTAL_ROLE_OPTIONS,
  WORK_MODE_OPTIONS,
  profileToForm,
} from '../components/EmployeeOnboardingForm';
import {
  SALARY_SENSITIVE_FIELDS,
  formatPayrollValue,
  payStructureKind,
  payrollFieldsFor,
} from '../components/SalaryComponentsView';
import { APPLY_LABELS, LEAVE_LABELS, REQUEST_LABELS, ROLE_LABELS, SESSION_LABELS, STATUS_LABELS, appToday, avatarSrc, formatDate, formatDateTime, formatLeaveSpan, isWfh, managerOptionLabel } from '../utils';
import { buildHolidayTemplateRows, HOLIDAY_UPLOAD_ACCEPT, parseHolidayFile } from '../holidayImport';
import * as XLSX from 'xlsx';

const NAV = [
  { to: '/hr', label: 'Overview', end: true, icon: '/assets/nav-searchlist.png' },
  { to: '/hr/feed', label: 'Feed', icon: '/assets/nav-onboarding.png' },
  { to: '/hr/approvals', label: 'HR approvals', icon: '/assets/nav-approved.png' },
  { to: '/hr/onboarding', label: 'Onboarding', icon: '/assets/nav-onboarding.png' },
  { to: '/hr/users', label: 'Leave Management', icon: '/assets/nav-team.png' },
  { to: '/hr/ratings', label: 'Ratings', icon: '/assets/rating-star.png' },
  { to: '/hr/invoices', label: 'Invoices', icon: '/assets/nav-searchlist.png' },
  { to: '/hr/calendar', label: 'Team calendar', icon: '/assets/nav-calendar.png' },
  { to: '/hr/history', label: 'History', icon: '/assets/nav-hourglass.png' },
];

function portalRoleLabel(role) {
  if (role === 'hr') return 'HR';
  if (role === 'manager') return 'Manager';
  return 'Employee';
}

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

export function HrOverview() {
  const { user } = useAuth();
  const { data: stats, error, loading } = useLoad(() => api('/dashboard/stats'));
  const { data: report } = useLoad(() => api('/reports/overview'));

  return (
    <AppShell title={`Welcome ${user?.name || ''}`} nav={NAV}>
      {loading && <p className="muted">Loading…</p>}
      {error && <p className="form-error">{error}</p>}
      {stats && (
        <div className="stat-row four">
          <Link to="/hr/approvals" className="stat stat-link">
            <span>Awaiting your approval</span>
            <strong>{stats.pendingHr}</strong>
          </Link>
          <Link to="/hr/history" className="stat stat-link">
            <span>With managers</span>
            <strong>{stats.pendingManager}</strong>
          </Link>
          <Link to="/hr/users" className="stat stat-link">
            <span>Employees</span>
            <strong>{stats.users}</strong>
          </Link>
          <Link to="/hr/calendar" className="stat stat-link">
            <span>On leave / WFH today</span>
            <strong>{Number(stats.onLeaveToday || 0) + Number(stats.onWfhToday || 0)}</strong>
          </Link>
        </div>
      )}

      <OverviewPanels
        todayOnLeave={report?.todayOnLeave || []}
        teamTitle="Team on leave"
        calendarTo="/hr/calendar"
        holidaysTo="/hr/calendar"
        canApplyRestricted
      />

      <LeaveReportSection />
      <LeaveExportPanel />

    </AppShell>
  );
}

export function HrFeed() {
  return (
    <AppShell title="Feed" nav={NAV}>
      <CompanyFeed />
    </AppShell>
  );
}

export function HrApprovals() {
  const { data, error, loading, reload } = useLoad(() =>
    api('/leaves?status=pending_hr').then((d) => d.leaves)
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
    <AppShell title="HR approvals" nav={NAV}>
      <StatusCelebration
        show={celebrate}
        onDone={() => setCelebrate(false)}
        message="Leave approved!"
        detail="Balance updated (if applicable)."
        imageSrc="/assets/leave-approved.gif"
        durationMs={2800}
      />
      {loading && <p className="muted">Loading…</p>}
      {error && <p className="form-error">{error}</p>}
      {!loading && data?.length === 0 && <p className="empty">No requests awaiting HR.</p>}
      <div className="stack tight">
        {(data || []).map((leave) => (
          <section key={leave.id} className="panel">
            <div className="row-between">
              <div>
                <strong className="employee-name">{leave.userName}</strong>
                <div className="sub">{leave.userEmail}</div>
              </div>
              <button type="button" className="btn review-hr" onClick={() => openReview(leave)}>
                Review
              </button>
            </div>
            <p>
              <span className={`badge type-${leave.leaveType}`}>
                {REQUEST_LABELS[leave.leaveType]}
              </span>{' '}
              {formatLeaveSpan(leave)}
            </p>
            <ApprovalProgress leave={leave} />
          </section>
        ))}
      </div>

      {active && (
        <div className="modal-backdrop" onClick={() => setActive(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>
              HR review — {active.userName} ({isWfh(active.leaveType) ? 'WFH' : 'leave'})
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
                HR note
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
                Cancel
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
                Final approve
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

function reportingManagerName(profile, managers) {
  if (profile?.managerName) return profile.managerName;
  const match = (managers || []).find((m) => String(m.id) === String(profile?.managerId));
  if (match) return managerOptionLabel(match);
  return 'Unassigned';
}

function ProfileFacts({ items }) {
  return (
    <dl className="profile-facts">
      {items.map((item) => (
        <div key={item.label} className={item.wide ? 'is-wide' : undefined}>
          <dt>{item.label}</dt>
          <dd>{item.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

function ProfileCardMenu({ items = [] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function onDocClick(event) {
      if (!ref.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  if (!items.length) return null;

  return (
    <div className="profile-card-menu" ref={ref}>
      <button
        type="button"
        className="profile-card-more"
        aria-label="Profile actions"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>
      {open && (
        <div className="profile-card-dropdown" role="menu">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={item.danger ? 'danger' : undefined}
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function HrOnboarding() {
  const { data: profiles, error, loading, reload } = useLoad(() =>
    api('/onboarding').then((d) => d.profiles)
  );
  const { data: managers, reload: reloadManagers } = useLoad(() =>
    api('/managers').then((d) => d.managers)
  );
  const [form, setForm] = useState(() => ({
    ...EMPTY_ONBOARDING_FORM,
    assets: [{ ...EMPTY_ASSET }],
  }));
  const [showForm, setShowForm] = useState(false);
  const [editingUserId, setEditingUserId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [selected, setSelected] = useState(null);
  const [createdNotice, setCreatedNotice] = useState(null);
  const [bulkResult, setBulkResult] = useState(null);

  function blankForm() {
    return { ...EMPTY_ONBOARDING_FORM, assets: [{ ...EMPTY_ASSET }] };
  }

  async function deleteProfile(profile) {
    const name = profile?.name || 'this employee';
    const ok = window.confirm(
      `Delete ${name}? Their profile, leave history, balances, and notifications will be removed permanently.`
    );
    if (!ok) return;
    setBusy(true);
    setMsg('');
    setErr('');
    try {
      await api(`/users/${profile.userId}`, { method: 'DELETE' });
      setMsg(`${name} deleted.`);
      setSelected(null);
      setShowForm(false);
      setEditingUserId(null);
      reload();
    } catch (error) {
      setErr(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveProfile(e) {
    e.preventDefault();
    setBusy(true);
    setMsg('');
    setErr('');
    try {
      const body = {
        ...form,
        managerId: form.managerId ? Number(form.managerId) : null,
        assets: form.assets || [],
      };
      if (editingUserId) {
        if (!body.password) delete body.password;
        const { profile } = await api(`/onboarding/${editingUserId}`, {
          method: 'PATCH',
          body,
        });
        setSelected(profile);
        setMsg(`${portalRoleLabel(form.role)} profile updated.`);
      } else {
        const { profile, credentials } = await api('/onboarding', {
          method: 'POST',
          body,
        });
        setCreatedNotice({
          name: profile?.name || form.name || portalRoleLabel(form.role),
          email: credentials?.email || profile?.email || '',
          password: credentials?.password || '',
          emailGenerated: Boolean(credentials?.emailGenerated),
          passwordGenerated: Boolean(credentials?.passwordGenerated),
          role: form.role,
        });
        setMsg(`${portalRoleLabel(form.role)} profile created.`);
      }
      setForm(blankForm());
      setShowForm(false);
      setEditingUserId(null);
      reload();
      reloadManagers();
    } catch (error) {
      setErr(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function bulkImportEmployees(result) {
    const created = result?.created || [];
    const failed = result?.failed || [];
    setShowForm(false);
    setEditingUserId(null);
    setForm(blankForm());
    setBulkResult({ created, failed });
    if (created.length && !failed.length) {
      setMsg(
        `Imported ${created.length} employee${created.length === 1 ? '' : 's'} from the ${
          result.fileType === 'csv' ? 'CSV' : 'Excel'
        } file.`
      );
      setErr('');
    } else if (created.length) {
      setMsg(
        `Imported ${created.length} employee${created.length === 1 ? '' : 's'}. ${failed.length} row${failed.length === 1 ? '' : 's'} failed.`
      );
      setErr('');
    } else {
      setMsg('');
      setErr(failed[0]?.error || 'No employees could be imported from that file.');
    }
    reload();
    reloadManagers();
  }

  function openCreate(role = 'user') {
    setErr('');
    setMsg('');
    setBulkResult(null);
    setEditingUserId(null);
    setForm({
      ...blankForm(),
      role: role === 'manager' ? 'manager' : 'user',
    });
    setShowForm(true);
  }

  async function assignReportingTo(profile, managerIdValue) {
    setBusy(true);
    setMsg('');
    setErr('');
    try {
      const { user } = await api(`/users/${profile.userId}`, {
        method: 'PATCH',
        body: { managerId: managerIdValue ? Number(managerIdValue) : null },
      });
      setMsg(`Reporting to updated for ${profile.name}.`);
      setSelected((current) =>
        current?.userId === profile.userId
          ? {
              ...current,
              managerId: user?.managerId ?? null,
              managerName: user?.managerName ?? null,
              managerEmail: user?.managerEmail ?? null,
            }
          : current
      );
      reload();
    } catch (error) {
      setErr(error.message);
    } finally {
      setBusy(false);
    }
  }

  function openEdit(profile) {
    setErr('');
    setMsg('');
    setSelected(null);
    setEditingUserId(profile.userId);
    setForm(profileToForm(profile));
    setShowForm(true);
  }

  function labelFrom(options, value) {
    return options.find((o) => o.value === value)?.label || value || '—';
  }

  return (
    <AppShell title="Onboarding" nav={NAV}>
      <StatusCelebration
        show={Boolean(createdNotice)}
        onDone={() => setCreatedNotice(null)}
        message={createdNotice?.role === 'manager' ? 'Manager created!' : 'Employee created!'}
        detail={
          createdNotice?.email
            ? `${createdNotice.name} can log in with the credentials below.`
            : createdNotice?.name
              ? `${createdNotice.name} has been added to the portal.`
              : ''
        }
        credentials={
          createdNotice?.email
            ? {
                email: createdNotice.email,
                password: createdNotice.password,
                emailGenerated: createdNotice.emailGenerated,
                passwordGenerated: createdNotice.passwordGenerated,
              }
            : null
        }
        imageSrc="/assets/leave-approved.gif"
        durationMs={createdNotice?.password ? 12000 : 2800}
      />
      <div className="page-actions">
        <div className="page-actions-buttons">
          <button type="button" className="btn secondary" onClick={() => openCreate('manager')}>
            + Add manager
          </button>
          <button type="button" className="btn primary" onClick={() => openCreate('user')}>
            + Create employee profile
          </button>
        </div>
      </div>
      {(msg || err) && !showForm && (
        <p className={err ? 'form-error' : 'form-ok'}>{err || msg}</p>
      )}
      {bulkResult && (
        <div className="modal-backdrop" onClick={() => setBulkResult(null)}>
          <div
            className="modal modal-wide"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="row-between">
              <h2>Spreadsheet import</h2>
              <button type="button" className="btn ghost" onClick={() => setBulkResult(null)}>
                Close
              </button>
            </div>
            <p className={bulkResult.failed.length ? 'form-error' : 'form-ok'}>
              {bulkResult.created.length} created
              {bulkResult.failed.length ? `, ${bulkResult.failed.length} failed` : ''}.
            </p>
            {!!bulkResult.created.length && (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Row</th>
                      <th>Name</th>
                      <th>Login email</th>
                      <th>Password</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bulkResult.created.map((row) => (
                      <tr key={`ok-${row.row}-${row.email}`}>
                        <td>{row.row}</td>
                        <td>{row.name}</td>
                        <td>{row.email || '—'}</td>
                        <td>{row.password || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {!!bulkResult.failed.length && (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Row</th>
                      <th>Name</th>
                      <th>Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bulkResult.failed.map((row) => (
                      <tr key={`fail-${row.row}-${row.name}`}>
                        <td>{row.row}</td>
                        <td>{row.name}</td>
                        <td>{row.error}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
      {loading && <p className="muted">Loading…</p>}
      {error && <p className="form-error">{error}</p>}

      <section className="panel">
        <h2>Employee &amp; manager profiles</h2>
        {!loading && !profiles?.length && (
          <p className="empty">No onboarded employees yet. Create a profile to get started.</p>
        )}
        {!!profiles?.length && (
          <div className="id-badge-grid">
            {profiles.map((p) => (
              <OnboardingIdCard
                key={p.userId}
                profile={p}
                selected={selected?.userId === p.userId && !showForm}
                managerName={
                  p.managerId || p.managerName ? reportingManagerName(p, managers) : 'Unassigned'
                }
                menu={
                  <ProfileCardMenu
                    items={[
                      { label: 'View profile', onClick: () => setSelected(p) },
                      { label: 'Edit', onClick: () => openEdit(p) },
                      ...(p.role !== 'manager'
                        ? [{ label: 'Delete', onClick: () => deleteProfile(p), danger: true }]
                        : []),
                    ]}
                  />
                }
              />
            ))}
          </div>
        )}
      </section>

      {showForm && (
        <div className="modal-backdrop modal-backdrop-static">
          <div
            className="modal modal-wide profile-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="onboarding-title"
          >
            <div className="profile-sheet-toolbar">
              <div>
                <p className="profile-sheet-kicker">
                  {editingUserId ? 'Edit profile' : 'New profile'}
                </p>
                <h2 id="onboarding-title">
                  {editingUserId
                    ? form.name || portalRoleLabel(form.role)
                    : `Create ${portalRoleLabel(form.role).toLowerCase()} profile`}
                </h2>
              </div>
              <div className="row-actions">
                {editingUserId && (
                  <button
                    type="button"
                    className="btn ghost-danger"
                    onClick={() => {
                      const profile = (profiles || []).find((p) => p.userId === editingUserId);
                      if (profile) deleteProfile(profile);
                    }}
                    disabled={busy}
                  >
                    Delete
                  </button>
                )}
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => {
                    setShowForm(false);
                    setEditingUserId(null);
                  }}
                  disabled={busy}
                >
                  Close
                </button>
              </div>
            </div>
            {err && <p className="form-error">{err}</p>}
            <EmployeeOnboardingForm
              form={form}
              setForm={setForm}
              managers={managers}
              onSubmit={saveProfile}
              onBulkImport={editingUserId ? undefined : bulkImportEmployees}
              editingUserId={editingUserId}
              busy={busy}
              submitLabel={
                editingUserId ? 'Save changes' : `Create ${portalRoleLabel(form.role).toLowerCase()} profile`
              }
            />
          </div>
        </div>
      )}

      {selected && (
        <div className="modal-backdrop" onClick={() => setSelected(null)}>
          <div
            className="modal modal-wide profile-sheet"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="profile-sheet-toolbar">
              <p className="profile-sheet-kicker">View profile</p>
              <div className="row-actions">
                <button type="button" className="btn primary" onClick={() => openEdit(selected)}>
                  Edit
                </button>
                {selected.role !== 'manager' && (
                  <button
                    type="button"
                    className="btn ghost-danger"
                    onClick={() => deleteProfile(selected)}
                    disabled={busy}
                  >
                    Delete
                  </button>
                )}
                <button type="button" className="btn ghost" onClick={() => setSelected(null)}>
                  Close
                </button>
              </div>
            </div>

            <div className="profile-sheet-hero">
              <img
                className="profile-sheet-photo"
                src={avatarSrc(selected.personal.profilePhoto)}
                alt=""
              />
              <div className="profile-sheet-id">
                <h2>{selected.name}</h2>
                <p>{selected.email}</p>
                <p className="profile-sheet-role">{selected.employment.designation || '—'}</p>
                <div className="profile-sheet-chips">
                  <span>{selected.role === 'manager' ? 'Manager' : 'Employee'}</span>
                  {selected.employeeNumber ? <span>{selected.employeeNumber}</span> : null}
                  <span>
                    {labelFrom(EMPLOYMENT_STATUS_OPTIONS, selected.employment.employmentStatus)}
                  </span>
                </div>
                <label className="profile-sheet-manager">
                  Reporting manager
                  <select
                    className="reporting-to-select"
                    aria-label={`Reporting to for ${selected.name}`}
                    value={selected.managerId || ''}
                    disabled={busy}
                    onChange={(e) => assignReportingTo(selected, e.target.value)}
                  >
                    <option value="">Unassigned</option>
                    {(managers || [])
                      .filter(
                        (m) =>
                          String(m.id) !== String(selected.userId) && m.active !== false
                      )
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {managerOptionLabel(m)}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
            </div>

            <div className="profile-sheet-sections">
              <section className="profile-sheet-section">
                <h3>Personal</h3>
                <ProfileFacts
                  items={[
                    {
                      label: 'Date of birth',
                      value: selected.personal.dateOfBirth
                        ? formatDate(selected.personal.dateOfBirth)
                        : '—',
                    },
                    { label: 'Gender', value: labelFrom(GENDER_OPTIONS, selected.personal.gender) },
                    { label: 'Personal email', value: selected.personal.personalEmail || '—' },
                    { label: 'Mobile', value: selected.personal.personalMobile || '—' },
                    { label: 'Nationality', value: selected.personal.nationality || '—' },
                    {
                      label: 'Marital status',
                      value: labelFrom(MARITAL_STATUS_OPTIONS, selected.personal.maritalStatus),
                    },
                    { label: 'Address', value: selected.personal.address || '—', wide: true },
                    {
                      label: 'Emergency contact',
                      value: selected.personal.emergencyContact || '—',
                      wide: true,
                    },
                  ]}
                />
              </section>

              <section className="profile-sheet-section">
                <h3>Employment</h3>
                <ProfileFacts
                  items={[
                    {
                      label: 'Date of joining',
                      value: selected.employment.dateOfJoining
                        ? formatDate(selected.employment.dateOfJoining)
                        : '—',
                    },
                    {
                      label: 'Employment type',
                      value: labelFrom(EMPLOYMENT_TYPE_OPTIONS, selected.employment.employmentType),
                    },
                    { label: 'Department', value: selected.employment.department || '—' },
                    { label: 'Designation', value: selected.employment.designation || '—' },
                    { label: 'Job level', value: selected.employment.jobLevel || '—' },
                    { label: 'Role', value: labelFrom(PORTAL_ROLE_OPTIONS, selected.role) },
                    { label: 'Location', value: selected.employment.location || '—' },
                    {
                      label: 'Work mode',
                      value: labelFrom(WORK_MODE_OPTIONS, selected.employment.workMode),
                    },
                    {
                      label: 'Status',
                      value: labelFrom(EMPLOYMENT_STATUS_OPTIONS, selected.employment.employmentStatus),
                    },
                    { label: 'Probation', value: selected.employment.probationPeriod || '—' },
                    {
                      label: 'Confirmation date',
                      value: selected.employment.confirmationDate
                        ? formatDate(selected.employment.confirmationDate)
                        : '—',
                    },
                    { label: 'Work email', value: selected.email || '—' },
                  ]}
                />
              </section>

              <section className="profile-sheet-section is-wide">
                <h3>IT / Asset</h3>
                {!selected.assets?.length && !selected.it?.assetId && !selected.it?.laptopDesktopAssigned ? (
                  <p className="empty">No assets tagged.</p>
                ) : (
                  <div className="asset-detail-list">
                    {(selected.assets?.length
                      ? selected.assets
                      : [
                          {
                            assetCategory: 'laptop_desktop',
                            deviceAssigned: selected.it?.laptopDesktopAssigned,
                            assetId: selected.it?.assetId,
                            mobileNumber: selected.it?.companyMobile,
                            accessCard: selected.it?.accessCard,
                            issueDate: selected.it?.equipmentIssueDate,
                            returnDate: selected.it?.equipmentReturnDate,
                            softwareAccess: selected.it?.softwareAccessProvisioning,
                            companyEmail: selected.it?.companyEmailAccount,
                          },
                        ]
                    ).map((asset, idx) => (
                      <div className="asset-detail-card" key={asset.id || idx}>
                        <h4>
                          {ASSET_CATEGORY_OPTIONS.find((o) => o.value === asset.assetCategory)
                            ?.label || 'Asset'}{' '}
                          {selected.assets?.length > 1 ? `#${idx + 1}` : ''}
                        </h4>
                        <ProfileFacts
                          items={[
                            { label: 'Device / item', value: asset.deviceAssigned || '—' },
                            { label: 'Asset ID', value: asset.assetId || '—' },
                            { label: 'Mobile number', value: asset.mobileNumber || '—' },
                            { label: 'Access card', value: asset.accessCard || '—' },
                            {
                              label: 'Issue date',
                              value: asset.issueDate ? formatDate(asset.issueDate) : '—',
                            },
                            {
                              label: 'Return date',
                              value: asset.returnDate ? formatDate(asset.returnDate) : '—',
                            },
                            {
                              label: 'Software / access',
                              value: asset.softwareAccess || '—',
                              wide: true,
                            },
                            {
                              label: 'Company email / account',
                              value: asset.companyEmail || '—',
                              wide: true,
                            },
                          ]}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="profile-sheet-section is-wide">
                <h3>Payroll &amp; salary</h3>
                <ProfileFacts
                  items={[
                    ...payrollFieldsFor(selected.employment?.employmentType).map((f) => ({
                      label: f.label,
                      value: formatPayrollValue(f, selected.payroll),
                    })),
                    ...(payStructureKind(selected.employment?.employmentType) === 'employee'
                      ? SALARY_SENSITIVE_FIELDS.map((f) => ({
                          label: f.label,
                          value: selected.payroll?.[f.key] || '—',
                          wide: true,
                        }))
                      : []),
                  ]}
                />
              </section>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

export function HrUsers() {
  const { data, error, loading, reload } = useLoad(() =>
    api('/users').then((d) => d.users)
  );
  const {
    data: managers,
    error: managersError,
    loading: managersLoading,
    reload: reloadManagers,
  } = useLoad(() => api('/managers').then((d) => d.managers));
  const {
    data: creditLog,
    reload: reloadCredits,
  } = useLoad(() => api('/balances/credits').then((d) => d.credits));
  const [creditForm, setCreditForm] = useState({
    userId: '',
    leaveType: 'casual',
    amount: 1,
    note: '',
  });
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [creditPopup, setCreditPopup] = useState(null);

  async function creditBalance(e) {
    e.preventDefault();
    setMsg('');
    setErr('');
    try {
      const employee = (data || []).find((u) => String(u.id) === String(creditForm.userId));
      await api('/balances/credit', {
        method: 'POST',
        body: {
          userId: Number(creditForm.userId),
          leaveType: creditForm.leaveType,
          amount: Number(creditForm.amount),
          note: creditForm.note,
        },
      });
      const typeLabel = LEAVE_LABELS[creditForm.leaveType] || creditForm.leaveType;
      const days = Number(creditForm.amount);
      setCreditPopup({
        message: 'Leaves credited',
        detail: `${days} ${typeLabel} leave day${days === 1 ? '' : 's'} credited to ${
          employee?.name || 'employee'
        }'s account.`,
      });
      setMsg('Balance credited.');
      setCreditForm((f) => ({ ...f, amount: 1, note: '' }));
      reload();
      reloadCredits();
    } catch (error) {
      setErr(error.message);
    }
  }

  async function assignManagerReportingTo(mgr, managerIdValue) {
    setMsg('');
    setErr('');
    try {
      await api(`/users/${mgr.id}`, {
        method: 'PATCH',
        body: { managerId: managerIdValue ? Number(managerIdValue) : null },
      });
      setMsg(`Reporting to updated for ${mgr.name}.`);
      reloadManagers();
      reload();
    } catch (error) {
      setErr(error.message);
    }
  }

  async function toggleActive(user) {
    try {
      await api(`/users/${user.id}`, {
        method: 'PATCH',
        body: { active: !user.active },
      });
      reload();
      reloadManagers();
    } catch (error) {
      setErr(error.message);
    }
  }

  async function deleteEmployee(user) {
    const ok = window.confirm(
      `Delete ${user.name}? Their leave history, balances, and notifications will be removed permanently.`
    );
    if (!ok) return;
    setMsg('');
    setErr('');
    try {
      await api(`/users/${user.id}`, { method: 'DELETE' });
      setMsg(`${user.name} deleted.`);
      if (String(creditForm.userId) === String(user.id)) {
        setCreditForm((f) => ({ ...f, userId: '' }));
      }
      reload();
    } catch (error) {
      setErr(error.message);
    }
  }

  return (
    <AppShell title="Leave Management" nav={NAV}>
      <StatusCelebration
        show={Boolean(creditPopup)}
        onDone={() => setCreditPopup(null)}
        message={creditPopup?.message || 'Leaves credited'}
        detail={creditPopup?.detail || ''}
        imageSrc="/assets/balance-credited.gif"
        durationMs={3200}
      />
      {(msg || err) && <p className={err ? 'form-error' : 'form-ok'}>{err || msg}</p>}
      {loading && <p className="muted">Loading…</p>}
      {error && <p className="form-error">{error}</p>}
      {managersError && <p className="form-error">{managersError}</p>}

      <div className="leave-mgmt-stack">
      <section className="panel leave-mgmt-credit">
        <div className="leave-credit-head">
          <p className="leave-credit-kicker">Leave balances</p>
          <h2>Credit leave balance</h2>
        </div>
        <form className="leave-credit-form" onSubmit={creditBalance}>
          <label>
            Employee
            <select
              value={creditForm.userId}
              onChange={(e) => setCreditForm((f) => ({ ...f, userId: e.target.value }))}
              required
            >
              <option value="">Select…</option>
              {(data || []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                  {u.role === 'manager' ? ' (manager)' : u.role === 'hr' ? ' (HR)' : ''}
                  {u.active ? '' : ' (inactive)'}
                </option>
              ))}
            </select>
          </label>
          <label className={`leave-credit-type is-${creditForm.leaveType}`}>
            Type
            <select
              value={creditForm.leaveType}
              onChange={(e) => setCreditForm((f) => ({ ...f, leaveType: e.target.value }))}
            >
              {Object.entries(LEAVE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            Days
            <input
              type="number"
              min="0.5"
              step="0.5"
              value={creditForm.amount}
              onChange={(e) => setCreditForm((f) => ({ ...f, amount: e.target.value }))}
              required
            />
          </label>
          <label className="leave-credit-note">
            Note (optional)
            <input
              value={creditForm.note}
              onChange={(e) => setCreditForm((f) => ({ ...f, note: e.target.value }))}
              placeholder="Reason for credit"
            />
          </label>
          <div className="leave-credit-actions">
            <button className="btn primary" type="submit">
              Credit balance
            </button>
          </div>
        </form>
      </section>

      <section className="panel leave-mgmt-managers">
        <h2>Managers &amp; HR</h2>
        {managersLoading && <p className="muted">Loading managers…</p>}
        {!managersLoading && !managers?.length && (
          <p className="empty">
            No managers or HR users yet. Add them from <Link to="/hr/onboarding">Onboarding</Link>.
          </p>
        )}
        {!!managers?.length && (
          <div className="profile-card-grid">
            {managers.map((mgr) => (
              <article
                key={mgr.id}
                className={`profile-card ${mgr.active ? '' : 'is-inactive'}`}
              >
                <img
                  className="profile-card-photo"
                  src={avatarSrc(mgr.profilePhoto)}
                  alt=""
                />
                <div className="profile-card-body">
                  <div className="profile-card-head">
                    <h3 className="profile-card-name">{mgr.name}</h3>
                    <ProfileCardMenu
                      items={[
                        {
                          label: mgr.active ? 'Deactivate' : 'Activate',
                          onClick: () => toggleActive(mgr),
                        },
                      ]}
                    />
                  </div>
                  <p className="profile-card-email">{mgr.email}</p>
                  <p className="profile-card-designation">
                    {mgr.designation || ROLE_LABELS[mgr.role] || mgr.role}
                  </p>
                  <p className="profile-card-manager">
                    {mgr.managerId || mgr.managerName
                      ? `Reports to ${reportingManagerName(mgr, managers)}`
                      : 'No reporting manager'}
                  </p>
                  <label className="profile-card-assign">
                    Reporting manager
                    <select
                      className="reporting-to-select"
                      aria-label={`Reporting to for ${mgr.name}`}
                      value={mgr.managerId || ''}
                      onChange={(e) => assignManagerReportingTo(mgr, e.target.value)}
                    >
                      <option value="">Unassigned</option>
                      {(managers || [])
                        .filter((m) => String(m.id) !== String(mgr.id) && m.active !== false)
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {managerOptionLabel(m)}
                          </option>
                        ))}
                    </select>
                  </label>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <HrEmployeeBalanceDirectory
        users={data || []}
        empty={
          !loading ? (
            <p className="empty">
              No employees yet. Add them from <Link to="/hr/onboarding">Onboarding</Link>.
            </p>
          ) : null
        }
        renderMenu={(user) => (
          <ProfileCardMenu
            items={[
              {
                label: user.active ? 'Deactivate' : 'Activate',
                onClick: () => toggleActive(user),
              },
              {
                label: 'Delete',
                onClick: () => deleteEmployee(user),
                danger: true,
              },
            ]}
          />
        )}
      />

      <section className="panel">
        <h2>Credit history</h2>
        {!creditLog?.length && <p className="empty">No credits recorded yet.</p>}
        {!!creditLog?.length && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Employee</th>
                  <th>Type</th>
                  <th>Days</th>
                  <th>Credited by</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {creditLog.map((row) => (
                  <tr key={row.id}>
                    <td>{formatDateTime(row.createdAt)}</td>
                    <td>
                      <strong className="employee-name">{row.userName}</strong>
                      <div className="sub">{row.userEmail}</div>
                    </td>
                    <td>
                      <span className={`badge type-${row.leaveType}`}>
                        {LEAVE_LABELS[row.leaveType] || row.leaveType}
                      </span>
                    </td>
                    <td>{row.amount}</td>
                    <td>{row.creditedByName}</td>
                    <td>{row.note || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      </div>
    </AppShell>
  );
}

export function HrCalendar() {
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
  const [busyId, setBusyId] = useState(null);
  const [err, setErr] = useState('');
  const [mandatoryForm, setMandatoryForm] = useState({
    title: '',
    startDate: '',
    endDate: '',
    note: '',
    holidayType: 'general',
  });
  const [mandatoryBusy, setMandatoryBusy] = useState(false);
  const [mandatoryMsg, setMandatoryMsg] = useState('');
  const [uploadBusy, setUploadBusy] = useState(false);

  async function createLeave(body) {
    await api('/leaves/admin', { method: 'POST', body });
    reload();
  }

  async function deleteLeave(leave) {
    setBusyId(leave.id);
    setErr('');
    try {
      if (leave.isMandatory) {
        if (leave.leaveType === 'restricted' || leave.holidayType === 'restricted') {
          setErr(
            'Restricted holidays stay in Overview for applying. They appear on a calendar only after a leave request is approved.'
          );
          return false;
        }
        await api(`/mandatory-leaves/${leave.mandatoryId}`, { method: 'DELETE' });
      } else {
        await api(`/leaves/${leave.id}`, { method: 'DELETE' });
      }
      reload();
      return true;
    } catch (error) {
      setErr(error.message);
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function submitMandatory(e) {
    e.preventDefault();
    setMandatoryBusy(true);
    setMandatoryMsg('');
    setErr('');
    try {
      await api('/mandatory-leaves', {
        method: 'POST',
        body: {
          title: mandatoryForm.title,
          startDate: mandatoryForm.startDate,
          endDate: mandatoryForm.endDate || mandatoryForm.startDate,
          note: mandatoryForm.note,
          holidayType: mandatoryForm.holidayType,
        },
      });
      setMandatoryForm({ title: '', startDate: '', endDate: '', note: '', holidayType: 'general' });
      setMandatoryMsg(
        mandatoryForm.holidayType === 'restricted'
          ? 'Restricted holiday added. It is listed on Overview for employees and managers to apply.'
          : 'Holiday added. It is now on the team calendar below.'
      );
      reload();
    } catch (error) {
      setErr(error.message);
    } finally {
      setMandatoryBusy(false);
    }
  }

  function downloadHolidayTemplate() {
    const rows = buildHolidayTemplateRows();
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet['!cols'] = [{ wch: 10 }, { wch: 16 }, { wch: 28 }, { wch: 16 }];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Holidays');
    XLSX.writeFile(workbook, 'company-holidays-2026.xlsx');
  }

  async function onMandatoryFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadBusy(true);
    setMandatoryMsg('');
    setErr('');
    try {
      const leaves = await parseHolidayFile(file);
      if (!leaves.length) {
        throw new Error(
          'No valid rows found. Upload CSV, XLSX, or Excel (.xls) with columns: Sl No., Date, Holiday, Holiday Type (General or Restricted)'
        );
      }
      const result = await api('/mandatory-leaves/upload', {
        method: 'POST',
        body: { leaves },
      });
      const errCount = result.errors?.length || 0;
      setMandatoryMsg(
        errCount
          ? `Uploaded ${result.created} holiday(s); ${errCount} row(s) skipped. See the calendar below.`
          : `Uploaded ${result.created} holiday(s). They are now on the team calendar below.`
      );
      reload();
    } catch (error) {
      setErr(error.message);
    } finally {
      setUploadBusy(false);
    }
  }

  return (
    <AppShell title="Team calendar" nav={NAV}>
      <section className="panel mandatory-leave-panel">
        <h2>Company holidays</h2>
        <form className="mandatory-leave-form" onSubmit={submitMandatory}>
          <label>
            Holiday
            <input
              required
              value={mandatoryForm.title}
              onChange={(e) => setMandatoryForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Republic Day"
            />
          </label>
          <label>
            Date
            <input
              required
              type="date"
              value={mandatoryForm.startDate}
              onChange={(e) =>
                setMandatoryForm((f) => ({
                  ...f,
                  startDate: e.target.value,
                  endDate: f.endDate || e.target.value,
                }))
              }
            />
          </label>
          <label>
            Holiday type
            <select
              value={mandatoryForm.holidayType}
              onChange={(e) => setMandatoryForm((f) => ({ ...f, holidayType: e.target.value }))}
            >
              <option value="general">General</option>
              <option value="restricted">Restricted</option>
            </select>
          </label>
          <label className="mandatory-leave-note">
            Note
            <input
              value={mandatoryForm.note}
              onChange={(e) => setMandatoryForm((f) => ({ ...f, note: e.target.value }))}
              placeholder="Optional"
            />
          </label>
          <div className="mandatory-leave-actions">
            <button type="submit" className="btn primary" disabled={mandatoryBusy}>
              {mandatoryBusy ? 'Saving…' : 'Add to calendar'}
            </button>
            <button type="button" className="btn secondary" onClick={downloadHolidayTemplate}>
              Download Excel format
            </button>
            <label className="btn secondary mandatory-upload-btn">
              {uploadBusy ? 'Uploading…' : 'Upload CSV / Excel'}
              <input
                type="file"
                accept={HOLIDAY_UPLOAD_ACCEPT}
                hidden
                disabled={uploadBusy}
                onChange={onMandatoryFile}
              />
            </label>
          </div>
        </form>
        {mandatoryMsg && <p className="form-success">{mandatoryMsg}</p>}
      </section>

      {loading && <p className="muted">Loading…</p>}
      {(error || err) && <p className="form-error">{error || err}</p>}
      {data && (
        <LeaveCalendar
          leaves={data.leaves}
          showNames
          balancesByUserId={data.balancesByUserId}
          employees={data.users}
          canManage
          busyId={busyId}
          onCreateLeave={createLeave}
          onDeleteLeave={deleteLeave}
        />
      )}
    </AppShell>
  );
}

export function HrHistory() {
  const [status, setStatus] = useState('all');
  const [userId, setUserId] = useState('');
  const { data: users } = useLoad(() => api('/users').then((d) => d.users));
  const { data, error, loading } = useLoad(() => {
    const params = new URLSearchParams({ status });
    if (userId) params.set('userId', userId);
    return api(`/leaves?${params}`).then((d) => d.leaves);
  }, [status, userId]);

  return (
    <AppShell title="Request history" nav={NAV}>
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
        <label>
          Employee
          <select value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Everyone</option>
            {(users || []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
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
