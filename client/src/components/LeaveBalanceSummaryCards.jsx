export const LEAVE_BALANCE_TYPES = [
  { key: 'earned', label: 'Earned Leave', tone: 'earned' },
  { key: 'sick', label: 'Sick Leave', tone: 'sick' },
  { key: 'casual', label: 'Casual Leave', tone: 'casual' },
  { key: 'restricted', label: 'Restricted Leave', tone: 'restricted' },
  { key: 'celebration', label: 'Celebration Leave', tone: 'celebration' },
];

function fmtDays(value) {
  const n = Number(value) || 0;
  return n % 1 ? n.toFixed(1) : String(n);
}

function daysText(value) {
  const n = Number(value) || 0;
  return `${fmtDays(n)} ${n === 1 ? 'day' : 'days'}`;
}

export function computePersonalLeaveTotals(balances, leaves, userId) {
  const mine = userId
    ? (leaves || []).filter((leave) => String(leave.userId) === String(userId))
    : leaves || [];
  return LEAVE_BALANCE_TYPES.map((type) => {
    const available = Number(balances?.[type.key] ?? 0);
    const used = mine
      .filter((leave) => leave.leaveType === type.key && leave.status === 'approved')
      .reduce((sum, leave) => sum + Number(leave.days || 0), 0);
    return { ...type, available, used };
  });
}

function LeaveTypeIcon({ tone }) {
  const props = {
    viewBox: '0 0 24 24',
    width: '18',
    height: '18',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: '1.85',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  };
  if (tone === 'earned') {
    return (
      <svg {...props}>
        <rect x="3.5" y="5" width="17" height="15" rx="2.2" />
        <path d="M8 3.5v3M16 3.5v3M3.5 10h17" />
        <path d="M8.6 14.6 10.8 16.6 15.6 12.4" />
      </svg>
    );
  }
  if (tone === 'sick') {
    return (
      <svg {...props}>
        <path d="M12 3.4 20 7.2v5c0 4.6-3.2 7.8-8 9.2-4.8-1.4-8-4.6-8-9.2v-5L12 3.4Z" />
        <path d="M12 9.4v5.2M9.4 12h5.2" />
      </svg>
    );
  }
  if (tone === 'casual') {
    return (
      <svg {...props}>
        <path d="M8 4.5h8v3.2c0 2.6-1.8 4.7-4 5.3-2.2-.6-4-2.7-4-5.3V4.5Z" />
        <path d="M8 6.2H5.6A2.6 2.6 0 0 0 8.6 9.4M16 6.2h2.4A2.6 2.6 0 0 1 15.4 9.4" />
        <path d="M12 13v4.2M9.2 20.5h5.6M10.4 20.5v-3h3.2v3" />
      </svg>
    );
  }
  if (tone === 'celebration') {
    return (
      <svg {...props}>
        <path d="M4.5 10.5 12 4l7.5 6.5" />
        <path d="M6.5 10.5v8.5h11v-8.5" />
        <path d="M9.5 14.2h5" />
        <path d="M12 10.5v3.7" />
        <circle cx="7.5" cy="7.2" r="1.1" fill="currentColor" stroke="none" />
        <circle cx="16.5" cy="7.2" r="1.1" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  return (
    <svg {...props}>
      <rect x="5" y="11" width="14" height="9.5" rx="2" />
      <path d="M8.2 11V8.1a3.8 3.8 0 0 1 7.6 0V11" />
    </svg>
  );
}

function CardWave() {
  return (
    <svg className="elb-card-wave" viewBox="0 0 320 54" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0 22C42 8 74 36 118 24 162 12 198 6 236 18 268 28 296 22 320 12v42H0V22Z" />
    </svg>
  );
}

export default function LeaveBalanceSummaryCards({ items = [], className = '' }) {
  if (!items.length) return null;

  return (
    <div className={`elb-cards-scope${className ? ` ${className}` : ''}`}>
      <div className="elb-cards">
        {items.map((type) => (
          <article key={type.key} className={`elb-card tone-${type.tone}`}>
            <div className="elb-card-mark" aria-hidden="true">
              <LeaveTypeIcon tone={type.tone} />
            </div>
            <CardWave />
            <div className="elb-card-top">
              <span className="elb-card-icon">
                <LeaveTypeIcon tone={type.tone} />
              </span>
              <strong>{type.label}</strong>
            </div>
            <div className="elb-card-stats">
              <div>
                <span>Available</span>
                <b>{daysText(type.available)}</b>
              </div>
              <div>
                <span>Used</span>
                <b>{daysText(type.used)}</b>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

export { LeaveTypeIcon, fmtDays, daysText };
