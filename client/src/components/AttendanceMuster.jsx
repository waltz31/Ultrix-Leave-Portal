import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { api } from '../api';
import { usePollWhenVisible } from '../usePollWhenVisible';
import {
  APPLY_LABELS,
  appToday,
  avatarSrc,
  formatDate,
  formatTime,
  isUnderNineHours,
  punchInLateness,
  toYmd,
} from '../utils';
import { PunchInProgressChip, PunchStillInChip } from './PunchStatusChips';

const STATUS_META = {
  present: { label: 'Present', className: 'is-present' },
  late: { label: 'Late', className: 'is-late' },
  absent: { label: 'Absent', className: 'is-absent' },
  on_leave: { label: 'On leave', className: 'is-leave' },
  wfh: { label: 'WFH', className: 'is-wfh' },
  weekend: { label: 'Weekend', className: 'is-off' },
  holiday: { label: 'Holiday', className: 'is-off' },
};

function statusLabel(row) {
  if (row.status === 'on_leave' && row.leaveType) {
    return APPLY_LABELS[row.leaveType] || STATUS_META.on_leave.label;
  }
  if (row.status === 'holiday') return STATUS_META.holiday.label;
  return STATUS_META[row.status]?.label || row.status;
}

function downloadMusterExcel(muster, filename) {
  const rows = (muster?.rows || []).map((row) => ({
    Employee: row.userName || '',
    'Employee ID': row.employeeNumber || '',
    Department: row.department || '',
    Location: row.location || '',
    'Punch In': row.punchIn ? formatTime(row.punchIn) : '',
    'Punch Out': row.punchOut ? formatTime(row.punchOut) : row.stillIn ? 'Still in' : '',
    'Work Hours': row.workHours || (row.stillIn ? 'In progress' : ''),
    Status: statusLabel(row),
  }));
  const sheet = XLSX.utils.json_to_sheet(
    rows.length
      ? rows
      : [
          {
            Employee: '',
            'Employee ID': '',
            Department: '',
            Location: '',
            'Punch In': '',
            'Punch Out': '',
            'Work Hours': '',
            Status: '',
          },
        ]
  );
  sheet['!cols'] = [
    { wch: 28 },
    { wch: 14 },
    { wch: 18 },
    { wch: 16 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 16 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Muster');
  XLSX.writeFile(workbook, filename || `attendance-muster-${muster?.date || 'export'}.xlsx`);
}

export default function AttendanceMuster({ canSync = false }) {
  const [searchParams] = useSearchParams();
  const today = toYmd(appToday());
  const [date, setDate] = useState(searchParams.get('date') || today);
  const [location, setLocation] = useState('');
  const [department, setDepartment] = useState('');
  const [statusFilter, setStatusFilter] = useState(searchParams.get('focus') || '');
  const [query, setQuery] = useState('');
  const [data, setData] = useState(null);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ date });
    if (location) params.set('location', location);
    if (department) params.set('department', department);
    const res = await api(`/attendance/muster?${params}`);
    setData(res.muster);
    setStatus(res.status || null);
    setError('');
  }, [date, location, department]);

  usePollWhenVisible(
    () => {
      load()
        .catch((err) => setError(err.message || 'Could not load attendance muster'))
        .finally(() => setLoading(false));
    },
    60_000,
    [load]
  );

  async function syncNow() {
    setSyncing(true);
    setError('');
    try {
      await api('/punches/sync', { method: 'POST', body: {} });
      await load();
    } catch (err) {
      setError(err.message || 'Could not sync punches');
      try {
        const data = await api('/punches/status');
        setStatus(data.status || null);
      } catch {
        // ignore
      }
    } finally {
      setSyncing(false);
    }
  }

  const kpis = data?.kpis;
  const filters = data?.filters || { locations: [], departments: [] };

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.rows || []).filter((row) => {
      if (statusFilter === 'present' && !(row.status === 'present' || row.status === 'late')) return false;
      if (statusFilter === 'late' && row.status !== 'late') return false;
      if (statusFilter === 'absent' && row.status !== 'absent') return false;
      if (statusFilter === 'on_leave' && row.status !== 'on_leave') return false;
      if (statusFilter === 'wfh' && row.status !== 'wfh') return false;
      if (statusFilter === 'off' && row.status !== 'weekend' && row.status !== 'holiday') return false;
      if (!q) return true;
      const hay = [row.userName, row.employeeNumber, row.department, row.location]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [data, query, statusFilter]);

  const dayNote = data?.dayOff?.holiday?.title
    ? `Holiday · ${data.dayOff.holiday.title}`
    : data?.dayOff?.weekend
      ? 'Weekend'
      : null;

  return (
    <div className="muster">
      <div className="muster-head">
        <div>
          <h2>Attendance Muster</h2>
          <p className="muted">
            Daily attendance for {formatDate(date)}
            {dayNote ? ` · ${dayNote}` : ''}.
          </p>
        </div>
        <div className="muster-toolbar">
          <label>
            Date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <button
            type="button"
            className="btn secondary"
            disabled={!data?.rows?.length}
            onClick={() => downloadMusterExcel(data)}
          >
            Export Excel
          </button>
          {canSync && (
            <button type="button" className="btn" disabled={syncing} onClick={syncNow}>
              {syncing ? 'Syncing…' : 'Sync device'}
            </button>
          )}
        </div>
      </div>

      {status && !status.configured && (
        <p className="form-error">Punch API password is not configured on the server.</p>
      )}
      {status?.lastError ? <p className="form-error">{status.lastError}</p> : null}
      {error && <p className="form-error">{error}</p>}
      {loading && !data && <p className="muted">Loading muster…</p>}

      {kpis && (
        <div className="muster-kpis">
          <div className="panel muster-kpi">
            <span>Total</span>
            <strong>{kpis.totalEmployees}</strong>
          </div>
          <div className="panel muster-kpi is-present">
            <span>Present</span>
            <strong>{kpis.present}</strong>
            <em>{kpis.presentPct}%</em>
          </div>
          <div className="panel muster-kpi is-late">
            <span>Late</span>
            <strong>{kpis.late}</strong>
            <em>{kpis.latePct}%</em>
          </div>
          <div className="panel muster-kpi is-absent">
            <span>Absent</span>
            <strong>{kpis.absent}</strong>
            <em>{kpis.absentPct}%</em>
          </div>
          <div className="panel muster-kpi is-leave">
            <span>On leave</span>
            <strong>{kpis.onLeave}</strong>
            <em>{kpis.onLeavePct}%</em>
          </div>
          <div className="panel muster-kpi is-wfh">
            <span>WFH</span>
            <strong>{kpis.wfh}</strong>
            <em>{kpis.wfhPct}%</em>
          </div>
          <div className="panel muster-kpi is-off">
            <span>Weekend / Holiday</span>
            <strong>{kpis.weekendHoliday}</strong>
          </div>
          <div className="panel muster-kpi is-rate">
            <span>Attendance rate</span>
            <strong>{kpis.attendanceRate}%</strong>
          </div>
        </div>
      )}

      <div className="filters muster-filters">
        <label className="muster-search">
          Search
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name or employee ID…"
          />
        </label>
        <label>
          Department
          <select value={department} onChange={(e) => setDepartment(e.target.value)}>
            <option value="">All departments</option>
            {filters.departments.map((dept) => (
              <option key={dept} value={dept}>
                {dept}
              </option>
            ))}
          </select>
        </label>
        <label>
          Location
          <select value={location} onChange={(e) => setLocation(e.target.value)}>
            <option value="">All locations</option>
            {filters.locations.map((loc) => (
              <option key={loc} value={loc}>
                {loc}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            <option value="present">Present</option>
            <option value="late">Late</option>
            <option value="absent">Absent</option>
            <option value="on_leave">On leave</option>
            <option value="wfh">WFH</option>
            <option value="off">Weekend / Holiday</option>
          </select>
        </label>
      </div>

      {!loading && data && !rows.length && (
        <p className="empty">No employees match these filters.</p>
      )}

      {!!rows.length && (
        <div className="table-wrap">
          <table className="muster-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Department</th>
                <th>Punch in</th>
                <th>Punch out</th>
                <th>Work hours</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const meta = STATUS_META[row.status] || STATUS_META.absent;
                return (
                  <tr key={row.userId}>
                    <td>
                      <div className="muster-emp">
                        <img src={avatarSrc(row.profilePhoto)} alt="" />
                        <div>
                          <strong>{row.userName || '—'}</strong>
                          <div className="sub">{row.employeeNumber || '—'}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      {row.department || '—'}
                      {row.location ? <div className="sub">{row.location}</div> : null}
                    </td>
                    <td>
                      {row.punchIn ? (
                        <span className={`punch-in-sq is-${punchInLateness(row.punchIn) || 'on-time'}`}>
                          {formatTime(row.punchIn)}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      {row.punchOut ? (
                        formatTime(row.punchOut)
                      ) : row.stillIn ? (
                        <PunchStillInChip />
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      {row.workHours ? (
                        <span className={isUnderNineHours(row.workMinutes) ? 'work-hours-short' : undefined}>
                          {row.workHours}
                        </span>
                      ) : row.stillIn ? (
                        <PunchInProgressChip />
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      <span className={`muster-status ${meta.className}`}>{statusLabel(row)}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
