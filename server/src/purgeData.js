import './time.js';
import 'dotenv/config';
import db from './db.js';
import { isPostgres } from './sqlDialect.js';

if (!process.argv.includes('--confirm')) {
  console.error('This permanently deletes production data. Re-run with: node src/purgeData.js --confirm');
  process.exit(1);
}

await db.ready;

const hrUsers = await db
  .prepare(`SELECT id, email, name FROM users WHERE role = 'hr' ORDER BY id`)
  .all();

if (!hrUsers.length) {
  console.error('No HR user found — aborting so credentials are not lost.');
  process.exit(1);
}

console.log(`Database: ${db.dialect}`);
console.log('Keeping HR accounts:');
for (const u of hrUsers) {
  console.log(`  • ${u.email} (${u.name}, id ${u.id})`);
}

async function count(table) {
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get();
  return Number(row?.n ?? 0);
}

async function countIfExists(table) {
  try {
    return await count(table);
  } catch {
    return 0;
  }
}

const before = {
  users: await count('users'),
  invoices: await countIfExists('invoices'),
  leave_requests: await countIfExists('leave_requests'),
  employee_ratings: await countIfExists('employee_ratings'),
  employee_profiles: await countIfExists('employee_profiles'),
  mandatory_leaves: await countIfExists('mandatory_leaves'),
};

console.log('\nBefore:', before);

async function deleteAll(table) {
  try {
    await db.exec(`DELETE FROM ${table}`);
  } catch (err) {
    if (!/does not exist|no such table/i.test(err.message || '')) throw err;
  }
}

await db.transaction(async () => {
  await deleteAll('invoices');
  await deleteAll('employee_ratings');
  await deleteAll('notifications');
  await deleteAll('balance_credits');
  await deleteAll('leave_requests');
  await deleteAll('employee_assets');
  await deleteAll('employee_profiles');
  await deleteAll('mandatory_leaves');
  await deleteAll('leave_balances');
  await db.exec(`DELETE FROM users WHERE role != 'hr'`);
});

const after = {
  users: await count('users'),
  invoices: await countIfExists('invoices'),
  leave_requests: await countIfExists('leave_requests'),
  employee_ratings: await countIfExists('employee_ratings'),
  employee_profiles: await countIfExists('employee_profiles'),
  mandatory_leaves: await countIfExists('mandatory_leaves'),
};

console.log('\nAfter:', after);
console.log('\nDone — all data cleared except HR login(s).');

if (isPostgres) {
  process.exit(0);
}
