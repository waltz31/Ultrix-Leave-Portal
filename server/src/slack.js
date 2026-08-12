/**
 * Slack leave notifications.
 *
 * Preferred: Bot API
 *   SLACK_BOT_TOKEN=xoxb-...
 *   SLACK_LEAVE_CHANNEL=C...   (channel ID) or #channel-name
 *
 * Fallback: Incoming Webhook
 *   SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
 *
 * Optional:
 *   APP_PUBLIC_URL / CLIENT_ORIGIN — "Open portal" button
 */

function botToken() {
  return String(process.env.SLACK_BOT_TOKEN || '').trim();
}

function leaveChannel() {
  return String(process.env.SLACK_LEAVE_CHANNEL || '').trim();
}

function webhookUrl() {
  return String(process.env.SLACK_WEBHOOK_URL || '').trim();
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

function buildLeavePayload({
  employeeName,
  managerName,
  leaveType,
  startDate,
  endDate,
  days,
  session,
  reason,
}) {
  const typeLabel = leaveType === 'wfh' ? 'WFH' : `${leaveType} leave`;
  const sessionLabel =
    session && session !== 'full'
      ? session === 'morning'
        ? 'Morning'
        : 'Afternoon'
      : 'Full day';
  const dateRange =
    startDate === endDate ? startDate : `${startDate} → ${endDate}`;
  const link = portalUrl();

  const text = `${employeeName} submitted a ${typeLabel} request (${dateRange})`;

  const fields = [
    { type: 'mrkdwn', text: `*Employee*\n${escapeMrkdwn(employeeName)}` },
    { type: 'mrkdwn', text: `*Manager*\n${escapeMrkdwn(managerName || '—')}` },
    { type: 'mrkdwn', text: `*Type*\n${escapeMrkdwn(typeLabel)}` },
    { type: 'mrkdwn', text: `*Session*\n${sessionLabel}` },
    { type: 'mrkdwn', text: `*Dates*\n${escapeMrkdwn(dateRange)}` },
    { type: 'mrkdwn', text: `*Days*\n${days}` },
  ];

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'New leave request', emoji: true },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${escapeMrkdwn(employeeName)} submitted a *${escapeMrkdwn(typeLabel)}* request. Pending manager approval — HR will review after the manager approves.`,
      },
    },
    { type: 'section', fields },
  ];

  if (reason?.trim()) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Reason*\n${escapeMrkdwn(reason.trim())}`,
      },
    });
  }

  if (link) {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Open portal', emoji: true },
          url: link.startsWith('http') ? link : `https://${link}`,
        },
      ],
    });
  }

  return { text, blocks };
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
      console.error('Slack chat.postMessage failed:', data.error || res.status);
      return { ok: false, error: data.error };
    }
    return { ok: true };
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

export async function notifyLeaveApplied(details) {
  const payload = buildLeavePayload(details);

  if (botToken() && leaveChannel()) {
    return postViaBot(payload);
  }
  if (webhookUrl()) {
    return postViaWebhook(payload);
  }

  return { skipped: true };
}
