import './time.js';
import 'dotenv/config';
import db from './db.js';
import { hashPassword } from './auth.js';
import { isPostgres } from './sqlDialect.js';

const HR_EMAIL = 'hr@ultrix.co';

await db.ready;

if (isPostgres) {
  const existing = await db
    .prepare(`SELECT id, email FROM users WHERE email = ? OR email = ?`)
    .get(HR_EMAIL, 'hr@ultrix.com');
  if (existing?.email === HR_EMAIL) {
    console.log('Supabase already has HR user — skipping seed.');
    process.exit(0);
  }
  if (existing) {
    await db.prepare(`UPDATE users SET email = ? WHERE id = ?`).run(HR_EMAIL, existing.id);
    console.log(`Updated HR email to ${HR_EMAIL}`);
    process.exit(0);
  }
} else {
  await db.exec(`
    DELETE FROM notifications;
    DELETE FROM balance_credits;
    DELETE FROM leave_requests;
    DELETE FROM leave_balances;
    DELETE FROM users;
  `);
}

const insertUser = db.prepare(
  `INSERT INTO users (name, email, password_hash, role, manager_id)
   VALUES (?, ?, ?, ?, ?)`
);
const insertBal = db.prepare(
  `INSERT INTO leave_balances (user_id, casual, earned, sick, restricted) VALUES (?, ?, ?, ?, ?)`
);

await db.transaction(async () => {
  const hr = await insertUser.run(
    'Portal HR',
    HR_EMAIL,
    hashPassword('hr123'),
    'hr',
    null
  );
  await insertBal.run(hr.lastInsertRowid, 0, 0, 0, 2);
});

console.log('Database ready — HR login:');
console.log(`  HR: ${HR_EMAIL}`);
