import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { api } from '../api';
import { usePollWhenVisible } from '../usePollWhenVisible';
import { appToday, toYmd } from '../utils';

function monthLabel(month) {
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return month || '';
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' });
}

function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${yy}-${mm}`;
}

function monthOptions(around) {
  const opts = [];
  for (let i = -8; i <= 2; i += 1) {
    const value = shiftMonth(around, i);
    opts.push({ value, label: monthLabel(value) });
  }
  return opts;
}

function downloadMusterExcel(muster, filename) {
  const days = muster?.days || [];
  const totalKeys = muster?.totalKeys || [];
  const balanceLabelByKey = Object.fromEntries(
    (muster?.balanceColumns || []).map((col) => [col.key, col.label || col.key])
  );
  const rows = (muster?.rows || []).map((row) => {
    const out = {
      Employee: row.userName || '',
      'Employee ID': row.employeeNumber || '',
      Designation: row.designation || '',
      Location: row.location || '',
      Department: row.department || '',
    };
    for (const day of days) {
      out[`${day.day} ${day.weekday}`] = row.cells?.[day.ymd]?.code || '-';
    }
    for (const key of totalKeys) {
      const label = balanceLabelByKey[key] || key;
      const n = Number(row.totals?.[key]);
      out[`${label} Bal`] = Number.isFinite(n) ? n : 0;
    }
    return out;
  });

  const sheet = XLSX.utils.json_to_sheet(
    rows.length
      ? rows
      : [
          {
            Employee: '',
            'Employee ID': '',
            Designation: '',
            Location: '',
            Department: '',
          },
        ]
  );
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Muster');
  XLSX.writeFile(workbook, filename || `attendance-muster-${muster?.month || 'export'}.xlsx`);
}

function fmtBalance(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return n % 1 ? n.toFixed(1) : String(n);
}

function cellTitle(cell, day) {
  if (!cell) return '';
  const bits = [cell.code];
  if (cell.leaveType) bits.push(cell.leaveType);
  if (cell.holidayTitle) bits.push(cell.holidayTitle);
  if (day?.holiday?.title) bits.push(day.holiday.title);
  if (cell.late) bits.push('Grace / late');
  return bits.filter(Boolean).join(' · ');
}

export default function AttendanceMuster({ canSync = false }) {
  const [searchParams] = useSearchParams();
  const today = toYmd(appToday());
  const initialMonth = (searchParams.get('month') || searchParams.get('date') || today).slice(0, 7);

  const [month, setMonth] = useState(initialMonth);
  const [employeeId, setEmployeeId] = useState('');
  const [category, setCategory] = useState('');
  const [data, setData] = useState(null);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ month });
    if (category) params.set('department', category);
    if (employeeId) params.set('userId', employeeId);
    const res = await api(`/attendance/muster?${params}`);
    setData(res.muster);
    setStatus(res.status || null);
    setError('');
  }, [month, category, employeeId]);

  usePollWhenVisible(
    () => {
      load()
        .catch((err) => setError(err.message || 'Could not load attendance muster'))
        .finally(() => setLoading(false));
    },
    120_000,
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

  const filters = data?.filters || { locations: [], departments: [], employees: [] };
  const days = data?.days || [];
  const totalKeys = data?.totalKeys || [];
  const balanceLabelByKey = useMemo(() => {
    const map = {};
    for (const col of data?.balanceColumns || []) {
      map[col.key] = col.label || col.key;
    }
    return map;
  }, [data?.balanceColumns]);
  const rows = data?.rows || [];
  const months = useMemo(() => monthOptions(today.slice(0, 7)), [today]);

  return (
    <div className="muster muster-monthly">
      <div className="muster-head">
        <div>
          <h2>Attendance Muster</h2>
          <p className="muted">{monthLabel(month)} · monthly roll</p>
        </div>
        <div className="muster-toolbar">
          <button
            type="button"
            className="btn secondary"
            disabled={!rows.length}
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

      <div className="muster-roll-filters">
        <label>
          <span className="sr-only">Month</span>
          <select value={month} onChange={(e) => setMonth(e.target.value)}>
            {months.map((opt) => (
              <option key={opt.value} value={opt.value}>
                Month: {opt.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Attendance cycle</span>
          <select value="default" disabled>
            <option value="default">Default Attendance Cycle</option>
          </select>
        </label>
        <label>
          <span className="sr-only">Employee</span>
          <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="">Employee: All</option>
            {filters.employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.name}
                {emp.employeeNumber ? ` [${emp.employeeNumber}]` : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Category</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Category: All</option>
            {filters.departments.map((dept) => (
              <option key={dept} value={dept}>
                {dept}
              </option>
            ))}
          </select>
        </label>
      </div>

      {status && !status.configured && (
        <p className="form-error">Punch API password is not configured on the server.</p>
      )}
      {status?.lastError ? <p className="form-error">{status.lastError}</p> : null}
      {error && <p className="form-error">{error}</p>}
      {loading && !data && <p className="muted">Loading muster…</p>}

      {!loading && data && !rows.length && (
        <p className="empty">No employees match these filters.</p>
      )}

      {!!rows.length && (
        <div className="muster-roll-wrap">
          <table className="muster-roll-table">
            <thead>
              <tr>
                <th className="muster-roll-emp-col">Employee</th>
                {days.map((day) => (
                  <th
                    key={day.ymd}
                    className={`muster-roll-day-col${day.isWeekend ? ' is-weekend' : ''}${
                      day.holiday ? ' is-holiday' : ''
                    }`}
                    title={day.holiday?.title || undefined}
                  >
                    <span>{day.day}</span>
                    <em>{day.weekday}</em>
                  </th>
                ))}
                {totalKeys.map((key) => (
                  <th key={key} className="muster-roll-total-col" title={`${balanceLabelByKey[key] || key} balance`}>
                    {balanceLabelByKey[key] || key}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.userId}>
                  <th className="muster-roll-emp-col" scope="row">
                    <div className="muster-roll-emp">
                      <strong>
                        {row.userName || '—'}
                        {row.employeeNumber ? (
                          <span className="muster-roll-emp-id"> [{row.employeeNumber}]</span>
                        ) : null}
                      </strong>
                      {row.subtitle ? <span className="muster-roll-emp-sub">{row.subtitle}</span> : null}
                    </div>
                  </th>
                  {days.map((day) => {
                    const cell = row.cells?.[day.ymd] || { code: '-', tone: 'future' };
                    return (
                      <td
                        key={day.ymd}
                        className={`muster-roll-cell tone-${cell.tone || 'empty'}${
                          cell.code === 'A' ? ' is-absent' : ''
                        }`}
                        title={cellTitle(cell, day)}
                      >
                        <span>{cell.code || '-'}</span>
                      </td>
                    );
                  })}
                  {totalKeys.map((key) => (
                    <td key={key} className="muster-roll-total-cell">
                      {fmtBalance(row.totals?.[key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data?.legend?.length ? (
        <div className="muster-roll-footer">
          <div className="muster-roll-legend">
            <h3>Legend</h3>
            <div className="muster-roll-legend-list">
              {data.legend.map((item) => (
                <span key={`${item.code}-${item.label}`} className={`muster-roll-chip tone-${item.tone}`}>
                  {item.label}: {item.code}
                </span>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
