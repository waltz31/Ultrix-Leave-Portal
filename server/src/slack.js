/**
 * Slack leave notifications + interactive approve/reject.
 *
 * Preferred: Bot API (required for Approve/Reject buttons)
 *   SLACK_BOT_TOKEN=xoxb-...
 *   SLACK_LEAVE_CHANNEL=C...   (channel ID) or #channel-name
 *   SLACK_SIGNING_SECRET=...   (Interactivity → Signing Secret)
 *
 * Bot scopes needed:
 *   chat:write, users:read, users:read.email
 *
 * Interactivity Request URL:
 *   https://YOUR_API/api/slack/interactions
 *
 * Fallback (notify only, no buttons): Incoming Webhook
 *   SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
 *
 * Optional:
 *   APP_PUBLIC_URL / CLIENT_ORIGIN — "Open portal" button
 */

import crypto from 'crypto';
import db from './db.js';
import { LeaveReviewError, reviewLeaveRequest } from './leaveReview.js';

function botToken() {
  return String(process.env.SLACK_BOT_TOKEN || '').trim();
}

function leaveChannel() {
  return String(process.env.SLACK_LEAVE_CHANNEL || '').trim();
}

function webhookUrl() {
  return String(process.env.SLACK_WEBHOOK_URL || '').trim();
}

function signingSecret() {
  return String(process.env.SLACK_SIGNING_SECRET || '').trim();
}

function portalUrl() {
  return String(process.env.APP_PUBLIC_URL || process.env.CLIENT_ORIGIN || '').trim();
}

function escapeMrkdwn(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function typeLabel(leaveType) {
  if (leaveType === 'wfh') return 'Work from Home';
  if (leaveType === 'casual') return 'Casual Leave';
  if (leaveType === 'earned') return 'Earned Leave';
  if (leaveType === 'sick') return 'Sick Leave';
  if (leaveType === 'compensation') return 'Compensation Leave';
  return leaveType ? `${leaveType} leave` : 'Leave';
}

function sessionLabel(session) {
  if (session === 'morning') return 'Morning';
  if (session === 'afternoon') return 'Afternoon';
  return 'Full day';
}

function eventCopy(event, { employeeName, managerName, hrName, typeLabel: type }) {
  switch (event) {
    case 'manager_approved':
      return {
        header: 'Manager approved',
        text: `${managerName || 'Manager'} approved ${employeeName}'s ${type} — pending HR`,
        body: `*${escapeMrkdwn(managerName || 'Manager')}* approved *${escapeMrkdwn(employeeName)}*'s *${escapeMrkdwn(type)}* request. Waiting for HR final approval.`,
      };
    case 'hr_approved':
      return {
        header: 'Leave fully approved',
        text: `HR approved ${employeeName}'s ${type}`,
        body: `*${escapeMrkdwn(hrName || 'HR')}* fully approved *${escapeMrkdwn(employeeName)}*'s *${escapeMrkdwn(type)}* request.`,
      };
    case 'applied_hr':
      return {
        header: 'New leave request',
        text: `${employeeName} submitted a ${type} request`,
        body: `${escapeMrkdwn(employeeName)} submitted a *${escapeMrkdwn(type)}* request with no manager assigned. Needs HR approval.`,
      };
    case 'applied':
    default:
      return {
        header: 'New leave request',
        text: `${employeeName} submitted a ${type} request`,
        body: `${escapeMrkdwn(employeeName)} submitted a *${escapeMrkdwn(type)}* request. Pending manager approval — HR will review after the manager approves.`,
      };
  }
}

/** stage: 'manager' | 'hr' | null — buttons only when bot + signing secret are configured */
function actionButtons(leaveId, stage) {
  if (!leaveId || !stage || !botToken() || !signingSecret()) return null;
  const value = `${Number(leaveId)}:${stage}`;
  return {
    type: 'actions',
    block_id: `leave_actions_${leaveId}`,
    elements: [
      {
        type: 'button',
        action_id: 'leave_approve',
        text: {
          type: 'plain_text',
          text: stage === 'hr' ? 'Approve (HR)' : 'Approve (Manager)',
          emoji: true,
        },
        style: 'primary',
        value,
      },
      {
        type: 'button',
        action_id: 'leave_reject',
        text: {
          type: 'plain_text',
          text: stage === 'hr' ? 'Reject (HR)' : 'Reject (Manager)',
          emoji: true,
        },
        style: 'danger',
        value,
      },
    ],
  };
}

function buildLeavePayload({
  event = 'applied',
  leaveId,
  stage,
  employeeName,
  managerName,
  hrName,
  leaveType,
  startDate,
  endDate,
  days,
  session,
  reason,
  note,
}) {
  const type = typeLabel(leaveType);
  const dateRange =
    startDate === endDate || !endDate ? startDate : `${startDate} → ${endDate}`;
  const link = portalUrl();
  const copy = eventCopy(event, { employeeName, managerName, hrName, typeLabel: type });

  const fields = [
    { type: 'mrkdwn', text: `*Employee*\n${escapeMrkdwn(employeeName)}` },
    { type: 'mrkdwn', text: `*Manager*\n${escapeMrkdwn(managerName || '—')}` },
    { type: 'mrkdwn', text: `*Type*\n${escapeMrkdwn(type)}` },
    { type: 'mrkdwn', text: `*Session*\n${sessionLabel(session)}` },
    { type: 'mrkdwn', text: `*Dates*\n${escapeMrkdwn(dateRange)}` },
    { type: 'mrkdwn', text: `*Days*\n${days}` },
  ];

  if (leaveId) {
    fields.push({ type: 'mrkdwn', text: `*Request*\n#${leaveId}` });
  }
  if (event === 'hr_approved' && hrName) {
    fields.push({ type: 'mrkdwn', text: `*Approved by HR*\n${escapeMrkdwn(hrName)}` });
  }
  if (event === 'manager_approved' && managerName) {
    fields.push({ type: 'mrkdwn', text: `*Approved by*\n${escapeMrkdwn(managerName)}` });
  }

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: copy.header, emoji: true },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: copy.body,
      },
    },
    { type: 'section', fields },
  ];

  const noteText = (note || reason || '').trim();
  if (noteText) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${event === 'applied' || event === 'applied_hr' ? 'Reason' : 'Note'}*\n${escapeMrkdwn(noteText)}`,
      },
    });
  }

  const actions = [];
  const reviewButtons = actionButtons(leaveId, stage);
  if (reviewButtons) actions.push(...reviewButtons.elements);
  if (link) {
    actions.push({
      type: 'button',
      text: { type: 'plain_text', text: 'Open portal', emoji: true },
      url: link.startsWith('http') ? link : `https://${link}`,
    });
  }
  if (actions.length) {
    blocks.push({
      type: 'actions',
      block_id: reviewButtons?.block_id || `leave_links_${leaveId || 'x'}`,
      elements: actions.slice(0, 5),
    });
  }

  return { text: copy.text, blocks };
}

