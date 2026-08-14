import './time.js';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { SQL_NOW_IST } from './sqlDialect.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '..', 'data', 'leave.db');

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('user', 'manager', 'hr')) DEFAULT 'user',
    manager_id INTEGER REFERENCES users(id),
    employee_number TEXT UNIQUE,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (${SQL_NOW_IST})
  );

  CREATE TABLE IF NOT EXISTS leave_balances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    casual REAL NOT NULL DEFAULT 0,
    earned REAL NOT NULL DEFAULT 0,
    sick REAL NOT NULL DEFAULT 0,
    compensation REAL NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (${SQL_NOW_IST})
  );

  CREATE TABLE IF NOT EXISTS leave_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    leave_type TEXT NOT NULL CHECK(leave_type IN ('casual', 'earned', 'sick', 'compensation', 'wfh')),
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    days REAL NOT NULL,
    session TEXT NOT NULL CHECK(session IN ('full', 'morning', 'afternoon')) DEFAULT 'full',
    reason TEXT,
    status TEXT NOT NULL CHECK(status IN (
      'pending_manager', 'pending_hr', 'approved', 'rejected', 'cancelled'
    )) DEFAULT 'pending_manager',
    manager_note TEXT,
    manager_id INTEGER REFERENCES users(id),
    manager_reviewed_at TEXT,
    hr_note TEXT,
    hr_id INTEGER REFERENCES users(id),
    hr_reviewed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (${SQL_NOW_IST}),
    updated_at TEXT NOT NULL DEFAULT (${SQL_NOW_IST})
  );

  CREATE TABLE IF NOT EXISTS balance_credits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    leave_type TEXT NOT NULL CHECK(leave_type IN ('casual', 'earned', 'sick', 'compensation')),
    amount REAL NOT NULL,
    note TEXT,
    credited_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (${SQL_NOW_IST})
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    leave_id INTEGER REFERENCES leave_requests(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (${SQL_NOW_IST})
  );

  CREATE TABLE IF NOT EXISTS app_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

migrateUsersTable();
migrateEmployeeNumberColumn();
migrateLeaveRequestsTable();
migrateLeaveSessionColumn();
migrateCompensationLeave();
migrateEmployeeRatingsTable();
migrateEmployeeRatingsScale();
migrateEmployeeRatingsUniquePeriod();
migrateTimestampsToIst();
migrateInvoicesTable();
migrateInvoiceSubmitterDeleted();
migrateEmployeeProfilesTable();
migrateEmployeeAssetsTable();
migrateMandatoryLeavesTable();

function migrateInvoiceSubmitterDeleted() {
  const cols = db.prepare(`PRAGMA table_info(invoices)`).all();
  if (!cols.some((c) => c.name === 'submitter_deleted_at')) {
    db.exec(`ALTER TABLE invoices ADD COLUMN submitter_deleted_at TEXT`);
  }
  db.exec(`
    DROP INDEX IF EXISTS idx_invoices_user_number;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_user_number
      ON invoices(user_id, invoice_number)
      WHERE submitter_deleted_at IS NULL;
  `);
}

function migrateUsersTable() {
  const cols = db.prepare(`PRAGMA table_info(users)`).all();
  const names = cols.map((c) => c.name);
  const sql = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='users'`)
    .get()?.sql;

  if (sql && sql.includes("'admin'")) {
    db.exec(`
      PRAGMA foreign_keys = OFF;
      BEGIN;
      CREATE TABLE users_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user', 'manager', 'hr')) DEFAULT 'user',
        manager_id INTEGER REFERENCES users_new(id),
        employee_number TEXT UNIQUE,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (${SQL_NOW_IST})
      );
      INSERT INTO users_new (id, name, email, password_hash, role, manager_id, active, created_at)
      SELECT id, name, email, password_hash,
             CASE WHEN role = 'admin' THEN 'hr' ELSE role END,
             NULL, active, created_at
      FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
      COMMIT;
      PRAGMA foreign_keys = ON;
    `);
    return;
  }

  if (!names.includes('manager_id')) {
    db.exec(`ALTER TABLE users ADD COLUMN manager_id INTEGER REFERENCES users(id)`);
  }
}

function migrateEmployeeNumberColumn() {
  const cols = db.prepare(`PRAGMA table_info(users)`).all();
  if (!cols.some((c) => c.name === 'employee_number')) {
    db.exec(`ALTER TABLE users ADD COLUMN employee_number TEXT`);
    db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_employee_number
       ON users(employee_number)
       WHERE employee_number IS NOT NULL`
    );
  }
}

