/**
 * Leave email notifications via Gmail SMTP (Nodemailer).
 *
 * Templates: server/src/mailTemplates.js
 * Setup: server/EMAIL.md
 */

import nodemailer from 'nodemailer';
import db from './db.js';
import { renderTemplate } from './mailTemplates.js';

function envFlag(name, fallback = false) {
  const raw = String(process.env[name] ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function portalBaseUrl() {
  return String(process.env.APP_PUBLIC_URL || process.env.CLIENT_ORIGIN || '').trim().replace(/\/$/, '');
}

function mailFrom() {
  return String(
    process.env.MAIL_FROM || process.env.SMTP_USER || 'Ultrix Leave Portal <noreply@localhost>'
  ).trim();
}

function mailEnabled() {
  if (!envFlag('MAIL_ENABLED', false)) return false;
  return Boolean(String(process.env.SMTP_USER || '').trim() && String(process.env.SMTP_PASS || '').trim());
}

let transporter;

function getTransporter() {
  if (!mailEnabled()) return null;
  if (transporter) return transporter;

  const port = Number(process.env.SMTP_PORT || 465);
  const secure =
    String(process.env.SMTP_SECURE || '').trim() === ''
      ? port === 465
      : envFlag('SMTP_SECURE', port === 465);

  transporter = nodemailer.createTransport({
    host: String(process.env.SMTP_HOST || 'smtp.gmail.com').trim(),
    port,
    secure,
    auth: {
      user: String(process.env.SMTP_USER || '').trim(),
      pass: String(process.env.SMTP_PASS || '').trim(),
    },
  });
  return transporter;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function statusColors(tone) {
  switch (tone) {
    case 'success':
      return { bg: '#e6f7f0', text: '#0d5c57', border: '#64c5c1' };
    case 'action':
      return { bg: '#fff4e0', text: '#8a5a14', border: '#ffd27a' };
    case 'danger':
      return { bg: '#fde8ea', text: '#8a1f2d', border: '#ff7b8a' };
    case 'muted':
      return { bg: '#f0f2f5', text: '#555', border: '#ccc' };
    default:
      return { bg: '#e8f4ff', text: '#1a5f8a', border: '#7ec8ff' };
  }
}

function buildMailBodies(template) {
  const base = portalBaseUrl();
  const ctaUrl = base && template.ctaPath ? `${base}${template.ctaPath}` : base || null;

  const detailLines = template.rows.map((r) => `${r.label}: ${r.value}`);
  const textParts = [
    template.heading,
    '',
    `Status: ${template.status}`,
    '',
    template.intro,
    '',
    'Leave details:',
    ...detailLines.map((l) => `  ${l}`),
    '',
    'Next step:',
    template.nextStep,
  ];
  if (ctaUrl) textParts.push('', `${template.ctaLabel}: ${ctaUrl}`);
  textParts.push('', '—', 'Automated message from Ultrix Leave Portal. Please do not reply.');
  const text = textParts.join('\n');

  const colors = statusColors(template.statusTone);
  const rowsHtml = template.rows
    .map(
      (r) => `<tr>
        <td style="padding:10px 14px;border-bottom:1px solid #eef1f4;color:#667085;width:120px;font-weight:600;">${escapeHtml(r.label)}</td>
        <td style="padding:10px 14px;border-bottom:1px solid #eef1f4;color:#152033;">${escapeHtml(r.value)}</td>
      </tr>`
    )
    .join('');

  const ctaHtml = ctaUrl
    ? `<p style="margin:24px 0 0;text-align:center;">
        <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:linear-gradient(90deg,#64c5c1,#b5a3ed);color:#101526;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px;">${escapeHtml(template.ctaLabel)}</a>
       </p>`
    : '';

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f7fb;font-family:'Segoe UI',system-ui,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7fb;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:560px;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e4e9f0;box-shadow:0 8px 24px rgba(21,32,51,0.08);">
        <tr><td style="background:linear-gradient(90deg,#64c5c1,#b5a3ed);padding:20px 24px;">
          <div style="font-size:13px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:rgba(16,21,38,0.75);">Ultrix Leave Portal</div>
          <div style="font-size:22px;font-weight:700;color:#101526;margin-top:4px;">${escapeHtml(template.heading)}</div>
        </td></tr>
        <tr><td style="padding:24px;">
          <span style="display:inline-block;padding:6px 12px;border-radius:999px;background:${colors.bg};color:${colors.text};border:1px solid ${colors.border};font-size:12px;font-weight:700;">${escapeHtml(template.status)}</span>
          <p style="margin:16px 0 0;font-size:15px;line-height:1.55;color:#152033;">${escapeHtml(template.intro)}</p>
          <table role="presentation" width="100%" style="margin:20px 0 0;border:1px solid #eef1f4;border-radius:12px;overflow:hidden;border-collapse:collapse;">
            ${rowsHtml}
          </table>
          <div style="margin-top:20px;padding:14px 16px;background:#f8fafc;border-radius:12px;border-left:4px solid #64c5c1;">
            <div style="font-size:12px;font-weight:700;color:#667085;text-transform:uppercase;letter-spacing:0.04em;">Next step</div>
            <div style="font-size:14px;color:#152033;margin-top:6px;line-height:1.5;">${escapeHtml(template.nextStep)}</div>
          </div>
          ${ctaHtml}
          <p style="margin:28px 0 0;font-size:12px;color:#98a2b3;line-height:1.5;">This is an automated no-reply email from Ultrix Leave Portal.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  return { text, html, subject: template.subject };
}

async function nameForUserId(userId) {
  if (!userId) return null;
  const row = await db.prepare('SELECT name FROM users WHERE id = ?').get(userId);
  return row?.name || null;
}

async function emailsForUserIds(userIds) {
  const unique = [...new Set((userIds || []).filter(Boolean))];
  if (!unique.length) return [];
  const placeholders = unique.map(() => '?').join(',');
  const rows = await db
    .prepare(
      `SELECT email FROM users
       WHERE id IN (${placeholders}) AND active = 1 AND email IS NOT NULL AND TRIM(email) != ''`
    )
    .all(...unique);
  return rows.map((r) => r.email).filter(Boolean);
}

export async function sendMail({ to, subject, text, html }) {
  const tx = getTransporter();
  if (!tx) return { skipped: true };

  const recipients = Array.isArray(to) ? to.filter(Boolean) : [to].filter(Boolean);
  if (!recipients.length) return { skipped: true, reason: 'no recipients' };

  try {
    const info = await tx.sendMail({
      from: mailFrom(),
      to: recipients.join(', '),
      subject,
      text,
      html,
    });
    return { ok: true, messageId: info.messageId };
  } catch (err) {
    console.error('Mail send failed:', err.message || err);
    return { ok: false, error: err.message || String(err) };
  }
}

async function sendTemplatedMail({ toUserIds, templateKey, ctx }) {
  const to = await emailsForUserIds(toUserIds);
  if (!to.length) return { skipped: true };

  const { text, html, subject } = buildMailBodies(renderTemplate(templateKey, ctx));
  return sendMail({ to, subject, text, html });
}

async function sendTemplatedMailToUsers({ toUserIds, templateKey, ctxBuilder, ctx }) {
  const unique = [...new Set((toUserIds || []).filter(Boolean))];
  const results = [];
  const builder = ctxBuilder || (typeof ctx === 'function' ? ctx : null);
  for (const userId of unique) {
    const recipientName = await nameForUserId(userId);
    const built = builder
      ? await builder({ recipientName, userId })
      : { recipientName, userId, ...(ctx && typeof ctx === 'object' ? ctx : {}) };
    results.push(
      sendTemplatedMail({
        toUserIds: [userId],
        templateKey,
        ctx: built,
      })
    );
  }
  if (!results.length) return { skipped: true };
  return Promise.all(results);
}

/** Employee confirmation + manager notification on apply. */
export async function mailLeaveApplied({
  employeeId,
  managerId,
  employeeName,
  managerName,
  leaveType,
  startDate,
  endDate,
  days,
  session,
  reason,
}) {
  const base = {
    employeeName,
    managerName,
    leaveType,
    startDate,
    endDate,
    days,
    session,
    reason,
  };

  await sendTemplatedMail({
    toUserIds: [employeeId],
    templateKey: 'leaveAppliedEmployee',
    ctx: { ...base, recipientName: employeeName },
  });

  return sendTemplatedMail({
    toUserIds: [managerId],
    templateKey: 'leaveAppliedManager',
    ctx: { ...base, recipientName: managerName },
  });
}

/** Employee + HR when manager approves. */
export async function mailManagerApproved({
  employeeId,
  hrUserIds,
  employeeName,
  managerName,
  leaveType,
  startDate,
  endDate,
  days,
  session,
  note,
}) {
  const base = {
    employeeName,
    managerName,
    leaveType,
    startDate,
    endDate,
    days,
    session,
    note,
  };

  await sendTemplatedMail({
    toUserIds: [employeeId],
    templateKey: 'managerApprovedEmployee',
    ctx: { ...base, recipientName: employeeName },
  });

  return sendTemplatedMailToUsers({
    toUserIds: hrUserIds,
    templateKey: 'managerApprovedHr',
    ctx: ({ recipientName }) => ({ ...base, recipientName }),
  });
}

/** Employee + manager when HR gives final approval. */
export async function mailHrApproved({
  employeeId,
  managerId,
  employeeName,
  managerName,
  leaveType,
  startDate,
  endDate,
  days,
  session,
  note,
}) {
  const base = {
    employeeName,
    managerName,
    leaveType,
    startDate,
    endDate,
    days,
    session,
    note,
  };

  await sendTemplatedMail({
    toUserIds: [employeeId],
    templateKey: 'hrApprovedEmployee',
    ctx: { ...base, recipientName: employeeName },
  });

  return sendTemplatedMail({
    toUserIds: [managerId],
    templateKey: 'hrApprovedManager',
    ctx: { ...base, recipientName: managerName },
  });
}

export async function mailRejected({
  employeeId,
  managerId,
  byRole,
  employeeName,
  managerName,
  leaveType,
  startDate,
  endDate,
  days,
  session,
  note,
}) {
  const base = {
    byRole,
    employeeName,
    managerName,
    leaveType,
    startDate,
    endDate,
    days,
    session,
    note,
  };

  await sendTemplatedMail({
    toUserIds: [employeeId],
    templateKey: 'rejectedEmployee',
    ctx: { ...base, recipientName: employeeName },
  });

  if (byRole === 'hr' && managerId) {
    return sendTemplatedMail({
      toUserIds: [managerId],
      templateKey: 'rejectedManager',
      ctx: { ...base, recipientName: managerName },
    });
  }
  return { ok: true };
}

export async function mailCancelled({
  targetUserIds,
  employeeId,
  employeeName,
  leaveType,
  startDate,
  endDate,
  days,
  session,
  partial,
  cancelDate,
  message,
  employeeMessage,
}) {
  const base = {
    employeeName,
    leaveType,
    startDate,
    endDate,
    days,
    session,
    partial,
    cancelDate,
    message,
    employeeMessage,
  };

  await sendTemplatedMailToUsers({
    toUserIds: targetUserIds,
    templateKey: 'cancelledNotify',
    ctxBuilder: async ({ recipientName, userId }) => {
      const role = (await db.prepare('SELECT role FROM users WHERE id = ?').get(userId))?.role;
      return {
        ...base,
        recipientName,
        audience: role === 'hr' ? 'hr' : 'manager',
      };
    },
  });

  return sendTemplatedMail({
    toUserIds: [employeeId],
    templateKey: 'cancelledEmployee',
    ctx: { ...base, recipientName: employeeName },
  });
}

export async function getUserEmail(userId) {
  if (!userId) return null;
  const row = await db
    .prepare(
      `SELECT email FROM users
       WHERE id = ? AND active = 1 AND email IS NOT NULL AND TRIM(email) != ''`
    )
    .get(userId);
  return row?.email || null;
}
