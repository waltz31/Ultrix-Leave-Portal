import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { getPortalRoot } from '../portalRoot';
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

const RING = { r: 26, c: 2 * Math.PI * 26 };
const BALANCE_CARDS = [
  { key: 'earned', label: 'Earned Leave', tone: 'indigo' },
  { key: 'sick', label: 'Sick Leave', tone: 'amber' },
  { key: 'casual', label: 'Casual Leave', tone: 'teal' },
  { key: 'restricted', label: 'Restricted Leave', tone: 'rose' },
];

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

function usageFor(leaves, type, remaining) {
  const used = (leaves || [])
    .filter((leave) => leave.leaveType === type && leave.status === 'approved')
    .reduce((sum, leave) => sum + Number(leave.days || 0), 0);
  const allocated = Math.max(remaining + used, remaining, 0);
  const ratio = allocated > 0 ? Math.max(0, Math.min(1, remaining / allocated)) : 0;
  return { remaining, used, allocated, ratio };
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
      const mineQuery = user?.id ? `/leaves?userId=${user.id}` : '/leaves';
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
      setBalances({ casual: 0, earned: 0, sick: 0, restricted: 2 });
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
  const cards = restrictedOnly
    ? BALANCE_CARDS.filter((card) => card.key === 'restricted')
    : BALANCE_CARDS;
  const typeOptions = restrictedOnly
    ? [['restricted', APPLY_LABELS.restricted]]
    : Object.entries(APPLY_LABELS);
  const restricted = form.leaveType === 'restricted';
  const wfh = isWfh(form.leaveType);
  const halfDay = !restricted && form.session !== 'full';
  const requestedDays = estimateDays(form.startDate, form.endDate, form.session, restricted);
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
      session: key === 'restricted' ? 'full' : current.session,
      startDate: key === 'restricted' ? '' : current.startDate,
      endDate: key === 'restricted' ? '' : current.endDate,
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
                onClick={() => setShowModal(false)}
              >
                <div
                  className="leave-dash-modal"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="leave-dash-modal-title"
                  onClick={(event) => event.stopPropagation()}
                >
                  <header>
                    <h3 id="leave-dash-modal-title">Request Leave Time Off</h3>
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
    <section className="leave-dash">
      {overlays}

      <header className="leave-dash-head">
        <div className="leave-dash-who">
          <span className="leave-dash-avatar">{initials(user?.name)}</span>
          <div>
            <h2>Time Off &amp; Leave Balance</h2>
            <p>
              {user?.name || 'Employee'} ·{' '}
              {restrictedOnly ? 'Manager' : user?.role === 'hr' ? 'HR' : 'Employee'} · Active
            </p>
          </div>
        </div>
        <button type="button" className="leave-dash-request" onClick={openModal}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 4v16m8-8H4" />
          </svg>
          Request Time Off
        </button>
      </header>

      {loading && !balances ? (
        <p className="muted">Loading balances…</p>
      ) : (
        <div className={`leave-dash-cards${restrictedOnly ? ' is-single' : ''}`}>
          {cards.map((card) => {
            const stats = usageFor(leaves, card.key, Number(balances?.[card.key] ?? 0));
            const offset = RING.c - stats.ratio * RING.c;
            return (
              <article key={card.key} className={`leave-dash-card tone-${card.tone}`}>
                <div>
                  <span className="leave-dash-pill">{card.label}</span>
                  <p className="leave-dash-remain">
                    <strong>{Number(stats.remaining).toFixed(stats.remaining % 1 ? 1 : 0)}</strong>
                    <span>days left</span>
                  </p>
                  <p className="leave-dash-alloc">
                    Allocated: {Number(stats.allocated).toFixed(stats.allocated % 1 ? 1 : 0)} days
                    {' · '}
                    Used: {Number(stats.used).toFixed(stats.used % 1 ? 1 : 0)}
                  </p>
                </div>
                <div className="leave-dash-ring" aria-hidden>
                  <svg viewBox="0 0 64 64">
                    <circle className="leave-dash-ring-bg" cx="32" cy="32" r={RING.r} />
                    <circle
                      className="leave-dash-ring-fg"
                      cx="32"
                      cy="32"
                      r={RING.r}
                      strokeDasharray={RING.c}
                      strokeDashoffset={offset}
                    />
                  </svg>
                  <span>{Math.round(stats.ratio * 100)}%</span>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <div className="leave-dash-table-wrap">
        <div className="leave-dash-table-head">
          <h3>Recent Leave Requests Logs</h3>
          <span>Updated from your requests</span>
        </div>
        {!recent.length ? (
          <p className="empty leave-dash-empty">No leave requests yet.</p>
        ) : (
          <div className="leave-dash-table-scroll">
            <table className="leave-dash-table">
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
                      <span className={`leave-dash-status is-${statusTone(leave.status)}`}>
                        · {STATUS_LABELS[leave.status] || leave.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
