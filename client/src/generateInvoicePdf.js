import { jsPDF } from 'jspdf';
import html2pdf from 'html2pdf.js';

/** Capture tuned for crisp text at modest file size. */
const PDF_CANVAS_SCALE = 1.4;
const PDF_TARGET_WIDTH_PX = 880;
const PDF_TARGET_BYTES = 25 * 1024;
const PDF_START_QUALITY = 0.64;
const PDF_MIN_QUALITY = 0.46;

function preparePdfCanvas(sourceCanvas) {
  const scale = Math.min(1, PDF_TARGET_WIDTH_PX / sourceCanvas.width);
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(sourceCanvas.width * scale));
  out.height = Math.max(1, Math.round(sourceCanvas.height * scale));
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(sourceCanvas, 0, 0, out.width, out.height);
  return out;
}

function buildPdfBlob(canvas, quality) {
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
  let drawHeight = (canvas.height * drawWidth) / canvas.width;
  if (drawHeight > maxHeight) {
    const fit = maxHeight / drawHeight;
    drawWidth *= fit;
    drawHeight = maxHeight;
  }

  const offsetX = margin + (maxWidth - drawWidth) / 2;
  const offsetY = margin;
  const imgData = canvas.toDataURL('image/jpeg', quality);
  pdf.addImage(imgData, 'JPEG', offsetX, offsetY, drawWidth, drawHeight, undefined, 'MEDIUM');
  return pdf.output('blob');
}

function canvasToPdfBlob(canvas) {
  let quality = PDF_START_QUALITY;
  let blob = buildPdfBlob(canvas, quality);
  while (blob.size > PDF_TARGET_BYTES && quality > PDF_MIN_QUALITY) {
    quality = Math.max(PDF_MIN_QUALITY, quality - 0.04);
    blob = buildPdfBlob(canvas, quality);
  }
  return blob;
}

/** Generate a compact JPEG-based PDF blob from the invoice preview element. */
export async function generateInvoicePdfBlob(previewEl) {
  previewEl.classList.add('pdf-export');
  try {
    if (document.fonts?.ready) await document.fonts.ready;
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    );

    const worker = html2pdf().set({
      html2canvas: {
        scale: PDF_CANVAS_SCALE,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
        scrollX: 0,
        scrollY: 0,
      },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    }).from(previewEl);

    const canvasEl = await worker.toCanvas().get('canvas');
    if (!canvasEl) return null;

    const optimized = preparePdfCanvas(canvasEl);
    return canvasToPdfBlob(optimized);
  } finally {
    previewEl.classList.remove('pdf-export');
  }
}

export async function blobToBase64(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** Shrink signature images before they land in the preview / PDF. */
export function compressSignatureDataUrl(
  dataUrl,
  maxWidth = 480,
  maxHeight = 120,
  quality = 0.78
) {
  if (!dataUrl || !dataUrl.startsWith('data:image')) return Promise.resolve(dataUrl);

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(
        1,
        maxWidth / Math.max(img.width, 1),
        maxHeight / Math.max(img.height, 1)
      );
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}