function migrateLeaveRequestsTable() {
  const sql = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='leave_requests'`)
    .get()?.sql;
  if (!sql) return;
  if (sql.includes('pending_manager') && sql.includes('manager_note')) return;

  db.exec(`
    PRAGMA foreign_keys = OFF;
    BEGIN;
    CREATE TABLE leave_requests_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      leave_type TEXT NOT NULL CHECK(leave_type IN ('casual', 'earned', 'sick', 'wfh')),
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      days REAL NOT NULL,
      reason TEXT,
      status TEXT NOT NULL CHECK(status IN (
        'pending_manager', 'pending_hr', 'approved', 'rejected', 'cancelled'
      )) DEFAULT 'pending_manager',
      manager_note TEXT,
      manager_id INTEGER REFERENCES users(id),
      manager_reviewed_at TEXT,
      hr_note TEXT,
      hr_id INTEGER REFERENCES users(id),
      hr_reviewed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (${SQL_NOW_IST}),
      updated_at TEXT NOT NULL DEFAULT (${SQL_NOW_IST})
    );
    INSERT INTO leave_requests_new (
      id, user_id, leave_type, start_date, end_date, days, reason, status,
      manager_note, manager_id, manager_reviewed_at, hr_note, hr_id, hr_reviewed_at,
      created_at, updated_at
    )
    SELECT
      id, user_id, leave_type, start_date, end_date, days, reason,
      CASE
        WHEN status = 'pending' THEN 'pending_manager'
        ELSE status
      END,
      NULL,
      NULL,
      NULL,
      admin_note,
      reviewed_by,
      reviewed_at,
      created_at,
      updated_at
    FROM leave_requests;
    DROP TABLE leave_requests;
    ALTER TABLE leave_requests_new RENAME TO leave_requests;
    COMMIT;
    PRAGMA foreign_keys = ON;
  `);
}

function migrateLeaveSessionColumn() {
  const cols = db.prepare(`PRAGMA table_info(leave_requests)`).all();
  if (!cols.some((c) => c.name === 'session')) {
    db.exec(
      `ALTER TABLE leave_requests ADD COLUMN session TEXT NOT NULL DEFAULT 'full'`
    );
  }
}

function migrateCompensationLeave() {
  const balCols = db.prepare(`PRAGMA table_info(leave_balances)`).all().map((c) => c.name);
  if (!balCols.includes('compensation')) {
    db.exec(
      `ALTER TABLE leave_balances ADD COLUMN compensation REAL NOT NULL DEFAULT 0`
    );
  }

  const leaveSql = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='leave_requests'`)
    .get()?.sql;
  if (leaveSql && !leaveSql.includes("'compensation'")) {
    db.exec(`
      PRAGMA foreign_keys = OFF;
      BEGIN;
      CREATE TABLE leave_requests_comp (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        leave_type TEXT NOT NULL CHECK(leave_type IN ('casual', 'earned', 'sick', 'compensation', 'wfh')),
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        days REAL NOT NULL,
        session TEXT NOT NULL CHECK(session IN ('full', 'morning', 'afternoon')) DEFAULT 'full',
        reason TEXT,
        status TEXT NOT NULL CHECK(status IN (
          'pending_manager', 'pending_hr', 'approved', 'rejected', 'cancelled'
        )) DEFAULT 'pending_manager',
        manager_note TEXT,
        manager_id INTEGER REFERENCES users(id),
        manager_reviewed_at TEXT,
        hr_note TEXT,
        hr_id INTEGER REFERENCES users(id),
        hr_reviewed_at TEXT,
        created_at TEXT NOT NULL DEFAULT (${SQL_NOW_IST}),
        updated_at TEXT NOT NULL DEFAULT (${SQL_NOW_IST})
      );
      INSERT INTO leave_requests_comp (
        id, user_id, leave_type, start_date, end_date, days, session, reason, status,
        manager_note, manager_id, manager_reviewed_at, hr_note, hr_id, hr_reviewed_at,
        created_at, updated_at
      )
      SELECT
        id, user_id, leave_type, start_date, end_date, days, COALESCE(session, 'full'), reason, status,
        manager_note, manager_id, manager_reviewed_at, hr_note, hr_id, hr_reviewed_at,
        created_at, updated_at
      FROM leave_requests;
      DROP TABLE leave_requests;
      ALTER TABLE leave_requests_comp RENAME TO leave_requests;
      COMMIT;
      PRAGMA foreign_keys = ON;
    `);
  }

  const creditSql = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='balance_credits'`)
    .get()?.sql;
  if (creditSql && !creditSql.includes("'compensation'")) {
    db.exec(`
      PRAGMA foreign_keys = OFF;
      BEGIN;
      CREATE TABLE balance_credits_comp (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        leave_type TEXT NOT NULL CHECK(leave_type IN ('casual', 'earned', 'sick', 'compensation')),
        amount REAL NOT NULL,
        note TEXT,
        credited_by INTEGER NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (${SQL_NOW_IST})
      );
      INSERT INTO balance_credits_comp (id, user_id, leave_type, amount, note, credited_by, created_at)
      SELECT id, user_id, leave_type, amount, note, credited_by, created_at FROM balance_credits;
      DROP TABLE balance_credits;
      ALTER TABLE balance_credits_comp RENAME TO balance_credits;
      COMMIT;
      PRAGMA foreign_keys = ON;
    `);
  }
}

function migrateEmployeeRatingsTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS employee_ratings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      manager_id INTEGER NOT NULL REFERENCES users(id),
      score REAL NOT NULL CHECK(score >= 1 AND score <= 10),
      feedback TEXT NOT NULL,
      period_label TEXT,
      created_at TEXT NOT NULL DEFAULT (${SQL_NOW_IST}),
      updated_at TEXT NOT NULL DEFAULT (${SQL_NOW_IST})
    );
    CREATE INDEX IF NOT EXISTS idx_employee_ratings_user ON employee_ratings(user_id);
    CREATE INDEX IF NOT EXISTS idx_employee_ratings_manager ON employee_ratings(manager_id);
    CREATE INDEX IF NOT EXISTS idx_employee_ratings_created ON employee_ratings(created_at);
  `);
}

