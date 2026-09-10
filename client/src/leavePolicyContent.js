/** Ultrix leave policy copy sourced from STAN HRMS Leave Policy Spec v1.0 */

export const LEAVE_POLICY_VERSION = '1.0';

export const POLICY_TABS = [
  { id: 'overview', label: 'Policy Overview' },
  { id: 'types', label: 'Leave Types' },
  { id: 'rules', label: 'Rules & Guidelines' },
  { id: 'holidays', label: 'Holiday List' },
  { id: 'approvals', label: 'Approvals' },
  { id: 'faqs', label: 'FAQs' },
];

export const KEY_DEFINITIONS = [
  {
    term: 'Date of Joining (DOJ)',
    definition: "The employee's first working day. All accrual clocks start here.",
  },
  {
    term: 'Probation Period',
    definition:
      'Default 6 months from DOJ. Configurable per employee; may be extended by management.',
  },
  {
    term: 'Confirmation Date',
    definition:
      "The date the employee's status changes from Probation to Confirmed. Unlocks Earned Leave.",
  },
  {
    term: 'Leave Year',
    definition:
      'The 12-month cycle used for entitlement, carry-forward and lapse (calendar vs financial year to be confirmed by HR).',
  },
  {
    term: 'LOP / LWP',
    definition:
      'Loss of Pay / Leave Without Pay. Any absence not covered by an approved, sufficient leave balance.',
  },
  {
    term: 'Completed Month',
    definition:
      'A full month of service measured from DOJ (e.g. DOJ 12 Mar → months complete on the 11th of each following month).',
  },
];

export const LEAVE_TYPES_TABLE = [
  {
    type: 'Earned Leave',
    code: 'EL',
    entitlement: '18 days / year',
    accrual: '1.5 days per completed month',
    accruesFrom: 'Date of Joining',
    yearEnd: 'Carries forward (capped)',
  },
  {
    type: 'Sick Leave',
    code: 'SL',
    entitlement: '12 days / year',
    accrual: '1 day per completed month',
    accruesFrom: 'Date of Joining',
    yearEnd: 'Lapses',
  },
  {
    type: 'Casual Leave',
    code: 'CL',
    entitlement: '4 days / year',
    accrual: '1 day per quarter',
    accruesFrom: 'Date of Joining',
    yearEnd: 'Lapses',
  },
  {
    type: 'Celebration Leave',
    code: 'CEL',
    entitlement: '1 day / year',
    accrual: 'Granted upfront, once per leave year',
    accruesFrom: 'Date of Joining',
    yearEnd: 'Lapses',
  },
  {
    type: 'Marriage Leave',
    code: 'ML',
    entitlement: '10 days (one-time)',
    accrual: 'Not accrued — granted on request',
    accruesFrom: 'On approval',
    yearEnd: 'Not applicable',
  },
  {
    type: 'Loss of Pay',
    code: 'LOP',
    entitlement: 'No limit',
    accrual: 'Not accrued — employee-initiated',
    accruesFrom: 'Date of Joining',
    yearEnd: 'Not applicable',
  },
];

