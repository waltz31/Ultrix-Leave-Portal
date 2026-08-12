import './time.js';
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import db from './db.js';
import routes from './routes.js';
import { slackStatus } from './slack.js';
import { purgeExpiredInvoices } from './invoiceCleanup.js';

const app = express();
const PORT = process.env.PORT || 4000;
let dbReady = false;

const allowedOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const allowVercelPreviews =
  process.env.NODE_ENV === 'production' ||
  allowedOrigins.some((o) => /\.vercel\.app$/i.test(o));

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      if (allowVercelPreviews && /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
  })
);
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

app.get('/api/health', (_req, res) => {
  if (!dbReady) {
    return res.status(503).json({
      ok: false,
      status: 'starting',
      timezone: 'Asia/Kolkata',
    });
  }
  res.json({
    ok: true,
    timezone: 'Asia/Kolkata',
    db: db.dialect,
    slack: slackStatus(),
  });
});

app.use('/api', async (req, res, next) => {
  if (!dbReady) {
    return res.status(503).json({ error: 'Server is starting, please retry in a few seconds' });
  }
  return next();
});

app.use('/api', routes);

app.use((err, _req, res, _next) => {
  console.error(err);
  if (err?.type === 'entity.too.large' || err?.status === 413) {
    return res.status(413).json({
      error: 'Invoice file is too large. Try submitting without a long signature image, or download PDF only.',
    });
  }
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  const slack = slackStatus();
  console.log(`Leave Portal API running on port ${PORT} (IST, ${db.dialect})`);
  console.log(
    slack.configured
      ? `Slack: ${slack.mode} → ${slack.channel || 'webhook'}`
      : 'Slack: off (missing SLACK_BOT_TOKEN / SLACK_LEAVE_CHANNEL)'
  );
});

try {
  await db.ready;
  dbReady = true;
  console.log('Database ready');

  async function runInvoiceCleanup() {
    try {
      const removed = await purgeExpiredInvoices(db);
      if (removed > 0) {
        console.log(`Invoice cleanup: removed ${removed} expired invoice(s)`);
      }
    } catch (err) {
      console.error('Invoice cleanup failed:', err);
    }
  }

  runInvoiceCleanup();
  setInterval(runInvoiceCleanup, 24 * 60 * 60 * 1000);
} catch (err) {
  console.error('Fatal database startup error:', err);
  process.exit(1);
}