/** Expand score scale from 1–5 to 1–10 on existing databases. */
function migrateEmployeeRatingsScale() {
  const row = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='employee_ratings'`)
    .get();
  if (!row?.sql || row.sql.includes('<= 10')) return;

  db.exec(`
    PRAGMA foreign_keys = OFF;
    BEGIN;
    CREATE TABLE employee_ratings_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      manager_id INTEGER NOT NULL REFERENCES users(id),
      score REAL NOT NULL CHECK(score >= 1 AND score <= 10),
      feedback TEXT NOT NULL,
      period_label TEXT,
      created_at TEXT NOT NULL DEFAULT (${SQL_NOW_IST}),
      updated_at TEXT NOT NULL DEFAULT (${SQL_NOW_IST})
    );
    INSERT INTO employee_ratings_new
      (id, user_id, manager_id, score, feedback, period_label, created_at, updated_at)
    SELECT id, user_id, manager_id, score, feedback, period_label, created_at, updated_at
    FROM employee_ratings;
    DROP TABLE employee_ratings;
    ALTER TABLE employee_ratings_new RENAME TO employee_ratings;
    CREATE INDEX IF NOT EXISTS idx_employee_ratings_user ON employee_ratings(user_id);
    CREATE INDEX IF NOT EXISTS idx_employee_ratings_manager ON employee_ratings(manager_id);
    CREATE INDEX IF NOT EXISTS idx_employee_ratings_created ON employee_ratings(created_at);
    COMMIT;
    PRAGMA foreign_keys = ON;
  `);
}

function migrateEmployeeRatingsUniquePeriod() {
  const indexExists = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='index' AND name='idx_employee_ratings_user_period'`
    )
    .get();
  if (indexExists) return;

  db.exec(`
    DELETE FROM employee_ratings
    WHERE period_label IS NOT NULL
      AND id NOT IN (
        SELECT MAX(id)
        FROM employee_ratings
        WHERE period_label IS NOT NULL
        GROUP BY user_id, period_label
      )
  `);

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_ratings_user_period
    ON employee_ratings(user_id, period_label)
    WHERE period_label IS NOT NULL
  `);
}

/** One-time: prior writes used UTC via datetime('now'); shift to IST. */
function migrateTimestampsToIst() {
  const flag = db.prepare(`SELECT value FROM app_meta WHERE key = 'timestamps_tz'`).get();
  if (flag?.value === 'IST') return;

  db.exec('BEGIN');
  try {
    db.prepare(
      `UPDATE users
       SET created_at = datetime(created_at, '+5 hours', '30 minutes')
       WHERE created_at IS NOT NULL AND length(created_at) >= 19`
    ).run();

    db.prepare(
      `UPDATE leave_balances
       SET updated_at = datetime(updated_at, '+5 hours', '30 minutes')
       WHERE updated_at IS NOT NULL AND length(updated_at) >= 19`
    ).run();

    db.prepare(
      `UPDATE leave_requests
       SET created_at = CASE
             WHEN created_at IS NOT NULL AND length(created_at) >= 19
             THEN datetime(created_at, '+5 hours', '30 minutes') ELSE created_at END,
           updated_at = CASE
             WHEN updated_at IS NOT NULL AND length(updated_at) >= 19
             THEN datetime(updated_at, '+5 hours', '30 minutes') ELSE updated_at END,
           manager_reviewed_at = CASE
             WHEN manager_reviewed_at IS NOT NULL AND length(manager_reviewed_at) >= 19
             THEN datetime(manager_reviewed_at, '+5 hours', '30 minutes') ELSE manager_reviewed_at END,
           hr_reviewed_at = CASE
             WHEN hr_reviewed_at IS NOT NULL AND length(hr_reviewed_at) >= 19
             THEN datetime(hr_reviewed_at, '+5 hours', '30 minutes') ELSE hr_reviewed_at END`
    ).run();

    db.prepare(
      `UPDATE balance_credits
       SET created_at = datetime(created_at, '+5 hours', '30 minutes')
       WHERE created_at IS NOT NULL AND length(created_at) >= 19`
    ).run();

    db.prepare(
      `UPDATE notifications
       SET created_at = datetime(created_at, '+5 hours', '30 minutes')
       WHERE created_at IS NOT NULL AND length(created_at) >= 19`
    ).run();

    db.prepare(
      `INSERT INTO app_meta (key, value) VALUES ('timestamps_tz', 'IST')
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run();

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function migrateInvoicesTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      invoice_number TEXT NOT NULL,
      invoice_date TEXT NOT NULL,
      billing_period TEXT NOT NULL,
      consultant TEXT NOT NULL,
      total_amount REAL NOT NULL DEFAULT 0,
      data_json TEXT NOT NULL,
      pdf_data TEXT,
      submitter_deleted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (${SQL_NOW_IST})
    );
    DROP INDEX IF EXISTS idx_invoices_user_number;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_user_number
      ON invoices(user_id, invoice_number)
      WHERE submitter_deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_invoices_billing_period ON invoices(billing_period);
    CREATE INDEX IF NOT EXISTS idx_invoices_user ON invoices(user_id);
  `);
}

function migrateEmployeeProfilesTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS employee_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      profile_photo TEXT,
      date_of_birth TEXT,
      gender TEXT,
      personal_email TEXT,
      personal_mobile TEXT,
      address TEXT,
      emergency_contact TEXT,
      nationality TEXT,
      marital_status TEXT,
      date_of_joining TEXT,
      employment_type TEXT,
      department TEXT,
      designation TEXT,
      job_level TEXT,
      location TEXT,
      work_mode TEXT,
      employment_status TEXT NOT NULL DEFAULT 'active',
      probation_period TEXT,
      confirmation_date TEXT,
      employee_category TEXT,
      laptop_desktop_assigned TEXT,
      asset_id TEXT,
      company_mobile TEXT,
      access_card TEXT,
      equipment_issue_date TEXT,
      equipment_return_date TEXT,
      software_access_provisioning TEXT,
      company_email_account TEXT,
      basic_salary REAL,
      hra REAL,
      allowances REAL,
      variable_pay REAL,
      bonuses REAL,
      deductions REAL,
      pf_epf_details TEXT,
      professional_tax REAL,
      tds REAL,
      net_salary REAL,
      salary_history TEXT,
      payslips TEXT,
      bank_account_details TEXT,
      created_at TEXT NOT NULL DEFAULT (${SQL_NOW_IST}),
      updated_at TEXT NOT NULL DEFAULT (${SQL_NOW_IST})
    );
    CREATE INDEX IF NOT EXISTS idx_employee_profiles_user ON employee_profiles(user_id);
  `);

  const cols = db.prepare(`PRAGMA table_info(employee_profiles)`).all().map((c) => c.name);
  const extras = [
    ['laptop_desktop_assigned', 'TEXT'],
    ['asset_id', 'TEXT'],
    ['company_mobile', 'TEXT'],
    ['access_card', 'TEXT'],
    ['equipment_issue_date', 'TEXT'],
    ['equipment_return_date', 'TEXT'],
    ['software_access_provisioning', 'TEXT'],
    ['company_email_account', 'TEXT'],
    ['basic_salary', 'REAL'],
    ['hra', 'REAL'],
    ['allowances', 'REAL'],
    ['variable_pay', 'REAL'],
    ['bonuses', 'REAL'],
    ['deductions', 'REAL'],
    ['pf_epf_details', 'TEXT'],
    ['professional_tax', 'REAL'],
    ['tds', 'REAL'],
    ['net_salary', 'REAL'],
    ['salary_history', 'TEXT'],
    ['payslips', 'TEXT'],
    ['bank_account_details', 'TEXT'],
    ['stipend', 'REAL'],
    ['fixed_pay', 'REAL'],
    ['joining_bonus', 'REAL'],
    ['retention_bonus', 'REAL'],
    ['esops', 'TEXT'],
    ['bonus_amount', 'REAL'],
    ['bonus_frequency', 'TEXT'],
  ];
  for (const [name, type] of extras) {
    if (!cols.includes(name)) {
      db.exec(`ALTER TABLE employee_profiles ADD COLUMN ${name} ${type}`);
    }
  }
}

function migrateEmployeeAssetsTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS employee_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      asset_category TEXT NOT NULL DEFAULT 'other',
      device_assigned TEXT,
      asset_id TEXT,
      mobile_number TEXT,
      access_card TEXT,
      issue_date TEXT,
      return_date TEXT,
      software_access TEXT,
      company_email TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (${SQL_NOW_IST})
    );
    CREATE INDEX IF NOT EXISTS idx_employee_assets_user ON employee_assets(user_id);
  `);

  // One-time migrate legacy single IT columns → employee_assets
  const existing = db.prepare(`SELECT COUNT(*) AS c FROM employee_assets`).get()?.c || 0;
  if (Number(existing) === 0) {
    const legacy = db
      .prepare(
        `SELECT user_id, laptop_desktop_assigned, asset_id, company_mobile, access_card,
                equipment_issue_date, equipment_return_date, software_access_provisioning,
                company_email_account
         FROM employee_profiles
         WHERE COALESCE(laptop_desktop_assigned, asset_id, company_mobile, access_card,
                        equipment_issue_date, equipment_return_date,
                        software_access_provisioning, company_email_account) IS NOT NULL`
      )
      .all();
    const insert = db.prepare(
      `INSERT INTO employee_assets (
         user_id, asset_category, device_assigned, asset_id, mobile_number, access_card,
         issue_date, return_date, software_access, company_email, sort_order
       ) VALUES (?, 'laptop_desktop', ?, ?, ?, ?, ?, ?, ?, ?, 0)`
    );
    for (const row of legacy) {
      insert.run(
        row.user_id,
        row.laptop_desktop_assigned || null,
        row.asset_id || null,
        row.company_mobile || null,
        row.access_card || null,
        row.equipment_issue_date || null,
        row.equipment_return_date || null,
        row.software_access_provisioning || null,
        row.company_email_account || null
      );
    }
  }
}

function migrateMandatoryLeavesTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mandatory_leaves (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      note TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (${SQL_NOW_IST})
    );
    CREATE INDEX IF NOT EXISTS idx_mandatory_leaves_dates
      ON mandatory_leaves(start_date, end_date);
  `);
}

export default db;
