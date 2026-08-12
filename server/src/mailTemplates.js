/** Shared leave detail helpers for email templates. */

export function leaveTypeLabel(type) {
  if (type === 'wfh') return 'WFH';
  return `${type.charAt(0).toUpperCase() + type.slice(1)} leave`;
}

export function sessionLabel(session) {
  if (session === 'morning') return 'Morning';
  if (session === 'afternoon') return 'Afternoon';
  return 'Full day';
}

export function dateRange(startDate, endDate) {
  if (!startDate) return '—';
  return startDate === endDate ? startDate : `${startDate} → ${endDate}`;
}

export function leaveDetailRows({ leaveType, startDate, endDate, days, session, reason, note, managerName, employeeName }) {
  const rows = [
    { label: 'Employee', value: employeeName },
    { label: 'Type', value: leaveTypeLabel(leaveType) },
    { label: 'Session', value: sessionLabel(session) },
    { label: 'Dates', value: dateRange(startDate, endDate) },
    { label: 'Days', value: String(days ?? '—') },
  ].filter((r) => r.value && r.value !== 'undefined');

  if (managerName) rows.unshift({ label: 'Manager', value: managerName });
  if (reason) rows.push({ label: 'Reason', value: reason });
  if (note) rows.push({ label: 'Note', value: note });
  return rows;
}

/**
 * Template catalog — each returns subject, heading, intro, status, nextStep, rows, cta.
 * `ctaPath` is appended to APP_PUBLIC_URL / CLIENT_ORIGIN.
 */
