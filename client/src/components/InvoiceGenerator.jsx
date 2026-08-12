import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { downloadInvoicePdf } from '../downloadInvoice';
import { useAuth } from '../auth';
import InvoiceDocument from './InvoiceDocument';
import {
  blobToBase64,
  compressSignatureDataUrl,
  generateInvoicePdfBlob,
} from '../generateInvoicePdf';
import {
  defaultInvoiceForm,
  emptyInvoiceForm,
  emptyLineItem,
  formatDeletesOn,
  invoiceTotal,
  randomInvoiceNumber,
} from '../invoiceUtils';
import InvoiceRetentionNotice from './InvoiceRetentionNotice';
import StatusCelebration from './StatusCelebration';
import '../invoice.css';

const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;

const OPEN_SECTIONS_DEFAULT = {
  info: false,
  billing: false,
  services: false,
  payment: false,
  signature: false,
};

function InvoiceFormSection({ sectionKey, title, open, onToggle, children }) {
  return (
    <fieldset className={`invoice-fieldset form-section${open ? '' : ' collapsed'}`}>
      <button
        type="button"
        className="section-toggle"
        onClick={() => onToggle(sectionKey)}
        aria-expanded={open}
      >
        {title}
      </button>
      <div className="section-body">{children}</div>
    </fieldset>
  );
}

