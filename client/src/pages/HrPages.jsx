import { Link } from 'react-router-dom';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import AppShell from '../components/AppShell';
import LeaveCalendar from '../components/LeaveCalendar';
import ApprovalProgress from '../components/ApprovalProgress';
import StatusCelebration from '../components/StatusCelebration';
import { LeaveExportPanel, LeaveReportSection } from '../components/LeaveReports';
import OverviewPanels from '../components/OverviewPanels';
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
  DetailList,
  SALARY_SENSITIVE_FIELDS,
  formatPayrollValue,
  payStructureKind,
  payrollFieldsFor,
} from '../components/SalaryComponentsView';
import { APPLY_LABELS, LEAVE_LABELS, REQUEST_LABELS, SESSION_LABELS, STATUS_LABELS, appToday, avatarSrc, formatDate, formatDateTime, formatLeaveSpan, isWfh } from '../utils';
import { buildHolidayTemplateRows, HOLIDAY_UPLOAD_ACCEPT, parseHolidayFile } from '../holidayImport';
import * as XLSX from 'xlsx';

const NAV = [
  { to: '/hr', label: 'Overview', end: true, icon: '/assets/nav-searchlist.png' },
  { to: '/hr/approvals', label: 'HR approvals', icon: '/assets/nav-approved.png' },
  { to: '/hr/onboarding', label: 'Onboarding', icon: '/assets/nav-onboarding.png' },
  { to: '/hr/users', label: 'Leave Management', icon: '/assets/nav-team.png' },
  { to: '/hr/ratings', label: 'Ratings', icon: '/assets/rating-star.png' },
  { to: '/hr/reports', label: 'Reports', icon: '/assets/document.png' },
  { to: '/hr/invoices', label: 'Invoices', icon: '/assets/nav-searchlist.png' },
  { to: '/hr/calendar', label: 'Team calendar', icon: '/assets/nav-calendar.png' },
  { to: '/hr/history', label: 'History', icon: '/assets/nav-hourglass.png' },
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
      />

    </AppShell>
  );
}

