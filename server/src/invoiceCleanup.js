import { invoiceDeletionDate } from './invoiceUtils.js';
import { SQL_TODAY_IST } from './sqlDialect.js';

/** Today's date in IST as YYYY-MM-DD. */
export async function getTodayIso(db) {
  const row = await db.prepare(`SELECT ${SQL_TODAY_IST} AS today`).get();
  return row?.today || null;
}

/** Delete invoices whose automatic retention date has passed (IST). */
export async function purgeExpiredInvoices(db) {
  const today = await getTodayIso(db);
  if (!today) return 0;

  const rows = await db.prepare(`SELECT id, billing_period FROM invoices`).all();
  const expiredIds = rows
    .filter((row) => {
      const deletesOn = invoiceDeletionDate(row.billing_period);
      return deletesOn && today >= deletesOn;
    })
    .map((row) => row.id);

  if (!expiredIds.length) return 0;

  for (const id of expiredIds) {
    await db.prepare(`DELETE FROM invoices WHERE id = ?`).run(id);
  }
  return expiredIds.length;
}