export const ACCRUAL_RULES = [
  {
    title: 'Earned Leave (EL) — 1.5 days per month',
    points: [
      'EL accrues at 1.5 days for every completed month of service, counted from the Date of Joining.',
      'During the first 6 completed months the balance stays locked and shows as 0 — it cannot be applied for or approved.',
      'In the 7th month (after completing 6 months), the full 7-month balance is released in one credit (7 × 1.5 = 10.5 days).',
      'From the month following unlock, 1.5 days continues to credit automatically each month and is immediately available.',
      'If probation is extended, accrual continues during the extension and the accrued balance is released on the actual unlock date.',
      'If an employee exits before unlock, the locked EL balance is forfeited (subject to HR confirmation).',
    ],
  },
  {
    title: 'Sick Leave (SL) — 1 day per month',
    points: [
      'SL accrues at 1 day per completed month from the Date of Joining.',
      'SL is available from day one — there is no probation lock.',
      'Maximum 12 days in a leave year.',
      'Medical certificate requirement is configurable by HR.',
    ],
  },
  {
    title: 'Casual Leave (CL) — 1 day per quarter',
    points: [
      'CL accrues at 1 day per quarter from the Date of Joining (4 days across a full leave year).',
      'The credit happens at the start of each quarter and accumulates within the leave year.',
      'CL is available from day one — no probation lock.',
      'Any balance remaining at the end of the leave year lapses.',
    ],
  },
  {
    title: 'Celebration Leave (CEL) — 1 day per year',
    points: [
      'One day per leave year, granted upfront and available from the Date of Joining.',
      "It may be taken for the employee's own birthday or wedding anniversary — the employee selects the occasion when applying.",
      'It can be used only once in a leave year and does not carry forward.',
    ],
  },
  {
    title: 'Marriage Leave (ML) — 10 days',
    points: [
      "Up to 10 days for the employee's own marriage.",
      'Not accrued — granted on application and requires explicit manager approval.',
      'One-time benefit per employee for the duration of their employment.',
    ],
  },
  {
    title: 'Loss of Pay (LOP)',
    points: [
      'LOP is a selectable leave type — an employee may deliberately apply for LOP even when other balances exist.',
      'LOP still requires manager approval; approval records the absence as authorised but unpaid.',
      'Any approved leave that exceeds the available balance is automatically split: available balance first, excess converted to LOP.',
      'Any absence with no approved leave request against it is marked LOP by the system and flagged to the manager and HR.',
      "LOP days feed into the payroll deduction file for that month's payroll cycle.",
    ],
  },
];

export const BALANCE_RULES = [
  'Earned Leave carries forward into the next leave year, subject to a configurable cap (default: 30 days). Anything above the cap lapses at year end.',
  'Sick Leave, Casual Leave and Celebration Leave do not carry forward — balances reset to zero at the start of each leave year.',
  'Negative balances are not permitted. Where a balance is insufficient, the shortfall becomes LOP.',
  'Half-day leave is supported for SL, CL and EL. Celebration and Marriage leave are full-day only.',
  'A monthly accrual job runs on a fixed date and writes an auditable ledger entry for every credit, debit, lapse and carry-forward.',
  'Employees can see a running balance and a full transaction history for each leave type.',
];

export const HOLIDAY_CATEGORIES = [
  {
    category: 'National Holidays',
    behaviour: 'Mandatory, non-working for all employees',
    notes: 'Applies organisation-wide regardless of location',
  },
  {
    category: 'Regional Holidays',
    behaviour: 'Non-working for the applicable location only',
    notes: "Mapped to the employee's work location / branch",
  },
  {
    category: 'Restricted Holidays',
    behaviour: 'Optional — employee elects which ones to avail',
    notes: 'Employee applies; count per year is configured by HR',
  },
];

export const HOLIDAY_RULES = [
  'The annual holiday list is uploaded by HR and drives the working-day calculation for every leave request.',
  'Holidays and weekly offs falling within a leave period must not be deducted from the leave balance.',
  'HR can upload the holiday list in bulk (CSV / Excel) and edit it mid-year.',
  "Restricted holidays appear in the employee's leave application dropdown as a distinct type.",
];

export const APPROVAL_STATUSES = [
  {
    status: 'Draft',
    meaning: 'Employee has started but not submitted',
    actions: 'Employee: submit or discard',
  },
  {
    status: 'Pending Approval',
    meaning: 'Submitted, awaiting reporting manager',
    actions: 'Manager: approve / reject / request info. Employee: withdraw',
  },
  {
    status: 'Approved',
    meaning: 'Manager has approved; balance deducted',
    actions: 'Employee: request cancellation. Manager: revoke',
  },
  {
    status: 'Rejected',
    meaning: 'Manager declined; balance restored',
    actions: 'Employee: re-apply with revised dates',
  },
  {
    status: 'Cancelled',
    meaning: 'Withdrawn before or after approval; balance restored',
    actions: 'None',
  },
  {
    status: 'Auto-LOP',
    meaning: 'Absence recorded with no approved request',
    actions: 'HR: regularise or confirm as LOP',
  },
];

