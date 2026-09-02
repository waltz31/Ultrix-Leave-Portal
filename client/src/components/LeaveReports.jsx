import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../api';
import { useChartTheme } from '../chartTheme';
import {
  downloadLeavesCsv,
  downloadLeavesPdf,
  monthRange,
} from '../exportLeaves';
import { REQUEST_LABELS, appYear, formatLeaveSpan } from '../utils';

const MONTHS = [
  { value: '', label: 'All months' },
  { value: '1', label: 'January' },
  { value: '2', label: 'February' },
  { value: '3', label: 'March' },
  { value: '4', label: 'April' },
  { value: '5', label: 'May' },
  { value: '6', label: 'June' },
  { value: '7', label: 'July' },
  { value: '8', label: 'August' },
  { value: '9', label: 'September' },
  { value: '10', label: 'October' },
  { value: '11', label: 'November' },
  { value: '12', label: 'December' },
];

export function UpcomingLeaveList({
  items,
  showEmployee = true,
  emptyText = 'No upcoming approved leave.',
}) {
  if (!items?.length) {
    return <p className="empty">{emptyText}</p>;
  }
  return (
    <ul className="upcoming-list">
      {items.map((leave) => (
        <li key={leave.id}>
          <div className={showEmployee ? 'upcoming-person' : undefined}>
            {showEmployee && <strong className="upcoming-name">{leave.userName}</strong>}
            <span className={`badge type-${leave.leaveType}`}>
              {REQUEST_LABELS[leave.leaveType]}
            </span>
          </div>
          <span className="upcoming-dates">{formatLeaveSpan(leave)}</span>
        </li>
      ))}
    </ul>
  );
}

