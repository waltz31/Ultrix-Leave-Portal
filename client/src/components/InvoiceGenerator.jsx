import { useCallback, useEffect, useRef, useState } from 'react';
import html2pdf from 'html2pdf.js';
import { api } from '../api';
import { downloadInvoicePdf } from '../downloadInvoice';
import { useAuth } from '../auth';
import InvoiceDocument from './InvoiceDocument';
import {
  INVOICE_FONTS,
  defaultInvoiceForm,
  emptyLineItem,
  invoiceTotal,
  randomInvoiceNumber,
} from '../invoiceUtils';
import '../invoice.css';

const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;

function SignaturePad({ onChange }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const hasStroke = useRef(false);
  const lastPoint = useRef(null);

  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 2) return;
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const snapshot = hasStroke.current ? canvas.toDataURL('image/png') : null;
    const cssWidth = Math.floor(rect.width);
    const cssHeight = Math.floor(rect.height);
    canvas.width = Math.max(1, Math.floor(cssWidth * ratio));
    canvas.height = Math.max(1, Math.floor(cssHeight * ratio));
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111111';
    if (snapshot) {
      const img = new Image();
      img.onload = () => {
        ctx.clearRect(0, 0, cssWidth, cssHeight);
        ctx.drawImage(img, 0, 0, cssWidth, cssHeight);
      };
      img.src = snapshot;
    }
  }, []);

  useEffect(() => {
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [resize]);

  function pointerPos(e) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function emitSignature() {
    const canvas = canvasRef.current;
    if (!canvas || !hasStroke.current) {
      onChange(null);
      return;
    }
    onChange(canvas.toDataURL('image/png'));
  }

  function startDraw(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    drawing.current = true;
    lastPoint.current = pointerPos(e);
    try {
      canvasRef.current.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  }

  function draw(e) {
    if (!drawing.current) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const point = pointerPos(e);
    if (!lastPoint.current) {
      lastPoint.current = point;
      ctx.beginPath();
      ctx.moveTo(point.x, point.y);
      return;
    }
    const midX = (lastPoint.current.x + point.x) / 2;
    const midY = (lastPoint.current.y + point.y) / 2;
    ctx.quadraticCurveTo(lastPoint.current.x, lastPoint.current.y, midX, midY);
    ctx.stroke();
    lastPoint.current = point;
    hasStroke.current = true;
  }

  function endDraw(e) {
    if (!drawing.current) return;
    drawing.current = false;
    lastPoint.current = null;
    emitSignature();
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasStroke.current = false;
    onChange(null);
  }

  return (
    <div className="invoice-signature-wrap">
      <canvas
        ref={canvasRef}
        className="invoice-signature-pad"
        width={320}
        height={140}
        onPointerDown={startDraw}
        onPointerMove={draw}
        onPointerUp={endDraw}
        onPointerLeave={endDraw}
        aria-label="Signature drawing pad"
      />
      <button type="button" className="btn ghost full" onClick={clear}>
        Clear signature
      </button>
    </div>
  );
}

async function generatePdfBlob(previewEl, filename) {
  previewEl.classList.add('pdf-export');
  try {
    if (document.fonts?.ready) await document.fonts.ready;
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    );

    const worker = html2pdf().set({
      html2canvas: {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
      },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    }).from(previewEl);

    const canvasEl = await worker.toCanvas().get('canvas');
    const { jsPDF } = await import('jspdf');

    if (!canvasEl) {
      await html2pdf()
        .set({
          margin: [6, 6, 6, 6],
          filename,
          image: { type: 'jpeg', quality: 0.82 },
          html2canvas: {
            scale: 2,
            useCORS: true,
            backgroundColor: '#ffffff',
          },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        })
        .from(previewEl)
        .save();
      return null;
    }

    const targetWidthPx = 1320;
    const scale = Math.min(1, targetWidthPx / canvasEl.width);
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(canvasEl.width * scale));
    out.height = Math.max(1, Math.round(canvasEl.height * scale));
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(canvasEl, 0, 0, out.width, out.height);

    const pdf = new jsPDF({
      unit: 'mm',
      format: 'a4',
      orientation: 'portrait',
      compress: true,
    });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 6;
    const maxWidth = pageWidth - margin * 2;
    const maxHeight = pageHeight - margin * 2;
    let drawWidth = maxWidth;
    let drawHeight = (out.height * drawWidth) / out.width;
    if (drawHeight > maxHeight) {
      const fit = maxHeight / drawHeight;
      drawWidth *= fit;
      drawHeight = maxHeight;
    }
    const offsetX = margin + (maxWidth - drawWidth) / 2;
    const offsetY = margin;
    const imgData = out.toDataURL('image/jpeg', 0.84);
    pdf.addImage(imgData, 'JPEG', offsetX, offsetY, drawWidth, drawHeight, undefined, 'MEDIUM');
    return pdf.output('blob');
  } finally {
    previewEl.classList.remove('pdf-export');
  }
}

