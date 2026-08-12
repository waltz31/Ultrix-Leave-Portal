export const INVOICE_SELECT = `
  SELECT i.*,
         u.name AS user_name,
         u.email AS user_email,
         u.employee_number
  FROM invoices i
  JOIN users u ON u.id = i.user_id
`;

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
    invoiceFont: String(body.invoiceFont || 'source-sans'),
    // Keep signatures out of JSON storage — they live in the PDF (and can be huge).
    signatureDataUrl: null,
  };

  return { data, totalAmount };
}
