import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import {
  avatarSrc,
  formatDate,
  formatDateTime,
  formatOverviewHolidayRow,
  formatTime,
  punchInLateness,
} from '../utils';
import StatusCelebration from './StatusCelebration';

const PAGE_SIZE = 10;

function statusLabel(status) {
  if (status === 'changes_requested') return 'Changes requested';
  if (status === 'approved') return 'Approved';
  if (status === 'rejected') return 'Rejected';
  if (status === 'cancelled') return 'Cancelled';
  return 'Pending';
}

function punchDayLabel(ymd) {
  const { date, weekday } = formatOverviewHolidayRow(ymd);
  return weekday ? `${date} (${weekday})` : date;
}

function csvEscape(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

export default function RegularizationInbox() {
  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState({
    total: 0,
    pending: 0,
    approved: 0,
    rejected: 0,
    avgApprovalDays: 0,
  });
  const [departments, setDepartments] = useState([]);
  const [reasons, setReasons] = useState([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [status, setStatus] = useState('all');
  const [department, setDepartment] = useState('');
  const [reason, setReason] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const [checked, setChecked] = useState(() => new Set());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState('');
  const [history, setHistory] = useState([]);
  const [lastApproved, setLastApproved] = useState(null);
  const [lastApprovedByUser, setLastApprovedByUser] = useState({});

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 250);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (department) params.set('department', department);
      if (reason) params.set('reason', reason);
      if (search) params.set('search', search);
      const data = await api(`/attendance/regularizations?${params}`);
      setRows(data.regularizations || []);
      setStats(
        data.stats || {
          total: 0,
          pending: 0,
          approved: 0,
          rejected: 0,
          avgApprovalDays: 0,
        }
      );
      setDepartments(data.departments || []);
      setReasons(data.reasons || []);
      setHistory(data.history || []);
      setLastApproved(data.lastApproved || null);
      setLastApprovedByUser(data.lastApprovedByUser || {});
      if (!from && data.from) setFrom(data.from);
      if (!to && data.to) setTo(data.to);
    } catch (err) {
      setError(err.message || 'Could not load regularization requests');
    } finally {
      setLoading(false);
    }
  }, [status, from, to, department, reason, search]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setPage(1);
    setChecked(new Set());
  }, [status, from, to, department, reason, search]);

  const openRows = useMemo(
    () => rows.filter((row) => row.status === 'pending'),
    [rows]
  );
  const pageCount = Math.max(1, Math.ceil(openRows.length / PAGE_SIZE));
  const pageRows = openRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function toggle(id) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function togglePage() {
    const ids = pageRows.filter((row) => row.status === 'pending').map((row) => row.id);
    setChecked((prev) => {
      const next = new Set(prev);
      const allOn = ids.every((id) => next.has(id));
      ids.forEach((id) => (allOn ? next.delete(id) : next.add(id)));
      return next;
    });
  }

  async function review(id, action, extraNote = '') {
    setBusy(true);
    setError('');
    try {
      await api(`/attendance/regularizations/${id}/review`, {
        method: 'PATCH',
        body: { action, note: extraNote || note },
      });
      setSuccess(
        action === 'approve'
          ? 'Request approved'
          : action === 'reject'
            ? 'Request rejected'
            : 'Change request sent'
      );
      setNote('');
      setSelected(null);
      await load();
    } catch (err) {
      setError(err.message || 'Could not update request');
    } finally {
      setBusy(false);
    }
  }

  async function bulk(action) {
    const ids = [...checked];
    if (!ids.length) return;
    setBusy(true);
    setError('');
    try {
      for (const id of ids) {
        await api(`/attendance/regularizations/${id}/review`, {
          method: 'PATCH',
          body: { action, note },
        });
      }
      setSuccess(action === 'approve' ? 'Selected requests approved' : 'Selected requests rejected');
      setChecked(new Set());
      setSelected(null);
      await load();
    } catch (err) {
      setError(err.message || 'Could not update requests');
    } finally {
      setBusy(false);
    }
  }

  function resetFilters() {
    setStatus('all');
    setDepartment('');
    setReason('');
    setSearchInput('');
    setSearch('');
    setFrom('');
    setTo('');
  }

  function exportCsv() {
    const header = [
      'Code',
      'Employee',
      'Employee ID',
      'Department',
      'Request date',
      'Attendance date',
      'Issue',
      'Reason',
      'Status',
      'Current in',
      'Current out',
      'Requested in',
      'Requested out',
    ];
    const lines = [
      header.join(','),
      ...openRows.map((row) =>
        [
          row.code,
          row.userName,
          row.employeeNumber,
          row.department,
          row.createdAt,
          row.punchDate,
          row.issueLabel,
          row.reason,
          statusLabel(row.displayStatus || row.status),
          row.currentPunchIn,
          row.currentPunchOut,
          row.proposedPunchIn,
          row.proposedPunchOut,
        ]
          .map(csvEscape)
          .join(',')
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'regularization-requests.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  const pendingChecked = useMemo(
    () => rows.filter((row) => checked.has(row.id) && row.status === 'pending'),
    [rows, checked]
  );

  return (
    <div className="regdash">
      <StatusCelebration
        show={Boolean(success)}
        onDone={() => setSuccess('')}
        message={success || 'Updated'}
        detail="The employee has been notified."
        imageSrc="/assets/request-submitted.gif"
        durationMs={2600}
      />

      <div className="regdash-kpis">
        <article className="panel regdash-kpi tone-total">
          <span>Total requests</span>
          <strong>{stats.total}</strong>
          <span>This month</span>
        </article>
        <article className="panel regdash-kpi tone-pending">
          <span>Pending requests</span>
          <strong>{stats.pending}</strong>
          <span>Needs action</span>
        </article>
        <article className="panel regdash-kpi tone-approved">
          <span>Approved</span>
          <strong>{stats.approved}</strong>
          <span>This month</span>
        </article>
        <article className="panel regdash-kpi tone-rejected">
          <span>Rejected</span>
          <strong>{stats.rejected}</strong>
          <span>This month</span>
        </article>
        <article className="panel regdash-kpi tone-time">
          <span>Avg. approval time</span>
          <strong>{stats.avgApprovalDays || 0}</strong>
          <span>Days</span>
        </article>
      </div>

      <div className="panel regdash-filters">
        <label className="regdash-search">
          Search
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search employee, ID…"
          />
        </label>
        <label>
          Department
          <select value={department} onChange={(e) => setDepartment(e.target.value)}>
            <option value="">All departments</option>
            {departments.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label>
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">All statuses</option>
            <option value="pending">Pending</option>
            <option value="changes_requested">Changes requested</option>
          </select>
        </label>
        <label>
          Reason
          <select value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">All reasons</option>
            {reasons.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn secondary" onClick={resetFilters}>
          Reset
        </button>
      </div>

      {error ? <p className="form-error">{error}</p> : null}

      <section className="panel regdash-table-card">
        <div className="row-between">
          <h2>{openRows.length} open request{openRows.length === 1 ? '' : 's'}</h2>
          <div className="regdash-toolbar">
            <button
              type="button"
              className="btn secondary"
              disabled={!pendingChecked.length || busy}
              onClick={() => bulk('approve')}
            >
              Approve selected
            </button>
            <button
              type="button"
              className="btn secondary"
              disabled={!pendingChecked.length || busy}
              onClick={() => bulk('reject')}
            >
              Reject selected
            </button>
            <button type="button" className="btn primary" onClick={exportCsv} disabled={!openRows.length}>
              Export
            </button>
          </div>
        </div>

        {loading && !openRows.length ? <p className="muted">Loading…</p> : null}
        {!loading && !openRows.length ? <p className="empty">No open regularization requests.</p> : null}

        {!!pageRows.length && (
          <div className="table-wrap">
            <table className="regdash-table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={
                        pageRows.some((row) => row.status === 'pending') &&
                        pageRows.filter((row) => row.status === 'pending').every((row) => checked.has(row.id))
                      }
                      onChange={togglePage}
                      aria-label="Select page"
                    />
                  </th>
                  <th>Employee</th>
                  <th>Request date</th>
                  <th>Attendance date</th>
                  <th>Issue</th>
                  <th>Reason</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row) => (
                  <tr key={row.id} className={selected?.id === row.id ? 'is-open' : ''}>
                    <td>
                      <input
                        type="checkbox"
                        checked={checked.has(row.id)}
                        disabled={row.status !== 'pending'}
                        onChange={() => toggle(row.id)}
                        aria-label={`Select ${row.userName}`}
                      />
                    </td>
                    <td>
                      <div className="regdash-emp">
                        <img src={avatarSrc(row.profilePhoto)} alt="" />
                        <div>
                          <strong>{row.userName}</strong>
                          <div className="sub">
                            {[row.employeeNumber, row.department].filter(Boolean).join(' · ') || '—'}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>{row.createdAt ? formatDateTime(row.createdAt) : '—'}</td>
                    <td>{punchDayLabel(row.punchDate)}</td>
                    <td>
                      <span className={`regdash-issue is-${row.issueKey}`}>{row.issueLabel}</span>
                    </td>
                    <td>{row.reason || '—'}</td>
                    <td>
                      <span className={`regdash-status is-${row.displayStatus || row.status}`}>
                        {statusLabel(row.displayStatus || row.status)}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn secondary"
                        onClick={() => {
                          setSelected(row);
                          setNote(row.hrNote || '');
                        }}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {openRows.length > PAGE_SIZE && (
          <div className="regdash-pager">
            <span>
              Showing {(page - 1) * PAGE_SIZE + 1} to {Math.min(page * PAGE_SIZE, openRows.length)} of {openRows.length}
            </span>
            <div>
              <button type="button" className="btn secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Prev
              </button>
              <span>
                {page} / {pageCount}
              </span>
              <button
                type="button"
                className="btn secondary"
                disabled={page >= pageCount}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </section>

      {selected && (
        <div className="regdash-drawer-wrap">
          <button type="button" className="regdash-drawer-mask" aria-label="Close details" onClick={() => setSelected(null)} />
          <aside className="panel regdash-drawer" aria-label="Request details">
            <div className="row-between">
              <h2>Request details</h2>
              <button type="button" className="btn secondary" onClick={() => setSelected(null)}>
                Close
              </button>
            </div>
            <div className="regdash-drawer-meta">
              <span className={`regdash-status is-${selected.displayStatus || selected.status}`}>
                {statusLabel(selected.displayStatus || selected.status)}
              </span>
              <code>{selected.code}</code>
            </div>
            <div className="regdash-emp lg">
              <img src={avatarSrc(selected.profilePhoto)} alt="" />
              <div>
                <strong>{selected.userName}</strong>
                <div className="sub">{[selected.employeeNumber, selected.department].filter(Boolean).join(' · ')}</div>
                {selected.email ? <div className="sub">{selected.email}</div> : null}
                {selected.phone ? <div className="sub">{selected.phone}</div> : null}
              </div>
            </div>
            <dl className="regdash-facts">
              <div>
                <dt>Attendance date</dt>
                <dd>{punchDayLabel(selected.punchDate)}</dd>
              </div>
              <div>
                <dt>Original status</dt>
                <dd>{selected.issueLabel}</dd>
              </div>
              <div>
                <dt>Actual check-in</dt>
                <dd>
                  {selected.currentPunchIn ? (
                    <span className={`punch-in-sq is-${punchInLateness(selected.currentPunchIn) || 'on-time'}`}>
                      {formatTime(selected.currentPunchIn)}
                    </span>
                  ) : (
                    'Not marked'
                  )}
                </dd>
              </div>
              <div>
                <dt>Actual check-out</dt>
                <dd>{selected.currentPunchOut ? formatTime(selected.currentPunchOut) : 'Not marked'}</dd>
              </div>
              <div>
                <dt>Requested check-in</dt>
                <dd>
                  {selected.proposedPunchIn ? (
                    <span className={`punch-in-sq is-${punchInLateness(selected.proposedPunchIn) || 'on-time'}`}>
                      {formatTime(selected.proposedPunchIn)}
                    </span>
                  ) : (
                    '—'
                  )}
                </dd>
              </div>
              <div>
                <dt>Requested check-out</dt>
                <dd>{selected.proposedPunchOut ? formatTime(selected.proposedPunchOut) : '—'}</dd>
              </div>
            </dl>
            <label>
              Reason
              <p className="regdash-block">{selected.reason || '—'}</p>
            </label>
            {(() => {
              const previous =
                lastApprovedByUser[selected.userId] || lastApprovedByUser[String(selected.userId)];
              if (!previous) return null;
              const isThis = Number(previous.id) === Number(selected.id);
              return (
                <div className="regdash-previous">
                  <h3>{isThis ? 'Approved record' : 'Last approved'}</h3>
                  <p>
                    {punchDayLabel(previous.punchDate)}
                    {previous.hrReviewedAt ? ` · ${formatDateTime(previous.hrReviewedAt)}` : ''}
                    {previous.hrName ? ` · ${previous.hrName}` : ''}
                  </p>
                  <p className="sub">
                    {previous.proposedPunchIn ? formatTime(previous.proposedPunchIn) : '—'}
                    {' → '}
                    {previous.proposedPunchOut ? formatTime(previous.proposedPunchOut) : '—'}
                    {previous.reason ? ` · ${previous.reason}` : ''}
                  </p>
                </div>
              );
            })()}
            <ol className="regdash-timeline">
              <li>
                <strong>Request submitted</strong>
                <span>{selected.createdAt ? formatDateTime(selected.createdAt) : '—'}</span>
              </li>
              {selected.status === 'pending' ? (
                <li>
                  <strong>Under review</strong>
                  <span>Waiting for approval</span>
                </li>
              ) : (
                <li>
                  <strong>{statusLabel(selected.status)}</strong>
                  <span>{selected.hrReviewedAt ? formatDateTime(selected.hrReviewedAt) : formatDate(selected.punchDate)}</span>
                </li>
              )}
            </ol>
            {selected.status === 'pending' ? (
              <>
                <label>
                  Reviewer comments
                  <textarea
                    rows={3}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Add a note for the employee"
                  />
                </label>
                <div className="regdash-drawer-actions">
                  <button
                    type="button"
                    className="btn danger"
                    disabled={busy}
                    onClick={() => review(selected.id, 'reject')}
                  >
                    Reject
                  </button>
                  <button
                    type="button"
                    className="btn secondary"
                    disabled={busy || !note.trim()}
                    onClick={() => review(selected.id, 'changes')}
                  >
                    Request changes
                  </button>
                  <button
                    type="button"
                    className="btn primary"
                    disabled={busy}
                    onClick={() => review(selected.id, 'approve')}
                  >
                    Approve
                  </button>
                </div>
              </>
            ) : selected.hrNote ? (
              <p className="regdash-block">Reviewer note: {selected.hrNote}</p>
            ) : null}
          </aside>
        </div>
      )}
    </div>
  );
}
