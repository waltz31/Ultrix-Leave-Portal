import './time.js';
import 'dotenv/config';
import db from './db.js';
import { hashPassword } from './auth.js';
import { isPostgres } from './sqlDialect.js';

await db.ready;

if (isPostgres) {
  const existing = await db
    .prepare(`SELECT id FROM users WHERE email = ?`)
    .get('hr@ultrix.com');
  if (existing) {
    console.log('Supabase already has HR user — skipping seed.');
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
  `INSERT INTO leave_balances (user_id, casual, earned, sick) VALUES (?, ?, ?, ?)`
);

await db.transaction(async () => {
  const hr = await insertUser.run(
    'Portal HR',
    'hr@ultrix.com',
    hashPassword('hr123'),
    'hr',
    null
  );
  await insertBal.run(hr.lastInsertRowid, 0, 0, 0);
});

console.log('Database ready — HR login:');
console.log('  HR: hr@ultrix.com / hr123');
