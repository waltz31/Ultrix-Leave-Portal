import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { formatDate, formatDateTime } from '../utils';

export default function HrRegularizationsPanel() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api('/attendance/regularizations?status=pending');
      setItems(data.regularizations || []);
    } catch (err) {
      setError(err.message || 'Could not load regularizations');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function review(id, action) {
    setBusyId(id);
    setError('');
    try {
      await api(`/attendance/regularizations/${id}/review`, {
        method: 'PATCH',
        body: { action, note },
      });
      setNote('');
      await load();
    } catch (err) {
      setError(err.message || 'Could not update request');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="panel att-reg-panel">
      <div className="row-between">
        <div>
          <h2>Attendance regularizations</h2>
          <p className="muted">Review short-hours correction requests from employees.</p>
        </div>
        <button type="button" className="btn secondary" onClick={load} disabled={loading}>
          Refresh
        </button>
      </div>
      {error ? <p className="form-error">{error}</p> : null}
      {loading && !items.length ? <p className="muted">Loading…</p> : null}
      {!loading && !items.length ? (
        <p className="empty">No pending regularization requests.</p>
      ) : null}
      {!!items.length && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Date</th>
                <th>Current</th>
                <th>Proposed</th>
                <th>Reason</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id}>
                  <td>
                    {row.userName}
                    <div className="sub">{row.employeeNumber || ''}</div>
                  </td>
                  <td>{formatDate(row.punchDate)}</td>
                  <td>
                    <div className="att-reg-times">
                      <span>{formatDateTime(row.currentPunchIn)}</span>
                      <span>→ {row.currentPunchOut ? formatDateTime(row.currentPunchOut) : '—'}</span>
                      <strong>{row.currentWorkHours || '—'}</strong>
                    </div>
                  </td>
                  <td>
                    <div className="att-reg-times">
                      <span>{formatDateTime(row.proposedPunchIn)}</span>
                      <span>→ {formatDateTime(row.proposedPunchOut)}</span>
                      <strong>{row.proposedWorkHours || '—'}</strong>
                    </div>
                  </td>
                  <td>{row.reason}</td>
                  <td>
                    <div className="att-reg-actions">
                      <button
                        type="button"
                        className="btn secondary"
                        disabled={busyId === row.id}
                        onClick={() => review(row.id, 'reject')}
                      >
                        Reject
                      </button>
                      <button
                        type="button"
                        className="btn primary"
                        disabled={busyId === row.id}
                        onClick={() => review(row.id, 'approve')}
                      >
                        Approve
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!!items.length && (
        <label className="att-reg-note">
          HR note (optional, applied to next action)
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional note"
          />
        </label>
      )}
    </section>
  );
}
