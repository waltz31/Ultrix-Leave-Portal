# Email notifications (Gmail no-reply)

Leave apply / approve / reject / cancel emails are sent with **Nodemailer** over **Gmail SMTP** from a no-reply address.

## Setup

1. Create or pick a mailbox (e.g. `noreply@yourcompany.com`).
2. Turn on **2-Step Verification** for that Google account.
3. Open [Google Account → Security → App passwords](https://myaccount.google.com/apppasswords) and create an app password for **Mail**.
4. Copy `server/.env.example` values into `server/.env` and set:

```bash
MAIL_ENABLED=true
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=noreply@yourcompany.com
SMTP_PASS=xxxx-xxxx-xxxx-xxxx
MAIL_FROM="Ultrix Leave Portal <noreply@yourcompany.com>"
APP_PUBLIC_URL=https://your-portal-url
```

5. Restart the API (`npm run dev` in `server/`).

With `MAIL_ENABLED=false` (or missing credentials), the portal still works; emails are skipped silently.

## Email templates

Templates live in [`src/mailTemplates.js`](src/mailTemplates.js). Each event uses a branded HTML layout with status badge, leave details, next-step guidance, and a portal button.

| Event | Who receives email | Template |
|-------|-------------------|----------|
| Employee applies | Employee (confirmation) + Manager (action required) | `leaveAppliedEmployee`, `leaveAppliedManager` |
| Manager approves | Employee (pending HR) + HR (your approval needed) | `managerApprovedEmployee`, `managerApprovedHr` |
| HR approves | Employee + Manager | `hrApprovedEmployee`, `hrApprovedManager` |
| Rejected | Employee (+ Manager if HR rejected) | `rejectedEmployee`, `rejectedManager` |
| Cancelled | Manager/HR + Employee confirmation | `cancelledNotify`, `cancelledEmployee` |