async function postViaBot(payload) {
  const token = botToken();
  const channel = leaveChannel();
  if (!token || !channel) return { skipped: true };

  try {
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        channel,
        text: payload.text,
        blocks: payload.blocks,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) {
      console.error(
        `Slack chat.postMessage failed (${channel}):`,
        data.error || res.status
      );
      return { ok: false, error: data.error };
    }
    console.log(`Slack: posted leave update to ${channel}`);
    return { ok: true, ts: data.ts, channel: data.channel };
  } catch (err) {
    console.error('Slack bot error:', err.message);
    return { ok: false };
  }
}

async function postViaWebhook(payload) {
  const url = webhookUrl();
  if (!url) return { skipped: true };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`Slack webhook failed (${res.status}): ${body}`);
      return { ok: false };
    }
    return { ok: true };
  } catch (err) {
    console.error('Slack webhook error:', err.message);
    return { ok: false };
  }
}

export function slackStatus() {
  const token = botToken();
  const channel = leaveChannel();
  const webhook = webhookUrl();
  const secret = signingSecret();
  return {
    configured: Boolean((token && channel) || webhook),
    mode: token && channel ? 'bot' : webhook ? 'webhook' : 'off',
    channel: channel || null,
    interactions: Boolean(token && secret),
  };
}

async function postLeaveNotification(details) {
  const payload = buildLeavePayload(details);

  if (botToken() && leaveChannel()) {
    return postViaBot(payload);
  }
  if (webhookUrl()) {
    // Webhooks cannot host interactive buttons reliably
    const { blocks } = payload;
    const safeBlocks = blocks.filter((b) => b.type !== 'actions' || !b.elements?.some((e) => e.action_id));
    const linkOnly = blocks.find((b) => b.type === 'actions');
    if (linkOnly) {
      const urlBtns = linkOnly.elements.filter((e) => e.url);
      if (urlBtns.length) {
        safeBlocks.push({ type: 'actions', elements: urlBtns });
      }
    }
    return postViaWebhook({ text: payload.text, blocks: safeBlocks });
  }

  console.warn(
    'Slack: skipped leave notification (set SLACK_BOT_TOKEN + SLACK_LEAVE_CHANNEL, or SLACK_WEBHOOK_URL)'
  );
  return { skipped: true };
}

export async function notifyLeaveApplied(details) {
  const stage = details.stage || (details.managerName === 'None (HR)' ? 'hr' : 'manager');
  const event = stage === 'hr' ? 'applied_hr' : 'applied';
  return postLeaveNotification({ ...details, event, stage });
}

export async function notifyLeaveManagerApproved(details) {
  return postLeaveNotification({
    ...details,
    event: 'manager_approved',
    stage: 'hr',
  });
}

export async function notifyLeaveHrApproved(details) {
  return postLeaveNotification({
    ...details,
    event: 'hr_approved',
    stage: null,
  });
}