function SignaturePad({ onChange }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const hasStroke = useRef(false);
  const lastPoint = useRef(null);
  const [empty, setEmpty] = useState(true);

  const paintStyle = useCallback((ctx, ratio) => {
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111111';
  }, []);

  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const cssWidth = wrap.clientWidth;
    const cssHeight = wrap.clientHeight;
    if (cssWidth < 2 || cssHeight < 2) return;

    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const snapshot = hasStroke.current ? canvas.toDataURL('image/png') : null;

    canvas.width = Math.round(cssWidth * ratio);
    canvas.height = Math.round(cssHeight * ratio);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;

    const ctx = canvas.getContext('2d');
    paintStyle(ctx, ratio);

    if (snapshot) {
      const img = new Image();
      img.onload = () => {
        paintStyle(ctx, ratio);
        ctx.drawImage(img, 0, 0, cssWidth, cssHeight);
      };
      img.src = snapshot;
    }
  }, [paintStyle]);

  useEffect(() => {
    resize();
    const wrap = wrapRef.current;
    if (!wrap) return undefined;

    const observer = new ResizeObserver(() => resize());
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [resize]);

  function pointerPos(e) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  async function emitSignature() {
    const canvas = canvasRef.current;
    if (!canvas || !hasStroke.current) {
      onChange(null);
      return;
    }
    const compressed = await compressSignatureDataUrl(canvas.toDataURL('image/png'));
    onChange(compressed);
  }

  function startDraw(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const point = pointerPos(e);
    drawing.current = true;
    hasStroke.current = true;
    setEmpty(false);
    lastPoint.current = point;
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  }

  function draw(e) {
    if (!drawing.current || !lastPoint.current) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const point = pointerPos(e);
    ctx.beginPath();
    ctx.moveTo(lastPoint.current.x, lastPoint.current.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    lastPoint.current = point;
  }

  function endDraw(e) {
    if (!drawing.current) return;
    drawing.current = false;
    lastPoint.current = null;
    try {
      canvasRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    emitSignature();
  }

  function clear() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    paintStyle(ctx, ratio);
    drawing.current = false;
    hasStroke.current = false;
    lastPoint.current = null;
    setEmpty(true);
    onChange(null);
  }

  return (
    <div className="invoice-signature-wrap">
      <div className="invoice-signature-card">
        <div className="invoice-signature-pad-shell" ref={wrapRef}>
          {empty && (
            <span className="invoice-signature-placeholder" aria-hidden="true">
              Sign here
            </span>
          )}
          <canvas
            ref={canvasRef}
            className="invoice-signature-pad"
            onPointerDown={startDraw}
            onPointerMove={draw}
            onPointerUp={endDraw}
            onPointerCancel={endDraw}
            aria-label="Signature drawing pad"
          />
        </div>
        <button type="button" className="btn ghost invoice-signature-clear" onClick={clear}>
          Clear signature
        </button>
      </div>
    </div>
  );
}

export default function InvoiceGenerator() {
  const { user } = useAuth();
  const previewRef = useRef(null);
  const signatureUploadRef = useRef(null);
  const [form, setForm] = useState(() => defaultInvoiceForm(user?.name || ''));
  const [formKey, setFormKey] = useState(0);
  const [openSections, setOpenSections] = useState(OPEN_SECTIONS_DEFAULT);
  const [signatureMode, setSignatureMode] = useState('draw');
  const [ifscStatus, setIfscStatus] = useState('');
  const [autoIfsc, setAutoIfsc] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitPopup, setSubmitPopup] = useState(null);
  const [submitted, setSubmitted] = useState([]);

  const loadMine = useCallback(() => {
    api('/invoices/mine')
      .then((d) => setSubmitted(d.invoices || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadMine();
  }, [loadMine]);

  function updateField(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function updateLineItem(id, key, value) {
    setForm((f) => ({
      ...f,
      lineItems: f.lineItems.map((item) =>
        item.id === id ? { ...item, [key]: value } : item
      ),
    }));
  }

  function addLineItem() {
    setForm((f) => ({
      ...f,
      lineItems: [emptyLineItem(), ...f.lineItems],
    }));
  }

  function removeLineItem(id) {
    setForm((f) => {
      if (f.lineItems.length <= 1) return f;
      return { ...f, lineItems: f.lineItems.filter((item) => item.id !== id) };
    });
  }

  async function fetchIfsc(force = false) {
    const ifsc = form.ifsc.trim().toUpperCase();
    if (!ifsc) {
      setIfscStatus('');
      return;
    }
    if (!IFSC_PATTERN.test(ifsc)) {
      setIfscStatus('Enter a valid 11-character IFSC code');
      return;
    }
    setIfscStatus('Looking up IFSC…');
    try {
      const res = await fetch(`https://ifsc.razorpay.com/${ifsc}`);
      if (!res.ok) {
        setIfscStatus('IFSC not found');
        return;
      }
      const data = await res.json();
      setForm((f) => ({
        ...f,
        ifsc,
        bank: force || !f.bank ? data.BANK || f.bank : f.bank,
        branch:
          force || !f.branch
            ? [data.BRANCH, data.CITY].filter(Boolean).join(', ')
            : f.branch,
        swift:
          data.SWIFT?.trim()
            ? force || !f.swift
              ? data.SWIFT.trim()
              : f.swift
            : f.swift,
      }));
      setIfscStatus('Bank details filled');
    } catch {
      setIfscStatus('Could not fetch IFSC details');
    }
  }

  function handleIfscBlur() {
    if (autoIfsc) fetchIfsc();
  }

  function toggleSection(key) {
    setOpenSections((sections) => ({ ...sections, [key]: !sections[key] }));
  }

  function applyEmptyForm() {
    setForm(emptyInvoiceForm());
    setIfscStatus('');
    setSignatureMode('draw');
    setAutoIfsc(true);
    setOpenSections({ ...OPEN_SECTIONS_DEFAULT });
    setFormKey((k) => k + 1);
    if (signatureUploadRef.current) {
      signatureUploadRef.current.value = '';
    }
  }

  function handleClearAll() {
    const ok = window.confirm('Clear all invoice fields and start fresh?');
    if (!ok) return;
    setError('');
    setSuccess('');
    applyEmptyForm();
  }

  async function downloadPdf() {
    const el = previewRef.current;
    if (!el) return;
    setBusy(true);
    setError('');
    try {
      const filename = `${form.invoiceNumber || 'invoice'}.pdf`;
      const blob = await generateInvoicePdfBlob(el);
      if (!blob) throw new Error('Could not generate PDF');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message || 'Could not generate PDF');
    } finally {
      setBusy(false);
    }
  }

  async function submitInvoice() {
    setError('');
    setSuccess('');
    if (!form.consultant.trim()) {
      setError('Consultant name is required');
      return;
    }
    if (!form.invoiceNumber.trim()) {
      setError('Invoice number is required');
      return;
    }
    if (invoiceTotal(form.lineItems) <= 0) {
      setError('Add at least one line item with an amount');
      return;
    }

    setBusy(true);
    try {
      const el = previewRef.current;
      let pdfData = null;
      if (el) {
        const blob = await generateInvoicePdfBlob(el);
        if (blob) pdfData = await blobToBase64(blob);
      }

      await api('/invoices', {
        method: 'POST',
        body: {
          ...form,
          lineItems: form.lineItems.map(({ description, amount }) => ({
            description,
            amount: Number(amount) || 0,
          })),
          pdfData,
        },
      });
      const submittedNumber = form.invoiceNumber;
      setSubmitPopup({
        message: 'Invoice submitted',
        detail: `${submittedNumber} has been sent to HR.`,
      });
      setError('');
      setSuccess('');
      loadMine();
      applyEmptyForm();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSignatureUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const compressed = await compressSignatureDataUrl(reader.result);
      updateField('signatureDataUrl', compressed);
    };
    reader.readAsDataURL(file);
  }

  async function deleteSubmittedInvoice(inv) {
    const ok = window.confirm(
      `Remove invoice ${inv.invoiceNumber} from your list? HR will still keep a copy until they delete it or the retention date passes.`
    );
    if (!ok) return;
    setBusy(true);
    setError('');
    try {
      await api(`/invoices/${inv.id}`, { method: 'DELETE' });
      setSuccess('Invoice removed from your list.');
      loadMine();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="invoice-studio">
      <StatusCelebration
        show={Boolean(submitPopup)}
        onDone={() => setSubmitPopup(null)}
        message={submitPopup?.message || 'Invoice submitted'}
        detail={submitPopup?.detail || ''}
        imageSrc="/assets/request-submitted.gif"
        durationMs={3200}
      />
      <InvoiceRetentionNotice />
      <div className="invoice-studio-layout">
        <aside className="invoice-studio-panel panel">
          <header className="invoice-studio-header">
            <h2>Invoice Generator</h2>
            <p className="muted">Fill in details, preview, then submit to HR.</p>
          </header>

          <div key={`invoice-form-${formKey}`} className="invoice-form stack">
            <InvoiceFormSection
              sectionKey="info"
              title="Invoice info"
              open={openSections.info}
              onToggle={toggleSection}
            >
              <div className="invoice-form-grid">
                <label>
                  Consultant
                  <input
                    value={form.consultant}
                    onChange={(e) => updateField('consultant', e.target.value)}
                  />
                </label>
                <label>
                  PAN
                  <input value={form.pan} onChange={(e) => updateField('pan', e.target.value)} />
                </label>
              </div>
              <label>
                Invoice number
                <div className="input-with-action">
                  <input
                    value={form.invoiceNumber}
                    onChange={(e) => updateField('invoiceNumber', e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={() => updateField('invoiceNumber', randomInvoiceNumber())}
                  >
                    Random
                  </button>
                </div>
              </label>
              <div className="invoice-form-grid">
                <label>
                  Invoice date
                  <input
                    type="date"
                    value={form.invoiceDate}
                    onChange={(e) => updateField('invoiceDate', e.target.value)}
                  />
                </label>
                <label>
                  Billing period
                  <input
                    type="month"
                    value={form.billingPeriod}
                    onChange={(e) => updateField('billingPeriod', e.target.value)}
                  />
                </label>
              </div>
            </InvoiceFormSection>

            <InvoiceFormSection
              sectionKey="billing"
              title="Billing"
              open={openSections.billing}
              onToggle={toggleSection}
            >
              <label>
                Billed to
                <input
                  value={form.billedTo}
                  placeholder="Company name"
                  onChange={(e) => updateField('billedTo', e.target.value)}
                />
              </label>
              <label>
                Address
                <input
                  value={form.address}
                  onChange={(e) => updateField('address', e.target.value)}
                />
              </label>
            </InvoiceFormSection>

            <InvoiceFormSection
              sectionKey="services"
              title="Services"
              open={openSections.services}
              onToggle={toggleSection}
            >
              <button type="button" className="btn secondary full" onClick={addLineItem}>
                Add item
              </button>
              <div className="invoice-line-items">
                {form.lineItems.map((item) => (
                  <div key={item.id} className="invoice-line-item-row">
                    <textarea
                      rows={2}
                      placeholder="Description"
                      value={item.description}
                      onChange={(e) => updateLineItem(item.id, 'description', e.target.value)}
                    />
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Amount (INR)"
                      value={item.amount}
                      onChange={(e) => updateLineItem(item.id, 'amount', e.target.value)}
                    />
                    <button
                      type="button"
                      className="btn ghost"
                      disabled={form.lineItems.length <= 1}
                      onClick={() => removeLineItem(item.id)}
                      aria-label="Remove item"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </InvoiceFormSection>

            <InvoiceFormSection
              sectionKey="payment"
              title="Payment details"
              open={openSections.payment}
              onToggle={toggleSection}
            >
              <div className="invoice-form-grid">
                <label>
                  Account holder
                  <input
                    value={form.accountHolder}
                    onChange={(e) => updateField('accountHolder', e.target.value)}
                  />
                </label>
                <label>
                  Account number
                  <input
                    value={form.accountNumber}
                    onChange={(e) => updateField('accountNumber', e.target.value)}
                  />
                </label>
              </div>
              <label>
                IFSC
                <div className="input-with-action">
                  <input
                    value={form.ifsc}
                    onChange={(e) => updateField('ifsc', e.target.value.toUpperCase())}
                    onBlur={handleIfscBlur}
                    maxLength={11}
                  />
                  <button type="button" className="btn secondary" onClick={() => fetchIfsc(true)}>
                    Lookup
                  </button>
                </div>
                {ifscStatus && <span className="field-hint">{ifscStatus}</span>}
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={autoIfsc}
                  onChange={(e) => setAutoIfsc(e.target.checked)}
                />
                Auto-fill bank details from IFSC
              </label>
              <div className="invoice-form-grid">
                <label>
                  SWIFT
                  <input value={form.swift} onChange={(e) => updateField('swift', e.target.value)} />
                </label>
                <label>
                  Bank
                  <input value={form.bank} onChange={(e) => updateField('bank', e.target.value)} />
                </label>
              </div>
              <label>
                Branch
                <input value={form.branch} onChange={(e) => updateField('branch', e.target.value)} />
              </label>
            </InvoiceFormSection>

            <InvoiceFormSection
              sectionKey="signature"
              title="Signature"
              open={openSections.signature}
              onToggle={toggleSection}
            >
              <div className="signature-source-options">
                <label className="radio-label">
                  <input
                    type="radio"
                    name="sig"
                    checked={signatureMode === 'draw'}
                    onChange={() => setSignatureMode('draw')}
                  />
                  Draw
                </label>
                <label className="radio-label">
                  <input
                    type="radio"
                    name="sig"
                    checked={signatureMode === 'upload'}
                    onChange={() => setSignatureMode('upload')}
                  />
                  Upload
                </label>
              </div>
              {signatureMode === 'draw' ? (
                <SignaturePad
                  key={formKey}
                  onChange={(dataUrl) => updateField('signatureDataUrl', dataUrl)}
                />
              ) : (
                <input
                  key={`sig-upload-${formKey}`}
                  ref={signatureUploadRef}
                  className="invoice-signature-upload"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleSignatureUpload}
                />
              )}
            </InvoiceFormSection>
          </div>

          <div className="invoice-studio-actions">
            <button type="button" className="btn secondary" onClick={downloadPdf} disabled={busy}>
              Download PDF
            </button>
            <button type="button" className="btn ghost" onClick={handleClearAll} disabled={busy}>
              Clear all
            </button>
            <button type="button" className="btn primary" onClick={submitInvoice} disabled={busy}>
              {busy ? 'Working…' : 'Submit to HR'}
            </button>
          </div>

          {error && <p className="form-error">{error}</p>}
          {success && <p className="form-success">{success}</p>}
        </aside>

        <div className="invoice-studio-preview">
          <div className="invoice-preview-toolbar">
            <span>Live preview</span>
            <span className="muted">A4 · compact PDF</span>
          </div>
          <div className="invoice-preview-stage">
            <InvoiceDocument key={`preview-${formKey}`} form={form} previewRef={previewRef} />
          </div>
        </div>
      </div>

      {submitted.length > 0 && (
        <section className="panel invoice-submitted-list">
          <h3>Your submitted invoices</h3>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Invoice #</th>
                  <th>Period</th>
                  <th>Total</th>
                  <th>Submitted</th>
                  <th>Deletes on</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {submitted.map((inv) => (
                  <tr key={inv.id}>
                    <td>{inv.invoiceNumber}</td>
                    <td>{inv.billingPeriod}</td>
                    <td>₹{Number(inv.totalAmount).toLocaleString('en-IN')}</td>
                    <td>{inv.createdAt}</td>
                    <td>{formatDeletesOn(inv.deletesOn)}</td>
                    <td className="invoice-row-actions">
                      {inv.hasPdf && (
                        <button
                          type="button"
                          className="btn ghost small"
                          onClick={() =>
                            downloadInvoicePdf(inv.id, `${inv.invoiceNumber}.pdf`).catch(
                              (err) => setError(err.message)
                            )
                          }
                        >
                          PDF
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn ghost small invoice-delete-btn"
                        disabled={busy}
                        onClick={() => deleteSubmittedInvoice(inv)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
