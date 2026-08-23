import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CartesianGrid, Cell, Line, LineChart, Pie, PieChart, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api';
import { APP_VERSION } from '../version';
import { appToday, avatarSrc, formatDate, formatDateTime, formatTime, hasMissingPunchOut, isUnderNineHours, punchInLateness, toYmd } from '../utils';
import { PunchInProgressChip } from './PunchStatusChips';

const COLORS = {
  present: '#16a34a',
  absent: '#ef4444',
  leave: '#f59e0b',
  late: '#f97316',
  wfh: '#6366f1',
};

const TICK = { fill: 'currentColor', fontSize: 11 };

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

export default function HrAttendanceOverview() {
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
      load().catch(() => {});
    }, 8000);
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

  const kpiCards = kpis
    ? [
        {
          key: 'total',
          label: 'Total employees',
          value: kpis.totalEmployees,
          hint: kpis.locations
            ? `Across ${kpis.locations} location${kpis.locations === 1 ? '' : 's'}`
            : 'Active people',
          icon: 'people',
          to: '/hr/onboarding',
        },
        {
          key: 'present',
          label: 'Present today',
          value: kpis.present,
          hint: kpis.unmatchedPunches
            ? `${kpis.presentPct}% · ${kpis.unmatchedPunches} unmatched device punches`
            : `${kpis.presentPct}%`,
          icon: 'present',
          to: `/hr/attendance?date=${date}&focus=present`,
        },
        {
          key: 'absent',
          label: 'Absent today',
          value: kpis.absent,
          hint: `${kpis.absentPct}%`,
          icon: 'absent',
          to: `/hr/attendance?date=${date}&focus=absent`,
        },
        {
          key: 'leave',
          label: 'On leave',
          value: kpis.onLeave,
          hint: `${kpis.onLeavePct}%`,
          icon: 'leave',
          to: '/hr/calendar',
        },
        {
          key: 'late',
          label: 'Late today',
          value: kpis.late,
          hint: `${kpis.latePct}%`,
          icon: 'late',
          to: `/hr/attendance?date=${date}&focus=late`,
        },
        {
          key: 'wfh',
          label: 'Work from home',
          value: kpis.wfh,
          hint: `${kpis.wfhPct}%`,
          icon: 'wfh',
          to: `/hr/attendance?date=${date}&focus=wfh`,
        },
      ]
    : [];

  return (
    <div className="attov">
      <div className="attov-head">
        <div>
          <h2>Attendance overview</h2>
          <p className="muted">Live office punches, leave, and presence for {formatDate(date)}.</p>
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
          <section className="panel attov-panel">
            <h3>Attendance trend (this month)</h3>
            <ChartFrame height={260}>
              {(width, height) => (
                <LineChart
                  width={width}
                  height={height}
                  data={data.trend}
                  margin={{ top: 8, right: 8, left: 0, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(127,127,127,0.28)" />
                  <XAxis dataKey="date" tick={TICK} tickFormatter={(v) => String(v).slice(8)} />
                  <YAxis allowDecimals={false} tick={TICK} width={32} domain={[0, 'auto']} />
                  <Tooltip content={<ChartTip />} />
                  <Line
                    type="monotone"
                    dataKey="present"
                    name="Present"
                    stroke={COLORS.present}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="absent"
                    name="Absent"
                    stroke={COLORS.absent}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="onLeave"
                    name="On leave"
                    stroke={COLORS.leave}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="late"
                    name="Late"
                    stroke={COLORS.late}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              )}
            </ChartFrame>
            <ul className="attov-legend attov-legend-inline">
              <li>
                <i style={{ background: COLORS.present }} />
                Present
              </li>
              <li>
                <i style={{ background: COLORS.absent }} />
                Absent
              </li>
              <li>
                <i style={{ background: COLORS.leave }} />
                On leave
              </li>
              <li>
                <i style={{ background: COLORS.late }} />
                Late
              </li>
            </ul>
          </section>
          <section className="panel attov-panel">
            <h3>Attendance distribution</h3>
            {pieData.length ? (
              <div className="attov-donut">
                <div className="attov-donut-plot">
                  <ChartFrame height={240}>
                    {(width, height) => {
                      const outer = Math.max(52, Math.min(92, Math.floor(Math.min(width, height) / 2.55)));
                      return (
                        <PieChart width={width} height={height}>
                          <Pie
                            data={pieData}
                            dataKey="value"
                            nameKey="name"
                            cx="50%"
                            cy="50%"
                            innerRadius={Math.round(outer * 0.68)}
                            outerRadius={outer}
                            paddingAngle={2}
                            isAnimationActive={false}
                          >
                            {pieData.map((entry) => (
                              <Cell key={entry.key} fill={COLORS[entry.key] || '#888'} />
                            ))}
                          </Pie>
                          <Tooltip content={<ChartTip />} />
                        </PieChart>
                      );
                    }}
                  </ChartFrame>
                  <div className="attov-donut-center">
                    <strong>{kpis?.present ?? 0}</strong>
                    <span>present</span>
                  </div>
                </div>
                <ul className="attov-legend">
                  {pieData.map((entry) => (
                    <li key={entry.key}>
                      <i style={{ background: COLORS[entry.key] || '#888' }} />
                      <span>{entry.name}</span>
                      <b>{entry.value}</b>
                      <em>{pieTotal ? Math.round((entry.value / pieTotal) * 100) : 0}%</em>
                    </li>
                  ))}
                </ul>
              </div>
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
              <Link className="attov-side-link" to="/hr/approvals">
                Open approvals
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
                <Link to="/hr/onboarding">Add employee</Link>
                <Link to="/hr/calendar">Team calendar</Link>
                <Link to="/hr/users">Leave management</Link>
                <Link to="/hr/attendance">Attendance log</Link>
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
                        <Link to="/hr/attendance" className="attov-view" aria-label="View attendance log">
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
