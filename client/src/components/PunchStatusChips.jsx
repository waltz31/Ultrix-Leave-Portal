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

export function PunchInProgressChip() {
  return (
    <span className="punch-status-chip punch-status-progress" title="Work hours in progress">
      <span className="punch-status-meter" aria-hidden>
        <span className="punch-status-meter-bar" />
      </span>
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
