import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { REQUEST_LABELS, SESSION_LABELS, STATUS_LABELS, formatDate } from './utils';

function sessionLabel(session) {
  if (!session || session === 'full') return 'Full day';
  return SESSION_LABELS[session] || session;
}

export function leaveExportRows(leaves) {
  return (leaves || []).map((leave) => ({
    employee: leave.userName || '',
    employeeNumber: leave.employeeNumber || leave.userEmployeeNumber || '',
    email: leave.userEmail || '',
    type: REQUEST_LABELS[leave.leaveType] || leave.leaveType,
    startDate: leave.startDate,
    endDate: leave.endDate,
    session: sessionLabel(leave.session),
    days: leave.days,
    status: STATUS_LABELS[leave.status] || leave.status,
    reason: leave.reason || '',
    manager: leave.managerName || '',
  }));
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function downloadLeavesCsv(leaves, filename = 'leave-report.csv') {
  const rows = leaveExportRows(leaves);
  const headers = [
    'Employee',
    'Employee Number',
    'Email',
    'Type',
    'Start Date',
    'End Date',
    'Session',
    'Days',
    'Status',
    'Reason',
    'Manager',
  ];
  const lines = [
    headers.join(','),
    ...rows.map((r) =>
      [
        r.employee,
        r.employeeNumber,
        r.email,
        r.type,
        r.startDate,
        r.endDate,
        r.session,
        r.days,
        r.status,
        r.reason,
        r.manager,
      ]
        .map(csvEscape)
        .join(',')
    ),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  triggerDownload(blob, filename);
}

export function downloadLeavesPdf(leaves, meta = {}, filename = 'leave-report.pdf') {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const title = meta.title || 'Leave report';
  const subtitle = meta.subtitle || '';

  doc.setFontSize(16);
  doc.text(title, 40, 36);
  if (subtitle) {
    doc.setFontSize(10);
    doc.setTextColor(90);
    doc.text(subtitle, 40, 54);
    doc.setTextColor(0);
  }

  const rows = leaveExportRows(leaves).map((r) => [
    r.employee,
    r.employeeNumber || '—',
    r.type,
    formatDate(r.startDate),
    formatDate(r.endDate),
    r.session,
    String(r.days),
    r.status,
    r.reason || '—',
  ]);

  autoTable(doc, {
    startY: subtitle ? 66 : 48,
    head: [
      [
        'Employee',
        'Emp #',
        'Type',
        'Start',
        'End',
        'Session',
        'Days',
        'Status',
        'Reason',
      ],
    ],
    body: rows.length ? rows : [['No leave records for the selected filters.', '', '', '', '', '', '', '', '']],
    styles: { fontSize: 8, cellPadding: 4, overflow: 'linebreak' },
    headStyles: { fillColor: [100, 197, 193], textColor: [16, 21, 38] },
    columnStyles: {
      0: { cellWidth: 90 },
      1: { cellWidth: 50 },
      2: { cellWidth: 55 },
      3: { cellWidth: 70 },
      4: { cellWidth: 70 },
      5: { cellWidth: 55 },
      6: { cellWidth: 35 },
      7: { cellWidth: 80 },
      8: { cellWidth: 'auto' },
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

export function monthRange(year, month) {
  const y = Number(year);
  if (!y) return { from: '', to: '' };
  if (month) {
    const m = Number(month);
    const from = `${y}-${String(m).padStart(2, '0')}-01`;
    const last = new Date(y, m, 0).getDate();
    const to = `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
    return { from, to };
  }
  return { from: `${y}-01-01`, to: `${y}-12-31` };
}
