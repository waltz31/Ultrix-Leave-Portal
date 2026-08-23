import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import {
  avatarSrc,
  formatDate,
  formatDateTime,
  formatOverviewHolidayRow,
  formatTime,
} from '../utils';

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

export default function RegularizationHistoryPanel() {
  const [history, setHistory] = useState([]);
  const [lastApproved, setLastApproved] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api('/attendance/regularizations');
      setHistory(data.history || []);
      setLastApproved(data.lastApproved || null);
    } catch (err) {
      setError(err.message || 'Could not load regularization history');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="history-tab-body">
      {lastApproved && (
        <p className="regdash-last-approved">
          Last approved: <strong>{lastApproved.userName}</strong>
          {' · '}
          {punchDayLabel(lastApproved.punchDate)}
          {lastApproved.hrReviewedAt ? ` · ${formatDateTime(lastApproved.hrReviewedAt)}` : ''}
          {lastApproved.hrName ? ` · by ${lastApproved.hrName}` : ''}
        </p>
      )}
      {loading && <p className="muted">Loading…</p>}
      {error && <p className="form-error">{error}</p>}
      {!loading && !history.length && <p className="empty">No regularization history yet.</p>}
      {!!history.length && (
        <div className="table-wrap">
          <table className="regdash-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Attendance date</th>
                <th>Status</th>
                <th>Reviewed</th>
                <th>Reviewer</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {history.map((row) => (
                <tr key={row.id}>
                  <td>
                    <strong>{row.userName}</strong>
                    <div className="sub">{row.employeeNumber || '—'}</div>
                  </td>
                  <td>{punchDayLabel(row.punchDate)}</td>
                  <td>
                    <span className={`regdash-status is-${row.displayStatus || row.status}`}>
                      {statusLabel(row.displayStatus || row.status)}
                    </span>
                  </td>
                  <td>{row.hrReviewedAt ? formatDateTime(row.hrReviewedAt) : '—'}</td>
                  <td>{row.hrName || '—'}</td>
                  <td>
                    <button type="button" className="btn secondary" onClick={() => setSelected(row)}>
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <div className="regdash-drawer-wrap">
          <button
            type="button"
            className="regdash-drawer-mask"
            aria-label="Close details"
            onClick={() => setSelected(null)}
          />
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
                <div className="sub">
                  {[selected.employeeNumber, selected.department].filter(Boolean).join(' · ')}
                </div>
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
                <dt>Requested check-in</dt>
                <dd>{selected.proposedPunchIn ? formatTime(selected.proposedPunchIn) : '—'}</dd>
              </div>
              <div>
                <dt>Requested check-out</dt>
                <dd>{selected.proposedPunchOut ? formatTime(selected.proposedPunchOut) : '—'}</dd>
              </div>
            </dl>
            <p className="regdash-block">{selected.reason || '—'}</p>
            {selected.hrNote ? <p className="regdash-block">Reviewer note: {selected.hrNote}</p> : null}
            <p className="muted">
              {selected.hrReviewedAt ? formatDateTime(selected.hrReviewedAt) : formatDate(selected.punchDate)}
              {selected.hrName ? ` · ${selected.hrName}` : ''}
            </p>
          </aside>
        </div>
      )}
    </div>
  );
}
