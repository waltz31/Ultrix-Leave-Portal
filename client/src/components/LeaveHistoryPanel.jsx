import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import ApprovalProgress from './ApprovalProgress';
import { REQUEST_LABELS, STATUS_LABELS, formatLeaveSpan, canUserCancel } from '../utils';

async function cancelLeave(id, status) {
  const detail =
    status === 'approved'
      ? ' Leave days will be restored to your balance if applicable.'
      : status === 'pending_hr'
        ? ' This leave is partially approved (manager approved, awaiting HR).'
        : '';
  if (!window.confirm(`Cancel this entire request?${detail}`)) return false;
  await api(`/leaves/${id}/cancel`, {
    method: 'PATCH',
    body: { cancelAll: true },
  });
  return true;
}

export default function LeaveHistoryPanel({ showEmployee = false, canCancel = false }) {
  const [status, setStatus] = useState('all');
  const [userId, setUserId] = useState('');
  const [users, setUsers] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    if (!showEmployee) return undefined;
    let cancelled = false;
    api('/users')
      .then((data) => {
        if (!cancelled) setUsers(data.users || []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [showEmployee]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ status });
      if (showEmployee && userId) params.set('userId', userId);
      const data = await api(`/leaves?${params}`);
      setLeaves(data.leaves || []);
    } catch (err) {
      setError(err.message || 'Could not load leave history');
    } finally {
      setLoading(false);
    }
  }, [status, userId, showEmployee]);

  useEffect(() => {
    load();
  }, [load]);

  async function onCancel(leave) {
    setError('');
    setBusyId(leave.id);
    try {
      const done = await cancelLeave(leave.id, leave.status);
      if (done) await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="history-tab-body">
      <div className="filters">
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">All</option>
            <option value="pending_manager">Awaiting manager</option>
            <option value="pending_hr">Awaiting HR</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
        {showEmployee && (
          <label>
            Employee
            <select value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">Everyone</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {loading && <p className="muted">Loading…</p>}
      {error && <p className="form-error">{error}</p>}
      {!loading && !leaves.length && <p className="empty">No leave history yet.</p>}
      <div className="stack tight">
        {leaves.map((leave) => (
          <section key={leave.id} className="panel">
            <div className="row-between">
              <div>
                {showEmployee ? (
                  <>
                    <strong className="employee-name">{leave.userName}</strong>
                    {' · '}
                  </>
                ) : null}
                {REQUEST_LABELS[leave.leaveType]} · {formatLeaveSpan(leave)}
              </div>
              <div className="row-actions">
                <span className={`badge status-${leave.status}`}>
                  {STATUS_LABELS[leave.status]}
                </span>
                {canCancel && canUserCancel(leave.status) && (
                  <button
                    type="button"
                    className="btn danger ghost-danger"
                    disabled={busyId === leave.id}
                    onClick={() => onCancel(leave)}
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
            <ApprovalProgress leave={leave} compact={!canCancel} />
          </section>
        ))}
      </div>
    </div>
  );
}
