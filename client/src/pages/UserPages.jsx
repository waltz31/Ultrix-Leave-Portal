import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import AppShell from '../components/AppShell';
import LeaveCalendar from '../components/LeaveCalendar';
import ApprovalProgress from '../components/ApprovalProgress';
import StatusCelebration from '../components/StatusCelebration';
import ErrorPopup from '../components/ErrorPopup';
import OverviewPanels from '../components/OverviewPanels';
import { LeaveReportCharts } from '../components/LeaveReports';
import {
  APPLY_LABELS,
  LEAVE_LABELS,
  REQUEST_LABELS,
  SESSION_LABELS,
  STATUS_LABELS,
  appToday,
  formatLeaveSpan,
  isWfh,
  canUserCancel,
  holidayDateLabel,
  toYmd,
  blockedRegularLeaveMessage,
  generalHolidayMapFromList,
  isApplyBlockError,
  insufficientRestrictedBalance,
  RH_ONLY_PUBLISHED_DATES,
} from '../utils';
import { SalaryComponentsView } from '../components/SalaryComponentsView';

const NAV = [
  { to: '/app', label: 'Home', end: true },
  { to: '/app/apply', label: 'Apply' },
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
        canApplyRestricted
        restrictedBalance={balances?.restricted ?? 2}
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

export function UserApply() {
  const { data: balances, reload } = useLoad(() =>
    api('/balances/me').then((d) => d.balances)
  );
  const [form, setForm] = useState({
    leaveType: 'casual',
    startDate: '',
    endDate: '',
    session: 'full',
    reason: '',
  });
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [submittedPopup, setSubmittedPopup] = useState(null);
  const { data: holidayData, reload: reloadHolidays } = useLoad(() =>
    api(`/holidays?year=${appToday().getFullYear()}`)
  );
  const [errorPopup, setErrorPopup] = useState(null);
  const wfh = isWfh(form.leaveType);
  const restricted = form.leaveType === 'restricted';
  const halfDay = !restricted && form.session !== 'full';
  const restrictedBalance = balances?.restricted ?? 2;
  const noRestrictedBalance = restrictedBalance < 1;
  const generalHolidayMap = useMemo(
    () => generalHolidayMapFromList(holidayData?.general || holidayData?.holidays),
    [holidayData]
  );
  const rhDates = useMemo(
    () => new Set((holidayData?.restricted || []).map((h) => toYmd(h.startDate))),
    [holidayData]
  );

  function showApplyError(message, title = 'Cannot apply leave') {
    setErrorPopup({ title, message });
    setErr(message);
  }

  function pickWorkingDate(field, value) {
    const blocked = blockedRegularLeaveMessage(
      field === 'startDate' ? value : form.startDate,
      field === 'endDate' ? value : field === 'startDate' && (halfDay || form.session !== 'full') ? value : form.endDate,
      generalHolidayMap
    );
    if (blocked) {
      showApplyError(blocked);
      return;
    }
    setForm((f) => ({
      ...f,
      [field]: value,
      endDate:
        field === 'startDate' && (halfDay || f.session !== 'full')
          ? value
          : field === 'endDate'
            ? value
            : f.endDate || value,
    }));
  }

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setMsg('');
    setErr('');
    try {
      const body = {
        ...form,
        session: restricted ? 'full' : form.session,
        startDate: restricted || halfDay ? toYmd(form.startDate) : toYmd(form.startDate),
        endDate: restricted || halfDay ? toYmd(form.startDate) : toYmd(form.endDate),
      };
      if (restricted) {
        if (noRestrictedBalance) {
          throw new Error(insufficientRestrictedBalance(restrictedBalance));
        }
        if (!body.startDate) {
          throw new Error(RH_ONLY_PUBLISHED_DATES);
        }
        if (!rhDates.has(body.startDate)) {
          throw new Error(RH_ONLY_PUBLISHED_DATES);
        }
      } else {
        const blocked = blockedRegularLeaveMessage(body.startDate, body.endDate, generalHolidayMap);
        if (blocked) throw new Error(blocked);
      }
      await api('/leaves', { method: 'POST', body });
      setSubmittedPopup({
        message: restricted
          ? 'Restricted leave submitted'
          : wfh
            ? 'Work from Home submitted'
            : 'Leave submitted',
        detail: 'Your request is waiting for manager approval, then HR.',
      });
      setMsg(
        wfh
          ? 'Work from Home submitted — waiting for manager, then HR.'
          : `${REQUEST_LABELS[form.leaveType] || 'Leave'} submitted — waiting for manager, then HR.`
      );
      setForm({
        leaveType: form.leaveType,
        startDate: '',
        endDate: '',
        session: 'full',
        reason: '',
      });
      reload();
      reloadHolidays();
    } catch (error) {
      const message = error.message || 'Could not submit leave';
      if (isApplyBlockError(message) || restricted) {
        showApplyError(
          message,
          /insufficient restricted leave/i.test(message) ? 'No restricted leave balance' : 'Cannot apply leave'
        );
      } else {
        setErr(message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell title="Apply" nav={NAV}>
      <ErrorPopup
        show={Boolean(errorPopup)}
        title={errorPopup?.title}
        message={errorPopup?.message}
        onClose={() => setErrorPopup(null)}
      />
      <StatusCelebration
        show={Boolean(submittedPopup)}
        onDone={() => setSubmittedPopup(null)}
        message={submittedPopup?.message || 'Request submitted'}
        detail={submittedPopup?.detail || ''}
        imageSrc="/assets/request-submitted.gif"
        durationMs={3200}
      />
      <div className="apply-layout">
        <div className="apply-main">
          <section className="panel apply-form-panel">
            <h2>Apply</h2>
            <p className="muted slim">
              Pick a type, dates, and submit. Manager then HR approve. You cannot apply leave on
              Saturdays, Sundays, or general holidays — those already appear on the calendar. Restricted
              holidays can only be taken on the published RH dates (max 2 per year).
            </p>
            <form className="stack-form apply-form" onSubmit={onSubmit}>
              <div className="apply-field">
                <span className="apply-label" id="apply-type-label">
                  Type
                </span>
                <div
                  className="apply-type-pills"
                  role="radiogroup"
                  aria-labelledby="apply-type-label"
                >
                  {Object.entries(APPLY_LABELS).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      role="radio"
                      aria-checked={form.leaveType === key}
                      className={`apply-type-pill type-${key}${form.leaveType === key ? ' is-selected' : ''}`}
                      onClick={() => {
                        if (key === 'restricted' && noRestrictedBalance) {
                          showApplyError(
                            insufficientRestrictedBalance(restrictedBalance),
                            'No restricted leave balance'
                          );
                          return;
                        }
                        setForm((f) => ({
                          ...f,
                          leaveType: key,
                          session: key === 'restricted' ? 'full' : f.session,
                          endDate: key === 'restricted' ? f.startDate : f.endDate,
                          startDate: key === 'restricted' ? '' : f.startDate,
                        }));
                      }}
                    >
                      <span className={`apply-type-swatch type-${key}`} aria-hidden />
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {restricted ? (
                <div className="apply-dates">
                  <label className="full">
                    Restricted leave
                    <select
                      value={form.startDate}
                      onChange={(e) => {
                        const value = e.target.value;
                        if (noRestrictedBalance) {
                          showApplyError(
                            insufficientRestrictedBalance(restrictedBalance),
                            'No restricted leave balance'
                          );
                          return;
                        }
                        if (value && !rhDates.has(value)) {
                          showApplyError(RH_ONLY_PUBLISHED_DATES);
                          return;
                        }
                        setForm((f) => ({
                          ...f,
                          startDate: value,
                          endDate: value,
                          session: 'full',
                        }));
                      }}
                      required
                      disabled={noRestrictedBalance}
                    >
                      <option value="">Select a published RH date…</option>
                      {(holidayData?.restricted || []).map((h) => (
                        <option key={h.id} value={toYmd(h.startDate)}>
                          {holidayDateLabel(h)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="muted slim apply-hint">
                    You can take restricted holidays only on these company RH dates — for example
                    Sankranti/Ponga, Ugadi Festival, Eid-ul-Fitr, Good Friday. General holidays
                    (New Year, Republic Day, Independence Day, and others) already appear on your
                    calendar. Balance: {restrictedBalance} restricted leave
                    {restrictedBalance === 1 ? '' : 's'} remaining.
                    {noRestrictedBalance ? ' You have no restricted leave balance left.' : ''}
                  </p>
                  {!holidayData?.restricted?.length && (
                    <p className="form-error">
                      No restricted holidays are published for this year yet. Ask HR to add the RH
                      list.
                    </p>
                  )}
                </div>
              ) : (
              <div className="apply-dates">
                <label>
                  Session
                  <select
                    value={form.session}
                    onChange={(e) => {
                      const session = e.target.value;
                      const nextEnd = session !== 'full' ? form.startDate || form.endDate : form.endDate;
                      const blocked = blockedRegularLeaveMessage(
                        form.startDate,
                        nextEnd,
                        generalHolidayMap
                      );
                      if (blocked) {
                        showApplyError(blocked);
                        return;
                      }
                      setForm((f) => ({
                        ...f,
                        session,
                        endDate: session !== 'full' ? f.startDate || f.endDate : f.endDate,
                      }));
                    }}
                  >
                    {Object.entries(SESSION_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {halfDay ? 'Date' : 'Start date'}
                  <input
                    type="date"
                    value={form.startDate}
                    onChange={(e) => pickWorkingDate('startDate', e.target.value)}
                    required
                  />
                </label>
                {!halfDay && (
                  <label>
                    End date
                    <input
                      type="date"
                      value={form.endDate}
                      min={form.startDate || undefined}
                      onChange={(e) => pickWorkingDate('endDate', e.target.value)}
                      required
                    />
                  </label>
                )}
              </div>
              )}
              {halfDay && <p className="muted slim apply-hint">Half day counts as 0.5.</p>}

              <label>
                Notes
                <textarea
                  rows={3}
                  value={form.reason}
                  onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                  placeholder="Optional — reason for this request"
                />
              </label>

              {msg && <p className="form-ok">{msg}</p>}
              {err && !errorPopup && <p className="form-error">{err}</p>}
              <button
                className="btn primary apply-submit"
                type="submit"
                disabled={busy || (restricted && noRestrictedBalance)}
              >
                {busy
                  ? 'Submitting…'
                  : `Submit ${REQUEST_LABELS[form.leaveType] || 'request'}`}
              </button>
            </form>
          </section>
        </div>

        <aside className="panel balance-side">
          <h2>Balances</h2>
          {balances ? (
            <ul className="balance-list">
              {Object.entries(LEAVE_LABELS).map(([key, label]) => (
                <li key={key}>
                  <span>{label}</span>
                  <strong>{balances[key] ?? 0}</strong>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Loading…</p>
          )}
          {restricted && (
            <p className="balance-note">
              Restricted leave uses your restricted leave balance (2 per year by default). You can
              only take it on published RH dates. General holidays are already on the calendar.
            </p>
          )}
          {wfh && (
            <p className="balance-note">Work from Home does not use leave balance.</p>
          )}
        </aside>
      </div>
    </AppShell>
  );
}

export function UserCalendar() {
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
      <p className="lede">
        Your active leave appears here, colored by leave type. General holidays show in blue with
        the holiday name (New Year, Republic Day, Independence Day, and others). Restricted
        holidays are pink — you may take only 2 per year on those dates. Saturdays and Sundays are
        grey. Tap a day to cancel just that day, or cancel the full multi-day request.
      </p>
      {loading && <p className="muted">Loading…</p>}
      {error && <p className="form-error">{error}</p>}
      {cancelErr && <p className="form-error">{cancelErr}</p>}
      {data && (
        <LeaveCalendar leaves={data} onCancel={onCancel} busyId={busyId} />
      )}
    </AppShell>
  );
}

export function UserHistory() {
  const [status, setStatus] = useState('all');
  const { data, error, loading, reload } = useLoad(
    () => api(`/leaves?status=${status}`).then((d) => d.leaves),
    [status]
  );
  const [cancelErr, setCancelErr] = useState('');
  const [busyId, setBusyId] = useState(null);

  async function onCancel(leave) {
    setCancelErr('');
    setBusyId(leave.id);
    try {
      const done = await cancelLeave(leave.id, leave.status);
      if (done) reload();
    } catch (err) {
      setCancelErr(err.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <AppShell title="History" nav={NAV}>
      <div className="filters">
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">All</option>
            <option value="pending_manager">Awaiting manager</option>
            <option value="pending_hr">Partially approved (awaiting HR)</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
      </div>
      {loading && <p className="muted">Loading…</p>}
      {error && <p className="form-error">{error}</p>}
      {cancelErr && <p className="form-error">{cancelErr}</p>}
      <div className="stack tight">
        {(data || []).map((leave) => (
          <section key={leave.id} className="panel">
            <div className="row-between">
              <div>
                {REQUEST_LABELS[leave.leaveType]} · {formatLeaveSpan(leave)}
              </div>
              <div className="row-actions">
                <span className={`badge status-${leave.status}`}>
                  {STATUS_LABELS[leave.status]}
                </span>
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
            </div>
            <ApprovalProgress leave={leave} />
          </section>
        ))}
      </div>
    </AppShell>
  );
}

export function UserSalary() {
  const { data, error, loading } = useLoad(() =>
    api('/profiles/me').then((d) => d.profile)
  );

  return (
    <AppShell title="My salary" nav={NAV}>
      <p className="lede">Your salary components (view only). Contact HR for changes.</p>
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
