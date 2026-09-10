import { Link } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { usePollWhenVisible } from '../usePollWhenVisible';
import { PunchCheckoutDisplay } from './PunchStatusChips';
import {
  REQUIRED_WORK_MINUTES,
  appToday,
  avatarSrc,
  expectedLogoutFromPunchIn,
  formatTime,
  parseAppDateTime,
  punchInLateness,
  toYmd,
} from '../utils';

const AVATAR_TONES = 6;
const ON_TIME_CUTOFF_MINUTES = 11 * 60 + 30;
const NOTE_STORAGE_KEY = 'ultrix.officePunches.noteDismissed';

function personInitials(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function avatarTone(seed) {
  const s = String(seed || '');
  let hash = 0;
  for (let i = 0; i < s.length; i += 1) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return hash % AVATAR_TONES;
}

function minutesOfDayIst(value) {
  const parsed = parseAppDateTime(value);
  if (!parsed) {
    const match = String(value || '').match(/(\d{1,2}):(\d{2})/);
    if (!match) return null;
    return Number(match[1]) * 60 + Number(match[2]);
  }
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(parsed);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
  return hour * 60 + minute;
}

function formatLateByLabel(punchIn) {
  const lateness = punchInLateness(punchIn);
  if (lateness !== 'late' && lateness !== 'very-late') return null;
  const minutes = minutesOfDayIst(punchIn);
  if (minutes == null) return 'Late';
  const lateMins = Math.max(0, minutes - ON_TIME_CUTOFF_MINUTES);
  if (lateMins <= 0) return 'Late';
  if (lateMins < 60) return `Late by ${lateMins}m`;
  const h = Math.floor(lateMins / 60);
  const m = lateMins % 60;
  return m ? `Late by ${h}h ${m}m` : `Late by ${h}h`;
}

function formatCompactDuration(totalMinutes) {
  const mins = Math.max(0, Math.round(Number(totalMinutes) || 0));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h <= 0) return `${m}m`;
  if (m <= 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function minutesSince(value, nowMs = Date.now()) {
  const d = parseAppDateTime(value);
  if (!d) return null;
  return Math.max(0, Math.round((nowMs - d.getTime()) / 60_000));
}

function formatWeekdayLong(ymd) {
  const [y, m, d] = String(ymd || '')
    .split('-')
    .map(Number);
  if (!y || !m || !d) return '';
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function formatDateChipLabel(ymd, todayYmd) {
  const [y, m, d] = String(ymd || '')
    .split('-')
    .map(Number);
  if (!y || !m || !d) return 'Select date';
  const date = new Date(y, m - 1, d);
  const short = date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  return ymd === todayYmd ? `Today, ${short}` : short;
}

function TitleClockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <circle cx="12" cy="12" r="8.25" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 8.2v4.2l2.9 1.7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="15" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 3.5v3M16 3.5v3M3.5 10h17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function PunchInIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        d="M10 12h9M15.5 8.5 19 12l-3.5 3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M13 5.5H7.5A2.5 2.5 0 0 0 5 8v8a2.5 2.5 0 0 0 2.5 2.5H13"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PunchOutIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        d="M14 12H5M9.5 8.5 6 12l3.5 3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M11 5.5h5.5A2.5 2.5 0 0 1 19 8v8a2.5 2.5 0 0 1-2.5 2.5H11"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function HoursIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 8v4l2.8 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
      <path
        d="M5 12.5 9.5 17 19 7.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StatusClockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
      <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 8v4l2.6 1.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <circle cx="12" cy="5" r="1.6" fill="currentColor" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
      <circle cx="12" cy="19" r="1.6" fill="currentColor" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 10.5v5.2M12 7.8h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function ProgressTrack({ percent = 0, dotted = false }) {
  const pct = Math.max(0, Math.min(100, Number(percent) || 0));
  return (
    <div className={`op-progress${dotted ? ' is-dotted' : ''}`} aria-hidden="true">
      <span className="op-progress-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

function OfficePunchRow({ session, nowMs, musterTo }) {
  const name = session.userName || `ID ${session.deviceUserCode || '—'}`;
  const role = session.designation || 'Employee';
  const empId = session.employeeNumber || session.deviceUserCode;
  const photo = session.profilePhoto ? avatarSrc(session.profilePhoto) : null;
  const tone = avatarTone(session.userId || session.deviceUserCode || name);
  const stillIn = Boolean(session.stillIn);
  const checkedOut = Boolean(session.punchOut);
  const lateBy = session.punchIn ? formatLateByLabel(session.punchIn) : null;
  const onTime = Boolean(session.punchIn && !lateBy);
  const elapsedIn = session.punchIn ? minutesSince(session.punchIn, nowMs) : null;
  const leftAgo = session.punchOut ? minutesSince(session.punchOut, nowMs) : null;
  const progressPct = stillIn
    ? elapsedIn != null
      ? Math.min(100, Math.round((elapsedIn / REQUIRED_WORK_MINUTES) * 100))
      : 8
    : checkedOut
      ? 100
      : 0;

  const totalLabel = session.workHours
    ? session.workHours
    : stillIn
      ? 'In progress'
      : '—';

  return (
    <li className={`op-card${stillIn ? ' is-live' : checkedOut ? ' is-done' : ''}`}>
      <div className="op-who">
        {photo ? (
          <img className="op-avatar is-photo" src={photo} alt="" />
        ) : (
          <span className={`op-avatar tone-${tone}`}>{personInitials(name)}</span>
        )}
        <div className="op-identity">
          <strong className="op-name">{name}</strong>
          <span className="op-meta">
            <span>{role}</span>
            {empId ? <span className="op-emp-id">#{empId}</span> : null}
          </span>
        </div>
      </div>

      <div className="op-col is-in">
        <span className="op-ico is-in" aria-hidden="true">
          <PunchInIcon />
        </span>
        <div className="op-col-body">
          <span className="op-kicker">IN</span>
          <strong className="op-value">{session.punchIn ? formatTime(session.punchIn) : '—'}</strong>
          {onTime ? <span className="op-tag is-ok">On time</span> : null}
          {lateBy ? <span className="op-tag is-late">{lateBy}</span> : null}
        </div>
      </div>

      <div className="op-col is-out">
        <span
          className={`op-ico is-out${stillIn && !session.punchOut ? ' is-muted' : ''}`}
          aria-hidden="true"
        >
          <PunchOutIcon />
        </span>
        <div className="op-col-body">
          <span className="op-kicker">OUT</span>
          {session.punchOut || stillIn ? (
            <div className="op-out-live">
              <PunchCheckoutDisplay
                session={session}
                formatTime={formatTime}
                expectedLogoutFromPunchIn={expectedLogoutFromPunchIn}
                requiredMinutes={REQUIRED_WORK_MINUTES}
              />
            </div>
          ) : (
            <strong className="op-value">—</strong>
          )}
        </div>
      </div>

      <div className="op-col is-hours">
        <span className="op-ico is-hours" aria-hidden="true">
          <HoursIcon />
        </span>
        <div className="op-col-body">
          <span className="op-kicker">Total Hours</span>
          <strong className={`op-value${stillIn && !session.workHours ? ' is-live' : ''}`}>{totalLabel}</strong>
        </div>
      </div>

      <div className="op-state">
        {checkedOut ? (
          <>
            <span className="op-state-pill is-done">
              <CheckIcon /> Checked Out
            </span>
            <ProgressTrack percent={100} />
            {leftAgo != null ? <span className="op-state-sub">Left {formatCompactDuration(leftAgo)} ago</span> : null}
          </>
        ) : stillIn ? (
          <>
            <span className="op-state-pill is-live">
              <StatusClockIcon /> In Progress
            </span>
            <ProgressTrack percent={progressPct} dotted />
            {elapsedIn != null ? (
              <span className="op-state-sub">Checked in {formatCompactDuration(elapsedIn)} ago</span>
            ) : null}
          </>
        ) : (
          <span className="op-state-pill is-muted">Not checked in</span>
        )}
      </div>

      {musterTo ? (
        <Link className="op-menu" to={musterTo} aria-label={`Open punches for ${name}`} title="View punches">
          <MoreIcon />
        </Link>
      ) : (
        <span className="op-menu is-disabled" aria-hidden="true">
          <MoreIcon />
        </span>
      )}
    </li>
  );
}

export default function OfficePunchesPanel({
  attendanceTo = null,
  title = 'Office Punches',
  limit = 8,
}) {
  const todayYmd = toYmd(appToday());
  const [date, setDate] = useState(todayYmd);
  const [punches, setPunches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [nowMs, setNowMs] = useState(Date.now());
  const [noteOpen, setNoteOpen] = useState(() => {
    try {
      return localStorage.getItem(NOTE_STORAGE_KEY) !== '1';
    } catch {
      return true;
    }
  });

  const load = useCallback(async () => {
    try {
      const data = await api(`/punches?from=${date}&to=${date}`);
      setPunches(data.punches || []);
    } catch {
      setPunches([]);
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    setLoading(true);
  }, [date]);

  usePollWhenVisible(load, date === todayYmd ? 60_000 : 120_000, [load, date, todayYmd]);

  useEffect(() => {
    if (date !== todayYmd) return undefined;
    const id = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, [date, todayYmd]);

  const dateInputRef = useRef(null);
  const visible = useMemo(() => punches.slice(0, limit), [punches, limit]);
  const dateLabel = formatDateChipLabel(date, todayYmd);
  const weekdayLabel = formatWeekdayLong(date);

  function dismissNote() {
    setNoteOpen(false);
    try {
      localStorage.setItem(NOTE_STORAGE_KEY, '1');
    } catch {
      /* ignore */
    }
  }

  function openDatePicker() {
    const input = dateInputRef.current;
    if (!input) return;
    try {
      if (typeof input.showPicker === 'function') {
        input.showPicker();
        return;
      }
    } catch {
      /* fall through */
    }
    input.focus();
    input.click();
  }

  return (
    <section className="op-panel">
      <header className="op-head">
        <div className="op-title">
          <span className="op-title-ico" aria-hidden="true">
            <TitleClockIcon />
          </span>
          <div>
            <h2>{title}</h2>
            <p>
              Live check-ins for {date === todayYmd ? 'today' : 'selected day'}
              {weekdayLabel ? ` • ${weekdayLabel}` : ''}
            </p>
          </div>
        </div>
        <div className="op-actions">
          <button type="button" className="op-date" onClick={openDatePicker}>
            <CalendarIcon />
            <span>{dateLabel}</span>
            <input
              ref={dateInputRef}
              type="date"
              className="op-date-input"
              value={date}
              max={todayYmd}
              onChange={(e) => {
                const next = e.target.value || todayYmd;
                setDate(next);
              }}
              onClick={(e) => e.stopPropagation()}
              aria-label="Punch date"
            />
          </button>
          {attendanceTo ? (
            <Link className="op-cta" to={attendanceTo}>
              View All Punches
              <span aria-hidden="true">→</span>
            </Link>
          ) : null}
        </div>
      </header>

      {loading ? (
        <p className="op-empty">Loading punches…</p>
      ) : !visible.length ? (
        <p className="op-empty">No device punches for this day.</p>
      ) : (
        <ul className="op-list">
          {visible.map((session) => (
            <OfficePunchRow
              key={`${session.userId || session.deviceUserCode}-${session.id}`}
              session={session}
              nowMs={nowMs}
              musterTo={attendanceTo}
            />
          ))}
        </ul>
      )}

      {noteOpen ? (
        <aside className="op-note" role="note">
          <span className="op-note-ico" aria-hidden="true">
            <InfoIcon />
          </span>
          <p>
            <strong>Note:</strong> Punch data is updated in real-time. Total hours are calculated based on
            completed punches.
          </p>
          <button type="button" className="op-note-x" onClick={dismissNote} aria-label="Dismiss note">
            ×
          </button>
        </aside>
      ) : null}
    </section>
  );
}
