import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api';
import { useChartTheme } from '../chartTheme';
import { APP_VERSION } from '../version';
import { appToday, avatarSrc, formatDate, formatDateTime, formatTime, isUnderNineHours, punchInLateness, toYmd } from '../utils';
import { PunchInProgressChip } from './PunchStatusChips';

const TREND_METRICS = [
  { key: 'present', label: 'Present' },
  { key: 'absent', label: 'Absent' },
  { key: 'onLeave', label: 'On leave' },
  { key: 'late', label: 'Late' },
];

function dayLabel(ymd) {
  return String(ymd || '').slice(8).replace(/^0/, '') || '';
}

function trendSummaryFrom(rows = []) {
  if (!rows.length) return null;
  const presentCounts = rows.map((row) => Number(row.present) || 0);
  const total = presentCounts.reduce((sum, n) => sum + n, 0);
  const peak = Math.max(...presentCounts);
  const today = presentCounts[presentCounts.length - 1] ?? 0;
  return {
    avg: Math.round(total / rows.length),
    peak,
    today,
    days: rows.length,
  };
}

function TrendTooltip({ active, payload, chart }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className="attov-tip attov-trend-tip">
      <div className="attov-tip-label">{formatDate(row.date)}</div>
      <div className="attov-trend-tip-main">
        <i style={{ background: chart.attendance.present }} />
        <span>Present</span>
        <b>{row.present ?? 0}</b>
      </div>
      <div className="attov-trend-tip-grid">
        {TREND_METRICS.slice(1).map(({ key, label }) => (
          <div key={key}>
            <span>{label}</span>
            <b>{row[key] ?? 0}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

function KpiIcon({ name }) {
  const common = { viewBox: '0 0 24 24', width: '22', height: '22', fill: 'none', 'aria-hidden': true };
  const s = { stroke: 'currentColor', strokeWidth: '1.8', strokeLinecap: 'round', strokeLinejoin: 'round' };
  if (name === 'people') {
    return (
      <svg {...common}>
        <circle cx="9" cy="8" r="3" {...s} />
        <path d="M4 18c.7-3 3-4.5 5-4.5s4.3 1.5 5 4.5" {...s} />
        <path d="M16.5 8.4a2.4 2.4 0 1 1 0 4.8" {...s} />
      </svg>
    );
  }
  if (name === 'present') {
    return (
      <svg {...common}>
        <path d="M20 7 10 17l-5-5" {...s} />
      </svg>
    );
  }
  if (name === 'absent') {
    return (
      <svg {...common}>
        <path d="M15 9 9 15M9 9l6 6" {...s} />
        <circle cx="12" cy="12" r="8" {...s} />
      </svg>
    );
  }
  if (name === 'leave') {
    return (
      <svg {...common}>
        <rect x="4" y="5" width="16" height="15" rx="2" {...s} />
        <path d="M8 3.5V7M16 3.5V7M4 10h16" {...s} />
      </svg>
    );
  }
  if (name === 'late') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="8" {...s} />
        <path d="M12 8v4l3 2" {...s} />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M4 10h16M7 10V7a5 5 0 0 1 10 0v3" {...s} />
      <rect x="5" y="10" width="14" height="10" rx="2" {...s} />
    </svg>
  );
}

function ChartFrame({ height = 260, children }) {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const apply = () => setWidth(Math.max(0, Math.floor(el.clientWidth)));
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={ref} className="attov-chart" style={{ height }}>
      {width > 16 ? children(width, height) : null}
    </div>
  );
}

function ChartTip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const title =
    label && /^\d{4}-\d{2}-\d{2}/.test(String(label)) ? formatDate(label) : label;
  return (
    <div className="attov-tip">
      {title ? <div className="attov-tip-label">{title}</div> : null}
      {payload.map((row) => (
        <div key={row.dataKey || row.name} className="attov-tip-row">
          <i style={{ background: row.color || row.payload?.fill }} />
          <span>{row.name}</span>
          <b>{row.value}</b>
        </div>
      ))}
    </div>
  );
}

function downloadOverviewCsv(overview) {
  const rows = [
    ['Department', 'Total', 'Present', 'Absent', 'On leave', 'Late', 'WFH', 'Attendance %'],
    ...(overview.byDepartment || []).map((d) => [
      d.department,
      d.total,
      d.present,
      d.absent,
      d.onLeave,
      d.late,
      d.wfh,
      d.attendancePct,
    ]),
  ];
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `attendance-overview-${overview.date}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const ROLE_LINKS = {
  hr: {
    employees: '/hr/onboarding',
    employeesLabel: 'Across locations',
    attendance: '/hr/muster',
    calendar: '/hr/calendar',
    approvals: '/hr/approvals',
    approvalsLabel: 'Open leave approval',
    quickActions: [
      { to: '/hr/onboarding', label: 'Add employee' },
      { to: '/hr/calendar', label: 'Attendance info' },
      { to: '/hr/users', label: 'Leave management' },
      { to: '/hr/muster', label: 'Attendance muster' },
    ],
  },
  manager: {
    employees: '/manager/history',
    employeesLabel: 'Your team',
    attendance: '/manager/muster',
    calendar: '/manager/calendar',
    approvals: '/manager/approvals',
    approvalsLabel: 'Open approvals',
    quickActions: [
      { to: '/manager/approvals', label: 'Leave approvals' },
      { to: '/manager/calendar', label: 'Attendance info' },
      { to: '/manager/muster', label: 'Attendance muster' },
      { to: '/manager/regularization', label: 'Regularization' },
    ],
  },
};

export default function HrAttendanceOverview({ scope = 'hr' }) {
  const chart = useChartTheme();
  const links = ROLE_LINKS[scope] || ROLE_LINKS.hr;
  const today = toYmd(appToday());
  const [date, setDate] = useState(today);
  const [location, setLocation] = useState('');
  const [department, setDepartment] = useState('');
  const [data, setData] = useState(null);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ date });
    if (location) params.set('location', location);
    if (department) params.set('department', department);
    const res = await api(`/attendance/overview?${params}`);
    setData(res.overview);
    setStatus(res.status);
  }, [date, location, department]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    load()
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Could not load attendance overview');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') load().catch(() => {});
    }, 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [load]);

  const kpis = data?.kpis;
  const pieData = useMemo(
    () => (data?.distribution || []).filter((d) => Number(d.value) > 0),
    [data]
  );
  const pieTotal = pieData.reduce((sum, d) => sum + Number(d.value || 0), 0);
  const trendRows = data?.trend || [];
  const trendSummary = useMemo(() => trendSummaryFrom(data?.trend), [data?.trend]);
  const trendTickStep = trendRows.length > 20 ? 4 : trendRows.length > 12 ? 3 : 2;

  const kpiCards = kpis
    ? [
        {
          key: 'total',
          label: scope === 'manager' ? 'Team members' : 'Total employees',
          value: kpis.totalEmployees,
          hint: kpis.locations
            ? `Across ${kpis.locations} location${kpis.locations === 1 ? '' : 's'}`
            : links.employeesLabel,
          icon: 'people',
          to: links.employees,
        },
        {
          key: 'present',
          label: 'Present today',
          value: kpis.present,
          hint: kpis.unmatchedPunches
            ? `${kpis.presentPct}% · ${kpis.unmatchedPunches} unmatched device punches`
            : `${kpis.presentPct}%`,
          icon: 'present',
          to: `${links.attendance}?date=${date}&focus=present`,
        },
        {
          key: 'absent',
          label: 'Absent today',
          value: kpis.absent,
          hint: `${kpis.absentPct}%`,
          icon: 'absent',
          to: `${links.attendance}?date=${date}&focus=absent`,
        },
        {
          key: 'leave',
          label: 'On leave',
          value: kpis.onLeave,
          hint: `${kpis.onLeavePct}%`,
          icon: 'leave',
          to: links.calendar,
        },
        {
          key: 'late',
          label: 'Late today',
          value: kpis.late,
          hint: `${kpis.latePct}%`,
          icon: 'late',
          to: `${links.attendance}?date=${date}&focus=late`,
        },
        {
          key: 'wfh',
          label: 'Work from home',
          value: kpis.wfh,
          hint: `${kpis.wfhPct}%`,
          icon: 'wfh',
          to: `${links.attendance}?date=${date}&focus=wfh`,
        },
      ]
    : [];

  return (
    <div className="attov">
      <div className="attov-head">
        <div>
          <h2>{scope === 'manager' ? 'Team attendance' : 'Attendance overview'}</h2>
          <p className="muted">
            {scope === 'manager'
              ? `Live punches, leave, and presence for your team · ${formatDate(date)}.`
              : `Live office punches, leave, and presence for ${formatDate(date)}.`}
          </p>
        </div>
        <div className="attov-filters">
          <label>
            Date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label>
            Location
            <select value={location} onChange={(e) => setLocation(e.target.value)}>
              <option value="">All locations</option>
              {(data?.filters.locations || []).map((loc) => (
                <option key={loc} value={loc}>
                  {loc}
                </option>
              ))}
            </select>
          </label>
          <label>
            Department
            <select value={department} onChange={(e) => setDepartment(e.target.value)}>
              <option value="">All departments</option>
              {(data?.filters.departments || []).map((dept) => (
                <option key={dept} value={dept}>
                  {dept}
                </option>
              ))}
            </select>
          </label>
          <label>
            Shift
            <select disabled value="">
              <option>All shifts</option>
            </select>
          </label>
          <button
            type="button"
            className="btn primary attov-export"
            disabled={!data}
            onClick={() => data && downloadOverviewCsv(data)}
          >
            Export report
          </button>
        </div>
      </div>

      {error && <p className="form-error">{error}</p>}
      {loading && !data && <p className="muted">Loading attendance…</p>}

      {kpis && (
        <div className="attov-kpis">
          {kpiCards.map((card) => (
            <Link
              key={card.key}
              to={card.to}
              className={`panel attov-kpi attov-kpi-${card.key}`}
            >
              <span className="attov-kpi-icon">
                <KpiIcon name={card.icon} />
              </span>
              <span className="attov-kpi-label">{card.label}</span>
              <strong>{card.value ?? 0}</strong>
              <span className="attov-kpi-hint">{card.hint}</span>
            </Link>
          ))}
        </div>
      )}

      {data && (
        <div className="attov-charts">
          <section className="panel attov-panel attov-trend-panel">
            <div className="attov-trend-head">
              <div>
                <h3>Attendance trend (this month)</h3>
                <p className="attov-trend-lede">Daily present headcount · hover a bar for full breakdown</p>
              </div>
              {trendSummary && (
                <dl className="attov-trend-stats">
                  <div>
                    <dt>Avg</dt>
                    <dd>{trendSummary.avg}</dd>
                  </div>
                  <div>
                    <dt>Peak</dt>
                    <dd>{trendSummary.peak}</dd>
                  </div>
                  <div>
                    <dt>Latest</dt>
                    <dd>{trendSummary.today}</dd>
                  </div>
                </dl>
              )}
            </div>
            <ChartFrame height={228}>
              {(width, height) => (
                <BarChart
                  width={width}
                  height={height}
                  data={trendRows}
                  margin={{ top: 10, right: 6, left: -6, bottom: 2 }}
                  barCategoryGap="28%"
                >
                  <CartesianGrid strokeDasharray="3 3" stroke={chart.gridStroke} vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={chart.tick}
                    tickFormatter={dayLabel}
                    interval={trendTickStep}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={chart.tick}
                    width={28}
                    domain={[0, 'auto']}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: chart.mode === 'light' ? 'rgba(21, 32, 51, 0.05)' : 'rgba(255, 255, 255, 0.06)' }}
                    content={<TrendTooltip chart={chart} />}
                  />
                  <Bar
                    dataKey="present"
                    name="Present"
                    radius={[6, 6, 0, 0]}
                    maxBarSize={22}
                    isAnimationActive={false}
                  >
                    {trendRows.map((entry) => (
                      <Cell
                        key={entry.date}
                        fill={chart.attendance.present}
                        opacity={entry.date === date ? 1 : 0.78}
                        stroke={entry.date === date ? chart.secondary : 'none'}
                        strokeWidth={entry.date === date ? 2 : 0}
                      />
                    ))}
                  </Bar>
                </BarChart>
              )}
            </ChartFrame>
          </section>
          <section className="panel attov-panel">
            <h3>Attendance distribution</h3>
            {pieData.length ? (
              <>
                <ChartFrame height={240}>
                  {(width, height) => (
                    <BarChart
                      width={width}
                      height={height}
                      data={pieData}
                      layout="vertical"
                      margin={{ top: 4, right: 12, left: 4, bottom: 4 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={chart.gridStroke} horizontal={false} />
                      <XAxis type="number" allowDecimals={false} tick={chart.tick} />
                      <YAxis type="category" dataKey="name" tick={chart.tick} width={92} />
                      <Tooltip content={<ChartTip />} contentStyle={chart.tooltipStyle} />
                      <Bar dataKey="value" name="Employees" radius={[0, 6, 6, 0]} isAnimationActive={false}>
                        {pieData.map((entry) => (
                          <Cell key={entry.key} fill={chart.attendanceColor(entry.key)} />
                        ))}
                      </Bar>
                    </BarChart>
                  )}
                </ChartFrame>
                <ul className="attov-legend attov-legend-inline attov-legend-bars">
                  {pieData.map((entry) => (
                    <li key={entry.key}>
                      <i style={{ background: chart.attendanceColor(entry.key) }} />
                      <span>{entry.name}</span>
                      <b>{entry.value}</b>
                      <em>{pieTotal ? Math.round((entry.value / pieTotal) * 100) : 0}%</em>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="empty">No attendance mix for this date.</p>
            )}
          </section>
        </div>
      )}

      {data && (
        <div className="attov-mid">
          <section className="panel attov-panel">
            <h3>Attendance summary by department</h3>
            <div className="table-wrap">
              <table className="attov-table">
                <thead>
                  <tr>
                    <th>Department</th>
                    <th>Total</th>
                    <th>Present</th>
                    <th>Absent</th>
                    <th>On leave</th>
                    <th>Late</th>
                    <th>WFH</th>
                    <th>Attendance %</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.byDepartment || []).map((row) => (
                    <tr key={row.department}>
                      <td>{row.department}</td>
                      <td>{row.total}</td>
                      <td>{row.present}</td>
                      <td>{row.absent}</td>
                      <td>{row.onLeave}</td>
                      <td>{row.late}</td>
                      <td>{row.wfh}</td>
                      <td>
                        <div className="attov-bar-wrap">
                          <span>{row.attendancePct}%</span>
                          <span className="attov-bar" aria-hidden>
                            <span
                              className={row.attendancePct >= 75 ? 'is-good' : 'is-low'}
                              style={{ width: `${Math.min(100, row.attendancePct)}%` }}
                            />
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!data.byDepartment?.length && (
                    <tr>
                      <td colSpan={8}>No department data yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <div className="attov-side">
            <section className="panel attov-panel">
              <h3>Pending leave requests</h3>
              <ul className="attov-mini-stats">
                <li>
                  <span>Total pending</span>
                  <strong>{data.pending.total}</strong>
                </li>
                <li>
                  <span>Pending &gt; 3 days</span>
                  <strong>{data.pending.olderThanThreeDays}</strong>
                </li>
                <li>
                  <span>This week</span>
                  <strong>{data.pending.thisWeek}</strong>
                </li>
              </ul>
              <Link className="attov-side-link" to={links.approvals}>
                {links.approvalsLabel}
              </Link>
            </section>
            <section className="panel attov-panel">
              <h3>Live attendance (now)</h3>
              <ul className="attov-mini-stats">
                <li>
                  <span>Currently in office</span>
                  <strong>{data.live.inOffice}</strong>
                </li>
                <li>
                  <span>Work from home</span>
                  <strong>{data.live.wfh}</strong>
                </li>
                <li>
                  <span>Yet to check-in</span>
                  <strong>{data.live.yetToCheckIn}</strong>
                </li>
                <li>
                  <span>Checked-out</span>
                  <strong>{data.live.checkedOut}</strong>
                </li>
              </ul>
            </section>
            <section className="panel attov-panel">
              <h3>Quick actions</h3>
              <div className="attov-actions">
                {links.quickActions.map((action) => (
                  <Link key={action.to} to={action.to}>
                    {action.label}
                  </Link>
                ))}
              </div>
            </section>
          </div>
        </div>
      )}

      {data && (
        <section className="panel attov-panel">
          <h3>Recent punches</h3>
          {!data.recentPunches.length && <p className="empty">No punches for this date yet.</p>}
          {!!data.recentPunches.length && (
            <div className="table-wrap">
              <table className="attov-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Details</th>
                    <th>Punch in</th>
                    <th>Punch out</th>
                    <th>Work hours</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.recentPunches.map((session) => (
                    <tr key={`${session.userId || session.deviceUserCode}-${session.id}`}>
                      <td>
                        <div className="attov-emp">
                          <img src={avatarSrc(session.profilePhoto)} alt="" />
                          <div>
                            <strong>{session.userName || 'Unmapped'}</strong>
                            <div className="sub">{session.employeeNumber || session.deviceUserCode}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        {session.department || '—'}
                        {session.location ? ` · ${session.location}` : ''}
                      </td>
                      <td>
                        {session.punchIn ? (
                          <span className={`punch-in-sq is-${punchInLateness(session.punchIn) || 'on-time'}`}>
                            {formatTime(session.punchIn)}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        {session.punchOut ? (
                          formatTime(session.punchOut)
                        ) : session.stillIn ? (
                          <PunchInProgressChip />
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        {session.workHours ? (
                          <span className={isUnderNineHours(session.workMinutes) ? 'work-hours-short' : undefined}>
                            {session.workHours}
                          </span>
                        ) : session.stillIn ? (
                          <PunchInProgressChip />
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        <Link to={links.attendance} className="attov-view" aria-label="View attendance log">
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <p className="attov-meta muted">
        v{APP_VERSION}
        {status?.lastOkAt ? ` · Last updated ${formatDateTime(status.lastOkAt)}` : ''}
        {' · '}
        <span className={status?.lastError ? 'attov-status-bad' : 'attov-status-ok'}>
          {status?.lastError ? 'Punch sync needs attention' : 'All systems operational'}
        </span>
      </p>
    </div>
  );
}
