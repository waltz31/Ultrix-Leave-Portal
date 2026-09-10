export function PunchStillInChip({ compact = false }) {
  return (
    <span className={`punch-status-chip punch-status-still${compact ? ' is-compact' : ''}`} title="Still in office">
      <span className="punch-status-orb" aria-hidden>
        <span className="punch-status-orb-core" />
        <span className="punch-status-orb-ring" />
      </span>
      <span className="punch-status-label">Still in</span>
    </span>
  );
}

export function PunchInProgressChip({ compact = false }) {
  return (
    <span
      className={`punch-status-chip punch-status-progress${compact ? ' is-compact' : ''}`}
      title="Work hours in progress"
    >
      {!compact ? (
        <span className="punch-status-meter" aria-hidden>
          <span className="punch-status-meter-bar" />
        </span>
      ) : null}
      <span className="punch-status-label">
        In progress
        <span className="punch-status-dots" aria-hidden>
          <i />
          <i />
          <i />
        </span>
      </span>
    </span>
  );
}

/** Punch-out cell: actual time, or minimum logout + in-progress while still in. */
export function PunchCheckoutDisplay({ session, formatTime, expectedLogoutFromPunchIn, requiredMinutes = 540 }) {
  if (session?.punchOut) {
    return formatTime(session.punchOut);
  }
  if (!session?.stillIn) return '—';

  const expected = session?.punchIn
    ? expectedLogoutFromPunchIn(session.punchIn, requiredMinutes)
    : null;
  const label = expected ? formatTime(expected) : null;

  return (
    <span className="punch-checkout-live" title={label ? `Minimum logout ${label}` : 'Still in office'}>
      {label ? <strong className="punch-checkout-min">{label}</strong> : null}
      <PunchInProgressChip compact />
    </span>
  );
}
