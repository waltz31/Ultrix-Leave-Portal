import './time.js';
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import db from './db.js';
import routes from './routes.js';
import { slackStatus } from './slack.js';

await db.ready;

const app = express();
const PORT = process.env.PORT || 4000;

const allowedOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const allowVercelPreviews = allowedOrigins.some((o) =>
  /\.vercel\.app$/i.test(o)
);

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
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    timezone: 'Asia/Kolkata',
    db: db.dialect,
    slack: slackStatus(),
  });
});

app.use('/api', routes);

app.use((err, _req, res, _next) => {
  console.error(err);
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
