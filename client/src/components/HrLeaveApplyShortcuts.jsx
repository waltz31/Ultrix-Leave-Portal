import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { getLeaveApplyFocus } from '../leaveApplyFocus';
import { getPortalRoot } from '../portalRoot';
import {
  APPLY_LABELS,
  SESSION_LABELS,
  appToday,
  blockedRegularLeaveMessage,
  generalHolidayMapFromList,
  holidayDateLabel,
  includeInAttendanceRoster,
  isApplyBlockError,
  RH_ONLY_PUBLISHED_DATES,
  toYmd,
} from '../utils';
import ErrorPopup from './ErrorPopup';

const SEQ_MS = 550;

function typingTarget(el) {
  if (!el) return false;
  const tag = String(el.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
}

function letterFromEvent(e) {
  const code = String(e.code || '');
  if (code === 'KeyA') return 'a';
  if (code === 'KeyP') return 'p';
  if (code === 'Period' || code === 'NumpadDecimal') return '.';
  const key = String(e.key || '').toLowerCase();
  if (key === 'a' || key === 'p' || key === '.') return key;
  return '';
}

/**
 * Global HR keyboard shortcuts (any screen):
 * A → full day · A.P → morning · P.A → afternoon
 * Case-insensitive (a/A, p/P). Prefills from last roster cell click when available.
 */
export default function HrLeaveApplyShortcuts() {
  const { user } = useAuth();
  const enabled = user?.role === 'hr';

  const [showCreate, setShowCreate] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createErr, setCreateErr] = useState('');
  const [errorPopup, setErrorPopup] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [publishedRestricted, setPublishedRestricted] = useState([]);
  const [createForm, setCreateForm] = useState({
    userId: '',
    leaveType: 'casual',
    startDate: '',
    endDate: '',
    session: 'full',
    reason: '',
  });

  const keySeqRef = useRef({ first: '', at: 0, timer: 0 });
  const showCreateRef = useRef(false);
  showCreateRef.current = showCreate;

  const restrictedHolidayOptions = useMemo(
    () =>
      [...publishedRestricted].sort((a, b) =>
        toYmd(a.startDate).localeCompare(toYmd(b.startDate))
      ),
    [publishedRestricted]
  );
  const restrictedHolidayDates = useMemo(
    () => new Set(restrictedHolidayOptions.map((h) => toYmd(h.startDate))),
    [restrictedHolidayOptions]
  );
  const generalHolidayMap = useMemo(() => generalHolidayMapFromList(leaves), [leaves]);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    const year = appToday().getFullYear();
    Promise.all([
      api('/users').then((d) => d.users || []),
      api(`/leaves/calendar?from=${year}-01-01&to=${year}-12-31`).then((d) => d.leaves || []),
      api(`/holidays?year=${year}`).then((d) => d.restricted || []).catch(() => []),
    ])
      .then(([users, calendarLeaves, restricted]) => {
        if (cancelled) return;
        setEmployees(
          users.filter((u) => u.id !== user?.id && includeInAttendanceRoster(u))
        );
        setLeaves(calendarLeaves);
        setPublishedRestricted(restricted);
      })
      .catch(() => {
        if (!cancelled) {
          setEmployees([]);
          setLeaves([]);
          setPublishedRestricted([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, user?.id]);

  function openWithSession(session) {
    const focus = getLeaveApplyFocus();
    const dayYmd = toYmd(focus?.dayYmd) || toYmd(appToday());
    const rh = restrictedHolidayOptions.find((h) => toYmd(h.startDate) === dayYmd);
    if (dayYmd && !rh) {
      const blocked = blockedRegularLeaveMessage(dayYmd, dayYmd, generalHolidayMap);
      if (blocked) {
        setErrorPopup({ title: 'Cannot apply leave', message: blocked });
        return;
      }
    }
    const nextSession = rh ? 'full' : SESSION_LABELS[session] ? session : 'full';
    setCreateErr('');
    setCreateForm({
      userId: focus?.userId || (employees[0] ? String(employees[0].id) : ''),
      leaveType: rh ? 'restricted' : 'casual',
      startDate: dayYmd,
      endDate: dayYmd,
      session: nextSession,
      reason: rh ? rh.userName || '' : '',
    });
    setShowCreate(true);
  }

  const openWithSessionRef = useRef(openWithSession);
  openWithSessionRef.current = openWithSession;

  useEffect(() => {
    if (!enabled) return undefined;

    function clearSeq() {
      if (keySeqRef.current.timer) window.clearTimeout(keySeqRef.current.timer);
      keySeqRef.current = { first: '', at: 0, timer: 0 };
    }

    function onKey(e) {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (showCreateRef.current) return;
      if (typingTarget(e.target)) return;
      if (document.querySelector('.modal-backdrop')) return;

      const key = letterFromEvent(e);
      if (!key) return;

      const now = Date.now();
      const { first, at } = keySeqRef.current;
      const within = Boolean(first) && now - at <= SEQ_MS;

      if (key === '.') {
        if (within && (first === 'a' || first === 'p')) {
          e.preventDefault();
          keySeqRef.current = { first: `${first}.`, at: now, timer: keySeqRef.current.timer };
        }
        return;
      }

      if (within && (first === 'a' || first === 'a.') && key === 'p') {
        e.preventDefault();
        clearSeq();
        openWithSessionRef.current('morning');
        return;
      }
      if (within && (first === 'p' || first === 'p.') && key === 'a') {
        e.preventDefault();
        clearSeq();
        openWithSessionRef.current('afternoon');
        return;
      }

      if (key === 'a') {
        e.preventDefault();
        if (keySeqRef.current.timer) window.clearTimeout(keySeqRef.current.timer);
        keySeqRef.current = {
          first: 'a',
          at: now,
          timer: window.setTimeout(() => {
            keySeqRef.current = { first: '', at: 0, timer: 0 };
            openWithSessionRef.current('full');
          }, SEQ_MS),
        };
        return;
      }

      if (key === 'p') {
        e.preventDefault();
        if (keySeqRef.current.timer) window.clearTimeout(keySeqRef.current.timer);
        keySeqRef.current = {
          first: 'p',
          at: now,
          timer: window.setTimeout(() => {
            keySeqRef.current = { first: '', at: 0, timer: 0 };
          }, SEQ_MS),
        };
      }
    }

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      clearSeq();
    };
  }, [enabled]);

  async function submitCreate(e) {
    e.preventDefault();
    setCreateBusy(true);
    setCreateErr('');
    try {
      const isRestricted = createForm.leaveType === 'restricted';
      const startDate = toYmd(createForm.startDate);
      const endDate =
        isRestricted || createForm.session !== 'full' ? startDate : toYmd(createForm.endDate);
      if (!createForm.userId) throw new Error('Select an employee');
      if (isRestricted) {
        if (!startDate || !restrictedHolidayDates.has(startDate)) {
          throw new Error(RH_ONLY_PUBLISHED_DATES);
        }
      } else {
        const blocked = blockedRegularLeaveMessage(startDate, endDate, generalHolidayMap);
        if (blocked) throw new Error(blocked);
      }
      await api('/leaves/admin', {
        method: 'POST',
        body: {
          ...createForm,
          userId: Number(createForm.userId),
          startDate,
          session: isRestricted ? 'full' : createForm.session,
          endDate,
        },
      });
      setShowCreate(false);
      window.dispatchEvent(new CustomEvent('ultrix:admin-leave-created'));
    } catch (err) {
      const message = err.message || 'Could not create leave';
      if (isApplyBlockError(message)) {
        setErrorPopup({
          title: /insufficient restricted leave/i.test(message)
            ? 'No restricted leave balance'
            : 'Cannot apply leave',
          message,
        });
      }
      setCreateErr(message);
    } finally {
      setCreateBusy(false);
    }
  }

  if (!enabled) return null;

  const portal = getPortalRoot();
  if (!portal) return null;

  return createPortal(
    <>
      <ErrorPopup
        show={Boolean(errorPopup)}
        title={errorPopup?.title}
        message={errorPopup?.message}
        onClose={() => setErrorPopup(null)}
      />
      {showCreate ? (
        <div
          className="modal-backdrop"
          onClick={() => !createBusy && setShowCreate(false)}
        >
          <div
            className="modal cal-create-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="hr-shortcut-create-title"
            onClick={(ev) => ev.stopPropagation()}
          >
            <div className="row-between">
              <h2 id="hr-shortcut-create-title">Add leave</h2>
              <button type="button" className="btn ghost" onClick={() => setShowCreate(false)}>
                Close
              </button>
            </div>
            <form className="stack-form" onSubmit={submitCreate}>
              <label>
                Employee
                <select
                  value={createForm.userId}
                  onChange={(ev) => setCreateForm((f) => ({ ...f, userId: ev.target.value }))}
                  required
                >
                  <option value="">Select…</option>
                  {employees.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Leave type
                <select
                  value={createForm.leaveType}
                  onChange={(ev) =>
                    setCreateForm((f) => {
                      const leaveType = ev.target.value;
                      const rh =
                        leaveType === 'restricted'
                          ? restrictedHolidayOptions.find(
                              (h) => toYmd(h.startDate) === toYmd(f.startDate)
                            )
                          : null;
                      return {
                        ...f,
                        leaveType,
                        session: leaveType === 'restricted' ? 'full' : f.session,
                        startDate: leaveType === 'restricted' && !rh ? '' : f.startDate,
                        endDate: leaveType === 'restricted' ? (rh ? toYmd(rh.startDate) : '') : f.endDate,
                        reason: leaveType === 'restricted' ? rh?.userName || '' : f.reason,
                      };
                    })
                  }
                >
                  {Object.entries(APPLY_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              {createForm.leaveType !== 'restricted' && (
                <label>
                  Session
                  <select
                    value={createForm.session}
                    onChange={(ev) =>
                      setCreateForm((f) => ({
                        ...f,
                        session: ev.target.value,
                        endDate: ev.target.value !== 'full' ? f.startDate : f.endDate,
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
              )}
              <label>
                {createForm.leaveType === 'restricted'
                  ? 'Restricted leave'
                  : createForm.session !== 'full'
                    ? 'Date'
                    : 'Start date'}
                {createForm.leaveType === 'restricted' ? (
                  <select
                    value={createForm.startDate}
                    onChange={(ev) => {
                      const startDate = ev.target.value;
                      if (startDate && !restrictedHolidayDates.has(startDate)) {
                        setErrorPopup({
                          title: 'Cannot apply leave',
                          message: RH_ONLY_PUBLISHED_DATES,
                        });
                        return;
                      }
                      const rh = restrictedHolidayOptions.find((h) => toYmd(h.startDate) === startDate);
                      setCreateForm((f) => ({
                        ...f,
                        startDate,
                        endDate: startDate,
                        session: 'full',
                        reason: rh?.userName || f.reason,
                      }));
                    }}
                    required
                  >
                    <option value="">Select from the RH list…</option>
                    {restrictedHolidayOptions.map((h) => (
                      <option key={h.id} value={toYmd(h.startDate)}>
                        {holidayDateLabel(h)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="date"
                    value={createForm.startDate}
                    onChange={(ev) => {
                      const value = ev.target.value;
                      const blocked = blockedRegularLeaveMessage(
                        value,
                        createForm.session !== 'full' ? value : createForm.endDate || value,
                        generalHolidayMap
                      );
                      if (blocked) {
                        setErrorPopup({ title: 'Cannot apply leave', message: blocked });
                        return;
                      }
                      setCreateForm((f) => ({
                        ...f,
                        startDate: value,
                        endDate: f.session !== 'full' ? value : f.endDate || value,
                      }));
                    }}
                    required
                  />
                )}
              </label>
              {createForm.leaveType !== 'restricted' && createForm.session === 'full' && (
                <label>
                  End date
                  <input
                    type="date"
                    value={createForm.endDate}
                    onChange={(ev) => {
                      const value = ev.target.value;
                      const blocked = blockedRegularLeaveMessage(
                        createForm.startDate,
                        value,
                        generalHolidayMap
                      );
                      if (blocked) {
                        setErrorPopup({ title: 'Cannot apply leave', message: blocked });
                        return;
                      }
                      setCreateForm((f) => ({ ...f, endDate: value }));
                    }}
                    required
                  />
                </label>
              )}
              {createForm.leaveType === 'restricted' && !restrictedHolidayOptions.length && (
                <p className="form-error">
                  No restricted holidays are published yet. Add them under Company holidays first.
                </p>
              )}
              <label>
                Reason (optional)
                <input
                  value={createForm.reason}
                  onChange={(ev) => setCreateForm((f) => ({ ...f, reason: ev.target.value }))}
                />
              </label>
              {createErr && !errorPopup && <p className="form-error">{createErr}</p>}
              <div className="modal-actions">
                <button type="button" className="btn ghost" onClick={() => setShowCreate(false)}>
                  Cancel
                </button>
                <button className="btn primary" type="submit" disabled={createBusy}>
                  {createBusy ? 'Saving…' : 'Add leave'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>,
    portal
  );
}