export function LeaveReportCharts({ byType = [], byMonth = [] }) {
  const chart = useChartTheme();
  const gradId = useId().replace(/:/g, '');
  const typeData = byType
    .filter((r) => r.days > 0)
    .map((r) => ({
      name: REQUEST_LABELS[r.type] || r.type,
      value: r.days,
      type: r.type,
    }));

  return (
    <div className="charts-grid">
      <section className="panel chart-panel">
        <h2>This month by type</h2>
        {typeData.length === 0 ? (
          <p className="empty">No approved leave this month.</p>
        ) : (
          <div className="chart-box">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={typeData} layout="vertical" margin={{ left: 4, right: 12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chart.gridStroke} horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={chart.tick} />
                <YAxis type="category" dataKey="name" tick={chart.tick} width={96} />
                <Tooltip contentStyle={chart.tooltipStyle} />
                <Bar dataKey="value" name="Days" radius={[0, 8, 8, 0]}>
                  {typeData.map((entry) => (
                    <Cell key={entry.type} fill={chart.leaveTypeColor(entry.type)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section className="panel chart-panel">
        <h2>Monthly leave days</h2>
        <div className="chart-box">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={byMonth}>
              <CartesianGrid strokeDasharray="3 3" stroke={chart.gridStroke} />
              <XAxis dataKey="label" tick={chart.tick} />
              <YAxis tick={chart.tick} allowDecimals={false} />
              <Tooltip contentStyle={chart.tooltipStyle} />
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={chart.barGrad[0]} />
                  <stop offset="100%" stopColor={chart.barGrad[1]} />
                </linearGradient>
              </defs>
              <Bar dataKey="days" name="Days" fill={`url(#${gradId})`} radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  );
}

/** Manager / HR leave report with optional employee filter. */
export function LeaveReportSection({ title = 'Leave report' }) {
  const [userId, setUserId] = useState('');
  const [users, setUsers] = useState([]);
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api('/users')
      .then((d) => setUsers(d.users || []))
      .catch(() => setUsers([]));
  }, []);

  const loadReport = useCallback(() => {
    setLoading(true);
    setError('');
    const qs = userId ? `?userId=${encodeURIComponent(userId)}` : '';
    api(`/reports/overview${qs}`)
      .then(setReport)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [userId]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  return (
    <section className="leave-report-section">
      <div className="report-head">
        <h2 className="section-title">{title}</h2>
        <label className="report-filter">
          Employee
          <select value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Everyone</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
                {u.employeeNumber ? ` (${u.employeeNumber})` : ''}
              </option>
            ))}
          </select>
        </label>
      </div>
      {loading && <p className="muted">Loading report…</p>}
      {error && <p className="form-error">{error}</p>}
      {!loading && report && (
        <LeaveReportCharts byType={report.byType} byMonth={report.byMonth} />
      )}
    </section>
  );
}

/** HR: download filtered leave rows as CSV / PDF. */
export function LeaveExportPanel() {
  const [users, setUsers] = useState([]);
  const [userId, setUserId] = useState('');
  const [year, setYear] = useState(String(appYear()));
  const [month, setMonth] = useState('');
  const [leaveType, setLeaveType] = useState('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [count, setCount] = useState(null);

  const years = useMemo(() => {
    const y = appYear();
    return Array.from({ length: 6 }, (_, i) => String(y - i));
  }, []);

  useEffect(() => {
    api('/users')
      .then((d) => setUsers(d.users || []))
      .catch(() => setUsers([]));
  }, []);

  useEffect(() => {
    if (!year) setMonth('');
  }, [year]);

  const filterSummary = useMemo(() => {
    const parts = [];
    const emp = users.find((u) => String(u.id) === String(userId));
    parts.push(emp ? emp.name : 'All employees');
    if (year) {
      const monthLabel = MONTHS.find((m) => m.value === month)?.label;
      parts.push(month ? `${monthLabel} ${year}` : `Year ${year}`);
    } else {
      parts.push('All dates');
    }
    parts.push(
      leaveType === 'all' ? 'All leave types' : REQUEST_LABELS[leaveType] || leaveType
    );
    return parts.join(' · ');
  }, [users, userId, year, month, leaveType]);

  async function fetchLeaves() {
    const params = new URLSearchParams();
    if (userId) params.set('userId', userId);
    if (leaveType && leaveType !== 'all') params.set('leaveType', leaveType);
    const { from, to } = monthRange(year, month);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const data = await api(`/leaves?${params.toString()}`);
    return data.leaves || [];
  }

  async function handleDownload(format) {
    setBusy(true);
    setError('');
    try {
      const leaves = await fetchLeaves();
      setCount(leaves.length);
      const stamp = [
        year || 'all',
        month || 'all-months',
        userId || 'all-employees',
        leaveType || 'all',
      ].join('_');
      const base = `ultrix-leaves_${stamp}`;
      if (format === 'csv') {
        downloadLeavesCsv(leaves, `${base}.csv`);
      } else {
        downloadLeavesPdf(
          leaves,
          {
            title: 'Ultrix Leave Portal — Leave export',
            subtitle: filterSummary,
          },
          `${base}.pdf`
        );
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel leave-export-panel">
      <div className="export-head">
        <div>
          <h2>Download leave data</h2>
        </div>
      </div>

      <div className="export-filters">
        <label>
          Employee
          <select value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">All employees</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
                {u.employeeNumber ? ` (${u.employeeNumber})` : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          Year
          <select value={year} onChange={(e) => setYear(e.target.value)}>
            <option value="">All years</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <label>
          Month
          <select
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            disabled={!year}
          >
            {MONTHS.map((m) => (
              <option key={m.value || 'all'} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Type of leave
          <select value={leaveType} onChange={(e) => setLeaveType(e.target.value)}>
            <option value="all">All types</option>
            <option value="casual">Casual Leave</option>
            <option value="earned">Earned Leave</option>
            <option value="sick">Sick Leave</option>
            <option value="restricted">Restricted Leave</option>
            <option value="wfh">Work from Home</option>
          </select>
        </label>
      </div>

      <div className="export-actions">
        <button
          type="button"
          className={`download-icon-btn ${busy ? 'is-busy' : ''}`}
          disabled={busy}
          onClick={() => handleDownload('csv')}
          aria-label={busy ? 'Preparing CSV' : 'Download CSV'}
          title="Download CSV"
        >
          <img src="/assets/document.png" alt="" />
          <span className="download-icon-tip">{busy ? 'Preparing…' : 'Download CSV'}</span>
        </button>
        <button
          type="button"
          className={`download-icon-btn ${busy ? 'is-busy' : ''}`}
          disabled={busy}
          onClick={() => handleDownload('pdf')}
          aria-label={busy ? 'Preparing PDF' : 'Download PDF'}
          title="Download PDF"
        >
          <img src="/assets/download-pdf.png" alt="" />
          <span className="download-icon-tip">{busy ? 'Preparing…' : 'Download PDF'}</span>
        </button>
        {count !== null && (
          <span className="muted export-count">
            {count} record{count === 1 ? '' : 's'}
          </span>
        )}
      </div>
      {error && <p className="form-error">{error}</p>}
    </section>
  );
}
