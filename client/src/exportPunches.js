import * as XLSX from 'xlsx';
import { formatDate, formatTime } from './utils';

/**
 * Export punch sessions to Excel.
 * Columns: Date, Name, Employee ID, Punch In, Punch Out, Work Hours
 */
export function downloadPunchesExcel(sessions = [], filename = 'punches.xlsx') {
  const rows = (sessions || []).map((s) => ({
    Date: s.punchDate ? formatDate(s.punchDate) : '',
    Name: s.userName || 'Unmapped',
    'Employee ID': s.employeeNumber || s.deviceUserCode || '',
    'Punch In': s.punchIn ? formatTime(s.punchIn) : '',
    'Punch Out': s.punchOut ? formatTime(s.punchOut) : s.stillIn ? 'Still in' : '',
    'Work Hours': s.workHours || (s.stillIn ? 'In progress' : ''),
  }));

  const sheet = XLSX.utils.json_to_sheet(
    rows.length
      ? rows
      : [
          {
            Date: '',
            Name: '',
            'Employee ID': '',
            'Punch In': '',
            'Punch Out': '',
            'Work Hours': '',
          },
        ]
  );
  sheet['!cols'] = [
    { wch: 14 },
    { wch: 28 },
    { wch: 14 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Punches');
  XLSX.writeFile(workbook, filename);
}
