import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { getPortalRoot } from '../portalRoot';
import { useTheme } from '../theme';
import ErrorPopup from './ErrorPopup';
import StatusCelebration from './StatusCelebration';
import {
  APPLY_LABELS,
  REQUEST_LABELS,
  SESSION_LABELS,
  STATUS_LABELS,
  appToday,
  blockedRegularLeaveMessage,
  eachYmd,
  formatLeaveSpan,
  generalHolidayMapFromList,
  holidayDateLabel,
  insufficientRestrictedBalance,
  isWeekendYmd,
  isWfh,
  RH_ONLY_PUBLISHED_DATES,
  toYmd,
} from '../utils';
import LeaveBalanceSummaryCards, {
  computePersonalLeaveTotals,
} from './LeaveBalanceSummaryCards';

function initials(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return 'ME';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function statusTone(status) {
  if (status === 'approved') return 'ok';
  if (status === 'pending_manager' || status === 'pending_hr') return 'pending';
  if (status === 'rejected') return 'bad';
  return 'muted';
}

function estimateDays(startDate, endDate, session, restricted) {
  if (restricted) return 1;
  if (!startDate) return 0;
  if (session && session !== 'full') return 0.5;
  const days = eachYmd(startDate, endDate || startDate).filter((day) => !isWeekendYmd(day));
  return days.length;
}

const EMPTY_FORM = {
  leaveType: 'casual',
  startDate: '',
  endDate: '',
  session: 'full',
  reason: '',
};

export default function LeaveBalanceDashboard({ restrictedOnly = false }) {
  const { user } = useAuth();
  const { mode: themeMode } = useTheme();
  const year = appToday().getFullYear();
  const [balances, setBalances] = useState(null);
  const [leaves, setLeaves] = useState([]);
  const [holidayData, setHolidayData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({
    ...EMPTY_FORM,
    leaveType: restrictedOnly ? 'restricted' : 'casual',
  });
  const [busy, setBusy] = useState(false);
  const [modalError, setModalError] = useState('');
  const [errorPopup, setErrorPopup] = useState(null);
  const [submittedPopup, setSubmittedPopup] = useState(null);

  async function reload() {
    setLoading(true);
    try {
      const mineQuery = user?.id
        ? `/leaves?userId=${user.id}&from=${year}-01-01&to=${year}-12-31`
        : `/leaves?from=${year}-01-01&to=${year}-12-31`;
      const [balanceData, leaveData, holidays] = await Promise.all([
        api('/balances/me'),
        api(mineQuery),
        api(`/holidays?year=${year}`),
      ]);
      setBalances(balanceData.balances);
      const mine = (leaveData.leaves || []).filter(
        (leave) => String(leave.userId) === String(user?.id)
      );
      setLeaves(mine);
      setHolidayData(holidays);
    } catch {
      setBalances({ casual: 0, earned: 0, sick: 0, restricted: 2, celebration: 0 });
      setLeaves([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
  }, [year, user?.id]);

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
  const balanceCards = useMemo(() => {
    const totals = computePersonalLeaveTotals(balances, leaves, user?.id);
    return restrictedOnly ? totals.filter((card) => card.key === 'restricted') : totals;
  }, [balances, leaves, user?.id, restrictedOnly]);
  const typeOptions = restrictedOnly
    ? [['restricted', APPLY_LABELS.restricted]]
    : Object.entries(APPLY_LABELS);
  const restricted = form.leaveType === 'restricted';
  const celebration = form.leaveType === 'celebration';
  const wfh = isWfh(form.leaveType);
  const halfDay = !restricted && !celebration && form.session !== 'full';
  const requestedDays = celebration
    ? form.startDate
      ? 1
      : 0
    : estimateDays(form.startDate, form.endDate, form.session, restricted);
  const recent = leaves.slice(0, 8);

  function showApplyError(message, title = 'Cannot apply leave') {
    setErrorPopup({ title, message });
    setModalError(message);
  }

  function openModal() {
    setModalError('');
    setForm({
      ...EMPTY_FORM,
      leaveType: restrictedOnly ? 'restricted' : 'casual',
    });
    setShowModal(true);
  }

  function setType(key) {
    if (key === 'restricted' && noRestrictedBalance) {
      showApplyError(insufficientRestrictedBalance(restrictedBalance), 'No restricted leave balance');
      return;
    }
    setForm((current) => ({
      ...current,
      leaveType: key,
      session: key === 'restricted' || key === 'celebration' ? 'full' : current.session,
      startDate: key === 'restricted' ? '' : current.startDate,
      endDate:
        key === 'restricted'
          ? ''
          : key === 'celebration'
            ? current.startDate || current.endDate
            : current.endDate,
    }));
  }

  function pickWorkingDate(field, value) {
    const nextStart = field === 'startDate' ? value : form.startDate;
    const nextEnd =
      field === 'endDate'
        ? value
        : field === 'startDate' && (halfDay || form.session !== 'full')
          ? value
          : form.endDate;
    const blocked = blockedRegularLeaveMessage(nextStart, nextEnd || nextStart, generalHolidayMap);
    if (blocked) {
      showApplyError(blocked);
      return;
    }
    setForm((current) => ({
      ...current,
      [field]: value,
      endDate:
        field === 'startDate' && (halfDay || current.session !== 'full')
          ? value
          : field === 'endDate'
            ? value
            : current.endDate || value,
    }));
  }

  async function onSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setModalError('');
    try {
      const body = {
        ...form,
        session: restricted ? 'full' : form.session,
        startDate: toYmd(form.startDate),
        endDate: restricted || halfDay ? toYmd(form.startDate) : toYmd(form.endDate),
      };
      if (restricted) {
        if (noRestrictedBalance) throw new Error(insufficientRestrictedBalance(restrictedBalance));
        if (!body.startDate || !rhDates.has(body.startDate)) throw new Error(RH_ONLY_PUBLISHED_DATES);
      } else {
        const blocked = blockedRegularLeaveMessage(body.startDate, body.endDate, generalHolidayMap);
        if (blocked) throw new Error(blocked);
      }
      const available = Number(balances?.[form.leaveType] ?? 0);
      if (!wfh && requestedDays > available) {
        throw new Error(
          `Insufficient balance. You requested ${requestedDays} day${requestedDays === 1 ? '' : 's'} but only have ${available} left.`
        );
      }
      const autoApproved = user?.role === 'hr';
      await api('/leaves', { method: 'POST', body });
      setShowModal(false);
      setSubmittedPopup({
        message: restricted
          ? autoApproved
            ? 'Restricted leave applied'
            : 'Restricted leave submitted'
          : wfh
            ? autoApproved
              ? 'Work from Home applied'
              : 'Work from Home submitted'
            : autoApproved
              ? 'Leave applied'
              : 'Leave submitted',
        detail: autoApproved
          ? 'Approved and added to your calendar.'
          : 'Your request is waiting for manager approval, then HR.',
        imageSrc: autoApproved ? '/assets/leave-approved.gif' : '/assets/request-submitted.gif',
      });
      await reload();
    } catch (error) {
      const message = error.message || 'Could not submit leave';
      showApplyError(
        message,
        /insufficient/i.test(message) ? 'No leave balance' : 'Cannot apply leave'
      );
    } finally {
      setBusy(false);
    }
  }

  const portalRoot = getPortalRoot();
  const overlays = portalRoot
      ? createPortal(
          <>
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
              imageSrc={submittedPopup?.imageSrc || '/assets/request-submitted.gif'}
              durationMs={3200}
            />
            {showModal ? (
              <div
                className="modal-backdrop leave-dash-backdrop"
                data-theme={themeMode}
                onClick={() => setShowModal(false)}
              >
                <div
                  className="leave-dash-modal"
                  data-theme={themeMode}
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="leave-dash-modal-title"
                  onClick={(event) => event.stopPropagation()}
                >
                  <header>
                    <h3 id="leave-dash-modal-title">Apply Leave</h3>
                    <button
                      type="button"
                      className="leave-dash-close"
                      onClick={() => setShowModal(false)}
                      aria-label="Close"
                    >
                      ×
                    </button>
                  </header>
                  {modalError ? <p className="leave-dash-modal-error">{modalError}</p> : null}
                  <form onSubmit={onSubmit}>
                    <label>
                      <span className="leave-dash-field-label">Leave category type</span>
                      <select
                        value={form.leaveType}
                        onChange={(event) => setType(event.target.value)}
                        required
                      >
                        {typeOptions.map(([key, label]) => {
                          const left = key === 'wfh' ? null : Number(balances?.[key] ?? 0);
                          return (
                            <option key={key} value={key}>
                              {left == null ? label : `${label} (${left} days left)`}
                            </option>
                          );
                        })}
                      </select>
                    </label>

                    {restricted ? (
                      <label>
                        <span className="leave-dash-field-label">Restricted leave</span>
                        <select
                          value={form.startDate}
                          required
                          disabled={noRestrictedBalance}
                          onChange={(event) => {
                            const value = event.target.value;
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
                            setForm((current) => ({
                              ...current,
                              startDate: value,
                              endDate: value,
                              session: 'full',
                            }));
                          }}
                        >
                          <option value="">Select a published RH date…</option>
                          {(holidayData?.restricted || []).map((holiday) => (
                            <option key={holiday.id} value={toYmd(holiday.startDate)}>
                              {holidayDateLabel(holiday)}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : celebration ? (
                      <>
                        <p className="muted leave-dash-hint">
                          Celebration leave is 1 day credited each year after your birthday. Apply it
                          on your birthday date only.
                        </p>
                        <label>
                          <span className="leave-dash-field-label">Birthday date</span>
                          <input
                            type="date"
                            value={form.startDate}
                            required
                            onChange={(event) => {
                              const value = event.target.value;
                              setForm((current) => ({
                                ...current,
                                startDate: value,
                                endDate: value,
                                session: 'full',
                              }));
                            }}
                          />
                        </label>
                      </>
                    ) : (
                      <>
                        {!wfh && (
                          <label>
                            <span className="leave-dash-field-label">Session</span>
                            <select
                              value={form.session}
                              onChange={(event) => {
                                const session = event.target.value;
                                setForm((current) => ({
                                  ...current,
                                  session,
                                  endDate:
                                    session !== 'full'
                                      ? current.startDate || current.endDate
                                      : current.endDate,
                                }));
                              }}
                            >
                              {Object.entries(SESSION_LABELS).map(([key, label]) => (
                                <option key={key} value={key}>
                                  {label}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                        <div className="leave-dash-dates">
                          <label>
                            <span className="leave-dash-field-label">
                              {halfDay ? 'Date' : 'Start date'}
                            </span>
                            <input
                              type="date"
                              value={form.startDate}
                              required
                              onChange={(event) => pickWorkingDate('startDate', event.target.value)}
                            />
                          </label>
                          {!halfDay && (
                            <label>
                              <span className="leave-dash-field-label">End date</span>
                              <input
                                type="date"
                                value={form.endDate}
                                min={form.startDate || undefined}
                                required
                                onChange={(event) => pickWorkingDate('endDate', event.target.value)}
                              />
                            </label>
                          )}
                        </div>
                      </>
                    )}

                    <label>
                      <span className="leave-dash-field-label">Total duration days requested</span>
                      <input
                        readOnly
                        value={requestedDays ? String(requestedDays) : ''}
                        placeholder="e.g. 2"
                      />
                    </label>

                    <label>
                      <span className="leave-dash-field-label">Notes</span>
                      <textarea
                        rows={2}
                        value={form.reason}
                        onChange={(event) =>
                          setForm((current) => ({ ...current, reason: event.target.value }))
                        }
                        placeholder="Optional"
                      />
                    </label>

                    <div className="leave-dash-modal-actions">
                      <button
                        type="button"
                        className="btn secondary"
                        onClick={() => setShowModal(false)}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="btn primary"
                        disabled={busy || (restricted && noRestrictedBalance)}
                      >
                        {busy ? 'Submitting…' : 'Submit Request'}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            ) : null}
          </>,
          portalRoot
        )
      : null;
  return (
    <div className="apply-leave">
      {overlays}

      <header className="apply-leave-head">
        <div className="apply-leave-who">
          <span className="apply-leave-avatar">{initials(user?.name)}</span>
          <div>
            <strong className="apply-leave-who-name">{user?.name || 'Employee'}</strong>
            <p>
              {restrictedOnly ? 'Manager' : user?.role === 'hr' ? 'HR' : 'Employee'} · Active
            </p>
          </div>
        </div>
        <button type="button" className="btn apply-leave-cta" onClick={openModal}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 4v16m8-8H4" />
          </svg>
          Apply Leave
        </button>
      </header>

      {loading && !balances ? (
        <p className="muted apply-leave-loading">Loading balances…</p>
      ) : (
        <LeaveBalanceSummaryCards
          className={`apply-leave-balances${restrictedOnly ? ' is-single' : ''}`}
          items={balanceCards}
        />
      )}

      <section className="apply-leave-panel">
        <div className="apply-leave-panel-head">
          <h2>Recent Leave Requests</h2>
          <span>Updated from your requests</span>
        </div>
        {!recent.length ? (
          <p className="empty apply-leave-empty">No leave requests yet.</p>
        ) : (
          <div className="apply-leave-table-wrap">
            <table className="apply-leave-table">
              <thead>
                <tr>
                  <th>Leave Type</th>
                  <th>Duration / Dates</th>
                  <th>Days</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((leave) => (
                  <tr key={leave.id}>
                    <td>{REQUEST_LABELS[leave.leaveType] || leave.leaveType}</td>
                    <td>{formatLeaveSpan(leave).split(' · ')[0]}</td>
                    <td>
                      {Number(leave.days || 0).toFixed(Number(leave.days) % 1 ? 1 : 0)}{' '}
                      {Number(leave.days) === 1 ? 'day' : 'days'}
                    </td>
                    <td>
                      <span className={`apply-leave-status is-${statusTone(leave.status)}`}>
                        {STATUS_LABELS[leave.status] || leave.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
