import { formatBillingPeriod, formatDisplayDate, formatINR } from '../invoiceUtils';

export default function InvoiceDocument({ form, previewRef }) {
  const items = form.lineItems || [];
  const total = items.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);

  return (
    <article
      ref={previewRef}
      className="invoice font-source-sans"
      aria-label="Invoice preview"
    >
      <header className="invoice-header-row">
        <h2 className="invoice-title">INVOICE</h2>
      </header>

      <table className="inv-table meta-table">
        <tbody>
          <tr>
            <td className="label">Consultant</td>
            <td>{form.consultant || '—'}</td>
          </tr>
          <tr>
            <td className="label">PAN</td>
            <td>{form.pan || '—'}</td>
          </tr>
          <tr>
            <td className="label">Invoice Number</td>
            <td>{form.invoiceNumber || '—'}</td>
          </tr>
          <tr>
            <td className="label">Invoice Date</td>
            <td>{formatDisplayDate(form.invoiceDate)}</td>
          </tr>
          <tr>
            <td className="label">Billing Period</td>
            <td>{formatBillingPeriod(form.billingPeriod)}</td>
          </tr>
        </tbody>
      </table>

      <table className="inv-table meta-table">
        <tbody>
          <tr>
            <td className="label">Billed To</td>
            <td>{form.billedTo || '—'}</td>
          </tr>
          <tr>
            <td className="label">Address</td>
            <td>{form.address || '—'}</td>
          </tr>
        </tbody>
      </table>

      <table className="inv-table items-table">
        <thead>
          <tr>
            <th>Description</th>
            <th className="amount-col">Amount (INR)</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr>
              <td>—</td>
              <td className="amount-col">0.00</td>
            </tr>
          ) : (
            items.map((item) => (
              <tr key={item.id}>
                <td>{item.description || '—'}</td>
                <td className="amount-col">{formatINR(item.amount)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <p className="total-line">
        <strong>Total Amount Due:</strong>
        <span>{formatINR(total)}</span>
      </p>

      <table className="inv-table payment-table">
        <thead>
          <tr>
            <th colSpan={2}>Payment Details</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="label">Account Holder Name</td>
            <td>{form.accountHolder || '—'}</td>
          </tr>
          <tr>
            <td className="label">Account Number</td>
            <td>{form.accountNumber || '—'}</td>
          </tr>
          <tr>
            <td className="label">IFSC</td>
            <td>{form.ifsc || '—'}</td>
          </tr>
          <tr>
            <td className="label">SWIFT Code</td>
            <td>{form.swift || '—'}</td>
          </tr>
          <tr>
            <td className="label">Bank</td>
            <td>{form.bank || '—'}</td>
          </tr>
          <tr>
            <td className="label">Branch</td>
            <td>{form.branch || '—'}</td>
          </tr>
        </tbody>
      </table>

      <div className="signature-block">
        {form.signatureDataUrl ? (
          <img
            className="sig-image"
            src={form.signatureDataUrl}
            alt="Consultant signature"
          />
        ) : null}
        <div className="sig-label">Consultant Signature</div>
      </div>
    </article>
  );
}
