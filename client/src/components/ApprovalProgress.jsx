import { STATUS_LABELS } from '../utils';

const STEPS = [
  {
    key: 'applied',
    label: 'Applied',
    icon: '/assets/icon-applied.gif',
    doneIcon: '/assets/icon-applied.gif',
  },
  {
    key: 'manager',
    label: 'Manager',
    icon: '/assets/icon-manager.png',
    doneIcon: '/assets/icon-manager-approved.gif',
    doneLabel: 'Manager approved',
  },
  {
    key: 'hr',
    label: 'HR',
    icon: '/assets/icon-hr.png',
    doneIcon: '/assets/icon-hr-approved.gif',
    doneLabel: 'HR approved',
  },
  {
    key: 'approved',
    label: 'Leave approved',
    icon: '/assets/icon-approved-seal.png',
    doneIcon: '/assets/leave-approved.gif',
  },
];

function resolveState(leave, key) {
  const { status, hrReviewedAt, managerReviewedAt } = leave;
  const rejectedAt =
    status === 'rejected'
      ? hrReviewedAt
        ? 'hr'
        : managerReviewedAt
          ? 'manager'
          : 'manager'
      : null;

  if (status === 'cancelled') {
    if (key === 'applied') return 'done';
    if (key === 'approved') return 'cancelled';
    return 'idle';
  }

  if (status === 'rejected') {
    if (key === 'applied') return 'done';
    if (key === rejectedAt) return 'rejected';
    if (rejectedAt === 'hr' && key === 'manager') return 'done';
    return 'idle';
  }

  if (status === 'pending_manager') {
    if (key === 'applied') return 'done';
    if (key === 'manager') return 'current';
    return 'idle';
  }

  if (status === 'pending_hr') {
    if (key === 'applied' || key === 'manager') return 'done';
    if (key === 'hr') return 'current';
    return 'idle';
  }

  if (status === 'approved') {
    return 'done';
  }

  return 'idle';
}

function connectorState(leave, fromKey) {
  const order = ['applied', 'manager', 'hr', 'approved'];
  const i = order.indexOf(fromKey);
  const next = order[i + 1];
  if (!next) return 'idle';
  const from = resolveState(leave, fromKey);
  const to = resolveState(leave, next);
  if (from === 'done' && (to === 'done' || to === 'current' || to === 'rejected')) {
    return to === 'rejected' ? 'rejected' : 'filled';
  }
  if (from === 'done' && to === 'idle') return 'idle';
  if (from === 'current') return 'idle';
  return 'idle';
}

function stepSrc(step, state) {
  if (step.doneIcon && (state === 'done' || (step.key === 'applied' && state !== 'idle'))) {
    return step.doneIcon;
  }
  return step.icon;
}

export default function ApprovalProgress({ leave, compact = false }) {
  return (
    <div className={`progress${compact ? ' compact' : ''}`}>
      <div className="progress-track" role="list" aria-label="Approval progress">
        {STEPS.map((step, index) => {
          const state = resolveState(leave, step.key);
          const isLast = index === STEPS.length - 1;
          const src = stepSrc(step, state);
          const isGif = String(src).endsWith('.gif');
          const useSeal =
            isGif ||
            step.key === 'approved' ||
            (state === 'done' && (step.key === 'manager' || step.key === 'hr'));
          return (
            <div key={step.key} className="progress-item" role="listitem">
              <div className={`progress-step ${state}${useSeal ? ' seal' : ''}`}>
                <span className="dot" aria-hidden="true">
                  <img
                    key={`${leave.id}-${step.key}-${state}-${src}`}
                    src={src}
                    alt=""
                    className={`step-icon${
                      step.key === 'hr' && !String(src).endsWith('.gif') ? ' dark-bg' : ''
                    }${isGif ? ' approved-gif' : ''}`}
                  />
                </span>
                <span className="label">
                  {state === 'done' && step.doneLabel ? step.doneLabel : step.label}
                </span>
              </div>
              {!isLast && (
                <div
                  className={`progress-connector ${connectorState(leave, step.key)}`}
                  aria-hidden="true"
                />
              )}
            </div>
          );
        })}
      </div>
      <div className="progress-meta">
        <span className={`badge status-${leave.status}`}>
          {leave.status === 'approved'
            ? 'Leave approved'
            : STATUS_LABELS[leave.status] || leave.status}
        </span>
        {leave.managerNote && (
          <span className="note">Manager: {leave.managerNote}</span>
        )}
        {leave.hrNote && <span className="note">HR: {leave.hrNote}</span>}
      </div>
    </div>
  );
}