export const APPROVAL_RULES = [
  'Every leave type follows the same approval chain. The system never auto-approves a request.',
  'Flow: Employee submits → Reporting Manager reviews → Approved / Rejected / Info requested.',
  'Notifications go to the employee and manager on every status change (email + in-app).',
  'A request pending beyond a configurable number of days escalates to the next-level manager or HR.',
  'A delegate / alternate approver can be configured so requests are not blocked during manager absence.',
  'The full approval trail — who approved, when, and any comments — is stored and visible in leave history.',
];

export const POLICY_FAQS = [
  {
    q: 'Can I take leave without manager approval?',
    a: "No. No leave can be availed without the reporting manager's approval. An absence without an approved leave request is recorded as Loss of Pay (LOP).",
  },
  {
    q: 'When does Earned Leave become available?',
    a: 'EL accrues from your Date of Joining but stays locked through probation. On confirmation it is released as a single credit of the accrued balance.',
  },
  {
    q: 'Do Sick / Casual / Celebration leave carry forward?',
    a: 'No. Those balances lapse at the end of the leave year. Only Earned Leave carries forward, subject to the carry-forward cap.',
  },
  {
    q: 'What happens if I apply for more days than my balance?',
    a: 'Available balance is deducted first and the excess days are converted to LOP.',
  },
  {
    q: 'Is half-day leave allowed?',
    a: 'Yes for Earned, Sick and Casual leave. Celebration and Marriage leave are full-day only.',
  },
  {
    q: 'Who do I contact for clarifications?',
    a: 'For clarifications on any rule in this policy, contact the Ultrix / STAN HR team.',
  },
];

export const PURPOSE_TEXT =
  'This document defines the leave types, accrual logic, eligibility conditions and approval workflow for the Leave Management module. Every rule maps to a configurable value in the system.';

export const CONFIG_PARAMETERS = [
  { parameter: 'EL accrual rate', defaultValue: '1.5 days / month', notes: 'Per completed month from DOJ' },
  { parameter: 'Probation duration', defaultValue: '6 months', notes: 'Overridable per employee' },
  { parameter: 'EL locked during probation', defaultValue: 'Yes', notes: 'Released in full on confirmation' },
  { parameter: 'SL accrual rate', defaultValue: '1 day / month', notes: 'Available from DOJ' },
  { parameter: 'CL accrual rate', defaultValue: '1 day / quarter', notes: 'Cumulative within the leave year' },
  { parameter: 'Celebration leave', defaultValue: '1 day / year', notes: 'Birthday or wedding anniversary' },
  { parameter: 'Marriage leave', defaultValue: '10 days', notes: 'One-time, on approval' },
  { parameter: 'EL carry-forward cap', defaultValue: '30 days', notes: 'Excess lapses at year end' },
  { parameter: 'Half-day leave', defaultValue: 'Enabled for EL, SL, CL', notes: 'Disabled for CEL and ML' },
  { parameter: 'Approval escalation', defaultValue: '3 days', notes: 'Escalates to next-level approver' },
  { parameter: 'Restricted holidays per year', defaultValue: 'To be confirmed', notes: 'See Open Decisions' },
  { parameter: 'Leave year start', defaultValue: 'To be confirmed', notes: 'Calendar vs financial year' },
];

export const OPEN_DECISIONS = [
  'Leave year definition — calendar year (Jan–Dec) or financial year (Apr–Mar)?',
  'Mid-month joiners — full 1.5 EL credit, pro-rata, or none for that month?',
  'Casual leave quarters — calendar quarters or counted from the individual’s DOJ?',
  'Exit settlement — is unused Earned Leave encashed, and is locked EL forfeited during probation?',
  'Sick leave documentation — medical certificate required beyond how many consecutive days?',
  'Sandwich rule — if leave is taken Fri and Mon, is the weekend counted as leave? (Recommendation: no.)',
  'Notice period — can leave be availed during notice, and does it extend LWD?',
  'Backdated applications — how far back can an employee apply, and who can regularise Auto-LOP?',
  'Number of restricted holidays an employee may avail per year.',
  'Marriage leave — minimum advance notice, and whether proof of marriage is required.',
];
