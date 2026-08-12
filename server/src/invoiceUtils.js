export const INVOICE_SELECT = `
  SELECT i.*,
         u.name AS user_name,
         u.email AS user_email,
         u.employee_number
  FROM invoices i
  JOIN users u ON u.id = i.user_id
`;

/** Invoices are removed on the 1st, two calendar months after the billing period month. */
export function invoiceDeletionDate(billingPeriod) {
  const match = String(billingPeriod || '').match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!year || month < 1 || month > 12) return null;
  const d = new Date(Date.UTC(year, month - 1 + 2, 1));
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function isInvoiceExpired(billingPeriod, todayIso) {
  const deletesOn = invoiceDeletionDate(billingPeriod);
  if (!deletesOn || !todayIso) return false;
  return todayIso >= deletesOn;
}

export const INVOICE_RETENTION_NOTICE =
  'Submitted invoices are automatically deleted on the 1st of the month, two months after the billing period (for example, August invoices are removed on 1 October). Download a PDF copy before then. You can remove an invoice from your list — HR will keep a copy until they delete it or the retention date passes.';

export function mapInvoice(row) {
  if (!row) return null;
  let data = {};
  try {
    data = JSON.parse(row.data_json || '{}');
  } catch {
    data = {};
  }
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.user_name,
    userEmail: row.user_email,
    employeeNumber: row.employee_number,
    invoiceNumber: row.invoice_number,
    invoiceDate: row.invoice_date,
    billingPeriod: row.billing_period,
    consultant: row.consultant,
    totalAmount: row.total_amount,
    createdAt: row.created_at,
    deletesOn: invoiceDeletionDate(row.billing_period),
    hiddenFromSubmitter: Boolean(row.submitter_deleted_at),
    data,
    hasPdf: Boolean(row.pdf_data),
  };
}

export function validateInvoicePayload(body) {
  const consultant = String(body.consultant || '').trim();
  const invoiceNumber = String(body.invoiceNumber || '').trim();
  const invoiceDate = String(body.invoiceDate || '').trim();
  const billingPeriod = String(body.billingPeriod || '').trim();

  if (!consultant) return { error: 'Consultant name is required' };
  if (!invoiceNumber) return { error: 'Invoice number is required' };
  if (!invoiceDate) return { error: 'Invoice date is required' };
  if (!billingPeriod || !/^\d{4}-\d{2}$/.test(billingPeriod)) {
    return { error: 'Billing period (month) is required' };
  }

  const lineItems = Array.isArray(body.lineItems) ? body.lineItems : [];
  if (lineItems.length === 0) {
    return { error: 'At least one line item is required' };
  }

  const normalizedItems = lineItems.map((item) => ({
    description: String(item.description || '').trim(),
    amount: Number(item.amount) || 0,
  }));

  if (normalizedItems.every((item) => !item.description)) {
    return { error: 'Line item descriptions are required' };
  }

  const totalAmount = normalizedItems.reduce((sum, item) => sum + item.amount, 0);

  const data = {
    consultant,
    pan: String(body.pan || '').trim(),
    invoiceNumber,
    invoiceDate,
    billingPeriod,
    billedTo: String(body.billedTo || '').trim(),
    address: String(body.address || '').trim(),
    lineItems: normalizedItems,
    accountHolder: String(body.accountHolder || '').trim(),
    accountNumber: String(body.accountNumber || '').trim(),
    ifsc: String(body.ifsc || '').trim().toUpperCase(),
    swift: String(body.swift || '').trim(),
    bank: String(body.bank || '').trim(),
    branch: String(body.branch || '').trim(),
    // Keep signatures out of JSON storage — they live in the PDF (and can be huge).
    signatureDataUrl: null,
  };

  return { data, totalAmount };
}
