import crypto from 'crypto';
import { Router } from 'express';
import db from './db.js';
import {
  authRequired,
  hrRequired,
  managerRequired,
  managerOrHrRequired,
  hashPassword,
  verifyPassword,
  signToken,
} from './auth.js';
import {
  countLeaveDays,
  countWeekdays,
  REQUEST_TYPES,
  isBalanceType,
  publicUser,
  mapLeave,
  mapMandatoryLeave,
  mapBalance,
  LEAVE_SELECT,
  LEAVE_TYPES,
  SESSIONS,
  sessionsOverlap,
  eachCalendarDay,
  contiguousRanges,
} from './leaveUtils.js';
import { notifyLeaveApplied } from './slack.js';
import { LeaveReviewError, reviewLeaveRequest } from './leaveReview.js';
import {
  mailLeaveApplied,
  mailCancelled,
} from './mail.js';
import { todayIst } from './time.js';
import { SQL_NOW_IST, SQL_TODAY_IST, isUniqueViolation } from './sqlDialect.js';
import { mapRating, RATING_SELECT } from './ratingUtils.js';
import { mapInvoice, validateInvoicePayload, INVOICE_SELECT, INVOICE_RETENTION_NOTICE } from './invoiceUtils.js';
import { purgeExpiredInvoices } from './invoiceCleanup.js';
import {
  EMPLOYMENT_TYPES,
  WORK_MODES,
  EMPLOYMENT_STATUSES,
  GENDERS,
  MARITAL_STATUSES,
  activeFromEmploymentStatus,
  mapEmployeeProfile,
  mapAsset,
  normalizeOptional,
  normalizeEnum,
  normalizeDate,
  normalizeProfilePhoto,
  parsePayrollFields,
  parseItPayrollForCreate,
  parseAssetsList,
  payStructureKind,
  applyPayStructure,
} from './employeeProfileUtils.js';

const router = Router();

async function getRatingById(id) {
  return await db.prepare(`${RATING_SELECT} WHERE er.id = ?`).get(id);
}

async function getBalance(userId) {
  return (
    (await db.prepare('SELECT * FROM leave_balances WHERE user_id = ?').get(userId)) || {
      casual: 0,
      earned: 0,
      sick: 0,
      compensation: 0,
    }
  );
}

async function ensureBalanceRow(userId) {
  await db.prepare(
    `INSERT INTO leave_balances (user_id, casual, earned, sick, compensation)
     VALUES (?, 0, 0, 0, 0)
     ON CONFLICT(user_id) DO NOTHING`
  ).run(userId);
}

async function getLeaveById(id) {
  return await db.prepare(`${LEAVE_SELECT} WHERE lr.id = ?`).get(id);
}

async function notifyUser({ userId, leaveId, type, title, message }) {
  if (!userId) return;
  await db.prepare(
    `INSERT INTO notifications (user_id, leave_id, type, title, message)
     VALUES (?, ?, ?, ?, ?)`
  ).run(userId, leaveId ?? null, type, title, message);
}

async function notifyMany(userIds, payload) {
  const unique = [...new Set(userIds.filter(Boolean))];
  for (const userId of unique) {
    await notifyUser({ ...payload, userId });
  }
}

async function getHrIds() {
  return (await db
    .prepare(`SELECT id FROM users WHERE role = 'hr' AND active = 1`)
    .all())
    .map((r) => r.id);
}

function leaveLabel(type) {
  if (type === 'wfh') return 'Work from Home';
  if (type === 'casual') return 'Casual Leave';
  if (type === 'earned') return 'Earned Leave';
  if (type === 'sick') return 'Sick Leave';
  if (type === 'compensation') return 'Compensation Leave';
  return `${type} leave`;
}

async function publicUserWithPhoto(user) {
  if (!user) return null;
  const row = await db
    .prepare(`SELECT profile_photo FROM employee_profiles WHERE user_id = ?`)
    .get(user.id);
  return publicUser({ ...user, profile_photo: row?.profile_photo || null });
}

