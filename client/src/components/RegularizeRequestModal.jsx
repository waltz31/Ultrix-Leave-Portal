import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { getPortalRoot } from '../portalRoot';
import { appToday, toYmd } from '../utils';

function isWeekdayYmd(ymd) {
  const [year, month, day] = String(ymd || '').split('-').map(Number);
  if (!year || !month || !day) return false;
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday >= 1 && weekday <= 5;
}

function stampToTime(stamp) {
  const m = String(stamp || '').match(/(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : '';
}

function sessionForUser(punches, userId) {
  const mine = (punches || []).filter((row) => Number(row.userId) === Number(userId));
  return mine[0] || punches?.[0] || null;
}

export default function RegularizeRequestModal({
  open,
  onClose,
  defaultDate,
  currentIn = '',
  currentOut = '',
  onSubmitted,
}) {
  const { user } = useAuth();
  const [date, setDate] = useState(defaultDate || '');
  const [punchIn, setPunchIn] = useState(currentIn || '09:30');
  const [punchOut, setPunchOut] = useState(currentOut || '18:30');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setDate(defaultDate || '');
    setPunchIn(currentIn || '09:30');
    setPunchOut(currentOut || '18:30');
    setReason('');
    setError('');
  }, [open, defaultDate, currentIn, currentOut]);

  useEffect(() => {
    if (!open || !date) return undefined;
    let cancelled = false;
    api(`/punches?from=${date}&to=${date}`)
      .then((data) => {
        if (cancelled) return;
        const session = sessionForUser(data.punches, user?.id);
        if (!session) return;
        setPunchIn((prev) => stampToTime(session.punchIn) || prev);
        setPunchOut((prev) => stampToTime(session.punchOut) || prev);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, date, user?.id]);

  if (!open) return null;
  const root = getPortalRoot();
  if (!root) return null;

  const todayYmd = toYmd(appToday());

  async function submit(event) {
    event.preventDefault();
    setError('');
    if (date > todayYmd) {
      setError('Regularization cannot be requested for a future date');
      return;
    }
    if (!isWeekdayYmd(date)) {
      setError('Regularization is allowed on weekdays only');
      return;
    }
    setBusy(true);
    try {
      await api('/attendance/regularizations', {
        method: 'POST',
        body: {
          punchDate: date,
          proposedPunchIn: punchIn,
          proposedPunchOut: punchOut,
          reason,
        },
      });
      onSubmitted?.({ date });
      onClose?.();
    } catch (err) {
      setError(err.message || 'Could not send request');
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal regularize-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="regularize-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="regularize-title">Request Regularization</h2>
        <p className="muted">
          Correct missing or wrong punches. Your request is sent for approval.
        </p>
        {error ? <p className="form-error">{error}</p> : null}
        <form className="stack-form" onSubmit={submit}>
          <label>
            Date
            <input
              type="date"
              required
              max={todayYmd}
              value={date}
              onChange={(e) => {
                const next = e.target.value;
                setDate(next);
                if (next && !isWeekdayYmd(next)) {
                  setError('Regularization is allowed on weekdays only');
                } else if (next > todayYmd) {
                  setError('Regularization cannot be requested for a future date');
                } else {
                  setError('');
                }
              }}
            />
          </label>
          <div className="regularize-time-row">
            <label>
              Current In Time
              <input
                type="time"
                required
                value={punchIn}
                onChange={(e) => setPunchIn(e.target.value)}
              />
            </label>
            <label>
              Current Out Time
              <input
                type="time"
                required
                value={punchOut}
                onChange={(e) => setPunchOut(e.target.value)}
              />
            </label>
          </div>
          <label>
            Reason
            <textarea
              required
              rows={4}
              maxLength={500}
              value={reason}
              placeholder="Why should attendance be regularized?"
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <p className="regularize-note">
            Your request will be sent to your manager for approval.
          </p>
          <div className="modal-actions">
            <button type="button" className="btn secondary" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={busy}>
              {busy ? 'Sending…' : 'Submit Request'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    root
  );
}
