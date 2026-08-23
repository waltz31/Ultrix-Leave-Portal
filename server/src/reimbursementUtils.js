export const REIMBURSEMENT_CATEGORIES = [
  'travel',
  'meal',
  'office_supplies',
  'internet',
  'other',
];

export const REIMBURSEMENT_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'reimbursed',
  'cancelled',
];

export const PAYMENT_MODES = ['self', 'company'];

export const CATEGORY_LABELS = {
  travel: 'Travel',
  meal: 'Meal',
  office_supplies: 'Office Supplies',
  internet: 'Internet',
  other: 'Other',
};

export const STATUS_LABELS = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  reimbursed: 'Reimbursed',
  cancelled: 'Cancelled',
};

const MAX_RECEIPT_CHARS = 7_000_000; // ~5MB binary as base64 data URL
const RECEIPT_MIME_RE = /^data:(image\/(?:jpeg|jpg|png)|application\/pdf);base64,/i;

export const REIMBURSEMENT_SELECT = `
  SELECT r.id, r.request_code, r.user_id, r.category, r.expense_date, r.description,
         r.amount, r.payment_mode, r.currency, r.notes,
         CASE WHEN r.receipt_data IS NOT NULL AND length(r.receipt_data) > 0 THEN 1 ELSE 0 END AS has_receipt,
         r.receipt_name, r.receipt_mime, r.status,
         r.hr_note, r.hr_id, r.hr_reviewed_at, r.reimbursed_at,
         r.created_at, r.updated_at,
         u.name AS user_name, u.employee_number, u.email AS user_email,
         hr.name AS hr_name
  FROM reimbursement_requests r
  JOIN users u ON u.id = r.user_id
  LEFT JOIN users hr ON hr.id = r.hr_id
`;

export function mapReimbursement(row, { includeReceipt = false } = {}) {
  if (!row) return null;
  const mapped = {
    id: row.id,
    requestCode: row.request_code,
    userId: row.user_id,
    userName: row.user_name,
    employeeNumber: row.employee_number || null,
    userEmail: row.user_email || null,
    category: row.category,
    categoryLabel: CATEGORY_LABELS[row.category] || row.category,
    expenseDate: row.expense_date,
    description: row.description || '',
    amount: Number(row.amount || 0),
    paymentMode: row.payment_mode,
    currency: row.currency || 'INR',
    notes: row.notes || '',
    hasReceipt: Boolean(row.has_receipt),
    receiptName: row.receipt_name || null,
    receiptMime: row.receipt_mime || null,
    status: row.status,
    statusLabel: STATUS_LABELS[row.status] || row.status,
    hrNote: row.hr_note || '',
    hrId: row.hr_id || null,
    hrName: row.hr_name || null,
    hrReviewedAt: row.hr_reviewed_at || null,
    reimbursedAt: row.reimbursed_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (includeReceipt && row.receipt_data) {
    mapped.receiptData = row.receipt_data;
  }
  return mapped;
}

export function validateReimbursementPayload(body = {}) {
  const category = String(body.category || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
  if (!REIMBURSEMENT_CATEGORIES.includes(category)) {
    return { error: 'Select a valid category' };
  }

  const expenseDate = String(body.expenseDate || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expenseDate)) {
    return { error: 'Select a valid expense date' };
  }

  const description = String(body.description || '').trim();
  if (!description) return { error: 'Description is required' };
  if (description.length > 300) return { error: 'Description must be 300 characters or fewer' };

  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: 'Enter a valid amount greater than zero' };
  }
  if (amount > 10_000_000) return { error: 'Amount is too large' };

  const paymentMode = String(body.paymentMode || 'self').trim().toLowerCase();
  if (!PAYMENT_MODES.includes(paymentMode)) {
    return { error: 'Select a valid payment mode' };
  }

  const currency = String(body.currency || 'INR').trim().toUpperCase() || 'INR';
  if (currency.length > 8) return { error: 'Invalid currency' };

  const notes = String(body.notes || '').trim();
  if (notes.length > 300) return { error: 'Notes must be 300 characters or fewer' };

  let receiptData = String(body.receiptData || '').trim() || null;
  let receiptName = String(body.receiptName || '').trim().slice(0, 180) || null;
  let receiptMime = null;
  if (!receiptData) {
    return { error: 'Upload a bill or receipt (JPG, PNG, or PDF)' };
  }
  if (receiptData.length > MAX_RECEIPT_CHARS) {
    return { error: 'Receipt file must be 5MB or smaller' };
  }
  const mimeMatch = receiptData.match(RECEIPT_MIME_RE);
  if (!mimeMatch) {
    return { error: 'Receipt must be JPG, PNG, or PDF' };
  }
  receiptMime = mimeMatch[1].toLowerCase().replace('image/jpg', 'image/jpeg');

  return {
    data: {
      category,
      expenseDate,
      description,
      amount: Math.round(amount * 100) / 100,
      paymentMode,
      currency,
      notes,
      receiptData,
      receiptName,
      receiptMime,
    },
  };
}