export default function InvoiceGenerator() {
  const { user } = useAuth();
  const previewRef = useRef(null);
  const [form, setForm] = useState(() => defaultInvoiceForm(user?.name || ''));
  const [signatureMode, setSignatureMode] = useState('draw');
  const [ifscStatus, setIfscStatus] = useState('');
  const [autoIfsc, setAutoIfsc] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
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

  function resetForm() {
    setForm(defaultInvoiceForm(user?.name || ''));
    setError('');
    setSuccess('');
    setIfscStatus('');
    setSignatureMode('draw');
  }

  async function downloadPdf() {
    const el = previewRef.current;
    if (!el) return;
    setBusy(true);
    setError('');
    try {
      const filename = `${form.invoiceNumber || 'invoice'}.pdf`;
      const blob = await generatePdfBlob(el, filename);
      if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      }
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
        const blob = await generatePdfBlob(el, `${form.invoiceNumber}.pdf`);
        if (blob) {
          const buffer = await blob.arrayBuffer();
          const bytes = new Uint8Array(buffer);
          let binary = '';
          for (let i = 0; i < bytes.length; i += 1) {
            binary += String.fromCharCode(bytes[i]);
          }
          pdfData = btoa(binary);
        }
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
      setSuccess('Invoice submitted to HR.');
      loadMine();
      resetForm();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function handleSignatureUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      updateField('signatureDataUrl', reader.result);
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="invoice-studio">
      <div className="invoice-studio-layout">
        <aside className="invoice-studio-panel panel">
          <header className="invoice-studio-header">
            <h2>Invoice Generator</h2>
            <p className="muted">Fill in details, preview, then submit to HR.</p>
          </header>

          <div className="invoice-form stack">
            <fieldset className="invoice-fieldset">
              <legend>Invoice info</legend>
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
              <label>
                Invoice font
                <select
                  value={form.invoiceFont}
                  onChange={(e) => updateField('invoiceFont', e.target.value)}
                >
                  {INVOICE_FONTS.map((f) => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </select>
              </label>
            </fieldset>

            <fieldset className="invoice-fieldset">
              <legend>Billing</legend>
              <label>
                Billed to
                <input
                  value={form.billedTo}
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
            </fieldset>

            <fieldset className="invoice-fieldset">
              <legend>Services</legend>
              <button type="button" className="btn secondary full" onClick={addLineItem}>
                Add item
              </button>
              <div className="invoice-line-items">
                {form.lineItems.map((item) => (
                  <div key={item.id} className="invoice-line-item-row">
                    <textarea
                      rows={1}
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
            </fieldset>

            <fieldset className="invoice-fieldset">
              <legend>Payment details</legend>
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
              <label>
                SWIFT
                <input value={form.swift} onChange={(e) => updateField('swift', e.target.value)} />
              </label>
              <label>
                Bank
                <input value={form.bank} onChange={(e) => updateField('bank', e.target.value)} />
              </label>
              <label>
                Branch
                <input value={form.branch} onChange={(e) => updateField('branch', e.target.value)} />
              </label>
            </fieldset>

            <fieldset className="invoice-fieldset">
              <legend>Signature</legend>
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
                  onChange={(dataUrl) => updateField('signatureDataUrl', dataUrl)}
                />
              ) : (
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleSignatureUpload}
                />
              )}
            </fieldset>
          </div>

          <div className="invoice-studio-actions">
            <button type="button" className="btn ghost" onClick={resetForm} disabled={busy}>
              Clear
            </button>
            <button type="button" className="btn secondary" onClick={downloadPdf} disabled={busy}>
              Download PDF
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
            <span className="muted">A4 · PDF export</span>
          </div>
          <div className="invoice-preview-stage">
            <InvoiceDocument form={form} previewRef={previewRef} />
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
                    <td>
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
