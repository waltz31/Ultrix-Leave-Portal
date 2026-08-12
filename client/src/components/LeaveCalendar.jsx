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
  const bal = balances || { casual: 0, earned: 0, sick: 0 };

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

export default function LeaveCalendar({
  leaves,
  showNames = false,
  balancesByUserId = null,
  onCancel = null,
  busyId = null,
}) {
  const [cursor, setCursor] = useState(() => startOfMonth(appToday()));
  const [selected, setSelected] = useState(null); // { id, day }
  const popoverRef = useRef(null);
  const showBalances = Boolean(balancesByUserId);
  const canCancelLeaves = typeof onCancel === 'function';
  const today = appToday();

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [cursor]);

  const selectedLeave = useMemo(
    () => (selected ? leaves.find((l) => l.id === selected.id) || null : null),
    [leaves, selected]
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
    return leaves.filter((leave) => {
      const start = parseISO(leave.startDate);
      const end = parseISO(leave.endDate);
      return isWithinInterval(day, { start, end });
    });
  }

  async function handleCancel(leave, opts = {}) {
    const done = await onCancel(leave, opts);
    if (done !== false) setSelected(null);
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
        <button
          type="button"
          className="btn secondary calendar-today-btn"
          onClick={() => setCursor(startOfMonth(today))}
        >
          Today
        </button>
      </div>

      <div className="calendar-legend" aria-hidden="true">
        <span className="legend-item">
          <i className="legend-dot type-casual" /> Casual
        </span>
        <span className="legend-item">
          <i className="legend-dot type-earned" /> Earned
        </span>
        <span className="legend-item">
          <i className="legend-dot type-sick" /> Sick
        </span>
        <span className="legend-item">
          <i className="legend-dot type-wfh" /> WFH
        </span>
      </div>

      {canCancelLeaves && (
        <p className="calendar-hint muted">
          Tap a leave day to cancel that day only, or cancel the full request.
        </p>
      )}

      <div className="calendar-grid head">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <div key={d} className="calendar-dow">
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
                {items.length > 0 && (
                  <span className="day-count">{items.length}</span>
                )}
              </div>
              <div className="leave-chips">
                {items.slice(0, 3).map((leave) => {
                  const cancellable = canCancelLeaves && canUserCancel(leave.status);
                  const ChipTag = cancellable ? 'button' : 'span';
                  const isSelected =
                    selected?.id === leave.id && selected?.day === dayKey;
                  return (
                    <ChipTag
                      key={`${leave.id}-${dayKey}`}
                      type={cancellable ? 'button' : undefined}
                      className={[
                        'chip',
                        `type-${leave.leaveType}`,
                        showBalances ? 'has-tip' : '',
                        cancellable ? 'chip-cancellable' : '',
                        leave.status && leave.status !== 'approved' ? 'chip-pending' : '',
                        isSelected ? 'is-selected' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      title={
                        showBalances
                          ? undefined
                          : `${showNames ? leave.userName + ' · ' : ''}${REQUEST_LABELS[leave.leaveType]}${
                              leave.session && leave.session !== 'full'
                                ? ` · ${SESSION_LABELS[leave.session]}`
                                : ''
                            }${leave.status && leave.status !== 'approved' ? ` · ${STATUS_LABELS[leave.status] || leave.status}` : ''}${
                              cancellable ? ' · Click to cancel' : ''
                            }`
                      }
                      onClick={
                        cancellable
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
                      {showNames ? leave.userName.split(' ')[0] : REQUEST_LABELS[leave.leaveType]}
                      {sessionSuffix(leave.session)}
                      {showBalances && (
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

      {selectedLeave && selected && canCancelLeaves && (
        <div className="cal-leave-popover" ref={popoverRef} role="dialog" aria-label="Leave details">
          <div className="cal-leave-popover-head">
            <span className={`badge type-${selectedLeave.leaveType}`}>
              {REQUEST_LABELS[selectedLeave.leaveType]}
            </span>
            <span className={`status-pill status-${selectedLeave.status}`}>
              {STATUS_LABELS[selectedLeave.status] || selectedLeave.status}
            </span>
            <button
              type="button"
              className="btn ghost cal-leave-close"
              onClick={() => setSelected(null)}
              aria-label="Close"
            >
              ×
            </button>
          </div>
          <p className="cal-leave-span">{formatLeaveSpan(selectedLeave)}</p>
          <p className="cal-leave-day">
            Selected day: <strong>{formatDate(selected.day)}</strong>
          </p>
          {selectedLeave.reason && (
            <p className="cal-leave-reason muted">{selectedLeave.reason}</p>
          )}
          {canUserCancel(selectedLeave.status) && (
            <div className="cal-leave-actions">
              {multiDay ? (
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
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