// ——— Auth ———
router.post('/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  const user = await db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  const isActive = user.active === true || user.active === 1 || user.active === '1';
  if (!isActive) {
    return res.status(401).json({ error: 'Account is inactive. Ask HR to activate it.' });
  }
  if (!user.password_hash || !verifyPassword(String(password), user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  res.json({ token: signToken(user), user: await publicUserWithPhoto(user) });
});

router.get('/auth/me', authRequired, async (req, res) => {
  res.json({ user: await publicUserWithPhoto(req.user) });
});

router.patch('/auth/password', authRequired, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new password are required' });
  }
  if (String(newPassword).length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!verifyPassword(currentPassword, user.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  await db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(
    hashPassword(newPassword),
    user.id
  );
  res.json({ ok: true });
});

router.patch('/auth/profile', authRequired, hrRequired, async (req, res) => {
  const { name } = req.body || {};
  const nextName = String(name || '').trim();
  if (!nextName || nextName.length < 2) {
    return res.status(400).json({ error: 'Name must be at least 2 characters' });
  }
  if (nextName.length > 80) {
    return res.status(400).json({ error: 'Name is too long' });
  }
  await db.prepare(`UPDATE users SET name = ? WHERE id = ?`).run(nextName, req.user.id);
  const updated = await db.prepare(`SELECT * FROM users WHERE id = ?`).get(req.user.id);
  res.json({ user: await publicUserWithPhoto(updated) });
});

// ——— Directory helpers ———
router.get('/managers', authRequired, hrRequired, async (_req, res) => {
  const managers = (await db
    .prepare(
      `SELECT id, name, email, role, active, created_at
       FROM users WHERE role = 'manager' ORDER BY name COLLATE NOCASE`
    )
    .all())
    .map(publicUser);
  res.json({ managers });
});

// ——— Users (HR) ———
router.get('/users', authRequired, managerOrHrRequired, async (req, res) => {
  if (req.user.role === 'manager') {
    const users = (await db
      .prepare(
        `SELECT u.*, b.casual, b.earned, b.sick, b.compensation, m.name AS manager_name,
                COALESCE((
                  SELECT SUM(lr.days) FROM leave_requests lr
                  WHERE lr.user_id = u.id AND lr.status = 'approved' AND lr.leave_type = 'wfh'
                ), 0) AS wfh_days
         FROM users u
         LEFT JOIN leave_balances b ON b.user_id = u.id
         LEFT JOIN users m ON m.id = u.manager_id
         WHERE u.role = 'user' AND u.manager_id = ?
         ORDER BY u.name COLLATE NOCASE`
      )
      .all(req.user.id))
      .map((row) => ({
        ...publicUser(row),
        balances: mapBalance(row),
        wfhDays: row.wfh_days || 0,
      }));
    return res.json({ users });
  }

  const users = (await db
    .prepare(
      `SELECT u.*, b.casual, b.earned, b.sick, b.compensation, m.name AS manager_name,
              COALESCE((
                SELECT SUM(lr.days) FROM leave_requests lr
                WHERE lr.user_id = u.id AND lr.status = 'approved' AND lr.leave_type = 'wfh'
              ), 0) AS wfh_days
       FROM users u
       LEFT JOIN leave_balances b ON b.user_id = u.id
       LEFT JOIN users m ON m.id = u.manager_id
       WHERE u.role = 'user'
       ORDER BY u.name COLLATE NOCASE`
    )
    .all())
    .map((row) => ({
      ...publicUser(row),
      balances: mapBalance(row),
      wfhDays: row.wfh_days || 0,
    }));
  res.json({ users });
});

router.post('/users', authRequired, hrRequired, async (req, res) => {
  const { name, email, password, role = 'manager', managerId, employeeNumber } = req.body || {};
  if (!name?.trim() || !email?.trim() || !password || password.length < 6) {
    return res.status(400).json({
      error: 'Name, email, and password (min 6 chars) are required',
    });
  }
  if (role !== 'manager') {
    return res.status(400).json({
      error: 'Employees must be created from Onboarding. Use this endpoint for managers only.',
    });
  }

  try {
    const result = await db
      .prepare(
        `INSERT INTO users (name, email, password_hash, role, manager_id, employee_number)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        name.trim(),
        email.toLowerCase().trim(),
        hashPassword(password),
        'manager',
        null,
        String(employeeNumber || '').trim() || null
      );
    await ensureBalanceRow(result.lastInsertRowid);
    await ensureEmployeeProfile(result.lastInsertRowid);
    const user = await db
      .prepare(
        `SELECT u.*, m.name AS manager_name FROM users u
         LEFT JOIN users m ON m.id = u.manager_id WHERE u.id = ?`
      )
      .get(result.lastInsertRowid);
    res.status(201).json({ user: publicUser(user) });
  } catch (err) {
    if (String(err.message).includes('UNIQUE') || isUniqueViolation(err)) {
      const msg = String(err.message).toLowerCase();
      if (msg.includes('employee_number') || msg.includes('idx_users_employee_number')) {
        return res.status(409).json({ error: 'Employee number already exists' });
      }
      return res.status(409).json({ error: 'Email already exists' });
    }
    throw err;
  }
});

// ——— Employee onboarding (HR) ———
const PROFILE_SELECT = `
  SELECT ep.id AS profile_id, ep.*,
         u.id AS user_id, u.name, u.email, u.role, u.manager_id, u.employee_number,
         u.active, u.created_at AS user_created_at,
         m.name AS manager_name
  FROM employee_profiles ep
  JOIN users u ON u.id = ep.user_id
  LEFT JOIN users m ON m.id = u.manager_id
`;

async function loadAssetsByUserIds(userIds) {
  const ids = [...new Set(userIds.filter(Boolean).map(Number))];
  const byUser = new Map();
  if (!ids.length) return byUser;
  const placeholders = ids.map(() => '?').join(',');
  const rows = await db
    .prepare(
      `SELECT * FROM employee_assets
       WHERE user_id IN (${placeholders})
       ORDER BY sort_order ASC, id ASC`
    )
    .all(...ids);
  for (const row of rows) {
    const list = byUser.get(row.user_id) || [];
    list.push(mapAsset(row));
    byUser.set(row.user_id, list);
  }
  return byUser;
}

function mapProfileWithAssets(row, assetsByUser, options = {}) {
  const assets = assetsByUser.get(row.user_id) || [];
  return mapEmployeeProfile(row, { ...options, assets });
}

async function replaceUserAssets(userId, assets) {
  await db.prepare(`DELETE FROM employee_assets WHERE user_id = ?`).run(userId);
  for (const asset of assets) {
    await db
      .prepare(
        `INSERT INTO employee_assets (
           user_id, asset_category, device_assigned, asset_id, mobile_number, access_card,
           issue_date, return_date, software_access, company_email, sort_order
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        userId,
        asset.assetCategory,
        asset.deviceAssigned,
        asset.assetId,
        asset.mobileNumber,
        asset.accessCard,
        asset.issueDate,
        asset.returnDate,
        asset.softwareAccess,
        asset.companyEmail,
        asset.sortOrder
      );
  }
}

/** Ensures a blank employee_profiles row exists (e.g. for managers' own salary). */
async function ensureEmployeeProfile(userId) {
  const existing = await db
    .prepare(`SELECT id FROM employee_profiles WHERE user_id = ?`)
    .get(userId);
  if (existing) return existing.id;
  const result = await db
    .prepare(
      `INSERT INTO employee_profiles (user_id, employment_status) VALUES (?, 'active')`
    )
    .run(userId);
  return result.lastInsertRowid;
}

async function ensureManagerProfiles() {
  const managers = await db
    .prepare(`SELECT id FROM users WHERE role = 'manager'`)
    .all();
  for (const mgr of managers) {
    await ensureEmployeeProfile(mgr.id);
  }
}

router.get('/onboarding', authRequired, hrRequired, async (_req, res) => {
  await ensureManagerProfiles();
  const rows = await db
    .prepare(
      `${PROFILE_SELECT} WHERE u.role IN ('user', 'manager') ORDER BY u.role COLLATE NOCASE, u.name COLLATE NOCASE`
    )
    .all();
  const assetsByUser = await loadAssetsByUserIds(rows.map((r) => r.user_id));
  res.json({
    profiles: rows.map((row) => mapProfileWithAssets(row, assetsByUser)),
  });
});

router.get('/onboarding/:userId', authRequired, hrRequired, async (req, res) => {
  const userId = Number(req.params.userId);
  const row = await db.prepare(`${PROFILE_SELECT} WHERE ep.user_id = ?`).get(userId);
  if (!row) return res.status(404).json({ error: 'Employee profile not found' });
  const assetsByUser = await loadAssetsByUserIds([userId]);
  res.json({ profile: mapProfileWithAssets(row, assetsByUser) });
});

router.post('/onboarding', authRequired, hrRequired, async (req, res) => {
  const body = req.body || {};
  const name = String(body.name || '').trim() || 'New employee';
  const emailProvided = Boolean(String(body.email || '').trim());
  const email =
    String(body.email || '').trim().toLowerCase() ||
    `pending.${Date.now()}.${crypto.randomBytes(3).toString('hex')}@ultrix.local`;

  const rawPassword = body.password == null ? '' : String(body.password);
  const passwordProvided = Boolean(rawPassword.trim());
  if (passwordProvided && rawPassword.length < 6) {
    return res.status(400).json({ error: 'Temporary password must be at least 6 characters' });
  }
  const password = passwordProvided ? rawPassword : crypto.randomBytes(9).toString('base64url');
  const employeeNumber = String(body.employeeNumber || body.employeeId || '').trim() || null;
  const managerId = body.managerId;

  if (employeeNumber && employeeNumber.length > 40) {
    return res.status(400).json({ error: 'Employee ID is too long' });
  }

  let nextManagerId = null;
  if (managerId !== undefined && managerId !== null && managerId !== '') {
    const mgr = await db
      .prepare(`SELECT id FROM users WHERE id = ? AND role = 'manager' AND active = 1`)
      .get(Number(managerId));
    if (!mgr) return res.status(400).json({ error: 'Invalid reporting manager' });
    nextManagerId = mgr.id;
  }

  let personal;
  let employment;
  let assets;
  let payroll;
  try {
    personal = {
      profilePhoto: normalizeProfilePhoto(body.profilePhoto),
      dateOfBirth: normalizeDate(body.dateOfBirth, 'Date of birth'),
      gender: normalizeEnum(body.gender, GENDERS, 'gender'),
      personalEmail: normalizeOptional(body.personalEmail, 120),
      personalMobile: normalizeOptional(body.personalMobile, 40),
      address: normalizeOptional(body.address, 2000),
      emergencyContact: normalizeOptional(body.emergencyContact, 500),
      nationality: normalizeOptional(body.nationality, 80),
      maritalStatus: normalizeEnum(body.maritalStatus, MARITAL_STATUSES, 'marital status'),
    };
    employment = {
      dateOfJoining: normalizeDate(body.dateOfJoining, 'Date of joining'),
      employmentType: normalizeEnum(body.employmentType, EMPLOYMENT_TYPES, 'employment type'),
      department: normalizeOptional(body.department, 120),
      designation: normalizeOptional(body.designation, 120),
      jobLevel: normalizeOptional(body.jobLevel, 80),
      location: normalizeOptional(body.location, 120),
      workMode: normalizeEnum(body.workMode, WORK_MODES, 'work mode'),
      employmentStatus:
        normalizeEnum(body.employmentStatus, EMPLOYMENT_STATUSES, 'employment status') ||
        'active',
      probationPeriod: normalizeOptional(body.probationPeriod, 80),
      confirmationDate: normalizeDate(body.confirmationDate, 'Confirmation date'),
      employeeCategory: null,
    };
    ({ assets, payroll } = parseItPayrollForCreate(body));
    payroll = applyPayStructure(
      payroll,
      payStructureKind(employment.employmentType)
    );
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    throw err;
  }

  const active = activeFromEmploymentStatus(employment.employmentStatus);

  try {
    const userId = await db.transaction(async () => {
      const result = await db
        .prepare(
          `INSERT INTO users (name, email, password_hash, role, manager_id, employee_number, active)
           VALUES (?, ?, ?, 'user', ?, ?, ?)`
        )
        .run(name, email, hashPassword(password), nextManagerId, employeeNumber, active);

      const newUserId = result.lastInsertRowid;
      await ensureBalanceRow(newUserId);

      await db
        .prepare(
          `INSERT INTO employee_profiles (
             user_id, profile_photo, date_of_birth, gender, personal_email, personal_mobile,
             address, emergency_contact, nationality, marital_status,
             date_of_joining, employment_type, department, designation, job_level,
             location, work_mode, employment_status, probation_period, confirmation_date,
             employee_category,
             basic_salary, hra, allowances, variable_pay, bonuses, deductions,
             pf_epf_details, professional_tax, tds, net_salary,
             salary_history, payslips, bank_account_details,
             stipend, fixed_pay, joining_bonus, retention_bonus, esops, bonus_amount, bonus_frequency
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          newUserId,
          personal.profilePhoto,
          personal.dateOfBirth,
          personal.gender,
          personal.personalEmail,
          personal.personalMobile,
          personal.address,
          personal.emergencyContact,
          personal.nationality,
          personal.maritalStatus,
          employment.dateOfJoining,
          employment.employmentType,
          employment.department,
          employment.designation,
          employment.jobLevel,
          employment.location,
          employment.workMode,
          employment.employmentStatus,
          employment.probationPeriod,
          employment.confirmationDate,
          employment.employeeCategory,
          payroll.basicSalary,
          payroll.hra,
          payroll.allowances,
          payroll.variablePay,
          payroll.bonuses,
          payroll.deductions,
          payroll.pfEpfDetails,
          payroll.professionalTax,
          payroll.tds,
          payroll.netSalary,
          payroll.salaryHistory,
          payroll.payslips,
          payroll.bankAccountDetails,
          payroll.stipend,
          payroll.fixedPay,
          payroll.joiningBonus,
          payroll.retentionBonus,
          payroll.esops,
          payroll.bonusAmount,
          payroll.bonusFrequency
        );

      await replaceUserAssets(newUserId, assets);
      return newUserId;
    });

    const row = await db.prepare(`${PROFILE_SELECT} WHERE ep.user_id = ?`).get(userId);
    const assetsByUser = await loadAssetsByUserIds([userId]);
    res.status(201).json({
      profile: mapProfileWithAssets(row, assetsByUser),
      credentials: {
        email,
        password,
        emailGenerated: !emailProvided,
        passwordGenerated: !passwordProvided,
      },
    });
  } catch (err) {
    if (String(err.message).includes('UNIQUE') || isUniqueViolation(err)) {
      const msg = String(err.message).toLowerCase();
      if (msg.includes('employee_number') || msg.includes('idx_users_employee_number')) {
        return res.status(409).json({ error: 'Employee ID already exists' });
      }
      return res.status(409).json({ error: 'Email already exists' });
    }
    throw err;
  }
});

router.patch('/onboarding/:userId', authRequired, hrRequired, async (req, res) => {
  const userId = Number(req.params.userId);
  const user = await db
    .prepare(`SELECT * FROM users WHERE id = ? AND role IN ('user', 'manager')`)
    .get(userId);
  if (!user) return res.status(404).json({ error: 'Employee not found' });

  await ensureEmployeeProfile(userId);
  const existing = await db
    .prepare(`SELECT * FROM employee_profiles WHERE user_id = ?`)
    .get(userId);
  if (!existing) return res.status(404).json({ error: 'Employee profile not found' });

  const body = req.body || {};
  let personal;
  let employment;
  let assets;
  let payroll;
  try {
    personal = {
      profilePhoto:
        body.profilePhoto !== undefined
          ? normalizeProfilePhoto(body.profilePhoto)
          : existing.profile_photo,
      dateOfBirth:
        body.dateOfBirth !== undefined
          ? normalizeDate(body.dateOfBirth, 'Date of birth')
          : existing.date_of_birth,
      gender:
        body.gender !== undefined
          ? normalizeEnum(body.gender, GENDERS, 'gender')
          : existing.gender,
      personalEmail:
        body.personalEmail !== undefined
          ? normalizeOptional(body.personalEmail, 120)
          : existing.personal_email,
      personalMobile:
        body.personalMobile !== undefined
          ? normalizeOptional(body.personalMobile, 40)
          : existing.personal_mobile,
      address:
        body.address !== undefined
          ? normalizeOptional(body.address, 2000)
          : existing.address,
      emergencyContact:
        body.emergencyContact !== undefined
          ? normalizeOptional(body.emergencyContact, 500)
          : existing.emergency_contact,
      nationality:
        body.nationality !== undefined
          ? normalizeOptional(body.nationality, 80)
          : existing.nationality,
      maritalStatus:
        body.maritalStatus !== undefined
          ? normalizeEnum(body.maritalStatus, MARITAL_STATUSES, 'marital status')
          : existing.marital_status,
    };
    employment = {
      dateOfJoining:
        body.dateOfJoining !== undefined
          ? normalizeDate(body.dateOfJoining, 'Date of joining')
          : existing.date_of_joining,
      employmentType:
        body.employmentType !== undefined
          ? normalizeEnum(body.employmentType, EMPLOYMENT_TYPES, 'employment type')
          : existing.employment_type,
      department:
        body.department !== undefined
          ? normalizeOptional(body.department, 120)
          : existing.department,
      designation:
        body.designation !== undefined
          ? normalizeOptional(body.designation, 120)
          : existing.designation,
      jobLevel:
        body.jobLevel !== undefined
          ? normalizeOptional(body.jobLevel, 80)
          : existing.job_level,
      location:
        body.location !== undefined
          ? normalizeOptional(body.location, 120)
          : existing.location,
      workMode:
        body.workMode !== undefined
          ? normalizeEnum(body.workMode, WORK_MODES, 'work mode')
          : existing.work_mode,
      employmentStatus:
        body.employmentStatus !== undefined
          ? normalizeEnum(body.employmentStatus, EMPLOYMENT_STATUSES, 'employment status') ||
            'active'
          : existing.employment_status,
      probationPeriod:
        body.probationPeriod !== undefined
          ? normalizeOptional(body.probationPeriod, 80)
          : existing.probation_period,
      confirmationDate:
        body.confirmationDate !== undefined
          ? normalizeDate(body.confirmationDate, 'Confirmation date')
          : existing.confirmation_date,
      employeeCategory: null,
    };
    assets = body.assets !== undefined ? parseAssetsList(body) : null;
    payroll = applyPayStructure(
      parsePayrollFields(body, existing),
      payStructureKind(employment.employmentType)
    );
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    throw err;
  }

  const nextName = body.name !== undefined ? String(body.name || '').trim() || 'New employee' : user.name;
  const nextEmail = body.email?.trim() ? body.email.toLowerCase().trim() : user.email;
  let nextEmployeeNumber = user.employee_number;
  if (body.employeeNumber !== undefined || body.employeeId !== undefined) {
    const empNo = String(body.employeeNumber || body.employeeId || '').trim();
    if (empNo.length > 40) return res.status(400).json({ error: 'Employee ID is too long' });
    nextEmployeeNumber = empNo || null;
  }

  let nextManagerId = user.manager_id;
  if (user.role === 'manager') {
    nextManagerId = null;
  } else if (body.managerId !== undefined) {
    if (body.managerId === null || body.managerId === '') {
      nextManagerId = null;
    } else {
      const mgr = await db
        .prepare(`SELECT id FROM users WHERE id = ? AND role = 'manager' AND active = 1`)
        .get(Number(body.managerId));
      if (!mgr) return res.status(400).json({ error: 'Invalid reporting manager' });
      nextManagerId = mgr.id;
    }
  }

  const nextActive = activeFromEmploymentStatus(employment.employmentStatus);
  let nextHash = user.password_hash;
  if (body.password !== undefined && body.password !== null && String(body.password) !== '') {
    const nextPassword = String(body.password);
    if (nextPassword.length < 6) {
      return res.status(400).json({ error: 'Temporary password must be at least 6 characters' });
    }
    nextHash = hashPassword(nextPassword);
  }

  try {
    await db.transaction(async () => {
      await db
        .prepare(
          `UPDATE users SET name = ?, email = ?, password_hash = ?, manager_id = ?, employee_number = ?, active = ?
           WHERE id = ?`
        )
        .run(
          nextName,
          nextEmail,
          nextHash,
          nextManagerId,
          nextEmployeeNumber,
          nextActive,
          userId
        );

      await db
        .prepare(
          `UPDATE employee_profiles SET
             profile_photo = ?, date_of_birth = ?, gender = ?, personal_email = ?, personal_mobile = ?,
             address = ?, emergency_contact = ?, nationality = ?, marital_status = ?,
             date_of_joining = ?, employment_type = ?, department = ?, designation = ?, job_level = ?,
             location = ?, work_mode = ?, employment_status = ?, probation_period = ?,
             confirmation_date = ?, employee_category = ?,
             basic_salary = ?, hra = ?, allowances = ?, variable_pay = ?, bonuses = ?, deductions = ?,
             pf_epf_details = ?, professional_tax = ?, tds = ?, net_salary = ?,
             salary_history = ?, payslips = ?, bank_account_details = ?,
             stipend = ?, fixed_pay = ?, joining_bonus = ?, retention_bonus = ?,
             esops = ?, bonus_amount = ?, bonus_frequency = ?,
             updated_at = ${SQL_NOW_IST}
           WHERE user_id = ?`
        )
        .run(
          personal.profilePhoto,
          personal.dateOfBirth,
          personal.gender,
          personal.personalEmail,
          personal.personalMobile,
          personal.address,
          personal.emergencyContact,
          personal.nationality,
          personal.maritalStatus,
          employment.dateOfJoining,
          employment.employmentType,
          employment.department,
          employment.designation,
          employment.jobLevel,
          employment.location,
          employment.workMode,
          employment.employmentStatus,
          employment.probationPeriod,
          employment.confirmationDate,
          employment.employeeCategory,
          payroll.basicSalary,
          payroll.hra,
          payroll.allowances,
          payroll.variablePay,
          payroll.bonuses,
          payroll.deductions,
          payroll.pfEpfDetails,
          payroll.professionalTax,
          payroll.tds,
          payroll.netSalary,
          payroll.salaryHistory,
          payroll.payslips,
          payroll.bankAccountDetails,
          payroll.stipend,
          payroll.fixedPay,
          payroll.joiningBonus,
          payroll.retentionBonus,
          payroll.esops,
          payroll.bonusAmount,
          payroll.bonusFrequency,
          userId
        );

      if (assets) {
        await replaceUserAssets(userId, assets);
      }
    });

    const row = await db.prepare(`${PROFILE_SELECT} WHERE ep.user_id = ?`).get(userId);
    const assetsByUser = await loadAssetsByUserIds([userId]);
    res.json({ profile: mapProfileWithAssets(row, assetsByUser) });
  } catch (err) {
    if (String(err.message).includes('UNIQUE') || isUniqueViolation(err)) {
      const msg = String(err.message).toLowerCase();
      if (msg.includes('employee_number') || msg.includes('idx_users_employee_number')) {
        return res.status(409).json({ error: 'Employee ID already exists' });
      }
      return res.status(409).json({ error: 'Email already exists' });
    }
    throw err;
  }
});

// ——— Profile / salary views (own account only for employee + manager) ———
router.get('/profiles/me', authRequired, async (req, res) => {
  if (req.user.role === 'manager') {
    await ensureEmployeeProfile(req.user.id);
  }
  const row = await db.prepare(`${PROFILE_SELECT} WHERE ep.user_id = ?`).get(req.user.id);
  if (!row) {
    return res.status(404).json({ error: 'No salary profile on file yet. Ask HR to add your details.' });
  }
  const assetsByUser = await loadAssetsByUserIds([req.user.id]);
  res.json({
    profile: mapProfileWithAssets(row, assetsByUser, {
      includeSensitive: true,
      includeIt: req.user.role === 'hr',
    }),
  });
});

router.get('/profiles/team', authRequired, hrRequired, async (req, res) => {
  const rows = await db
    .prepare(`${PROFILE_SELECT} WHERE u.role = 'user' ORDER BY u.name COLLATE NOCASE`)
    .all();
  const assetsByUser = await loadAssetsByUserIds(rows.map((r) => r.user_id));
  res.json({
    profiles: rows.map((row) =>
      mapProfileWithAssets(row, assetsByUser, {
        includeSensitive: true,
        includeIt: true,
      })
    ),
  });
});

router.get('/profiles/:userId', authRequired, async (req, res) => {
  const userId = Number(req.params.userId);
  const row = await db.prepare(`${PROFILE_SELECT} WHERE ep.user_id = ?`).get(userId);
  if (!row) return res.status(404).json({ error: 'Employee profile not found' });

  const isHr = req.user.role === 'hr';
  const isSelf = req.user.id === userId;
  if (!isHr && !isSelf) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const assetsByUser = await loadAssetsByUserIds([userId]);
  res.json({
    profile: mapProfileWithAssets(row, assetsByUser, {
      includeSensitive: isHr || isSelf,
      includeIt: isHr,
    }),
  });
});

router.patch('/users/:id', authRequired, hrRequired, async (req, res) => {
  const id = Number(req.params.id);
  const user = await db
    .prepare(`SELECT * FROM users WHERE id = ? AND role IN ('user', 'manager')`)
    .get(id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const { name, email, password, active, managerId, employeeNumber } = req.body || {};
  const nextName = name?.trim() || user.name;
  const nextEmail = email?.trim() ? email.toLowerCase().trim() : user.email;
  const nextActive = typeof active === 'boolean' ? (active ? 1 : 0) : user.active;
  const nextHash = password ? hashPassword(password) : user.password_hash;

  let nextEmployeeNumber = user.employee_number;
  if (employeeNumber !== undefined) {
    const empNo = String(employeeNumber || '').trim();
    if (empNo.length > 40) {
      return res.status(400).json({ error: 'Employee number is too long' });
    }
    nextEmployeeNumber = empNo || null;
  }

  let nextManagerId = user.manager_id;
  if (user.role === 'user' && managerId !== undefined) {
    if (managerId === null || managerId === '') {
      nextManagerId = null;
    } else {
      const mgr = await db
        .prepare(`SELECT id FROM users WHERE id = ? AND role = 'manager' AND active = 1`)
        .get(Number(managerId));
      if (!mgr) return res.status(400).json({ error: 'Invalid manager' });
      nextManagerId = mgr.id;
    }
  }

  try {
    await db.prepare(
      `UPDATE users SET name = ?, email = ?, password_hash = ?, active = ?, manager_id = ?, employee_number = ?
       WHERE id = ?`
    ).run(nextName, nextEmail, nextHash, nextActive, nextManagerId, nextEmployeeNumber, id);
    const updated = await db
      .prepare(
        `SELECT u.*, m.name AS manager_name FROM users u
         LEFT JOIN users m ON m.id = u.manager_id WHERE u.id = ?`
      )
      .get(id);
    res.json({ user: publicUser(updated) });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      const msg = String(err.message).toLowerCase();
      if (msg.includes('employee_number') || msg.includes('idx_users_employee_number')) {
        return res.status(409).json({ error: 'Employee number already exists' });
      }
      return res.status(409).json({ error: 'Email already exists' });
    }
    throw err;
  }
});

router.delete('/users/:id', authRequired, hrRequired, async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) {
    return res.status(400).json({ error: 'You cannot delete your own account' });
  }
  const user = await db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.role !== 'user') {
    return res.status(400).json({ error: 'Only employees can be deleted from here' });
  }

  await db.transaction(async () => {
    await db.prepare(`DELETE FROM notifications WHERE user_id = ?`).run(id);
    await db.prepare(`DELETE FROM balance_credits WHERE user_id = ? OR credited_by = ?`).run(id, id);
    await db.prepare(`DELETE FROM leave_requests WHERE user_id = ?`).run(id);
    await db.prepare(`DELETE FROM leave_balances WHERE user_id = ?`).run(id);
    await db.prepare(`DELETE FROM users WHERE id = ?`).run(id);
  });

  res.json({ ok: true });
});

// ——— Balances ———
router.get('/balances/me', authRequired, async (req, res) => {
  await ensureBalanceRow(req.user.id);
  res.json({ balances: mapBalance(await getBalance(req.user.id)) });
});

router.get('/balances/credits', authRequired, hrRequired, async (_req, res) => {
  const credits = (await db
    .prepare(
      `SELECT c.id, c.user_id, c.leave_type, c.amount, c.note, c.credited_by, c.created_at,
              u.name AS user_name, u.email AS user_email,
              hr.name AS credited_by_name
       FROM balance_credits c
       JOIN users u ON u.id = c.user_id
       JOIN users hr ON hr.id = c.credited_by
       ORDER BY c.created_at DESC, c.id DESC
       LIMIT 200`
    )
    .all())
    .map((row) => ({
      id: row.id,
      userId: row.user_id,
      userName: row.user_name,
      userEmail: row.user_email,
      leaveType: row.leave_type,
      amount: row.amount,
      note: row.note,
      creditedById: row.credited_by,
      creditedByName: row.credited_by_name,
      createdAt: row.created_at,
    }));
  res.json({ credits });
});

router.post('/balances/credit', authRequired, hrRequired, async (req, res) => {
  const { userId, leaveType, amount, note } = req.body || {};
  if (!userId || !LEAVE_TYPES.includes(leaveType)) {
    return res.status(400).json({ error: 'Valid userId and leaveType required' });
  }
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    return res.status(400).json({ error: 'Amount must be a positive number' });
  }
  const user = await db.prepare(`SELECT id FROM users WHERE id = ? AND role = 'user'`).get(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  await ensureBalanceRow(userId);
  const balances = await db.transaction(async () => {
    await db.prepare(
      `UPDATE leave_balances
       SET ${leaveType} = ${leaveType} + ?, updated_at = ${SQL_NOW_IST}
       WHERE user_id = ?`
    ).run(amt, userId);
    await db.prepare(
      `INSERT INTO balance_credits (user_id, leave_type, amount, note, credited_by)
       VALUES (?, ?, ?, ?, ?)`
    ).run(userId, leaveType, amt, note || null, req.user.id);
    return mapBalance(await getBalance(userId));
  });
  const typeLabel = leaveLabel(leaveType);
  const dayLabel = amt === 1 ? 'day' : 'days';
  await notifyUser({
    userId,
    leaveId: null,
    type: 'balance_credited',
    title: 'Leave balance credited',
    message: `HR credited ${amt} ${typeLabel} ${dayLabel} to your account.${
      note ? ` Note: ${note}` : ''
    }`,
  });

  res.json({ balances, credited: { userId, leaveType, amount: amt } });
});

// ——— Leave requests ———
router.get('/leaves', authRequired, async (req, res) => {
  const { status, userId, from, to, leaveType } = req.query;
  const clauses = [];
  const params = [];

  if (req.user.role === 'user') {
    clauses.push('lr.user_id = ?');
    params.push(req.user.id);
  } else if (req.user.role === 'manager') {
    clauses.push('u.manager_id = ?');
    params.push(req.user.id);
    if (userId) {
      clauses.push('lr.user_id = ?');
      params.push(Number(userId));
    }
  } else if (req.user.role === 'hr' && userId) {
    clauses.push('lr.user_id = ?');
    params.push(Number(userId));
  }

  if (status && status !== 'all') {
    if (status === 'pending') {
      clauses.push(`lr.status IN ('pending_manager', 'pending_hr')`);
    } else {
      clauses.push('lr.status = ?');
      params.push(status);
    }
  }
  if (leaveType && leaveType !== 'all') {
    clauses.push('lr.leave_type = ?');
    params.push(leaveType);
  }
  if (from) {
    clauses.push('lr.end_date >= ?');
    params.push(from);
  }
  if (to) {
    clauses.push('lr.start_date <= ?');
    params.push(to);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = (await db
    .prepare(`${LEAVE_SELECT} ${where} ORDER BY lr.created_at DESC`)
    .all(...params))
    .map(mapLeave);

  res.json({ leaves: rows });
});

router.get('/leaves/calendar', authRequired, async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) {
    return res.status(400).json({ error: 'from and to query params required (YYYY-MM-DD)' });
  }

  // Employees see their active requests (including pending / partially approved) so they can cancel from the calendar.
  // Managers and HR only see fully approved team/org leave.
  const statusClause =
    req.user.role === 'user'
      ? "lr.status IN ('pending_manager', 'pending_hr', 'approved')"
      : "lr.status = 'approved'";

  const clauses = [statusClause, 'lr.end_date >= ?', 'lr.start_date <= ?'];
  const params = [from, to];

  if (req.user.role === 'user') {
    clauses.push('lr.user_id = ?');
    params.push(req.user.id);
  } else if (req.user.role === 'manager') {
    clauses.push('u.manager_id = ?');
    params.push(req.user.id);
  }

  const rows = (await db
    .prepare(`${LEAVE_SELECT} WHERE ${clauses.join(' AND ')} ORDER BY lr.start_date`)
    .all(...params))
    .map(mapLeave);

  const mandatoryRows = (
    await db
      .prepare(
        `SELECT ml.*, u.name AS created_by_name
         FROM mandatory_leaves ml
         LEFT JOIN users u ON u.id = ml.created_by
         WHERE ml.end_date >= ? AND ml.start_date <= ?
         ORDER BY ml.start_date`
      )
      .all(from, to)
  ).map(mapMandatoryLeave);

  res.json({ leaves: [...rows, ...mandatoryRows], mandatoryLeaves: mandatoryRows });
});

/** HR: list mandatory company leaves (optional date range). */
router.get('/mandatory-leaves', authRequired, hrRequired, async (req, res) => {
  const { from, to } = req.query;
  const clauses = [];
  const params = [];
  if (from) {
    clauses.push('ml.end_date >= ?');
    params.push(from);
  }
  if (to) {
    clauses.push('ml.start_date <= ?');
    params.push(to);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = await db
    .prepare(
      `SELECT ml.*, u.name AS created_by_name
       FROM mandatory_leaves ml
       LEFT JOIN users u ON u.id = ml.created_by
       ${where}
       ORDER BY ml.start_date DESC`
    )
    .all(...params);
  res.json({ leaves: rows.map(mapMandatoryLeave) });
});

function normalizeMandatoryEntry(entry) {
  const title = String(entry?.title || '').trim();
  const startDate = String(entry?.startDate || entry?.start_date || '').trim();
  const endDate = String(entry?.endDate || entry?.end_date || startDate).trim();
  const note = String(entry?.note || '').trim() || null;
  return { title, startDate, endDate, note };
}

async function insertMandatoryLeave({ title, startDate, endDate, note, createdBy }) {
  if (!title || !startDate || !endDate) {
    throw Object.assign(new Error('title, startDate, and endDate are required'), { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw Object.assign(new Error('Dates must be YYYY-MM-DD'), { status: 400 });
  }
  let days;
  try {
    days = countWeekdays(startDate, endDate);
  } catch (err) {
    throw Object.assign(new Error(err.message), { status: 400 });
  }
  if (days < 0 || endDate < startDate) {
    throw Object.assign(new Error('End date must be on or after start date'), { status: 400 });
  }

  const result = await db
    .prepare(
      `INSERT INTO mandatory_leaves (title, start_date, end_date, note, created_by)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(title, startDate, endDate, note, createdBy);
  const row = await db
    .prepare(
      `SELECT ml.*, u.name AS created_by_name
       FROM mandatory_leaves ml
       LEFT JOIN users u ON u.id = ml.created_by
       WHERE ml.id = ?`
    )
    .get(result.lastInsertRowid);
  return mapMandatoryLeave(row);
}

/** HR: create a single mandatory leave (shows on all calendars). */
router.post('/mandatory-leaves', authRequired, hrRequired, async (req, res) => {
  try {
    const leave = await insertMandatoryLeave({
      ...normalizeMandatoryEntry(req.body || {}),
      createdBy: req.user.id,
    });
    res.status(201).json({ leave });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Failed to create mandatory leave' });
  }
});

/** HR: bulk upload mandatory leaves (JSON array from CSV/form). */
router.post('/mandatory-leaves/upload', authRequired, hrRequired, async (req, res) => {
  const entries = Array.isArray(req.body?.leaves)
    ? req.body.leaves
    : Array.isArray(req.body)
      ? req.body
      : null;
  if (!entries?.length) {
    return res.status(400).json({ error: 'Provide a non-empty leaves array' });
  }

  const created = [];
  const errors = [];
  for (let i = 0; i < entries.length; i += 1) {
    try {
      const leave = await insertMandatoryLeave({
        ...normalizeMandatoryEntry(entries[i]),
        createdBy: req.user.id,
      });
      created.push(leave);
    } catch (err) {
      errors.push({ index: i + 1, error: err.message || 'Invalid row' });
    }
  }

  if (!created.length) {
    return res.status(400).json({
      error: errors[0]?.error || 'No valid mandatory leaves in upload',
      errors,
    });
  }

  res.status(201).json({
    created: created.length,
    leaves: created,
    errors: errors.length ? errors : undefined,
  });
});

router.delete('/mandatory-leaves/:id', authRequired, hrRequired, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  const existing = await db.prepare(`SELECT id FROM mandatory_leaves WHERE id = ?`).get(id);
  if (!existing) return res.status(404).json({ error: 'Mandatory leave not found' });
  await db.prepare(`DELETE FROM mandatory_leaves WHERE id = ?`).run(id);
  res.json({ ok: true });
});

router.post('/leaves', authRequired, async (req, res) => {
  if (req.user.role !== 'user') {
    return res.status(400).json({ error: 'Only employees can apply for leave/WFH' });
  }

  const employee = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);

  const { leaveType, startDate, endDate, reason, session } = req.body || {};
  if (!REQUEST_TYPES.includes(leaveType) || !startDate || !endDate) {
    return res.status(400).json({
      error: 'leaveType (casual/earned/sick/compensation/wfh), startDate, and endDate are required',
    });
  }
  const leaveSession = SESSIONS.includes(session) ? session : 'full';
  const resolvedEnd = leaveSession === 'full' ? endDate : startDate;

  let days;
  try {
    days = countLeaveDays(startDate, resolvedEnd, leaveSession);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (days <= 0) {
    return res.status(400).json({ error: 'Request must include at least one weekday' });
  }

  if (isBalanceType(leaveType)) {
    await ensureBalanceRow(req.user.id);
    const bal = await getBalance(req.user.id);
    if (bal[leaveType] < days) {
      return res.status(400).json({
        error: `Insufficient ${leaveType} leave balance (${bal[leaveType]} available, ${days} requested)`,
      });
    }
  }

  const candidates = await db
    .prepare(
      `SELECT id, start_date, end_date, session FROM leave_requests
       WHERE user_id = ?
         AND status IN ('pending_manager', 'pending_hr', 'approved')
         AND end_date >= ?
         AND start_date <= ?`
    )
    .all(req.user.id, startDate, resolvedEnd);
  const overlap = candidates.find((row) =>
    sessionsOverlap(
      { startDate, endDate: resolvedEnd, session: leaveSession },
      {
        startDate: row.start_date,
        endDate: row.end_date,
        session: row.session || 'full',
      }
    )
  );
  if (overlap) {
    return res.status(409).json({ error: 'Overlapping leave/WFH request already exists' });
  }

  const initialStatus = employee.manager_id ? 'pending_manager' : 'pending_hr';
  const result = await db
    .prepare(
      `INSERT INTO leave_requests
         (user_id, leave_type, start_date, end_date, days, session, reason, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.user.id,
      leaveType,
      startDate,
      resolvedEnd,
      days,
      leaveSession,
      reason?.trim() || null,
      initialStatus
    );

  const leaveId = result.lastInsertRowid;
  const sessionNote = leaveSession === 'full' ? '' : ` (${leaveSession} session)`;

  if (employee.manager_id) {
    await notifyUser({
      userId: employee.manager_id,
      leaveId,
      type: 'pending_manager',
      title: 'New leave request',
      message: `${req.user.name} submitted a ${leaveLabel(leaveType)} request (${startDate} to ${resolvedEnd})${sessionNote}.`,
    });

    const manager = await db
      .prepare('SELECT name, email FROM users WHERE id = ?')
      .get(employee.manager_id);
    // Fire-and-forget; never block leave apply if Slack / mail is down
    void notifyLeaveApplied({
      leaveId,
      stage: 'manager',
      employeeName: req.user.name,
      managerName: manager?.name,
      leaveType,
      startDate,
      endDate: resolvedEnd,
      days,
      session: leaveSession,
      reason,
    });
    void mailLeaveApplied({
      employeeId: req.user.id,
      managerId: employee.manager_id,
      employeeName: req.user.name,
      managerName: manager?.name,
      leaveType,
      startDate,
      endDate: resolvedEnd,
      days,
      session: leaveSession,
      reason: reason?.trim() || null,
    });
  } else {
    const hrIds = await getHrIds();
    await notifyMany(hrIds, {
      leaveId,
      type: 'pending_hr',
      title: 'New leave request (direct to HR)',
      message: `${req.user.name} submitted a ${leaveLabel(leaveType)} request (${startDate} to ${resolvedEnd})${sessionNote}. No manager assigned — needs HR review.`,
    });
    void notifyLeaveApplied({
      leaveId,
      stage: 'hr',
      employeeName: req.user.name,
      managerName: 'None (HR)',
      leaveType,
      startDate,
      endDate: resolvedEnd,
      days,
      session: leaveSession,
      reason,
    });
    void mailLeaveApplied({
      employeeId: req.user.id,
      hrUserIds: hrIds,
      employeeName: req.user.name,
      managerName: null,
      leaveType,
      startDate,
      endDate: resolvedEnd,
      days,
      session: leaveSession,
      reason: reason?.trim() || null,
    });
  }

  res.status(201).json({ leave: mapLeave(await getLeaveById(leaveId)) });
});

/** HR: create an approved leave/WFH on behalf of an employee (calendar). */
router.post('/leaves/admin', authRequired, hrRequired, async (req, res) => {
  const { userId, leaveType, startDate, endDate, reason, session } = req.body || {};
  const employeeId = Number(userId);
  if (!employeeId || !REQUEST_TYPES.includes(leaveType) || !startDate || !endDate) {
    return res.status(400).json({
      error: 'userId, leaveType, startDate, and endDate are required',
    });
  }

  const employee = await db
    .prepare(`SELECT * FROM users WHERE id = ? AND role = 'user'`)
    .get(employeeId);
  if (!employee) return res.status(404).json({ error: 'Employee not found' });

  const leaveSession = SESSIONS.includes(session) ? session : 'full';
  const resolvedEnd = leaveSession === 'full' ? endDate : startDate;

  let days;
  try {
    days = countLeaveDays(startDate, resolvedEnd, leaveSession);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (days <= 0) {
    return res.status(400).json({ error: 'Request must include at least one weekday' });
  }

  if (isBalanceType(leaveType)) {
    await ensureBalanceRow(employeeId);
    const bal = await getBalance(employeeId);
    if ((bal[leaveType] ?? 0) < days) {
      return res.status(400).json({
        error: `Insufficient ${leaveLabel(leaveType)} balance (${bal[leaveType] ?? 0} available, ${days} requested)`,
      });
    }
  }

  const candidates = await db
    .prepare(
      `SELECT id, start_date, end_date, session FROM leave_requests
       WHERE user_id = ?
         AND status IN ('pending_manager', 'pending_hr', 'approved')
         AND end_date >= ?
         AND start_date <= ?`
    )
    .all(employeeId, startDate, resolvedEnd);
  const overlap = candidates.find((row) =>
    sessionsOverlap(
      { startDate, endDate: resolvedEnd, session: leaveSession },
      {
        startDate: row.start_date,
        endDate: row.end_date,
        session: row.session || 'full',
      }
    )
  );
  if (overlap) {
    return res.status(409).json({ error: 'Overlapping leave/WFH already exists for this employee' });
  }

  const leaveId = await db.transaction(async () => {
    if (isBalanceType(leaveType)) {
      await db
        .prepare(
          `UPDATE leave_balances
           SET ${leaveType} = ${leaveType} - ?, updated_at = ${SQL_NOW_IST}
           WHERE user_id = ?`
        )
        .run(days, employeeId);
    }
    const result = await db
      .prepare(
        `INSERT INTO leave_requests
           (user_id, leave_type, start_date, end_date, days, session, reason, status, hr_id, hr_reviewed_at, hr_note)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'approved', ?, ${SQL_NOW_IST}, ?)`
      )
      .run(
        employeeId,
        leaveType,
        startDate,
        resolvedEnd,
        days,
        leaveSession,
        reason?.trim() || null,
        req.user.id,
        'Created by HR'
      );
    return result.lastInsertRowid;
  });

  await notifyUser({
    userId: employeeId,
    leaveId,
    type: 'approved',
    title: 'Leave added by HR',
    message: `HR added ${leaveLabel(leaveType)} (${startDate} to ${resolvedEnd}) to your calendar.`,
  });

  res.status(201).json({ leave: mapLeave(await getLeaveById(leaveId)) });
});

/** HR: permanently remove a leave request (restores balance if it was approved). */
router.delete('/leaves/:id', authRequired, hrRequired, async (req, res) => {
  const id = Number(req.params.id);
  const leave = await db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(id);
  if (!leave) return res.status(404).json({ error: 'Leave request not found' });

  await db.transaction(async () => {
    if (leave.status === 'approved' && isBalanceType(leave.leave_type) && leave.days > 0) {
      await ensureBalanceRow(leave.user_id);
      await db
        .prepare(
          `UPDATE leave_balances
           SET ${leave.leave_type} = ${leave.leave_type} + ?, updated_at = ${SQL_NOW_IST}
           WHERE user_id = ?`
        )
        .run(leave.days, leave.user_id);
    }
    await db.prepare(`DELETE FROM notifications WHERE leave_id = ?`).run(id);
    await db.prepare(`DELETE FROM leave_requests WHERE id = ?`).run(id);
  });

  res.json({ ok: true });
});

router.patch('/leaves/:id/review', authRequired, managerOrHrRequired, async (req, res) => {
  const id = Number(req.params.id);
  const { action, leaveType, note, startDate, endDate, session } = req.body || {};
  const adminNote = note ?? req.body?.adminNote;

  try {
    const result = await reviewLeaveRequest({
      leaveId: id,
      action,
      actor: req.user,
      note: adminNote,
      leaveType,
      startDate,
      endDate,
      session,
    });
    res.json({ leave: result.leave });
  } catch (err) {
    if (err instanceof LeaveReviewError) {
      return res.status(err.status).json({ error: err.message });
    }
    throw err;
  }
});

router.patch('/leaves/:id/cancel', authRequired, async (req, res) => {
  if (req.user.role !== 'user') {
    return res.status(400).json({ error: 'Only employees can cancel their requests' });
  }

  const id = Number(req.params.id);
  const leave = await db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(id);
  if (!leave) return res.status(404).json({ error: 'Leave request not found' });
  if (leave.user_id !== req.user.id) {
    return res.status(403).json({ error: 'You can only cancel your own requests' });
  }
  if (!['approved', 'pending_manager', 'pending_hr'].includes(leave.status)) {
    return res.status(400).json({
      error: 'Only pending or approved requests can be cancelled',
    });
  }

  const cancelDate =
    typeof req.body?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.date)
      ? req.body.date
      : null;
  const cancelAll = Boolean(req.body?.cancelAll) || !cancelDate;

  const employee = await db.prepare('SELECT * FROM users WHERE id = ?').get(leave.user_id);
  const priorStatus = leave.status;
  const session = leave.session || 'full';

  // Half-day sessions are always a single day — cancel the whole request.
  const isPartial =
    !cancelAll &&
    cancelDate &&
    session === 'full' &&
    !(leave.start_date === leave.end_date && leave.start_date === cancelDate);

  if (cancelDate && (cancelDate < leave.start_date || cancelDate > leave.end_date)) {
    return res.status(400).json({ error: 'Cancel date is outside this leave range' });
  }

  let restoredDays = 0;
  let resultLeaves = [];
  let notifyMessage = '';

  const restoreBalance = async (amount) => {
    if (priorStatus !== 'approved' || !isBalanceType(leave.leave_type) || amount <= 0) {
      return;
    }
    await ensureBalanceRow(leave.user_id);
    await db.prepare(
      `UPDATE leave_balances
       SET ${leave.leave_type} = ${leave.leave_type} + ?, updated_at = ${SQL_NOW_IST}
       WHERE user_id = ?`
    ).run(amount, leave.user_id);
    restoredDays += amount;
  };

  await db.transaction(async () => {
    if (!isPartial) {
      await restoreBalance(leave.days);
      await db.prepare(
        `UPDATE leave_requests
         SET status = 'cancelled', updated_at = ${SQL_NOW_IST}
         WHERE id = ?`
      ).run(id);
      resultLeaves = [await getLeaveById(id)];
      notifyMessage = `${req.user.name} cancelled their ${leaveLabel(leave.leave_type)} request.`;
      return;
    }

    const remainingDays = eachCalendarDay(leave.start_date, leave.end_date).filter(
      (d) => d !== cancelDate
    );
    const ranges = contiguousRanges(remainingDays)
      .map((range) => {
        try {
          const days = countLeaveDays(range.startDate, range.endDate, session);
          return days > 0 ? { ...range, days } : null;
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    if (!ranges.length) {
      await restoreBalance(leave.days);
      await db.prepare(
        `UPDATE leave_requests
         SET status = 'cancelled', updated_at = ${SQL_NOW_IST}
         WHERE id = ?`
      ).run(id);
      resultLeaves = [await getLeaveById(id)];
      notifyMessage = `${req.user.name} cancelled their ${leaveLabel(leave.leave_type)} request.`;
      return;
    }

    const keptDays = ranges.reduce((sum, r) => sum + r.days, 0);
    await restoreBalance(Math.max(0, leave.days - keptDays));

    const [first, ...rest] = ranges;
    await db.prepare(
      `UPDATE leave_requests
       SET start_date = ?, end_date = ?, days = ?, updated_at = ${SQL_NOW_IST}
       WHERE id = ?`
    ).run(first.startDate, first.endDate, first.days, id);

    const insertedIds = [];
    const insert = await db.prepare(
      `INSERT INTO leave_requests (
         user_id, leave_type, start_date, end_date, days, session, reason, status,
         manager_note, manager_id, manager_reviewed_at,
         hr_note, hr_id, hr_reviewed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const range of rest) {
      const info = await insert.run(
        leave.user_id,
        leave.leave_type,
        range.startDate,
        range.endDate,
        range.days,
        session,
        leave.reason,
        leave.status,
        leave.manager_note,
        leave.manager_id,
        leave.manager_reviewed_at,
        leave.hr_note,
        leave.hr_id,
        leave.hr_reviewed_at
      );
      insertedIds.push(info.lastInsertRowid);
    }

    resultLeaves = [
      await getLeaveById(id),
      ...(await Promise.all(insertedIds.map((rid) => getLeaveById(rid)))),
    ];
    notifyMessage = `${req.user.name} cancelled ${leaveLabel(leave.leave_type)} on ${cancelDate} (other days kept).`;
  });

  const targets = [];
  if (employee.manager_id) targets.push(employee.manager_id);
  if (priorStatus === 'pending_hr' || priorStatus === 'approved') {
    targets.push(...await getHrIds());
  }
  await notifyMany(targets, {
    leaveId: id,
    type: 'cancelled',
    title: isPartial ? 'Leave day cancelled' : 'Request cancelled',
    message: notifyMessage,
  });

  const restored =
    restoredDays > 0
      ? ` ${restoredDays} day(s) restored to your ${leave.leave_type} balance.`
      : '';
  await notifyUser({
    userId: req.user.id,
    leaveId: id,
    type: 'cancelled',
    title: isPartial ? 'Leave day cancelled' : 'Your leave was cancelled',
    message: isPartial
      ? `Cancelled ${leaveLabel(leave.leave_type)} for ${cancelDate}. Remaining days stay active.${restored}`
      : `Your ${leaveLabel(leave.leave_type)} request (${leave.start_date} – ${leave.end_date}) was cancelled.${restored}`,
  });

  void mailCancelled({
    targetUserIds: targets,
    employeeId: req.user.id,
    employeeName: req.user.name,
    leaveType: leave.leave_type,
    startDate: leave.start_date,
    endDate: leave.end_date,
    days: leave.days,
    session: leave.session,
    partial: Boolean(isPartial),
    cancelDate,
    message: isPartial
      ? `${req.user.name} cancelled ${leaveLabel(leave.leave_type)} on ${cancelDate} (other days kept).`
      : notifyMessage,
    employeeMessage: isPartial
      ? `Cancelled ${leaveLabel(leave.leave_type)} for ${cancelDate}. Remaining days stay active.${restored}`
      : `Your ${leaveLabel(leave.leave_type)} request (${leave.start_date} – ${leave.end_date}) was cancelled.${restored}`,
  });

  res.json({
    leave: mapLeave(resultLeaves[0]),
    leaves: resultLeaves.map(mapLeave),
    partial: Boolean(isPartial),
    cancelledDate: isPartial ? cancelDate : null,
    restoredDays,
  });
});

// ——— Notifications (all roles) ———
router.get('/notifications', authRequired, async (req, res) => {
  const notifications = (await db
    .prepare(
      `SELECT id, leave_id, type, title, message, read, created_at
       FROM notifications
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT 40`
    )
    .all(req.user.id))
    .map((n) => ({
      id: n.id,
      leaveId: n.leave_id,
      type: n.type,
      title: n.title,
      message: n.message,
      read: Boolean(n.read),
      createdAt: n.created_at,
    }));
  const unreadCount = (await db
    .prepare(
      `SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read = 0`
    )
    .get(req.user.id)).c;
  res.json({ notifications, unreadCount });
});

router.patch('/notifications/read', authRequired, async (req, res) => {
  const { ids } = req.body || {};
  if (Array.isArray(ids) && ids.length) {
    const mark = await db.prepare(
      `UPDATE notifications SET read = 1 WHERE user_id = ? AND id = ?`
    );
    await db.transaction(async () => {
      for (const id of ids) await mark.run(req.user.id, Number(id));
    });
  } else {
    await db.prepare(`UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0`).run(
      req.user.id
    );
  }
  const unreadCount = (await db
    .prepare(
      `SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read = 0`
    )
    .get(req.user.id)).c;
  res.json({ ok: true, unreadCount });
});

router.delete('/notifications', authRequired, async (req, res) => {
  await db.prepare(`DELETE FROM notifications WHERE user_id = ?`).run(req.user.id);
  res.json({ ok: true, unreadCount: 0 });
});

router.get('/dashboard/stats', authRequired, managerOrHrRequired, async (req, res) => {
  if (req.user.role === 'manager') {
    const pendingManager = (await db
      .prepare(
        `SELECT COUNT(*) AS c FROM leave_requests lr
         JOIN users u ON u.id = lr.user_id
         WHERE lr.status = 'pending_manager' AND u.manager_id = ?`
      )
      .get(req.user.id)).c;
    const team = (await db
      .prepare(
        `SELECT COUNT(*) AS c FROM users WHERE role = 'user' AND active = 1 AND manager_id = ?`
      )
      .get(req.user.id)).c;
    const onLeaveToday = (await db
      .prepare(
        `SELECT COUNT(DISTINCT lr.user_id) AS c FROM leave_requests lr
         JOIN users u ON u.id = lr.user_id
         WHERE lr.status = 'approved'
           AND lr.leave_type != 'wfh'
           AND u.manager_id = ?
           AND ${SQL_TODAY_IST} BETWEEN lr.start_date AND lr.end_date`
      )
      .get(req.user.id)).c;
    const onWfhToday = (await db
      .prepare(
        `SELECT COUNT(DISTINCT lr.user_id) AS c FROM leave_requests lr
         JOIN users u ON u.id = lr.user_id
         WHERE lr.status = 'approved'
           AND lr.leave_type = 'wfh'
           AND u.manager_id = ?
           AND ${SQL_TODAY_IST} BETWEEN lr.start_date AND lr.end_date`
      )
      .get(req.user.id)).c;
    return res.json({
      pendingManager: Number(pendingManager) || 0,
      pendingHr: 0,
      users: Number(team) || 0,
      onLeaveToday: Number(onLeaveToday) || 0,
      onWfhToday: Number(onWfhToday) || 0,
    });
  }

  const pendingManager = (await db
    .prepare(`SELECT COUNT(*) AS c FROM leave_requests WHERE status = 'pending_manager'`)
    .get()).c;
  const pendingHr = (await db
    .prepare(`SELECT COUNT(*) AS c FROM leave_requests WHERE status = 'pending_hr'`)
    .get()).c;
  const users = (await db
    .prepare(`SELECT COUNT(*) AS c FROM users WHERE role = 'user' AND active = 1`)
    .get()).c;
  const onLeaveToday = (await db
    .prepare(
      `SELECT COUNT(DISTINCT user_id) AS c FROM leave_requests
       WHERE status = 'approved'
         AND leave_type != 'wfh'
         AND ${SQL_TODAY_IST} BETWEEN start_date AND end_date`
    )
    .get()).c;
  const onWfhToday = (await db
    .prepare(
      `SELECT COUNT(DISTINCT user_id) AS c FROM leave_requests
       WHERE status = 'approved'
         AND leave_type = 'wfh'
         AND ${SQL_TODAY_IST} BETWEEN start_date AND end_date`
    )
    .get()).c;
  res.json({
    pendingManager: Number(pendingManager) || 0,
    pendingHr: Number(pendingHr) || 0,
    pending: Number(pendingHr) || 0,
    users: Number(users) || 0,
    onLeaveToday: Number(onLeaveToday) || 0,
    onWfhToday: Number(onWfhToday) || 0,
  });
});

router.get('/reports/overview', authRequired, async (req, res) => {
  const role = req.user.role;
  const filterUserId = req.query.userId ? Number(req.query.userId) : null;

  if (filterUserId != null && Number.isNaN(filterUserId)) {
    return res.status(400).json({ error: 'Invalid employee filter' });
  }
  if (filterUserId != null && role === 'user') {
    return res.status(403).json({ error: 'Employees cannot filter by other users' });
  }
  if (filterUserId != null && (role === 'manager' || role === 'hr')) {
    const employee = await db
      .prepare(`SELECT id, manager_id, role FROM users WHERE id = ? AND role = 'user'`)
      .get(filterUserId);
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    if (role === 'manager' && employee.manager_id !== req.user.id) {
      return res.status(403).json({ error: 'Not on your team' });
    }
  }

  const listParams =
    role === 'manager' || role === 'user' ? [req.user.id] : [];

  const chartJoin = role === 'manager' ? 'JOIN users u ON u.id = lr.user_id' : '';
  const chartWhere = [];
  const chartParams = [];
  if (role === 'manager') {
    chartWhere.push('u.manager_id = ?');
    chartParams.push(req.user.id);
  } else if (role === 'user') {
    chartWhere.push('lr.user_id = ?');
    chartParams.push(req.user.id);
  }
  if (filterUserId != null && (role === 'manager' || role === 'hr')) {
    chartWhere.push('lr.user_id = ?');
    chartParams.push(filterUserId);
  }
  const chartWhereSql = chartWhere.length ? `AND ${chartWhere.join(' AND ')}` : '';

  const upcoming = (await db
    .prepare(
      `${LEAVE_SELECT}
       WHERE lr.status = 'approved'
         AND lr.end_date >= ${SQL_TODAY_IST}
         ${role === 'manager' ? 'AND u.manager_id = ?' : ''}
         ${role === 'user' ? 'AND lr.user_id = ?' : ''}
       ORDER BY lr.start_date ASC
       LIMIT 12`
    )
    .all(...listParams))
    .map(mapLeave);

  const todayOnLeave = (await db
    .prepare(
      `${LEAVE_SELECT}
       WHERE lr.status = 'approved'
         AND ${SQL_TODAY_IST} BETWEEN lr.start_date AND lr.end_date
         ${role === 'manager' ? 'AND u.manager_id = ?' : ''}
         ${role === 'user' ? 'AND lr.user_id = ?' : ''}
       ORDER BY u.name COLLATE NOCASE`
    )
    .all(...listParams))
    .map(mapLeave);

  const byTypeRows = await db
    .prepare(
      `SELECT lr.leave_type AS type, COALESCE(SUM(lr.days), 0) AS days, COUNT(*) AS count
       FROM leave_requests lr
       ${chartJoin}
       WHERE lr.status = 'approved'
         AND strftime('%Y-%m', lr.start_date) = strftime('%Y-%m', 'now', '+5 hours', '30 minutes')
         ${chartWhereSql}
       GROUP BY lr.leave_type`
    )
    .all(...chartParams);

  const byMonthRows = await db
    .prepare(
      `SELECT strftime('%Y-%m', lr.start_date) AS month, COALESCE(SUM(lr.days), 0) AS days
       FROM leave_requests lr
       ${chartJoin}
       WHERE lr.status = 'approved'
         AND lr.start_date >= date('now', '+5 hours', '30 minutes', '-5 months', 'start of month')
         ${chartWhereSql}
       GROUP BY strftime('%Y-%m', lr.start_date)
       ORDER BY month ASC`
    )
    .all(...chartParams);

  // Fill last 6 months including zeros (IST calendar)
  const months = [];
  const [ty, tm] = todayIst().split('-').map(Number);
  for (let i = 5; i >= 0; i -= 1) {
    const monthIndex = tm - 1 - i;
    const d = new Date(Date.UTC(ty, monthIndex, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const found = byMonthRows.find((r) => r.month === key);
    months.push({
      month: key,
      label: d.toLocaleString('en-IN', { month: 'short', timeZone: 'UTC' }),
      days: found ? found.days : 0,
    });
  }

  const allTypes = ['casual', 'earned', 'sick', 'compensation', 'wfh'];
  const byType = allTypes.map((type) => {
    const row = byTypeRows.find((r) => r.type === type);
    return { type, days: row ? row.days : 0, count: row ? row.count : 0 };
  });

  res.json({
    upcoming,
    todayOnLeave,
    byType,
    byMonth: months,
  });
});

// ——— Employee ratings ———
router.get('/ratings/employees', authRequired, managerOrHrRequired, async (req, res) => {
  const rows = (await db
    .prepare(
      `SELECT u.id, u.name, u.email, u.employee_number,
              m.name AS manager_name
       FROM users u
       LEFT JOIN users m ON m.id = u.manager_id
       WHERE u.role = 'user' AND u.active = 1
       ORDER BY u.name COLLATE NOCASE`
    )
    .all())
    .map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      employeeNumber: u.employee_number,
      managerName: u.manager_name,
    }));
  res.json({ employees: rows });
});

router.get('/ratings', authRequired, async (req, res) => {
  const { userId, managerId, from, to } = req.query;
  const clauses = ['1=1'];
  const params = [];

  if (req.user.role === 'user') {
    clauses.push('er.user_id = ?');
    params.push(req.user.id);
  } else if (req.user.role === 'manager') {
    if (managerId && Number(managerId) !== req.user.id) {
      return res.status(403).json({ error: 'Managers can only filter by their own ratings' });
    }
    clauses.push('er.manager_id = ?');
    params.push(req.user.id);
    if (userId) {
      clauses.push('er.user_id = ?');
      params.push(Number(userId));
    }
  } else if (req.user.role === 'hr') {
    if (userId) {
      clauses.push('er.user_id = ?');
      params.push(Number(userId));
    }
    if (managerId) {
      clauses.push('er.manager_id = ?');
      params.push(Number(managerId));
    }
  }

  if (from) {
    clauses.push('date(er.created_at) >= ?');
    params.push(from);
  }
  if (to) {
    clauses.push('date(er.created_at) <= ?');
    params.push(to);
  }

  const rows = (await db
    .prepare(
      `${RATING_SELECT} WHERE ${clauses.join(' AND ')} ORDER BY er.created_at DESC`
    )
    .all(...params))
    .map(mapRating);

  res.json({ ratings: rows });
});

router.post('/ratings', authRequired, managerRequired, async (req, res) => {
  const { userId, score, feedback, periodLabel } = req.body || {};
  const employeeId = Number(userId);
  const numericScore = Number(score);

  if (!employeeId) {
    return res.status(400).json({ error: 'userId is required' });
  }
  if (!Number.isFinite(numericScore) || numericScore < 1 || numericScore > 10) {
    return res.status(400).json({ error: 'score must be between 1 and 10' });
  }
  const trimmedFeedback = String(feedback || '').trim();
  if (trimmedFeedback.length < 10) {
    return res.status(400).json({ error: 'feedback is required (at least 10 characters)' });
  }

  const employee = await db
    .prepare(`SELECT id, name, role, active FROM users WHERE id = ?`)
    .get(employeeId);
  if (!employee || employee.role !== 'user' || !employee.active) {
    return res.status(400).json({ error: 'Invalid or inactive employee' });
  }

  const normalizedPeriod = periodLabel?.trim() || null;
  if (!normalizedPeriod) {
    return res.status(400).json({ error: 'period (month and year) is required' });
  }

  const existing = await db
    .prepare(
      `SELECT er.id, mgr.name AS manager_name
       FROM employee_ratings er
       LEFT JOIN users mgr ON mgr.id = er.manager_id
       WHERE er.user_id = ? AND er.period_label = ?`
    )
    .get(employeeId, normalizedPeriod);
  if (existing) {
    const by = existing.manager_name ? ` by ${existing.manager_name}` : '';
    return res.status(409).json({
      error: `A rating for ${normalizedPeriod} already exists for ${employee.name}${by}.`,
    });
  }

  let result;
  try {
    result = await db
      .prepare(
        `INSERT INTO employee_ratings (user_id, manager_id, score, feedback, period_label)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        employeeId,
        req.user.id,
        Math.round(numericScore),
        trimmedFeedback,
        normalizedPeriod
      );
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({
        error: `A rating for ${normalizedPeriod} already exists for ${employee.name}.`,
      });
    }
    throw err;
  }

  const rating = await getRatingById(result.lastInsertRowid);

  await notifyUser({
    userId: employeeId,
    leaveId: null,
    type: 'rating_received',
    title: 'New performance rating',
    message: `${req.user.name} rated you ${rating.score}/10. View feedback in My ratings.`,
  });

  res.status(201).json({ rating: mapRating(rating) });
});

// ——— Invoices ———
router.post('/invoices', authRequired, async (req, res) => {
  if (req.user.role !== 'user' && req.user.role !== 'manager') {
    return res.status(403).json({ error: 'Only employees and managers can submit invoices' });
  }

  const validated = validateInvoicePayload(req.body || {});
  if (validated.error) {
    return res.status(400).json({ error: validated.error });
  }

  const { data, totalAmount } = validated;
  // Cap stored PDF size (~8MB base64) so Postgres TEXT inserts stay healthy
  let pdfData = String(req.body?.pdfData || '').trim() || null;
  if (pdfData && pdfData.length > 8_000_000) {
    pdfData = null;
  }
  if (data.source === 'upload' && !pdfData) {
    return res.status(400).json({ error: 'Please upload an invoice PDF file' });
  }

  const duplicate = await db
    .prepare(
      `SELECT id FROM invoices
       WHERE user_id = ? AND invoice_number = ? AND submitter_deleted_at IS NULL`
    )
    .get(req.user.id, data.invoiceNumber);
  if (duplicate) {
    return res.status(409).json({
      error: `You already submitted invoice ${data.invoiceNumber}.`,
    });
  }

  let result;
  try {
    result = await db
      .prepare(
        `INSERT INTO invoices
           (user_id, invoice_number, invoice_date, billing_period, consultant, total_amount, data_json, pdf_data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        req.user.id,
        data.invoiceNumber,
        data.invoiceDate,
        data.billingPeriod,
        data.consultant,
        totalAmount,
        JSON.stringify(data),
        pdfData
      );
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({
        error: `You already submitted invoice ${data.invoiceNumber}.`,
      });
    }
    throw err;
  }

  const invoice = mapInvoice(
    await db.prepare(`${INVOICE_SELECT} WHERE i.id = ?`).get(result.lastInsertRowid)
  );

  const hrUsers = await db
    .prepare(`SELECT id FROM users WHERE role = 'hr' AND active = 1`)
    .all();
  for (const hr of hrUsers) {
    await notifyUser({
      userId: hr.id,
      leaveId: null,
      type: 'invoice_submitted',
      title: 'New invoice submitted',
      message: `${req.user.name} submitted invoice ${data.invoiceNumber} for ${data.billingPeriod}.`,
    });
  }

  res.status(201).json({ invoice });
});

router.get('/invoices/retention-policy', authRequired, (_req, res) => {
  res.json({ notice: INVOICE_RETENTION_NOTICE });
});

router.get('/invoices/mine', authRequired, async (req, res) => {
  await purgeExpiredInvoices(db);
  const rows = (await db
    .prepare(
      `${INVOICE_SELECT} WHERE i.user_id = ? AND i.submitter_deleted_at IS NULL ORDER BY i.created_at DESC`
    )
    .all(req.user.id))
    .map(mapInvoice);
  res.json({ invoices: rows, retentionNotice: INVOICE_RETENTION_NOTICE });
});

router.get('/invoices/submitters', authRequired, hrRequired, async (_req, res) => {
  const rows = (await db
    .prepare(
      `SELECT DISTINCT u.id, u.name, u.email, u.employee_number, u.role
       FROM invoices i
       JOIN users u ON u.id = i.user_id
       ORDER BY u.name COLLATE NOCASE`
    )
    .all())
    .map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      employeeNumber: u.employee_number,
      role: u.role,
    }));
  res.json({ users: rows });
});

router.get('/invoices', authRequired, hrRequired, async (req, res) => {
  await purgeExpiredInvoices(db);
  const { billingPeriod, userId } = req.query;
  const clauses = ['1=1'];
  const params = [];

  if (billingPeriod) {
    clauses.push('i.billing_period = ?');
    params.push(String(billingPeriod));
  }
  if (userId) {
    const id = Number(userId);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'Invalid employee filter' });
    }
    clauses.push('i.user_id = ?');
    params.push(id);
  }

  const rows = (await db
    .prepare(
      `${INVOICE_SELECT} WHERE ${clauses.join(' AND ')} ORDER BY i.created_at DESC`
    )
    .all(...params))
    .map(mapInvoice);

  res.json({ invoices: rows, retentionNotice: INVOICE_RETENTION_NOTICE });
});

