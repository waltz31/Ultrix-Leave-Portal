const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function formatINR(n) {
  return Number(n || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatDisplayDate(iso) {
  if (!iso) return '—';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatBillingPeriod(monthValue) {
  if (!monthValue) return '—';
  const [year, month] = monthValue.split('-').map(Number);
  if (!year || !month) return monthValue;
  return `${MONTHS[month - 1]} ${year}`;
}

export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function currentBillingMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function randomInvoiceNumber() {
  return Array.from({ length: 8 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join('').toUpperCase();
}

export function emptyLineItem() {
  return { id: crypto.randomUUID(), description: '', amount: '' };
}

export function defaultInvoiceForm(userName = '') {
  return {
    consultant: userName,
    pan: '',
    invoiceNumber: randomInvoiceNumber(),
    invoiceDate: todayIso(),
    billingPeriod: currentBillingMonth(),
    billedTo: 'Ultrix',
    address: '',
    lineItems: [emptyLineItem()],
    accountHolder: userName,
    accountNumber: '',
    ifsc: '',
    swift: '',
    bank: '',
    branch: '',
    signatureDataUrl: null,
  };
}

/** Completely blank form — used by Clear all. */
export function emptyInvoiceForm() {
  return {
    consultant: '',
    pan: '',
    invoiceNumber: '',
    invoiceDate: '',
    billingPeriod: '',
    billedTo: '',
    address: '',
    lineItems: [emptyLineItem()],
    accountHolder: '',
    accountNumber: '',
    ifsc: '',
    swift: '',
    bank: '',
    branch: '',
    signatureDataUrl: null,
  };
}

export function invoiceTotal(lineItems) {
  return (lineItems || []).reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
}

export const PERIOD_MONTHS = [
  { value: '1', label: 'January' },
  { value: '2', label: 'February' },
  { value: '3', label: 'March' },
  { value: '4', label: 'April' },
  { value: '5', label: 'May' },
  { value: '6', label: 'June' },
  { value: '7', label: 'July' },
  { value: '8', label: 'August' },
  { value: '9', label: 'September' },
  { value: '10', label: 'October' },
  { value: '11', label: 'November' },
  { value: '12', label: 'December' },
];

export function billingPeriodFromMonthYear(month, year) {
  if (!month || !year) return '';
  return `${year}-${String(month).padStart(2, '0')}`;
}

export const INVOICE_RETENTION_NOTICE =
  'Submitted invoices are automatically deleted on the 1st of the month, two months after the billing period (for example, August invoices are removed on 1 October). Download a PDF copy before then. You can remove an invoice from your list — HR will keep a copy until they delete it or the retention date passes.';

export function formatDeletesOn(iso) {
  if (!iso) return '—';
  const [year, month, day] = iso.split('-').map(Number);
  if (!year || !month || !day) return iso;
  return `${day} ${MONTHS[month - 1]} ${year}`;
}
