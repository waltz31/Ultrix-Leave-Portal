import { getToken } from './api';

export async function downloadInvoicePdf(id, filename) {
  const base = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
  const token = getToken();
  const res = await fetch(`${base}/api/invoices/${id}/pdf`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Could not download PDF');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || `invoice-${id}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}
