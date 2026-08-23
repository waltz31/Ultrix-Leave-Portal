import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { downloadPunchesExcel } from '../exportPunches';
import { formatDate, formatTime, isUnderNineHours, punchInLateness } from '../utils';
import { PunchInProgressChip, PunchStillInChip } from './PunchStatusChips';
import RegularizeRequestModal from './RegularizeRequestModal';
import StatusCelebration from './StatusCelebration';

function stampToTime(stamp) {
  const m = String(stamp || '').match(/(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : '';
}

export default function PunchBoard({ canSync = false, teamView = false }) {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const [date, setDate] = useState(searchParams.get('date') || today);
  const [month, setMonth] = useState((searchParams.get('date') || today).slice(0, 7));
  const monthView = !teamView;
  const [punches, setPunches] = useState([]);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [regularizeOpen, setRegularizeOpen] = useState(false);
  const [successOpen, setSuccessOpen] = useState(false);

  const range = useMemo(() => {
    if (!monthView) return { from: date, to: date };
    const [year, monthNum] = month.split('-').map(Number);
    const last = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
    const pad = (n) => String(n).padStart(2, '0');
    return {
      from: `${year}-${pad(monthNum)}-01`,
      to: `${year}-${pad(monthNum)}-${pad(last)}`,
    };
  }, [monthView, date, month]);

  const load = useCallback(async () => {
    try {
      const data = await api(`/punches?from=${range.from}&to=${range.to}`);
      setPunches(data.punches || []);
      setStatus(data.status || null);
      setError('');
    } catch (err) {
      setError(err.message || 'Could not load punches');
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    setLoading(true);
    load();
    const timer = setInterval(load, 4000);
    return () => clearInterval(timer);
  }, [load]);

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

  function exportExcel() {
    downloadPunchesExcel(punches, `punches-${monthView ? month : date}.xlsx`);
  }

  const orderedPunches = useMemo(
    () =>
      monthView
        ? [...punches].sort((a, b) => String(a.punchDate).localeCompare(String(b.punchDate)))
        : punches,
    [punches, monthView]
  );
  const punchedIn = useMemo(() => punches.filter((p) => p.stillIn).length, [punches]);
  const punchedOut = useMemo(() => punches.filter((p) => !p.stillIn).length, [punches]);
  const mySession = useMemo(
    () =>
      punches.find((row) => Number(row.userId) === Number(user?.id)) ||
      (!teamView ? punches[0] : null),
    [punches, user?.id, teamView]
  );

  return (
    <div className="stack">
      <div className="filters punch-toolbar">
        {monthView ? (
          <label>
            Month
            <input
              type="month"
              value={month}
              onChange={(e) => {
                setMonth(e.target.value);
                if (e.target.value) setDate(`${e.target.value}-01`);
              }}
            />
          </label>
        ) : (
          <label>
            Date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        )}
        <span className="punch-live">
          <span className="punch-live-dot" aria-hidden />
          Live
        </span>
        <button
          type="button"
          className="btn secondary"
          disabled={!punches.length}
          onClick={exportExcel}
        >
          Export Excel
        </button>
        {canSync && (
          <button type="button" className="btn" disabled={syncing} onClick={syncNow}>
            {syncing ? 'Syncing…' : 'Sync device'}
          </button>
        )}
      </div>

      {status && !status.configured && (
        <p className="form-error">Punch API password is not configured on the server.</p>
      )}
      {status?.lastError ? <p className="form-error">{status.lastError}</p> : null}
      {error && <p className="form-error">{error}</p>}

      <div className="stat-row punch-stat-row">
        <div className="stat">
          <span>Present</span>
          <strong>{punches.length}</strong>
        </div>
        <div className="stat">
          <span>Punched in</span>
          <strong>{punchedIn}</strong>
        </div>
        <div className="stat">
          <span>Punch out</span>
          <strong>{punchedOut}</strong>
        </div>
      </div>

      {loading && <p className="muted">Loading punches…</p>}
      {!loading && !punches.length && (
        <p className="empty">
          No punches for this {monthView ? 'month' : 'date'} yet for the allowlisted device IDs.
        </p>
      )}

      {!!punches.length && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {teamView && <th>Employee</th>}
                {teamView && <th>Employee ID</th>}
                <th>Date</th>
                <th>Punch in</th>
                <th>Punch out</th>
                <th>Work hours</th>
                {!teamView && <th>Device code</th>}
                {user?.role === 'user' && <th />}
              </tr>
            </thead>
            <tbody>
              {orderedPunches.map((session) => (
                <tr
                  key={`${session.punchDate}-${session.userId || session.deviceUserCode}-${session.id}`}
                >
                  {teamView && <td>{session.userName || 'Unmapped'}</td>}
                  {teamView && (
                    <td>{session.employeeNumber || session.deviceUserCode || '—'}</td>
                  )}
                  <td>{session.punchDate ? formatDate(session.punchDate) : '—'}</td>
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
                      <PunchStillInChip />
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
                  {!teamView && <td>{session.deviceUserCode}</td>}
                  {user?.role === 'user' && (
                    <td>
                      {session.canRegularize ? (
                        <button
                          type="button"
                          className="btn primary"
                          onClick={() => {
                            setRegularizeOpen(true);
                            setDate(session.punchDate || date);
                          }}
                        >
                          Regularize
                        </button>
                      ) : session.regularizePending ? (
                        <span className="muted">Pending</span>
                      ) : null}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {user?.role === 'user' && (
        <>
          <RegularizeRequestModal
            open={regularizeOpen}
            onClose={() => setRegularizeOpen(false)}
            defaultDate={date}
            currentIn={stampToTime(mySession?.punchIn)}
            currentOut={stampToTime(mySession?.punchOut)}
            onSubmitted={() => setSuccessOpen(true)}
          />
          <StatusCelebration
            show={successOpen}
            onDone={() => setSuccessOpen(false)}
            message="Regularization request sent"
            detail="HR and your manager have been notified."
            imageSrc="/assets/request-submitted.gif"
            durationMs={3200}
          />
        </>
      )}
    </div>
  );
}
