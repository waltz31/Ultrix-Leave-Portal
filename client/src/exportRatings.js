import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatDate, formatDateTime } from './utils';

function csvEscape(value) {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function ratingExportRows(ratings) {
  return (ratings || []).map((r) => ({
    employee: r.userName || '',
    employeeNumber: r.employeeNumber || '',
    email: r.userEmail || '',
    manager: r.managerName || '',
    score: r.score,
    feedback: r.feedback || '',
    period: r.periodLabel || '',
    ratedAt: r.createdAt,
  }));
}

export function downloadRatingsCsv(ratings, filename = 'ratings-report.csv') {
  const rows = ratingExportRows(ratings);
  const headers = [
    'Employee',
    'Employee Number',
    'Email',
    'Manager',
    'Score',
    'Feedback',
    'Period',
    'Rated At',
  ];
  const lines = [
    headers.join(','),
    ...rows.map((r) =>
      [
        r.employee,
        r.employeeNumber,
        r.email,
        r.manager,
        r.score,
        r.feedback,
        r.period,
        formatDateTime(r.ratedAt),
      ]
        .map(csvEscape)
        .join(',')
    ),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  triggerDownload(blob, filename);
}

export function downloadRatingsPdf(ratings, meta = {}, filename = 'ratings-report.pdf') {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const title = meta.title || 'Employee ratings report';
  const subtitle = meta.subtitle || '';

  doc.setFontSize(16);
  doc.text(title, 40, 36);
  if (subtitle) {
    doc.setFontSize(10);
    doc.setTextColor(90);
    doc.text(subtitle, 40, 54);
    doc.setTextColor(0);
  }

  const rows = ratingExportRows(ratings).map((r) => [
    r.employee,
    r.employeeNumber || '—',
    r.manager,
    `${r.score}/10`,
    r.period || '—',
    formatDateTime(r.ratedAt),
    r.feedback || '—',
  ]);

  autoTable(doc, {
    startY: subtitle ? 66 : 48,
    head: [['Employee', 'Emp #', 'Manager', 'Score', 'Period', 'Rated At', 'Feedback']],
    body: rows.length
      ? rows
      : [['No ratings for the selected filters.', '', '', '', '', '', '']],
    styles: { fontSize: 8, cellPadding: 4, overflow: 'linebreak' },
    headStyles: { fillColor: [100, 197, 193], textColor: [16, 21, 38] },
    columnStyles: {
      0: { cellWidth: 90 },
      1: { cellWidth: 50 },
      2: { cellWidth: 90 },
      3: { cellWidth: 40 },
      4: { cellWidth: 70 },
      5: { cellWidth: 90 },
      6: { cellWidth: 'auto' },
    },
  });

  doc.save(filename);
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export { monthRange } from './exportLeaves.js';
