import { Link } from 'react-router-dom';
import { useCallback, useEffect, useState } from 'react';
import { format, endOfMonth, startOfMonth } from 'date-fns';
import { api } from '../api';
import { useAuth } from '../auth';
import AppShell from '../components/AppShell';
import LeaveCalendar from '../components/LeaveCalendar';
import ApprovalProgress from '../components/ApprovalProgress';
import StatusCelebration from '../components/StatusCelebration';
import { LeaveExportPanel, LeaveReportSection, UpcomingLeaveList } from '../components/LeaveReports';
import { LEAVE_LABELS, REQUEST_LABELS, SESSION_LABELS, STATUS_LABELS, appToday, formatDate, formatDateTime, formatLeaveSpan, isWfh } from '../utils';

const NAV = [
  { to: '/hr', label: 'Overview', end: true, icon: '/assets/nav-searchlist.png' },
  { to: '/hr/approvals', label: 'HR approvals', icon: '/assets/nav-approved.png' },
  { to: '/hr/users', label: 'Users', icon: '/assets/nav-team.png' },
  { to: '/hr/ratings', label: 'Ratings', icon: '/assets/rating-star.png' },
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

function addMonthsSafe(date, n) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  return d;
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
            <strong>{(stats.onLeaveToday || 0) + (stats.onWfhToday || 0)}</strong>
          </Link>
        </div>
      )}

      <div className="overview-grid">
        <section className="panel">
          <h2>Upcoming leave</h2>
          <UpcomingLeaveList items={report?.upcoming || []} />
        </section>
        <section className="panel">
          <h2>On leave / WFH today</h2>
          <UpcomingLeaveList
            items={report?.todayOnLeave || []}
            emptyText="Nobody on leave or WFH today."
          />
        </section>
      </div>

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
      <div className="stack" style={{ gap: 14 }}>
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
                  {Object.entries(REQUEST_LABELS).map(([k, v]) => (
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

export function HrUsers() {
  const { data, error, loading, reload } = useLoad(() =>
    api('/users').then((d) => d.users)
  );
  const { data: managers } = useLoad(() =>
    api('/managers').then((d) => d.managers)
  );
  const {
    data: creditLog,
    reload: reloadCredits,
  } = useLoad(() => api('/balances/credits').then((d) => d.credits));
  const [showAddUser, setShowAddUser] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'user',
    managerId: '',
    employeeNumber: '',
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

  async function createUser(e) {
    e.preventDefault();
    setMsg('');
    setErr('');
    try {
      await api('/users', {
        method: 'POST',
        body: {
          ...createForm,
          employeeNumber: createForm.employeeNumber.trim(),
          managerId: createForm.role === 'user' ? Number(createForm.managerId) : null,
        },
      });
      setCreateForm({
        name: '',
        email: '',
        password: '',
        role: 'user',
        managerId: '',
        employeeNumber: '',
      });
      setShowAddUser(false);
      setMsg('User added.');
      reload();
    } catch (error) {
      setErr(error.message);
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
      reload();
      reloadCredits();
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

  function openAddUser() {
    setErr('');
    setMsg('');
    setShowAddUser(true);
  }

  return (
    <AppShell title="Users" nav={NAV}>
      <StatusCelebration
        show={Boolean(creditPopup)}
        onDone={() => setCreditPopup(null)}
        message={creditPopup?.message || 'Leaves credited'}
        detail={creditPopup?.detail || ''}
        imageSrc="/assets/balance-credited.gif"
        durationMs={3200}
      />
      <div className="page-actions">
        <p className="lede">Add employees (with manager) or managers. Credit leave balances.</p>
        <button type="button" className="btn primary" onClick={openAddUser}>
          + Add user
        </button>
      </div>
      {(msg || err) && <p className={err ? 'form-error' : 'form-ok'}>{err || msg}</p>}
      {loading && <p className="muted">Loading…</p>}
      {error && <p className="form-error">{error}</p>}

      <div className="split">
        <section className="panel">
          <h2>Employees</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Emp #</th>
                  <th>Manager</th>
                  <th className="leave-type-heading">Casual</th>
                  <th className="leave-type-heading">Earned</th>
                  <th className="leave-type-heading">Sick</th>
                  <th className="leave-type-heading">WFH</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(data || []).map((user) => (
                  <tr key={user.id}>
                    <td>
                      <strong className="employee-name">{user.name}</strong>
                      <div className="sub">{user.email}</div>
                    </td>
                    <td>{user.employeeNumber || '—'}</td>
                    <td>{user.managerName || '—'}</td>
                    <td>{user.balances.casual}</td>
                    <td>{user.balances.earned}</td>
                    <td>{user.balances.sick}</td>
                    <td>{user.wfhDays ?? 0}</td>
                    <td>
                      <div className="row-actions">
                        <button type="button" className="btn ghost" onClick={() => toggleActive(user)}>
                          {user.active ? 'Deactivate' : 'Activate'}
                        </button>
                        <button
                          type="button"
                          className="btn danger ghost-danger"
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
        </section>

        <section className="panel">
          <h2>Credit leave balance</h2>
          <form className="stack-form" onSubmit={creditBalance}>
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
            <label>
              Note (optional)
              <input
                value={creditForm.note}
                onChange={(e) => setCreditForm((f) => ({ ...f, note: e.target.value }))}
                placeholder="Reason for credit"
              />
            </label>
            <button className="btn primary" type="submit">
              Credit balance
            </button>
          </form>
        </section>
      </div>

      <section className="panel" style={{ marginTop: 16 }}>
        <h2>Credit history</h2>
        <p className="lede">Log of leave balances credited by HR, with date and time.</p>
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

      {showAddUser && (
        <div className="modal-backdrop modal-backdrop-static">
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="add-user-title">
            <h2 id="add-user-title">Add user</h2>
            <form className="stack-form" onSubmit={createUser}>
              <label>
                Full name
                <input
                  value={createForm.name}
                  onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                  required
                  autoFocus
                />
              </label>
              <label>
                Email
                <input
                  type="email"
                  value={createForm.email}
                  onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))}
                  required
                />
              </label>
              {createForm.role === 'user' && (
                <label>
                  Employee number
                  <input
                    value={createForm.employeeNumber}
                    onChange={(e) =>
                      setCreateForm((f) => ({ ...f, employeeNumber: e.target.value }))
                    }
                    required
                    maxLength={40}
                    placeholder="e.g. EMP001"
                  />
                </label>
              )}
              <label>
                Temporary password
                <input
                  type="text"
                  value={createForm.password}
                  onChange={(e) => setCreateForm((f) => ({ ...f, password: e.target.value }))}
                  minLength={6}
                  required
                />
              </label>
              <label>
                Role
                <select
                  value={createForm.role}
                  onChange={(e) => setCreateForm((f) => ({ ...f, role: e.target.value }))}
                >
                  <option value="user">Employee</option>
                  <option value="manager">Manager</option>
                </select>
              </label>
              {createForm.role === 'user' && (
                <label>
                  Manager
                  <select
                    value={createForm.managerId}
                    onChange={(e) => setCreateForm((f) => ({ ...f, managerId: e.target.value }))}
                    required
                  >
                    <option value="">Select manager…</option>
                    {(managers || []).map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {err && <p className="form-error">{err}</p>}
              <div className="modal-actions">
                <button type="button" className="btn ghost" onClick={() => setShowAddUser(false)}>
                  Cancel
                </button>
                <button className="btn primary" type="submit">
                  Add user
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}

export function HrCalendar() {
  const now = appToday();
  const from = format(startOfMonth(now), 'yyyy-MM-dd');
  const to = format(endOfMonth(addMonthsSafe(now, 2)), 'yyyy-MM-dd');
  const { data, error, loading } = useLoad(
    () =>
      Promise.all([
        api(`/leaves/calendar?from=${from}&to=${to}`).then((d) => d.leaves),
        api('/users').then((d) => d.users),
      ]).then(([leaves, users]) => ({
        leaves,
        balancesByUserId: Object.fromEntries(
          users.map((u) => [u.id, u.balances || { casual: 0, earned: 0, sick: 0 }])
        ),
      })),
    [from, to]
  );

  return (
    <AppShell title="Team calendar" nav={NAV}>
      <p className="lede">Hover a person to see available leave balances.</p>
      {loading && <p className="muted">Loading…</p>}
      {error && <p className="form-error">{error}</p>}
      {data && (
        <LeaveCalendar
          leaves={data.leaves}
          showNames
          balancesByUserId={data.balancesByUserId}
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
      <div className="stack" style={{ gap: 12 }}>
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