export function HrReports() {
  return (
    <AppShell title="Reports" nav={NAV}>
      <LeaveReportSection />
      <LeaveExportPanel />
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
      <p className="lede">Requests already approved by the manager.</p>
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
            <p className="muted">
              Final approval deducts leave balance (not for WFH). You may adjust type/dates.
            </p>
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
        setMsg(form.role === 'manager' ? 'Manager profile updated.' : 'Employee profile updated.');
      } else {
        const { profile, credentials } = await api('/onboarding', {
          method: 'POST',
          body,
        });
        setCreatedNotice({
          name: profile?.name || form.name || (form.role === 'manager' ? 'Manager' : 'Employee'),
          email: credentials?.email || profile?.email || '',
          password: credentials?.password || '',
          emailGenerated: Boolean(credentials?.emailGenerated),
          passwordGenerated: Boolean(credentials?.passwordGenerated),
          role: form.role,
        });
        setMsg(form.role === 'manager' ? 'Manager profile created.' : 'Employee profile created.');
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

  async function bulkImportEmployees(forms) {
    setBusy(true);
    setMsg('');
    setErr('');
    const created = [];
    const failed = [];
    try {
      for (let i = 0; i < forms.length; i += 1) {
        const next = forms[i];
        const rowLabel = next._excelRow || i + 2;
        const formBody = { ...next };
        delete formBody._excelRow;
        try {
          const { profile, credentials } = await api('/onboarding', {
            method: 'POST',
            body: {
              ...formBody,
              managerId: formBody.managerId ? Number(formBody.managerId) : null,
              assets: formBody.assets || [],
            },
          });
          created.push({
            row: rowLabel,
            name: profile?.name || formBody.name || 'Employee',
            email: credentials?.email || profile?.email || '',
            password: credentials?.password || '',
            emailGenerated: Boolean(credentials?.emailGenerated),
            passwordGenerated: Boolean(credentials?.passwordGenerated),
          });
        } catch (error) {
          failed.push({
            row: rowLabel,
            name: formBody.name || formBody.email || `Row ${rowLabel}`,
            error: error.message,
          });
        }
      }
      setShowForm(false);
      setEditingUserId(null);
      setForm(blankForm());
      setBulkResult({ created, failed });
      if (created.length && !failed.length) {
        setMsg(
          `Imported ${created.length} employee${created.length === 1 ? '' : 's'} from the spreadsheet.`
        );
      } else if (created.length) {
        setMsg(
          `Imported ${created.length} employee${created.length === 1 ? '' : 's'}. ${failed.length} row${failed.length === 1 ? '' : 's'} failed.`
        );
      } else {
        setErr(failed[0]?.error || 'No employees could be imported from that spreadsheet.');
      }
      reload();
    } finally {
      setBusy(false);
    }
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
        <p className="lede">
          Create and edit employee and manager profiles including personal, employment, IT/asset,
          and payroll details. Assign who each person reports to — managers can report to another
          manager.
        </p>
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
        <p className="muted slim">
          Employees and managers can each view their own salary in the portal. Assign reporting
          to here, including a manager for managers. Edit payroll to keep their Salary page up to
          date.
        </p>
        {!loading && !profiles?.length && (
          <p className="empty">No onboarded employees yet. Create a profile to get started.</p>
        )}
        {!!profiles?.length && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Role</th>
                  <th>Emp ID</th>
                  <th>Department</th>
                  <th>Designation</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Reporting To</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {profiles.map((p) => (
                  <tr key={p.userId}>
                    <td>
                      <div className="onboarding-row-identity">
                        <img
                          className="onboarding-avatar"
                          src={avatarSrc(p.personal.profilePhoto)}
                          alt=""
                        />
                        <div>
                          <strong className="employee-name">{p.name}</strong>
                          <div className="sub">{p.email}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="badge">
                        {p.role === 'manager' ? 'Manager' : 'Employee'}
                      </span>
                    </td>
                    <td>{p.employeeNumber || '—'}</td>
                    <td>{p.employment.department || '—'}</td>
                    <td>{p.employment.designation || '—'}</td>
                    <td>{labelFrom(EMPLOYMENT_TYPE_OPTIONS, p.employment.employmentType)}</td>
                    <td>
                      <span
                        className={`badge status-${p.employment.employmentStatus || 'active'}`}
                      >
                        {labelFrom(EMPLOYMENT_STATUS_OPTIONS, p.employment.employmentStatus)}
                      </span>
                    </td>
                    <td>
                      <select
                        className="reporting-to-select"
                        aria-label={`Reporting to for ${p.name}`}
                        value={p.managerId || ''}
                        disabled={busy}
                        onChange={(e) => assignReportingTo(p, e.target.value)}
                      >
                        <option value="">Unassigned</option>
                        {(managers || [])
                          .filter(
                            (m) =>
                              String(m.id) !== String(p.userId) && m.active !== false
                          )
                          .map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                      </select>
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          type="button"
                          className={`btn ghost ${selected?.userId === p.userId && !showForm ? 'is-selected' : ''}`}
                          onClick={() => setSelected(p)}
                        >
                          View
                        </button>
                        <button
                          type="button"
                          className={`btn ghost ${editingUserId === p.userId && showForm ? 'is-selected' : ''}`}
                          onClick={() => openEdit(p)}
                        >
                          Edit
                        </button>
                        {p.role !== 'manager' && (
                          <button
                            type="button"
                            className="btn ghost-danger"
                            onClick={() => deleteProfile(p)}
                            disabled={busy}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {showForm && (
        <div className="modal-backdrop modal-backdrop-static">
          <div
            className="modal modal-wide"
            role="dialog"
            aria-modal="true"
            aria-labelledby="onboarding-title"
          >
            <div className="row-between">
              <h2 id="onboarding-title">
                {editingUserId
                  ? form.role === 'manager'
                    ? 'Edit manager profile'
                    : 'Edit employee profile'
                  : form.role === 'manager'
                    ? 'Create manager profile'
                    : 'Create employee profile'}
              </h2>
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
                editingUserId
                  ? 'Save changes'
                  : form.role === 'manager'
                    ? 'Create manager profile'
                    : 'Create employee profile'
              }
            />
          </div>
        </div>
      )}

      {selected && (
        <div className="modal-backdrop" onClick={() => setSelected(null)}>
          <div
            className="modal modal-wide"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="row-between">
              <h2>{selected.name}</h2>
              <div className="row-actions">
                <button type="button" className="btn primary is-selected" onClick={() => openEdit(selected)}>
                  Edit
                </button>
                <button
                  type="button"
                  className="btn ghost-danger"
                  onClick={() => deleteProfile(selected)}
                  disabled={busy}
                >
                  Delete
                </button>
                <button type="button" className="btn ghost" onClick={() => setSelected(null)}>
                  Close
                </button>
              </div>
            </div>
            <div className="onboarding-detail-grid">
              <section>
                <h3>Personal</h3>
                <img
                  className="onboarding-detail-photo"
                  src={avatarSrc(selected.personal.profilePhoto)}
                  alt=""
                />
                <dl className="detail-list">
                  <div>
                    <dt>Employee ID</dt>
                    <dd>{selected.employeeNumber || '—'}</dd>
                  </div>
                  <div>
                    <dt>Date of birth</dt>
                    <dd>
                      {selected.personal.dateOfBirth
                        ? formatDate(selected.personal.dateOfBirth)
                        : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt>Gender</dt>
                    <dd>{labelFrom(GENDER_OPTIONS, selected.personal.gender)}</dd>
                  </div>
                  <div>
                    <dt>Personal email</dt>
                    <dd>{selected.personal.personalEmail || '—'}</dd>
                  </div>
                  <div>
                    <dt>Mobile</dt>
                    <dd>{selected.personal.personalMobile || '—'}</dd>
                  </div>
                  <div>
                    <dt>Address</dt>
                    <dd>{selected.personal.address || '—'}</dd>
                  </div>
                  <div>
                    <dt>Emergency contact</dt>
                    <dd>{selected.personal.emergencyContact || '—'}</dd>
                  </div>
                  <div>
                    <dt>Nationality</dt>
                    <dd>{selected.personal.nationality || '—'}</dd>
                  </div>
                  <div>
                    <dt>Marital status</dt>
                    <dd>{labelFrom(MARITAL_STATUS_OPTIONS, selected.personal.maritalStatus)}</dd>
                  </div>
                </dl>
              </section>
              <section>
                <h3>Employment</h3>
                <dl className="detail-list">
                  <div>
                    <dt>Date of joining</dt>
                    <dd>
                      {selected.employment.dateOfJoining
                        ? formatDate(selected.employment.dateOfJoining)
                        : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt>Employment type</dt>
                    <dd>
                      {labelFrom(EMPLOYMENT_TYPE_OPTIONS, selected.employment.employmentType)}
                    </dd>
                  </div>
                  <div>
                    <dt>Department</dt>
                    <dd>{selected.employment.department || '—'}</dd>
                  </div>
                  <div>
                    <dt>Designation</dt>
                    <dd>{selected.employment.designation || '—'}</dd>
                  </div>
                  <div>
                    <dt>Job level</dt>
                    <dd>{selected.employment.jobLevel || '—'}</dd>
                  </div>
                  <div>
                    <dt>Role</dt>
                    <dd>{labelFrom(PORTAL_ROLE_OPTIONS, selected.role)}</dd>
                  </div>
                  <div>
                    <dt>Reporting to</dt>
                    <dd>
                      {selected.managerName || selected.managerEmail ? (
                        <>
                          {selected.managerName || '—'}
                          {selected.managerEmail ? (
                            <div className="sub">{selected.managerEmail}</div>
                          ) : null}
                        </>
                      ) : (
                        '—'
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Location</dt>
                    <dd>{selected.employment.location || '—'}</dd>
                  </div>
                  <div>
                    <dt>Work mode</dt>
                    <dd>{labelFrom(WORK_MODE_OPTIONS, selected.employment.workMode)}</dd>
                  </div>
                  <div>
                    <dt>Status</dt>
                    <dd>
                      {labelFrom(EMPLOYMENT_STATUS_OPTIONS, selected.employment.employmentStatus)}
                    </dd>
                  </div>
                  <div>
                    <dt>Probation</dt>
                    <dd>{selected.employment.probationPeriod || '—'}</dd>
                  </div>
                  <div>
                    <dt>Confirmation date</dt>
                    <dd>
                      {selected.employment.confirmationDate
                        ? formatDate(selected.employment.confirmationDate)
                        : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt>Work email</dt>
                    <dd>{selected.email || '—'}</dd>
                  </div>
                </dl>
              </section>
              <section className="full">
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
                        <DetailList
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
                            },
                            {
                              label: 'Company email / account',
                              value: asset.companyEmail || '—',
                            },
                          ]}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </section>
              <section>
                <h3>Payroll &amp; salary</h3>
                <DetailList
                  items={[
                    ...payrollFieldsFor(selected.employment?.employmentType).map((f) => ({
                      label: f.label,
                      value: formatPayrollValue(f, selected.payroll),
                    })),
                    ...(payStructureKind(selected.employment?.employmentType) === 'employee'
                      ? SALARY_SENSITIVE_FIELDS.map((f) => ({
                          label: f.label,
                          value: selected.payroll?.[f.key] || '—',
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
  const [managerForm, setManagerForm] = useState({
    name: '',
    email: '',
    password: '',
    employeeNumber: '',
    managerId: '',
  });
  const [creditForm, setCreditForm] = useState({
    userId: '',
    leaveType: 'casual',
    amount: 1,
    note: '',
  });
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [creditPopup, setCreditPopup] = useState(null);
  const [managerNotice, setManagerNotice] = useState(null);
  const [managerBusy, setManagerBusy] = useState(false);

  async function createManager(e) {
    e.preventDefault();
    setMsg('');
    setErr('');
    setManagerBusy(true);
    try {
      const body = {
        name: managerForm.name.trim(),
        email: managerForm.email.trim(),
        password: managerForm.password,
        role: 'manager',
        employeeNumber: managerForm.employeeNumber.trim() || undefined,
        managerId: managerForm.managerId ? Number(managerForm.managerId) : null,
      };
      const { user } = await api('/users', { method: 'POST', body });
      setManagerNotice({
        name: user?.name || body.name,
        email: user?.email || body.email,
        password: body.password,
      });
      setMsg(`${user?.name || body.name} added as manager.`);
      setManagerForm({ name: '', email: '', password: '', employeeNumber: '', managerId: '' });
      reloadManagers();
      reload();
    } catch (error) {
      setErr(error.message);
    } finally {
      setManagerBusy(false);
    }
  }

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
      <StatusCelebration
        show={Boolean(managerNotice)}
        onDone={() => setManagerNotice(null)}
        message="Manager created!"
        detail={
          managerNotice?.email
            ? `${managerNotice.name} can log in with the credentials below.`
            : `${managerNotice?.name || 'Manager'} has been added.`
        }
        credentials={
          managerNotice?.email
            ? {
                email: managerNotice.email,
                password: managerNotice.password,
              }
            : null
        }
        imageSrc="/assets/leave-approved.gif"
        durationMs={managerNotice?.password ? 12000 : 2800}
      />
      <p className="lede">
        Add managers, credit leave balances, and manage employees. Create employees in{' '}
        <Link to="/hr/onboarding">Onboarding</Link>.
      </p>
      {(msg || err) && <p className={err ? 'form-error' : 'form-ok'}>{err || msg}</p>}
      {loading && <p className="muted">Loading…</p>}
      {error && <p className="form-error">{error}</p>}
      {managersError && <p className="form-error">{managersError}</p>}

      <div className="leave-mgmt-stack">
      <section className="panel leave-mgmt-managers">
        <h2>Add manager</h2>
        <p className="muted slim">
          Managers approve team leave before HR. They sign in with the email and password you set.
          Assign who each manager reports to — another manager can be their reporting manager.
        </p>
        <form className="manager-create-form" onSubmit={createManager}>
          <label>
            Name
            <input
              value={managerForm.name}
              onChange={(e) => setManagerForm((f) => ({ ...f, name: e.target.value }))}
              required
              autoComplete="off"
            />
          </label>
          <label>
            Work email
            <input
              type="email"
              value={managerForm.email}
              onChange={(e) => setManagerForm((f) => ({ ...f, email: e.target.value }))}
              required
              autoComplete="off"
            />
          </label>
          <label>
            Temp password
            <input
              type="text"
              value={managerForm.password}
              onChange={(e) => setManagerForm((f) => ({ ...f, password: e.target.value }))}
              minLength={6}
              required
              autoComplete="new-password"
              placeholder="Min 6 characters"
            />
          </label>
          <label>
            Emp ID (optional)
            <input
              value={managerForm.employeeNumber}
              onChange={(e) => setManagerForm((f) => ({ ...f, employeeNumber: e.target.value }))}
              autoComplete="off"
            />
          </label>
          <label>
            Reporting to
            <select
              value={managerForm.managerId}
              onChange={(e) => setManagerForm((f) => ({ ...f, managerId: e.target.value }))}
            >
              <option value="">No reporting manager</option>
              {(managers || [])
                .filter((m) => m.active !== false)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.email ? `${m.name} (${m.email})` : m.name}
                  </option>
                ))}
            </select>
          </label>
          <div className="leave-credit-actions">
            <button className="btn primary" type="submit" disabled={managerBusy}>
              {managerBusy ? 'Adding…' : 'Add manager'}
            </button>
          </div>
        </form>

        <h3 className="leave-mgmt-subhead">Managers</h3>
        {managersLoading && <p className="muted">Loading managers…</p>}
        {!managersLoading && !managers?.length && (
          <p className="empty">No managers yet. Add one above.</p>
        )}
        {!!managers?.length && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Reporting To</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {managers.map((mgr) => (
                  <tr key={mgr.id} className={mgr.active ? '' : 'is-inactive'}>
                    <td>
                      <strong className="employee-name">{mgr.name}</strong>
                    </td>
                    <td>{mgr.email}</td>
                    <td>
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
                              {m.name}
                            </option>
                          ))}
                      </select>
                    </td>
                    <td>
                      <span className={`badge ${mgr.active ? 'status-active' : 'status-inactive'}`}>
                        {mgr.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>
                      <div className="row-actions">
                        <button type="button" className="btn ghost" onClick={() => toggleActive(mgr)}>
                          {mgr.active ? 'Deactivate' : 'Activate'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel leave-mgmt-credit">
        <h2>Credit leave balance</h2>
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
                  {u.role === 'manager' ? ' (manager)' : ''}
                  {u.active ? '' : ' (inactive)'}
                </option>
              ))}
            </select>
          </label>
          <label>
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

      <section className="panel">
        <h2>Employee leave balances</h2>
        {!loading && !data?.length && (
          <p className="empty">
            No employees yet. Add them from <Link to="/hr/onboarding">Onboarding</Link>.
          </p>
        )}
        {!!data?.length && (
          <div className="table-wrap">
            <table className="leave-balances-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Emp ID</th>
                  <th>Reporting To</th>
                  <th>Status</th>
                  <th className="leave-type-heading">Casual Leave</th>
                  <th className="leave-type-heading">Earned Leave</th>
                  <th className="leave-type-heading">Sick Leave</th>
                  <th className="leave-type-heading">Restricted Leave</th>
                  <th className="leave-type-heading">WFH</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.map((user) => (
                  <tr key={user.id} className={user.active ? '' : 'is-inactive'}>
                    <td>
                      <strong className="employee-name">{user.name}</strong>
                      <div className="sub">
                        {user.email}
                        {user.role === 'manager' ? ' · Manager' : ''}
                      </div>
                    </td>
                    <td>{user.employeeNumber || '—'}</td>
                    <td>{user.managerEmail || user.managerName || '—'}</td>
                    <td>
                      <span className={`badge ${user.active ? 'status-active' : 'status-inactive'}`}>
                        {user.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>{user.balances.casual}</td>
                    <td>{user.balances.earned}</td>
                    <td>{user.balances.sick}</td>
                    <td>{user.balances.restricted ?? 0}</td>
                    <td>{user.wfhDays ?? 0}</td>
                    <td>
                      <div className="row-actions">
                        <button type="button" className="btn ghost" onClick={() => toggleActive(user)}>
                          {user.active ? 'Deactivate' : 'Activate'}
                        </button>
                        <button
                          type="button"
                          className="btn ghost-danger"
                          onClick={() => deleteEmployee(user)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Credit history</h2>
        <p className="muted slim">Leave balances credited by HR, with date and time.</p>
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
      setMandatoryMsg('Holiday added to all calendars.');
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
          ? `Uploaded ${result.created} holiday(s); ${errCount} row(s) skipped.`
          : `Uploaded ${result.created} holiday(s) to all calendars.`
      );
      reload();
    } catch (error) {
      setErr(error.message);
    } finally {
      setUploadBusy(false);
    }
  }

  const mandatoryOnCalendar = (data?.leaves || []).filter((l) => l.isMandatory);

  return (
    <AppShell title="Team calendar" nav={NAV}>
      <p className="lede">
        Filter by employee to review overlapping leave. Use + on a working day to add leave for an
        employee. Leave cannot be applied on Saturdays, Sundays, or general holidays. Restricted
        holidays can be taken only on the published RH dates — maximum 2 per year.
      </p>

      <section className="panel mandatory-leave-panel">
        <h2>Company holidays</h2>
        <p className="muted slim">
          General holidays are company-wide offs and already show on every calendar with the holiday
          name. Restricted holidays are optional — each employee or manager may take only 2 per year,
          and only on the RH dates in this list.
        </p>
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
        <p className="muted slim">
          Upload <code>.csv</code>, <code>.xlsx</code>, or <code>.xls</code> with columns{' '}
          <code>Sl No., Date, Holiday, Holiday Type</code> (General or Restricted). Dates like{' '}
          <code>01 Jan 2026</code>, <code>01-Jan-2026</code>, or <code>YYYY-MM-DD</code>.
        </p>
        {mandatoryMsg && <p className="form-success">{mandatoryMsg}</p>}
        {!!mandatoryOnCalendar.length && (
          <ul className="mandatory-leave-list">
            {mandatoryOnCalendar.map((leave) => (
              <li key={leave.id}>
                <span>
                  <strong>{leave.userName}</strong> · {leave.holidayType === 'restricted' ? 'Restricted' : 'General'} · {formatLeaveSpan(leave)}
                  {leave.reason ? ` · ${leave.reason}` : ''}
                </span>
                <button
                  type="button"
                  className="btn ghost-danger"
                  disabled={busyId === leave.id}
                  onClick={() => deleteLeave(leave)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
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