export function verifySlackSignature(req) {
  const secret = signingSecret();
  if (!secret) return false;
  const timestamp = req.headers['x-slack-request-timestamp'];
  const signature = req.headers['x-slack-signature'];
  if (!timestamp || !signature) return false;

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 60 * 5) return false;

  const rawBody = req.rawBody;
  if (!rawBody) return false;

  const base = `v0:${timestamp}:${rawBody}`;
  const digest = `v0=${crypto.createHmac('sha256', secret).update(base).digest('hex')}`;
  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(String(signature)));
  } catch {
    return false;
  }
}

async function slackUserEmail(slackUserId) {
  const token = botToken();
  if (!token || !slackUserId) return null;
  try {
    const res = await fetch(
      `https://slack.com/api/users.info?user=${encodeURIComponent(slackUserId)}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    const data = await res.json().catch(() => ({}));
    if (!data.ok) {
      console.error('Slack users.info failed:', data.error);
      return null;
    }
    return (
      data.user?.profile?.email ||
      data.user?.profile?.email_address ||
      null
    );
  } catch (err) {
    console.error('Slack users.info error:', err.message);
    return null;
  }
}

async function findPortalActorByEmail(email) {
  if (!email) return null;
  return db
    .prepare(
      `SELECT * FROM users
       WHERE lower(email) = lower(?)
         AND role IN ('manager', 'hr')
         AND active = 1`
    )
    .get(String(email).trim());
}

async function postResponseUrl(responseUrl, body) {
  if (!responseUrl) return;
  try {
    await fetch(responseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error('Slack response_url error:', err.message);
  }
}

function stripActionBlocks(blocks = []) {
  return (blocks || []).filter((b) => b.type !== 'actions');
}

/**
 * Express handler for Slack interactive components.
 * Expects urlencoded body with `payload` and `req.rawBody` for signature verify.
 */
export async function handleSlackInteraction(req, res) {
  let payload = null;
  try {
    payload = JSON.parse(req.body?.payload || '{}');
  } catch {
    return res.status(400).send('invalid payload');
  }

  if (payload?.type === 'url_verification') {
    return res.json({ challenge: payload.challenge });
  }

  const signatureOk = verifySlackSignature(req);
  if (!signatureOk) {
    console.error(
      'Slack interaction rejected: missing/invalid SLACK_SIGNING_SECRET or bad signature'
    );
    // Ack so Slack does not show a generic "server error" (do not trust response_url).
    return res.status(200).send();
  }

  if (payload.type !== 'block_actions') {
    return res.status(200).send();
  }

  const action = payload.actions?.[0];
  if (!action || !['leave_approve', 'leave_reject'].includes(action.action_id)) {
    return res.status(200).send();
  }

  // Acknowledge quickly; finish work async via response_url
  res.status(200).send();

  const [leaveIdRaw, stage] = String(action.value || '').split(':');
  const leaveId = Number(leaveIdRaw);
  const reviewAction = action.action_id === 'leave_approve' ? 'approve' : 'reject';
  const slackUserId = payload.user?.id;
  const responseUrl = payload.response_url;
  const originalBlocks = payload.message?.blocks || [];

  const fail = async (text) => {
    await postResponseUrl(responseUrl, {
      replace_original: false,
      response_type: 'ephemeral',
      text,
    });
  };

  if (!leaveId || !['manager', 'hr'].includes(stage)) {
    await fail('Could not read leave request from this button.');
    return;
  }

  try {
    const email = await slackUserEmail(slackUserId);
    if (!email) {
      await fail(
        'Could not read your Slack email. Ask an admin to grant the bot `users:read.email`, and ensure your Slack profile email matches your leave portal login.'
      );
      return;
    }

    const actor = await findPortalActorByEmail(email);
    if (!actor) {
      await fail(
        `No active manager/HR account found for ${email}. Use the same work email as the leave portal.`
      );
      return;
    }

    if (stage === 'manager' && actor.role !== 'manager') {
      await fail('Only the employee’s manager can use Manager Approve/Reject.');
      return;
    }
    if (stage === 'hr' && actor.role !== 'hr') {
      await fail('Only HR can use HR Approve/Reject.');
      return;
    }

    const result = await reviewLeaveRequest({
      leaveId,
      action: reviewAction,
      actor,
      note: `Via Slack by ${actor.name}`,
    });

    const verb = result.outcome === 'approved' ? 'approved' : 'rejected';
    const who = actor.role === 'hr' ? 'HR' : 'Manager';
    const statusLine = {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `✅ *${who} ${verb}* by *${escapeMrkdwn(actor.name)}* via Slack.`,
      },
    };

    await postResponseUrl(responseUrl, {
      replace_original: true,
      text: `Leave #${leaveId} ${verb} by ${actor.name}`,
      blocks: [...stripActionBlocks(originalBlocks), statusLine],
    });
  } catch (err) {
    const message =
      err instanceof LeaveReviewError
        ? err.message
        : err?.message || 'Could not update leave request';
    console.error('Slack leave review failed:', message);
    await fail(message);
  }
}
