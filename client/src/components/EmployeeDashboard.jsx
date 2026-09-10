import { Link } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { usePollWhenVisible } from '../usePollWhenVisible';
import LeaveBalanceSummaryCards, { computePersonalLeaveTotals } from './LeaveBalanceSummaryCards';
import ErrorPopup from './ErrorPopup';
import StatusCelebration from './StatusCelebration';
import {
  REQUEST_LABELS,
  REQUIRED_WORK_MINUTES,
  STATUS_LABELS,
  appToday,
  avatarSrc,
  expectedLogoutFromPunchIn,
  formatDate,
  formatOverviewHolidayRow,
  formatTime,
  holidayKind,
  holidayKindLabel,
  insufficientRestrictedBalance,
  isApplyBlockError,
  displayEmployeeId,
  punchInLateness,
  toYmd,
} from '../utils';

const LEAVE_DOT = {
  earned: 'var(--elb-tone-earned, var(--tone-ok))',
  sick: 'var(--elb-tone-sick, var(--tone-accent))',
  casual: 'var(--elb-tone-casual, var(--tone-info))',
  restricted: 'var(--elb-tone-restricted, var(--tone-danger))',
  celebration: 'var(--elb-tone-celebration, var(--tone-pink))',
};

function initials(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return 'ME';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function formatLeaveRangeShort(start, end) {
  const startYmd = toYmd(start);
  const endYmd = toYmd(end);
  const fmtDay = (ymd) => {
    const [y, m, d] = ymd.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return {
      day: d,
      month: date.toLocaleString('en-IN', { month: 'short' }),
    };
  };
  const s = fmtDay(startYmd);
  if (startYmd === endYmd) return `${s.day} ${s.month}`;
  const e = fmtDay(endYmd);
  if (s.month === e.month) return `${s.day} - ${e.day} ${s.month}`;
  return `${s.day} ${s.month} - ${e.day} ${e.month}`;
}

function holidayCardDate(iso) {
  const { date, weekday } = formatOverviewHolidayRow(iso);
  const parts = String(date).split(' ').filter(Boolean);
  const day = parts.find((part) => /^\d+$/.test(part)) || parts[0] || '—';
  const month = parts.find((part) => /[A-Za-z]/.test(part)) || '';
  const full = (() => {
    const ymd = toYmd(iso);
    const [y, m, d] = ymd.split('-').map(Number);
    if (!y || !m || !d) return date;
    const dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString('en-IN', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  })();
  return { day, month: month.toUpperCase(), weekday, full };
}

function PanelLink({ to, children, tone }) {
  return (
    <Link to={to} className={`emp-dash-link${tone ? ` tone-${tone}` : ''}`}>
      {children}
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
        <path
          d="M9 6l6 6-6 6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </Link>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 8v4l2.5 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function TodayAttendance({ user, profile, attendanceTo }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const today = toYmd(appToday());
      const data = await api(`/attendance/calendar?from=${today}&to=${today}`);
      setSession((data.sessions || [])[0] || null);
    } catch {
      setSession(null);
    } finally {
      setLoading(false);
    }
  }, []);

  usePollWhenVisible(load, 60_000, [load]);

  const checkedIn = Boolean(session?.punchIn);
  const checkedOut = Boolean(session?.punchOut);
  const stillIn = Boolean(session?.stillIn);
  const punchInTone = session?.punchIn ? punchInLateness(session.punchIn) : null;
  const onTimeCheckIn = punchInTone === 'on-time';
  const empId = displayEmployeeId(user, profile, session);
  const expectedLogout = session?.punchIn
    ? expectedLogoutFromPunchIn(session.punchIn, REQUIRED_WORK_MINUTES)
    : null;
  const expectedLogoutLabel = expectedLogout ? formatTime(expectedLogout) : null;

  return (
    <section className="emp-dash-panel">
      <header className="emp-dash-panel-head">
        <div className="emp-dash-panel-title">
          <span className="emp-dash-panel-icon tone-attendance" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M4 12h4l2-5 4 10 2-5h4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <h2>Today&apos;s Attendance</h2>
        </div>
        <PanelLink to={attendanceTo}>View all punches</PanelLink>
      </header>

      {loading ? (
        <p className="muted emp-dash-panel-loading">Loading attendance…</p>
      ) : (
        <div className="emp-punch-card">
          <div className="emp-punch-card-who">
            <span className="emp-dash-attendance-avatar-wrap">
              <img src={avatarSrc(user?.profilePhoto)} alt="" className="emp-dash-attendance-photo" />
              {stillIn ? <span className="emp-dash-online-dot" aria-label="Checked in" /> : null}
            </span>
            <div className="emp-punch-card-identity">
              <strong>{user?.name || 'Employee'}</strong>
              <span>{empId}</span>
            </div>
            {stillIn ? (
              <span className={`emp-dash-checked-pill${onTimeCheckIn ? ' is-on-time' : ' is-late'}`}>
                Checked In
              </span>
            ) : checkedOut ? (
              <span className="emp-dash-checked-pill is-out">Checked Out</span>
            ) : (
              <span className="emp-dash-checked-pill is-muted">Not checked in</span>
            )}
          </div>

          <div className="emp-punch-card-cols">
            <div className="emp-punch-card-col">
              <span className="emp-punch-card-label">
                <ClockIcon />
                Checked In
              </span>
              {session?.punchIn ? (
                <span
                  className={`emp-punch-value-pill is-in${punchInTone ? ` is-${punchInTone}` : ''}`}
                >
                  {formatTime(session.punchIn)}
                </span>
              ) : (
                <span className="emp-punch-value-pill is-empty">--:--</span>
              )}
              <em>{checkedIn ? 'Today' : 'Not checked in'}</em>
            </div>

            <div className="emp-punch-card-col">
              <span className="emp-punch-card-label">
                <ClockIcon />
                Checked Out
              </span>
              {checkedOut ? (
                <>
                  <span className="emp-punch-value-pill is-out-time">
                    {formatTime(session.punchOut)}
                  </span>
                  <em>Today</em>
                </>
              ) : stillIn ? (
                <>
                  <span className="emp-punch-value-pill is-progress">
                    <span className="emp-punch-progress-spin" aria-hidden="true" />
                    In progress
                  </span>
                  <em>Not checked out</em>
                </>
              ) : (
                <>
                  <span className="emp-punch-value-pill is-empty">--:--</span>
                  <em>Not checked out</em>
                </>
              )}
            </div>

            <div className="emp-punch-card-col">
              <span className="emp-punch-card-label">
                <ClockIcon />
                Expected Logout
              </span>
              {expectedLogoutLabel ? (
                <span className="emp-punch-value-pill is-expected">{expectedLogoutLabel}</span>
              ) : (
                <span className="emp-punch-value-pill is-empty">--:--</span>
              )}
              <em>
                {expectedLogoutLabel ? 'Based on 9h minimum logout.' : 'Available after punch-in'}
              </em>
            </div>

            <div className="emp-punch-card-col">
              <span className="emp-punch-card-label is-status">Status</span>
              {stillIn ? (
                <span className="emp-punch-value-pill is-office">In office</span>
              ) : checkedOut ? (
                <span className="emp-punch-value-pill is-done">Completed</span>
              ) : (
                <span className="emp-punch-value-pill is-awaiting">Awaiting punch</span>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function TeamsLeave({ items = [], calendarTo }) {
  const visible = (items || []).slice(0, 5);

  return (
    <section className="emp-dash-panel">
      <header className="emp-dash-panel-head">
        <div className="emp-dash-panel-title">
          <span className="emp-dash-panel-icon tone-team" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="9" cy="8" r="3" />
              <path d="M3.8 19c.6-2.8 2.8-4.2 5.2-4.2s4.6 1.4 5.2 4.2" strokeLinecap="round" />
              <path d="M16.4 9.2a2.4 2.4 0 1 1 0 4.6" strokeLinecap="round" />
              <path d="M19.2 19c.3-1.6 1.3-2.8 2.6-3.2" strokeLinecap="round" />
            </svg>
          </span>
          <div>
            <h2>Teams Leave</h2>
            <p>Who&apos;s on leave this month</p>
          </div>
        </div>
        <PanelLink to={calendarTo}>View team calendar</PanelLink>
      </header>

      {!visible.length ? (
        <p className="empty emp-dash-empty">No teammates on leave this month.</p>
      ) : (
        <ul className="emp-dash-team-list">
          {visible.map((leave) => {
            const type = leave.leaveType;
            const label = REQUEST_LABELS[type] || type;
            const days = Number(leave.days || 0);
            return (
              <li key={leave.id}>
                <img
                  src={avatarSrc(leave.profilePhoto)}
                  alt=""
                  className="emp-dash-team-photo"
                />
                <div className="emp-dash-team-main">
                  <strong>{leave.userName || 'Employee'}</strong>
                  <span>{leave.designation || 'Team member'}</span>
                </div>
                <div className="emp-dash-team-type">
                  <span
                    className="emp-dash-leave-dot"
                    style={{ background: LEAVE_DOT[type] || 'var(--shell-muted, #64748b)' }}
                    aria-hidden
                  />
                  {label}
                </div>
                <div className="emp-dash-team-dates">
                  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                    <rect x="4" y="5" width="16" height="15" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
                    <path d="M8 3v3M16 3v3M4 10h16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                  {formatLeaveRangeShort(leave.startDate, leave.endDate)}
                </div>
                <span className="emp-dash-days-pill">
                  {days % 1 ? days.toFixed(1) : days} {days === 1 ? 'day' : 'days'}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {items.length > 5 ? (
        <footer className="emp-dash-panel-foot">
          <PanelLink to={calendarTo}>View all team members</PanelLink>
        </footer>
      ) : null}
    </section>
  );
}

function UpcomingHolidays({
  holidaysTo,
  canApplyRestricted = false,
  onApplied,
  balances: balancesProp,
  leaves: leavesProp,
}) {
  const { user } = useAuth();
  const year = appToday().getFullYear();
  const todayYmd = toYmd(appToday());
  const [holidays, setHolidays] = useState([]);
  const [localBalances, setLocalBalances] = useState(null);
  const [localLeaves, setLocalLeaves] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyDate, setBusyDate] = useState('');
  const [submittedPopup, setSubmittedPopup] = useState(null);
  const [errorPopup, setErrorPopup] = useState(null);

  const balances = balancesProp ?? localBalances;
  const leaves = leavesProp ?? localLeaves;
  const hasParentData = balancesProp != null && leavesProp != null;

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const holidayData = await api(`/holidays?year=${year}`);
      const list = [...(holidayData.holidays || [])].sort((a, b) =>
        toYmd(a.startDate).localeCompare(toYmd(b.startDate))
      );
      setHolidays(list.filter((h) => toYmd(h.startDate) >= todayYmd));
      if (canApplyRestricted && !hasParentData) {
        const mineQuery = user?.id ? `/leaves?userId=${user.id}` : '/leaves';
        const [balanceData, leaveData] = await Promise.all([
          api('/balances/me'),
          api(mineQuery),
        ]);
        setLocalBalances(balanceData.balances);
        setLocalLeaves(
          (leaveData.leaves || []).filter((leave) => String(leave.userId) === String(user?.id))
        );
      }
    } catch {
      setHolidays([]);
    } finally {
      setLoading(false);
    }
  }, [year, todayYmd, canApplyRestricted, hasParentData, user?.id]);

  useEffect(() => {
    reload();
  }, [reload]);

  const restrictedBalance = balances?.restricted ?? 2;
  const noRestrictedBalance = restrictedBalance < 1;

  const appliedRhDates = useMemo(() => {
    const map = new Map();
    for (const leave of leaves) {
      if (leave.leaveType !== 'restricted') continue;
      if (!['pending_manager', 'pending_hr', 'approved'].includes(leave.status)) continue;
      map.set(toYmd(leave.startDate), leave.status);
    }
    return map;
  }, [leaves]);

  function statusLabel(status) {
    if (status === 'approved') return STATUS_LABELS.approved;
    if (status === 'pending_manager') return STATUS_LABELS.pending_manager;
    if (status === 'pending_hr') return STATUS_LABELS.pending_hr;
    return STATUS_LABELS.pending;
  }

  async function applyRestricted(holiday) {
    const ymd = toYmd(holiday.startDate);
    if (appliedRhDates.has(ymd)) return;
    if (ymd < todayYmd) return;
    if (noRestrictedBalance) {
      setErrorPopup({
        title: 'No restricted leave balance',
        message: insufficientRestrictedBalance(restrictedBalance),
      });
      return;
    }

    setBusyDate(ymd);
    try {
      const data = await api('/leaves', {
        method: 'POST',
        body: {
          leaveType: 'restricted',
          startDate: ymd,
          endDate: ymd,
          session: 'full',
          reason: holiday.userName || holiday.title || '',
        },
      });
      const autoApproved = data.leave?.status === 'approved' || user?.role === 'hr';
      setSubmittedPopup({
        message: autoApproved ? 'Restricted leave applied' : 'Restricted leave submitted',
        detail: autoApproved
          ? 'Added to your calendar.'
          : 'Your request is waiting for manager approval, then HR.',
        imageSrc: autoApproved ? '/assets/leave-approved.gif' : '/assets/request-submitted.gif',
      });
      await reload();
      onApplied?.();
    } catch (err) {
      const message = err.message || 'Could not apply restricted leave';
      setErrorPopup({
        title: isApplyBlockError(message) ? 'Cannot apply leave' : 'Apply failed',
        message,
      });
    } finally {
      setBusyDate('');
    }
  }

  function actionFor(holiday) {
    const ymd = toYmd(holiday.startDate);
    const isFuture = ymd >= todayYmd;
    if (!canApplyRestricted || holiday.holidayType !== 'restricted' || !isFuture) return null;

    const status = appliedRhDates.get(ymd);
    if (status === 'approved') {
      return <span className="overview-holiday-status is-approved">{statusLabel(status)}</span>;
    }
    if (status === 'pending_manager' || status === 'pending_hr') {
      return (
        <span className="overview-holiday-status is-pending">{statusLabel(status)}</span>
      );
    }
    return (
      <button
        type="button"
        className="overview-holiday-apply"
        disabled={busyDate === ymd}
        onClick={() => applyRestricted(holiday)}
      >
        {busyDate === ymd ? 'Applying…' : 'Apply'}
      </button>
    );
  }

  const visible = holidays.slice(0, 4);

  return (
    <section className="emp-dash-panel">
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
      <header className="emp-dash-panel-head">
        <div className="emp-dash-panel-title">
          <span className="emp-dash-panel-icon tone-holiday" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="4" y="5" width="16" height="15" rx="2" />
              <path d="M8 3v3M16 3v3M4 10h16" strokeLinecap="round" />
            </svg>
          </span>
          <h2>Upcoming Holidays</h2>
        </div>
        <PanelLink to={holidaysTo} tone="holiday">View calendar</PanelLink>
      </header>

      {loading ? (
        <p className="muted emp-dash-panel-loading">Loading holidays…</p>
      ) : !visible.length ? (
        <p className="empty emp-dash-empty">No upcoming holidays published.</p>
      ) : (
        <>
          <ul className="emp-dash-holiday-list">
            {visible.map((holiday) => {
              const { day, month, full } = holidayCardDate(holiday.startDate);
              const name = holiday.userName || holiday.title || 'Holiday';
              const kind = holidayKind(holiday);
              const action = actionFor(holiday);
              return (
                <li key={holiday.id || `${holiday.startDate}-${name}`}>
                  <article
                    className={`emp-dash-holiday-card is-${kind}${kind === 'national' ? ' has-india-flag' : ''}`}
                  >
                    {kind === 'national' ? (
                      <span className="india-flag-backdrop" aria-hidden="true" />
                    ) : null}
                    <div className="emp-dash-holiday-dateblock" aria-hidden="true">
                      <span className="emp-dash-holiday-day">{day}</span>
                      <span className="emp-dash-holiday-month">{month}</span>
                    </div>
                    <div className="emp-dash-holiday-body">
                      <strong className="emp-dash-holiday-name">{name}</strong>
                      <span className="emp-dash-holiday-full">{full}</span>
                      <div className="emp-dash-holiday-footer">
                        <em className={`emp-dash-holiday-tag is-${kind}`}>
                          {holidayKindLabel(kind)}
                        </em>
                        {action}
                      </div>
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
          <div className="emp-dash-holiday-legend" aria-label="Holiday types">
            <div className="emp-dash-holiday-legend-item">
              <span className="emp-dash-holiday-legend-dot is-national" aria-hidden="true" />
              <div>
                <strong>National Holidays</strong>
                <span>Republic Day, Independence Day, May Day, Gandhi Jayanti</span>
              </div>
            </div>
            <div className="emp-dash-holiday-legend-item">
              <span className="emp-dash-holiday-legend-dot is-regional" aria-hidden="true" />
              <div>
                <strong>Regional Holidays</strong>
                <span>Other company / regional holidays</span>
              </div>
            </div>
            <div className="emp-dash-holiday-legend-item">
              <span className="emp-dash-holiday-legend-dot is-restricted" aria-hidden="true" />
              <div>
                <strong>Restricted Holidays</strong>
                <span>Optional holidays with limited applicability</span>
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function ProfileSidebar({ user, profile }) {
  const employment = profile?.employment || {};
  const joiningDate = employment.dateOfJoining
    ? formatDate(employment.dateOfJoining)
    : '—';
  const empId = displayEmployeeId(user, profile);

  const rows = [
    {
      key: 'department',
      label: 'Department',
      value: user?.department || employment.department || '—',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="4" y="8" width="16" height="12" rx="2" />
          <path d="M9 8V6a3 3 0 0 1 6 0v2" strokeLinecap="round" />
        </svg>
      ),
    },
    {
      key: 'location',
      label: 'Location',
      value: user?.location || employment.location || '—',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M12 21s6-5.2 6-10a6 6 0 1 0-12 0c0 4.8 6 10 6 10Z" strokeLinecap="round" />
          <circle cx="12" cy="11" r="2.2" />
        </svg>
      ),
    },
    {
      key: 'email',
      label: 'Email',
      value: user?.email || '—',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="3" y="6" width="18" height="13" rx="2" />
          <path d="m3 8 9 6 9-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
    {
      key: 'empId',
      label: 'Employee ID',
      value: empId,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="5" y="4" width="14" height="16" rx="2" />
          <path d="M9 9h6M9 13h4" strokeLinecap="round" />
        </svg>
      ),
    },
    {
      key: 'joining',
      label: 'Joining Date',
      value: joiningDate,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="4" y="5" width="16" height="15" rx="2" />
          <path d="M8 3v3M16 3v3M4 10h16" strokeLinecap="round" />
        </svg>
      ),
    },
  ];

  return (
    <aside className="emp-dash-profile">
      <div className="emp-dash-profile-card">
        <div className="emp-dash-profile-top">
          <span className="emp-dash-profile-photo-wrap">
            <img src={avatarSrc(user?.profilePhoto)} alt="" className="emp-dash-profile-photo" />
            <span className="emp-dash-online-dot" aria-hidden />
          </span>
          <strong>{user?.name || 'Employee'}</strong>
          <span>{user?.department || employment.department || user?.designation || 'Employee'}</span>
          <span className="emp-dash-online-pill">
            <span className="emp-dash-online-dot is-inline" aria-hidden />
            Online
          </span>
        </div>
        <ul className="emp-dash-profile-rows">
          {rows.map((row) => (
            <li key={row.key}>
              <span className="emp-dash-profile-icon" aria-hidden>
                {row.icon}
              </span>
              <div>
                <em>{row.label}</em>
                <strong>{row.value}</strong>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}

export default function EmployeeDashboard({
  balances,
  earnedLeaveUnlocked = false,
  leaves,
  report,
  loading,
  error,
  calendarTo = '/app/history',
  holidaysTo = '/app/attendance',
  attendanceTo = '/app/attendance',
  canApplyRestricted = true,
  onRestrictedApplied,
}) {
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    if (!user?.id) return;
    api(`/profiles/${user.id}`)
      .then((data) => setProfile(data.profile))
      .catch(() => setProfile(null));
  }, [user?.id]);

  const balanceItems = useMemo(
    () =>
      balances
        ? computePersonalLeaveTotals(balances, leaves, user?.id, { earnedUnlocked: earnedLeaveUnlocked })
        : [],
    [balances, leaves, user?.id, earnedLeaveUnlocked]
  );

  return (
    <div className="emp-dash">
      {loading && !balances ? <p className="muted">Loading…</p> : null}
      {error ? <p className="form-error">{error}</p> : null}

      {balanceItems.length ? (
        <LeaveBalanceSummaryCards className="emp-dash-balances" items={balanceItems} />
      ) : null}

      <div className="emp-dash-body">
        <div className="emp-dash-main">
          <TodayAttendance user={user} profile={profile} attendanceTo={attendanceTo} />
          <TeamsLeave
            items={report?.teamLeavesThisMonth || []}
            calendarTo={calendarTo}
          />
          <UpcomingHolidays
            holidaysTo={holidaysTo}
            balances={balances}
            leaves={leaves}
            canApplyRestricted={canApplyRestricted}
            onApplied={onRestrictedApplied}
          />
        </div>
        <ProfileSidebar user={user} profile={profile} />
      </div>
    </div>
  );
}
