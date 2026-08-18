import { useEffect, useMemo, useRef, useState } from 'react';
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isWeekend,
  isWithinInterval,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns';
import {
  APPLY_LABELS,
  LEAVE_LABELS,
  REQUEST_LABELS,
  SESSION_LABELS,
  STATUS_LABELS,
  appToday,
  canUserCancel,
  formatDate,
  formatLeaveSpan,
} from '../utils';

function BalanceTooltip({ leave, balances }) {
  const bal = balances || { casual: 0, earned: 0, sick: 0, compensation: 0 };

  return (
    <div className="cal-tooltip" role="tooltip">
      <strong className="cal-tooltip-name">{leave.userName}</strong>
      <span className={`cal-tooltip-type type-${leave.leaveType}`}>
        On {REQUEST_LABELS[leave.leaveType]}
        {leave.session && leave.session !== 'full'
          ? ` · ${SESSION_LABELS[leave.session]}`
          : ''}
        {' · '}
        {format(parseISO(leave.startDate), 'd MMM')}
        {leave.startDate !== leave.endDate
          ? ` – ${format(parseISO(leave.endDate), 'd MMM')}`
          : ''}
      </span>
      <div className="cal-tooltip-balances">
        <span className="cal-tooltip-label">Available leave</span>
        <ul>
          {Object.entries(LEAVE_LABELS).map(([key, label]) => (
            <li key={key}>
              <span>{label}</span>
              <strong>{bal[key] ?? 0}</strong>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function sessionSuffix(session) {
  if (session === 'morning') return ' AM';
  if (session === 'afternoon') return ' PM';
  return '';
}

function primaryLeaveType(items) {
  if (!items.length) return null;
  const types = [...new Set(items.map((l) => l.leaveType))];
  return types.length === 1 ? types[0] : items[0].leaveType;
}

function shortTypeLabel(type) {
  if (type === 'wfh') return 'WFH';
  if (type === 'casual') return 'CL';
  if (type === 'earned') return 'EL';
  if (type === 'sick') return 'SL';
  if (type === 'compensation') return 'Comp';
  if (type === 'restricted') return 'RH';
  if (type === 'general') return 'GH';
  if (type === 'mandatory') return 'GH';
  return REQUEST_LABELS[type] || type;
}

export default function LeaveCalendar({
  leaves,
  showNames = false,
  balancesByUserId = null,
  onCancel = null,
  busyId = null,
  employees = null,
  canManage = false,
  onCreateLeave = null,
  onDeleteLeave = null,
}) {
  const [cursor, setCursor] = useState(() => startOfMonth(appToday()));
  const [selected, setSelected] = useState(null); // { id, day }
  const [employeeFilter, setEmployeeFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({
    userId: '',
    leaveType: 'casual',
    startDate: '',
    endDate: '',
    session: 'full',
    reason: '',
  });
  const [createBusy, setCreateBusy] = useState(false);
  const [createErr, setCreateErr] = useState('');
  const popoverRef = useRef(null);
  const showBalances = Boolean(balancesByUserId);
  const canCancelLeaves = typeof onCancel === 'function';
  const canDelete = canManage && typeof onDeleteLeave === 'function';
  const canCreate = canManage && typeof onCreateLeave === 'function';
  const today = appToday();

  const employeeOptions = useMemo(() => {
    if (employees?.length) return employees;
    const map = new Map();
    for (const leave of leaves || []) {
      if (leave.userId && !map.has(leave.userId)) {
        map.set(leave.userId, { id: leave.userId, name: leave.userName || `User ${leave.userId}` });
      }
    }
    return [...map.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }, [employees, leaves]);

  const filteredLeaves = useMemo(() => {
    const all = leaves || [];
    if (!employeeFilter) return all;
    return all.filter(
      (l) => l.isMandatory || String(l.userId) === String(employeeFilter)
    );
  }, [leaves, employeeFilter]);

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [cursor]);

  const selectedLeave = useMemo(
    () => (selected ? filteredLeaves.find((l) => l.id === selected.id) || null : null),
    [filteredLeaves, selected]
  );

  const multiDay =
    selectedLeave &&
    selectedLeave.startDate !== selectedLeave.endDate &&
    (selectedLeave.session || 'full') === 'full';

  useEffect(() => {
    if (!selected) return undefined;

    function onPointerDown(e) {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        setSelected(null);
      }
    }
    function onKey(e) {
      if (e.key === 'Escape') setSelected(null);
    }

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [selected]);

  function leavesOn(day) {
    return filteredLeaves.filter((leave) => {
      const start = parseISO(leave.startDate);
      const end = parseISO(leave.endDate);
      return isWithinInterval(day, { start, end });
    });
  }

  async function handleCancel(leave, opts = {}) {
    const done = await onCancel(leave, opts);
    if (done !== false) setSelected(null);
  }

  async function handleDelete(leave) {
    const ok = window.confirm(
      leave.isMandatory
        ? `Remove mandatory leave “${leave.userName}” (${formatLeaveSpan(leave)}) from all calendars?`
        : `Delete ${REQUEST_LABELS[leave.leaveType] || leave.leaveType} for ${leave.userName}? This cannot be undone.`
    );
    if (!ok) return;
    const done = await onDeleteLeave(leave);
    if (done !== false) setSelected(null);
  }

  function openCreate(dayKey = '') {
    setCreateErr('');
    setCreateForm({
      userId: employeeFilter || (employeeOptions[0] ? String(employeeOptions[0].id) : ''),
      leaveType: 'casual',
      startDate: dayKey,
      endDate: dayKey,
      session: 'full',
      reason: '',
    });
    setShowCreate(true);
  }

  async function submitCreate(e) {
    e.preventDefault();
    setCreateBusy(true);
    setCreateErr('');
    try {
      const isRestricted = createForm.leaveType === 'restricted';
      const body = {
        ...createForm,
        userId: Number(createForm.userId),
        session: isRestricted ? 'full' : createForm.session,
        endDate: isRestricted || createForm.session !== 'full' ? createForm.startDate : createForm.endDate,
      };
      await onCreateLeave(body);
      setShowCreate(false);
    } catch (err) {
      setCreateErr(err.message || 'Could not create leave');
    } finally {
      setCreateBusy(false);
    }
  }

  return (
    <div className="calendar calendar-pro">
      <div className="calendar-toolbar">
        <div className="calendar-nav">
          <button
            type="button"
            className="btn ghost calendar-nav-btn"
            onClick={() => setCursor((c) => subMonths(c, 1))}
            aria-label="Previous month"
          >
            ‹
          </button>
          <h3>{format(cursor, 'MMMM yyyy')}</h3>
          <button
            type="button"
            className="btn ghost calendar-nav-btn"
            onClick={() => setCursor((c) => addMonths(c, 1))}
            aria-label="Next month"
          >
            ›
          </button>
        </div>
        <div className="calendar-toolbar-actions">
          {(showNames || canManage) && (
            <label className="calendar-employee-filter">
              <span className="sr-only">Employee</span>
              <select
                value={employeeFilter}
                onChange={(e) => setEmployeeFilter(e.target.value)}
                aria-label="Filter by employee"
              >
                <option value="">All employees</option>
                {employeeOptions.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {canCreate && (
            <button
              type="button"
              className="btn primary calendar-add-btn"
              onClick={() => openCreate()}
              aria-label="Add leave"
              title="Add leave for an employee"
            >
              +
            </button>
          )}
          <button
            type="button"
            className="btn secondary calendar-today-btn"
            onClick={() => setCursor(startOfMonth(today))}
          >
            Today
          </button>
        </div>
      </div>

      <div className="calendar-legend" aria-hidden="true">
        {Object.entries(APPLY_LABELS).map(([key, label]) => (
          <span key={key} className="legend-item">
            <i className={`legend-swatch type-${key}`} /> {label}
          </span>
        ))}
        <span className="legend-item">
          <i className="legend-swatch type-general" /> General Holiday
        </span>
        <span className="legend-item">
          <i className="legend-swatch type-weekend" /> Sat / Sun
        </span>
      </div>

      {canCancelLeaves && (
        <p className="calendar-hint muted">
          Tap a leave day to cancel that day only, or cancel the full request.
        </p>
      )}
      {canManage && (
        <p className="calendar-hint muted">
          Use the employee dropdown to focus one person. Tap + to add leave, or open a chip to delete.
          General holidays (GH, blue) and restricted holidays (RH, pink) stay visible for every employee filter.
          Saturdays and Sundays are grey company offs.
        </p>
      )}

      <div className="calendar-grid head">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <div key={d} className={`calendar-dow${d === 'Sat' || d === 'Sun' ? ' is-weekend' : ''}`}>
            {d}
          </div>
        ))}
      </div>

      <div className="calendar-grid body">
        {days.map((day) => {
          const items = leavesOn(day);
          const outside = !isSameMonth(day, cursor);
          const isToday = isSameDay(day, today);
          const weekend = isWeekend(day);
          const leaveType = primaryLeaveType(items);
          const dayKey = format(day, 'yyyy-MM-dd');
          return (
            <div
              key={day.toISOString()}
              className={[
                'calendar-cell',
                outside ? 'muted' : '',
                isToday ? 'today' : '',
                weekend ? 'weekend' : '',
                items.length ? 'has-leave' : '',
                leaveType ? `leave-bg-${leaveType}` : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <div className="day-head">
                <span className={`day-num${isToday ? ' is-today' : ''}`}>
                  {format(day, 'd')}
                </span>
                <div className="day-head-actions">
                  {items.length > 0 && <span className="day-count">{items.length}</span>}
                  {canCreate && !outside && (
                    <button
                      type="button"
                      className="calendar-day-add"
                      aria-label={`Add leave on ${dayKey}`}
                      title="Add leave on this day"
                      onClick={(e) => {
                        e.stopPropagation();
                        openCreate(dayKey);
                      }}
                    >
                      +
                    </button>
                  )}
                </div>
              </div>
              <div className="leave-chips">
                {items.slice(0, 3).map((leave) => {
                  const cancellable =
                    canCancelLeaves && !leave.isMandatory && canUserCancel(leave.status);
                  const interactive = cancellable || canDelete || (showBalances && !leave.isMandatory);
                  const ChipTag = interactive ? 'button' : 'span';
                  const isSelected =
                    selected?.id === leave.id && selected?.day === dayKey;
                  return (
                    <ChipTag
                      key={`${leave.id}-${dayKey}`}
                      type={interactive ? 'button' : undefined}
                      className={[
                        'chip',
                        'leave-chip',
                        `type-${leave.leaveType}`,
                        showBalances && !leave.isMandatory ? 'has-tip' : '',
                        cancellable || canDelete ? 'chip-cancellable' : '',
                        leave.status && leave.status !== 'approved' ? 'chip-pending' : '',
                        isSelected ? 'is-selected' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      title={
                        showBalances && !leave.isMandatory
                          ? undefined
                          : `${showNames || leave.isMandatory ? leave.userName + ' · ' : ''}${REQUEST_LABELS[leave.leaveType]}${
                              leave.session && leave.session !== 'full'
                                ? ` · ${SESSION_LABELS[leave.session]}`
                                : ''
                            }${leave.status && leave.status !== 'approved' ? ` · ${STATUS_LABELS[leave.status] || leave.status}` : ''}`
                      }
                      onClick={
                        cancellable || canDelete
                          ? (e) => {
                              e.stopPropagation();
                              setSelected((cur) =>
                                cur?.id === leave.id && cur?.day === dayKey
                                  ? null
                                  : { id: leave.id, day: dayKey }
                              );
                            }
                          : undefined
                      }
                    >
                      <span className="leave-chip-main">
                        {showNames || leave.isMandatory
                          ? String(leave.userName || 'Mandatory').split(' ')[0]
                          : shortTypeLabel(leave.leaveType)}
                        {sessionSuffix(leave.session)}
                      </span>
                      {(showNames || leave.isMandatory) && (
                        <span className="leave-chip-sub">{shortTypeLabel(leave.leaveType)}</span>
                      )}
                      {showBalances && !leave.isMandatory && (
                        <BalanceTooltip
                          leave={leave}
                          balances={balancesByUserId[leave.userId]}
                        />
                      )}
                    </ChipTag>
                  );
                })}
                {items.length > 3 && (
                  <span className="chip more">+{items.length - 3} more</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {selectedLeave && selected && (canCancelLeaves || canDelete) && (
        <div className="cal-leave-popover" ref={popoverRef} role="dialog" aria-label="Leave details">
          <div className="cal-leave-popover-head">
            <span className={`badge type-${selectedLeave.leaveType}`}>
              {REQUEST_LABELS[selectedLeave.leaveType]}
            </span>
            {!selectedLeave.isMandatory && (
              <span className={`status-pill status-${selectedLeave.status}`}>
                {STATUS_LABELS[selectedLeave.status] || selectedLeave.status}
              </span>
            )}
            <button
              type="button"
              className="btn ghost cal-leave-close"
              onClick={() => setSelected(null)}
              aria-label="Close"
            >
              ×
            </button>
          </div>
          {(showNames || selectedLeave.isMandatory) && (
            <p className="cal-leave-person"><strong>{selectedLeave.userName}</strong></p>
          )}
          <p className="cal-leave-span">{formatLeaveSpan(selectedLeave)}</p>
          <p className="cal-leave-day">
            Selected day: <strong>{formatDate(selected.day)}</strong>
          </p>
          {selectedLeave.reason && (
            <p className="cal-leave-reason muted">{selectedLeave.reason}</p>
          )}
          <div className="cal-leave-actions">
            {canCancelLeaves && !selectedLeave.isMandatory && canUserCancel(selectedLeave.status) && (
              multiDay ? (
                <>
                  <button
                    type="button"
                    className="btn danger"
                    disabled={busyId === selectedLeave.id}
                    onClick={() => handleCancel(selectedLeave, { date: selected.day })}
                  >
                    {busyId === selectedLeave.id ? 'Cancelling…' : 'Cancel this day'}
                  </button>
                  <button
                    type="button"
                    className="btn danger ghost-danger"
                    disabled={busyId === selectedLeave.id}
                    onClick={() => handleCancel(selectedLeave, { cancelAll: true })}
                  >
                    Cancel entire leave
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="btn danger"
                  disabled={busyId === selectedLeave.id}
                  onClick={() => handleCancel(selectedLeave, { cancelAll: true })}
                >
                  {busyId === selectedLeave.id ? 'Cancelling…' : 'Cancel leave'}
                </button>
              )
            )}
            {canDelete && (
              <button
                type="button"
                className="btn ghost-danger"
                disabled={busyId === selectedLeave.id}
                onClick={() => handleDelete(selectedLeave)}
              >
                {busyId === selectedLeave.id
                  ? 'Deleting…'
                  : selectedLeave.isMandatory
                    ? 'Remove mandatory leave'
                    : 'Delete leave'}
              </button>
            )}
          </div>
        </div>
      )}

      {showCreate && (
        <div className="modal-backdrop modal-backdrop-static">
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="cal-create-title">
            <div className="row-between">
              <h2 id="cal-create-title">Add leave</h2>
              <button type="button" className="btn ghost" onClick={() => setShowCreate(false)}>
                Close
              </button>
            </div>
            <form className="stack-form" onSubmit={submitCreate}>
              <label>
                Employee
                <select
                  value={createForm.userId}
                  onChange={(e) => setCreateForm((f) => ({ ...f, userId: e.target.value }))}
                  required
                >
                  <option value="">Select…</option>
                  {employeeOptions.map((u) => (
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
                  onChange={(e) =>
                    setCreateForm((f) => ({
                      ...f,
                      leaveType: e.target.value,
                      session: e.target.value === 'restricted' ? 'full' : f.session,
                      endDate: e.target.value === 'restricted' ? f.startDate : f.endDate,
                    }))
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
                  onChange={(e) =>
                    setCreateForm((f) => ({
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
              )}
              <label>
                {createForm.leaveType === 'restricted' || createForm.session !== 'full'
                  ? 'Date'
                  : 'Start date'}
                <input
                  type="date"
                  value={createForm.startDate}
                  onChange={(e) =>
                    setCreateForm((f) => ({
                      ...f,
                      startDate: e.target.value,
                      endDate:
                        f.leaveType === 'restricted' || f.session !== 'full'
                          ? e.target.value
                          : f.endDate || e.target.value,
                    }))
                  }
                  required
                />
              </label>
              {createForm.leaveType !== 'restricted' && createForm.session === 'full' && (
                <label>
                  End date
                  <input
                    type="date"
                    value={createForm.endDate}
                    onChange={(e) => setCreateForm((f) => ({ ...f, endDate: e.target.value }))}
                    required
                  />
                </label>
              )}
              {createForm.leaveType === 'restricted' && (
                <p className="muted slim">
                  Restricted holidays must be a date from the company RH list. Each employee or
                  manager may take only 2 per year.
                </p>
              )}
              <label>
                Reason (optional)
                <input
                  value={createForm.reason}
                  onChange={(e) => setCreateForm((f) => ({ ...f, reason: e.target.value }))}
                />
              </label>
              {createErr && <p className="form-error">{createErr}</p>}
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
      )}
    </div>
  );
}
