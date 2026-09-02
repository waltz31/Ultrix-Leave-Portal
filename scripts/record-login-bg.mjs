import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = dirname(fileURLToPath(import.meta.url));
const outDir = join(root, '../client/public/assets');
const chrome =
  process.env.CHROME_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const url = process.env.BG_URL || 'http://127.0.0.1:5173/login-bg-scene.html';
const seconds = Number(process.env.BG_SECONDS || 16);

mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: chrome,
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'],
});

const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForSelector('canvas');
await page.waitForTimeout(400);

const buffer = await page.evaluate(async (ms) => {
  const canvas = document.querySelector('canvas');
  const stream = canvas.captureStream(30);
  const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ? 'video/webm;codecs=vp9'
    : 'video/webm';
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
  const chunks = [];
  rec.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  rec.start(500);
  await new Promise((r) => setTimeout(r, ms));
  rec.stop();
  await new Promise((r) => {
    rec.onstop = r;
  });
  const blob = new Blob(chunks, { type: 'video/webm' });
  const buf = await blob.arrayBuffer();
  return Array.from(new Uint8Array(buf));
}, seconds * 1000);

const out = join(outDir, 'login-bg.webm');
writeFileSync(out, Buffer.from(buffer));
await browser.close();
console.log('Wrote', out, 'bytes', buffer.length);