export const MAIL_TEMPLATES = {
  /** Employee: confirmation after submitting leave/WFH. */
  leaveAppliedEmployee: (ctx) => ({
    subject: `[Leave] Request submitted — ${leaveTypeLabel(ctx.leaveType)}`,
    heading: 'Leave request submitted',
    status: 'Submitted',
    statusTone: 'pending',
    intro: `Hi ${ctx.recipientName || ctx.employeeName}, your ${leaveTypeLabel(ctx.leaveType)} request has been submitted successfully.`,
    nextStep:
      'Your manager will review it first. After manager approval, HR will give the final approval. You will receive email updates at each step.',
    rows: leaveDetailRows(ctx),
    ctaLabel: 'View my requests',
    ctaPath: '/app/history',
  }),

  /** Manager: new request from team member. */
  leaveAppliedManager: (ctx) => ({
    subject: `[Leave] Action required — ${ctx.employeeName} applied for leave`,
    heading: 'New leave request',
    status: 'Awaiting your approval',
    statusTone: 'action',
    intro: `Hi ${ctx.recipientName || 'Manager'}, ${ctx.employeeName} has applied for ${leaveTypeLabel(ctx.leaveType)}. Please review and approve or reject.`,
    nextStep: 'Log in to the manager portal to review this request. HR will approve after you.',
    rows: leaveDetailRows(ctx),
    ctaLabel: 'Review request',
    ctaPath: '/manager/approvals',
  }),

  /** Employee: manager approved, waiting for HR. */
  managerApprovedEmployee: (ctx) => ({
    subject: `[Leave] Manager approved — pending HR`,
    heading: 'Manager approved your request',
    status: 'Pending HR approval',
    statusTone: 'pending',
    intro: `Hi ${ctx.recipientName || ctx.employeeName}, your manager has approved your ${leaveTypeLabel(ctx.leaveType)} request. It is now with HR for final approval.`,
    nextStep: 'You will receive another email once HR completes the review.',
    rows: leaveDetailRows(ctx),
    ctaLabel: 'Track status',
    ctaPath: '/app/history',
  }),

  /** HR: manager approved — HR must approve. */
  managerApprovedHr: (ctx) => ({
    subject: `[Leave] Manager approved — your approval needed (${ctx.employeeName})`,
    heading: 'Manager approved — HR action required',
    status: 'Awaiting HR approval',
    statusTone: 'action',
    intro: `Hi ${ctx.recipientName || 'HR'}, ${ctx.employeeName}'s ${leaveTypeLabel(ctx.leaveType)} request was approved by the manager. Final HR approval is required.`,
    nextStep: 'Please log in to the HR portal to approve or reject this request. Leave balance will be deducted on final approval (not for WFH).',
    rows: leaveDetailRows(ctx),
    ctaLabel: 'Review in HR portal',
    ctaPath: '/hr/approvals',
  }),

  /** Employee: fully approved by HR. */
  hrApprovedEmployee: (ctx) => ({
    subject: `[Leave] Approved — ${leaveTypeLabel(ctx.leaveType)}`,
    heading: 'Leave fully approved',
    status: 'Approved',
    statusTone: 'success',
    intro: `Hi ${ctx.recipientName || ctx.employeeName}, your ${leaveTypeLabel(ctx.leaveType)} request has been fully approved by HR.`,
    nextStep: 'Your leave is confirmed. You can view it on your calendar anytime.',
    rows: leaveDetailRows(ctx),
    ctaLabel: 'Open my calendar',
    ctaPath: '/app/calendar',
  }),

  /** Manager: HR fully approved team member's leave. */
  hrApprovedManager: (ctx) => ({
    subject: `[Leave] Approved — ${ctx.employeeName}`,
    heading: 'Team leave approved',
    status: 'Approved',
    statusTone: 'success',
    intro: `Hi ${ctx.recipientName || 'Manager'}, HR has fully approved ${ctx.employeeName}'s ${leaveTypeLabel(ctx.leaveType)} request.`,
    nextStep: 'The request is now active on the team calendar.',
    rows: leaveDetailRows(ctx),
    ctaLabel: 'View team calendar',
    ctaPath: '/manager/calendar',
  }),

  /** Employee: rejected by manager or HR. */
  rejectedEmployee: (ctx) => ({
    subject: `[Leave] Request rejected by ${ctx.byRole === 'hr' ? 'HR' : 'manager'}`,
    heading: 'Leave request rejected',
    status: 'Rejected',
    statusTone: 'danger',
    intro: `Hi ${ctx.recipientName || ctx.employeeName}, your ${leaveTypeLabel(ctx.leaveType)} request was rejected by ${ctx.byRole === 'hr' ? 'HR' : 'your manager'}.`,
    nextStep: ctx.note ? 'See the note below for details.' : 'Contact your manager or HR if you have questions.',
    rows: leaveDetailRows(ctx),
    ctaLabel: 'View history',
    ctaPath: '/app/history',
  }),

  /** Manager: HR rejected a team request. */
  rejectedManager: (ctx) => ({
    subject: `[Leave] HR rejected — ${ctx.employeeName}`,
    heading: 'HR rejected a team request',
    status: 'Rejected',
    statusTone: 'danger',
    intro: `Hi ${ctx.recipientName || 'Manager'}, HR rejected ${ctx.employeeName}'s ${leaveTypeLabel(ctx.leaveType)} request.`,
    nextStep: ctx.note ? 'See the note below for details.' : 'The employee has been notified.',
    rows: leaveDetailRows(ctx),
    ctaLabel: 'View history',
    ctaPath: '/manager/history',
  }),

  /** Manager / HR: employee cancelled leave. */
  cancelledNotify: (ctx) => ({
    subject: ctx.partial
      ? `[Leave] Day cancelled — ${ctx.employeeName}`
      : `[Leave] Request cancelled — ${ctx.employeeName}`,
    heading: ctx.partial ? 'Leave day cancelled' : 'Leave request cancelled',
    status: 'Cancelled',
    statusTone: 'muted',
    intro: ctx.message || `${ctx.employeeName} cancelled a ${leaveTypeLabel(ctx.leaveType)} request.`,
    nextStep: 'No action is required unless you need to follow up with the employee.',
    rows: leaveDetailRows({
      ...ctx,
      startDate: ctx.partial ? ctx.cancelDate : ctx.startDate,
      endDate: ctx.partial ? ctx.cancelDate : ctx.endDate,
    }),
    ctaLabel: 'Open portal',
    ctaPath: ctx.audience === 'hr' ? '/hr/calendar' : '/manager/calendar',
  }),

  /** Employee: cancellation confirmation. */
  cancelledEmployee: (ctx) => ({
    subject: ctx.partial ? '[Leave] Your leave day was cancelled' : '[Leave] Your request was cancelled',
    heading: ctx.partial ? 'Leave day cancelled' : 'Your leave was cancelled',
    status: 'Cancelled',
    statusTone: 'muted',
    intro:
      ctx.employeeMessage ||
      (ctx.partial
        ? `You cancelled ${leaveTypeLabel(ctx.leaveType)} for ${ctx.cancelDate}.`
        : `Your ${leaveTypeLabel(ctx.leaveType)} request was cancelled.`),
    nextStep: 'Remaining active days (if any) stay on your calendar.',
    rows: leaveDetailRows({
      ...ctx,
      startDate: ctx.partial ? ctx.cancelDate : ctx.startDate,
      endDate: ctx.partial ? ctx.cancelDate : ctx.endDate,
    }),
    ctaLabel: 'View my calendar',
    ctaPath: '/app/calendar',
  }),
};

export function renderTemplate(templateKey, ctx) {
  const fn = MAIL_TEMPLATES[templateKey];
  if (!fn) throw new Error(`Unknown mail template: ${templateKey}`);
  return fn(ctx);
}