router.delete('/invoices/:id', authRequired, async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    return res.status(400).json({ error: 'Invalid invoice id' });
  }

  const row = await db
    .prepare(`SELECT id, user_id, submitter_deleted_at FROM invoices WHERE id = ?`)
    .get(id);
  if (!row) {
    return res.status(404).json({ error: 'Invoice not found' });
  }

  const isOwner = row.user_id === req.user.id;
  const isHr = req.user.role === 'hr';
  if (!isOwner && !isHr) {
    return res.status(403).json({ error: 'Not allowed to delete this invoice' });
  }

  if (isHr) {
    await db.prepare(`DELETE FROM invoices WHERE id = ?`).run(id);
    return res.json({ ok: true, removed: true });
  }

  if (row.submitter_deleted_at) {
    return res.json({ ok: true, hidden: true });
  }

  await db
    .prepare(`UPDATE invoices SET submitter_deleted_at = ${SQL_NOW_IST} WHERE id = ?`)
    .run(id);
  res.json({ ok: true, hidden: true });
});

router.get('/invoices/:id', authRequired, async (req, res) => {
  const id = Number(req.params.id);
  const row = await db.prepare(`${INVOICE_SELECT} WHERE i.id = ?`).get(id);
  if (!row) return res.status(404).json({ error: 'Invoice not found' });

  if (req.user.role !== 'hr' && row.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Not allowed' });
  }
  if (req.user.role !== 'hr' && row.submitter_deleted_at) {
    return res.status(404).json({ error: 'Invoice not found' });
  }

  res.json({ invoice: mapInvoice(row) });
});

router.get('/invoices/:id/pdf', authRequired, async (req, res) => {
  const id = Number(req.params.id);
  const row = await db
    .prepare(`SELECT user_id, invoice_number, pdf_data, submitter_deleted_at FROM invoices WHERE id = ?`)
    .get(id);
  if (!row) return res.status(404).json({ error: 'Invoice not found' });

  if (req.user.role !== 'hr' && row.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Not allowed' });
  }
  if (req.user.role !== 'hr' && row.submitter_deleted_at) {
    return res.status(404).json({ error: 'Invoice not found' });
  }

  if (!row.pdf_data) {
    return res.status(404).json({ error: 'PDF not stored for this invoice' });
  }

  const base64 = row.pdf_data.replace(/^data:application\/pdf;base64,/, '');
  const buffer = Buffer.from(base64, 'base64');
  const filename = `${row.invoice_number || 'invoice'}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
});

export default router;
