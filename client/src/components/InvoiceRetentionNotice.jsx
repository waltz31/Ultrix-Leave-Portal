import { INVOICE_RETENTION_NOTICE } from '../invoiceUtils';

export default function InvoiceRetentionNotice({ className = '' }) {
  return (
    <div className={`invoice-retention-notice ${className}`.trim()} role="note">
      <strong>Invoice retention</strong>
      <p>{INVOICE_RETENTION_NOTICE}</p>
    </div>
  );
}
