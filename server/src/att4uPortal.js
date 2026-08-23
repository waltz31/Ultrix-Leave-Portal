import crypto from 'crypto';
import http from 'http';
import https from 'https';

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 4 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 4 });

const MONTHS = {
  jan: '01',
  feb: '02',
  mar: '03',
  apr: '04',
  may: '05',
  jun: '06',
  jul: '07',
  aug: '08',
  sep: '09',
  oct: '10',
  nov: '11',
  dec: '12',
};

function htmlAttr(tag, name) {
  const m = String(tag).match(new RegExp(`\\b${name}="([^"]*)"`, 'i'));
  return m ? m[1] : '';
}

function inputValue(html, idOrName) {
  const re = new RegExp(
    `<input[^>]*(?:id|name)="${idOrName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`,
    'i'
  );
  const tag = html.match(re)?.[0];
  return tag ? htmlAttr(tag, 'value') : '';
}

function encryptPortalPassword(plain, key) {
  const buf = Buffer.from(String(key), 'utf8');
  if (buf.length !== 16) {
    throw new Error('att4u login key is not 16 bytes');
  }
  const cipher = crypto.createCipheriv('aes-128-ecb', buf, null);
  return cipher.update(String(plain), 'utf8', 'base64') + cipher.final('base64');
}

function cookieStore() {
  const map = new Map();
  return {
    absorbSetCookie(rawList) {
      const list = Array.isArray(rawList) ? rawList : rawList ? [rawList] : [];
      for (const cookie of list) {
        const nv = String(cookie).split(';')[0];
        const i = nv.indexOf('=');
        if (i <= 0) continue;
        const name = nv.slice(0, i).trim();
        const value = nv.slice(i + 1).trim();
        if (!name) continue;
        if (!value) {
          map.delete(name);
          continue;
        }
        map.set(name, value);
      }
    },
    header() {
      return [...map.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    },
    snapshot() {
      return Object.fromEntries(map);
    },
    restore(obj) {
      map.clear();
      for (const [k, v] of Object.entries(obj || {})) map.set(k, v);
    },
  };
}

function portalFetch(url, cookies, options = {}) {
  const target = new URL(url);
  const lib = target.protocol === 'https:' ? https : http;
  const method = (options.method || 'GET').toUpperCase();
  const body = options.body ? String(options.body) : '';
  const followRedirects = options.followRedirects !== false;
  const headers = {
    Host: target.host,
    'User-Agent': 'Mozilla/5.0',
    Connection: 'keep-alive',
    ...(options.headers || {}),
  };
  const cookie = cookies.header();
  if (cookie) headers.Cookie = cookie;
  if (body) headers['Content-Length'] = Buffer.byteLength(body);

  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        path: `${target.pathname}${target.search}`,
        method,
        headers,
        timeout: options.timeout || 15000,
        agent: target.protocol === 'https:' ? httpsAgent : httpAgent,
      },
      (res) => {
        cookies.absorbSetCookie(res.headers['set-cookie']);
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks);
          const location = res.headers.location;
          if (followRedirects && [301, 302, 303, 307, 308].includes(res.statusCode) && location) {
            const next = new URL(location, url).toString();
            if (/LogOut\.aspx/i.test(next)) {
              reject(new Error('att4u portal session was logged out'));
              return;
            }
            resolve(portalFetch(next, cookies, { method: 'GET', headers: { Referer: url } }));
            return;
          }
          const text = raw.toString('utf8');
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            headers: res.headers,
            location,
            text: async () => text,
          });
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('att4u portal request timed out')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function collectFormFields(html) {
  const fields = {};
  for (const tag of html.match(/<input\b[^>]*>/gi) || []) {
    const name = htmlAttr(tag, 'name');
    if (!name) continue;
    const type = htmlAttr(tag, 'type').toLowerCase();
    if (type === 'checkbox' || type === 'radio' || type === 'image') continue;
    fields[name] = htmlAttr(tag, 'value');
  }
  for (const block of html.match(/<select\b[^>]*>[\s\S]*?<\/select>/gi) || []) {
    const name = htmlAttr(block, 'name');
    if (!name) continue;
    const selected = block.match(/<option[^>]*selected[^>]*value="([^"]*)"/i);
    const first = block.match(/<option[^>]*value="([^"]*)"/i);
    fields[name] = selected?.[1] ?? first?.[1] ?? '';
  }
  return fields;
}

function parsePortalPunchAt(raw) {
  const text = String(raw || '').trim();
  const named = text.match(
    /^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/
  );
  if (named) {
    const [, d, mon, y, h, mi, s] = named;
    const mo = MONTHS[mon.slice(0, 3).toLowerCase()];
    if (!mo) return '';
    return `${y}-${mo}-${String(d).padStart(2, '0')} ${String(h).padStart(2, '0')}:${mi}:${s || '00'}`;
  }
  const dmy = text.match(/^(\d{1,2})-(\d{1,2})-(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (dmy) {
    const [, d, mo, y, h, mi, s] = dmy;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')} ${String(h).padStart(2, '0')}:${mi}:${s || '00'}`;
  }
  return '';
}

function parseDirection(raw) {
  const v = String(raw || '').trim().toLowerCase().replace(/\s+/g, '-');
  if (['in', '0', 'i', 'check-in', 'checkin'].includes(v)) return 'in';
  if (['out', '1', 'o', 'check-out', 'checkout'].includes(v)) return 'out';
  return '';
}

export function parseDeviceLogExport(text) {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const header = lines[0].split('\t').map((h) => h.trim().toLowerCase());
  const idx = (name) => header.findIndex((h) => h === name);
  const userIdx = idx('userid') >= 0 ? idx('userid') : 1;
  const dateIdx = idx('log date') >= 0 ? idx('log date') : 3;
  const serialIdx = idx('serial number') >= 0 ? idx('serial number') : 5;
  const stateIdx = idx('att state') >= 0 ? idx('att state') : 6;
  const punches = [];
  for (const line of lines.slice(1)) {
    const cols = line.split('\t');
    const deviceUserCode = String(cols[userIdx] || '').trim();
    const punchedAt = parsePortalPunchAt(cols[dateIdx]);
    if (!deviceUserCode || !punchedAt) continue;
    punches.push({
      deviceUserCode,
      punchedAt,
      punchDate: punchedAt.slice(0, 10),
      serialNumber: String(cols[serialIdx] || '').trim(),
      direction: parseDirection(cols[stateIdx]),
      rawLine: line.slice(0, 500),
    });
  }
  return punches;
}

function cellText(html) {
  const text = String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text;
}

export function parseDeviceLogGrid(html) {
  const punches = [];
  const rows = String(html || '').match(/<tr[^>]*class="ob_gR[^"]*"[^>]*>[\s\S]*?<\/tr>/gi) || [];
  for (const row of rows) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => cellText(m[1]));
    const dateIdxs = [];
    for (let i = 0; i < cells.length; i += 1) {
      if (
        /\d{1,2}-\d{1,2}-\d{4}\s+\d{1,2}:\d{2}/.test(cells[i])
        || /\d{1,2}\s+[A-Za-z]{3,}\s+\d{4}\s+\d{1,2}:\d{2}/.test(cells[i])
      ) {
        dateIdxs.push(i);
      }
    }
    const logIdx = dateIdxs.length >= 2 ? dateIdxs[1] : dateIdxs[0];
    if (logIdx == null || logIdx < 2) continue;
    const deviceUserCode = cells[logIdx - 2];
    const logCell = cells[logIdx] || '';
    const punchedAt =
      parsePortalPunchAt(logCell.match(/\d{1,2} [A-Za-z]{3,} \d{4} \d{1,2}:\d{2}:\d{2}/)?.[0] || '')
      || parsePortalPunchAt(logCell.match(/\d{1,2}-\d{1,2}-\d{4} \d{1,2}:\d{2}:\d{2}/)?.[0] || '')
      || parsePortalPunchAt(logCell);
    if (!deviceUserCode || !punchedAt) continue;
    punches.push({
      deviceUserCode,
      punchedAt,
      punchDate: punchedAt.slice(0, 10),
      serialNumber: cells[logIdx + 2] || '',
      direction: parseDirection(cells[logIdx + 3] || ''),
      rawLine: cells.filter(Boolean).join('\t').slice(0, 500),
    });
  }
  return punches;
}

function selectedOption(html, name) {
  const block = html.match(new RegExp(`<select[^>]*name="${name}"[^>]*>[\\s\\S]*?</select>`, 'i'));
  if (!block) return '';
  const selected = block[0].match(/<option[^>]*selected[^>]*value="([^"]*)"/i);
  return selected?.[1] || '';
}

function datesAlreadySelected(html, from, to) {
  if (!from) return true;
  const same = (a, b) => Number(a) === Number(b);
  return (
    same(selectedOption(html, 'ddlFromDate'), from.slice(8, 10))
    && same(selectedOption(html, 'ddlToDate'), (to || from).slice(8, 10))
    && same(selectedOption(html, 'ddlMonth'), from.slice(5, 7))
    && same(selectedOption(html, 'ddlYear'), from.slice(0, 4))
  );
}

let cachedSession = null;

function newCookies() {
  return cookieStore();
}

async function loginPortal({ base, username, password }) {
  const cookies = newCookies();
  const loginPage = await portalFetch(`${base}/`, cookies);
  const loginHtml = await loginPage.text();
  if (!loginPage.ok) {
    throw new Error(`att4u portal login page HTTP ${loginPage.status}`);
  }
  const key = inputValue(loginHtml, 'StaffloginDialog$txtKey') || inputValue(loginHtml, 'StaffloginDialog_txtKey');
  const viewState = inputValue(loginHtml, '__VIEWSTATE');
  const viewGen = inputValue(loginHtml, '__VIEWSTATEGENERATOR');
  if (!key || !viewState) {
    throw new Error('att4u portal login form was not found');
  }
  const posted = await portalFetch(`${base}/`, cookies, {
    method: 'POST',
    followRedirects: false,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: `${base}/`,
    },
    body: new URLSearchParams({
      __VIEWSTATE: viewState,
      __VIEWSTATEGENERATOR: viewGen,
      'StaffloginDialog$txt_LoginName': username,
      'StaffloginDialog$Txt_Password': encryptPortalPassword(password, key),
      'StaffloginDialog$txtKey': key,
      'StaffloginDialog$Btn_Ok': 'Login',
    }).toString(),
  });
  const postedHtml = await posted.text();
  if (/Invalid UserName or Password/i.test(postedHtml) || /Can't Login/i.test(postedHtml)) {
    throw new Error('att4u portal login failed');
  }
  if (posted.status === 200 && !posted.location && /StaffloginDialog/i.test(postedHtml)) {
    throw new Error('att4u portal login failed');
  }
  return cookies;
}

async function ensureSession({ portalUrl, username, password }) {
  const base = String(portalUrl || 'http://www.att4u.com/STAN').replace(/\/+$/, '');
  if (cachedSession && cachedSession.base === base && Date.now() < cachedSession.until) {
    const cookies = newCookies();
    cookies.restore(cachedSession.cookieMap);
    return { base, cookies };
  }
  const cookies = await loginPortal({ base, username, password });
  cachedSession = {
    base,
    cookieMap: cookies.snapshot(),
    until: Date.now() + 8 * 60 * 1000,
  };
  return { base, cookies };
}

function rememberSession(base, cookies) {
  cachedSession = {
    base,
    cookieMap: cookies.snapshot(),
    until: Date.now() + 8 * 60 * 1000,
  };
}

function clearSession() {
  cachedSession = null;
}

async function loadDeviceLogPage(session) {
  const listUrl = `${session.base}/Manage/DeviceLogList.aspx`;
  const listRes = await portalFetch(listUrl, session.cookies, {
    headers: { Referer: `${session.base}/Main.aspx` },
  });
  const listHtml = await listRes.text();
  if (!listRes.ok || !/btnExport/i.test(listHtml)) {
    throw new Error('att4u portal session was logged out');
  }
  rememberSession(session.base, session.cookies);
  return { listUrl, listHtml };
}

async function exportDeviceLogs(session, listUrl, listHtml, from, to) {
  let html = listHtml;
  if (from && /ddlFromDate/.test(html) && !datesAlreadySelected(html, from, to)) {
    const fields = collectFormFields(html);
    fields.ddlFromDate = from.slice(8, 10);
    fields.ddlToDate = (to || from).slice(8, 10);
    fields.ddlMonth = from.slice(5, 7);
    fields.ddlYear = from.slice(0, 4);
    delete fields.btnExport;
    fields.btnGo = 'Filter';
    const filtered = await portalFetch(listUrl, session.cookies, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: listUrl,
      },
      body: new URLSearchParams(fields).toString(),
    });
    const filteredHtml = await filtered.text();
    if (/btnExport/i.test(filteredHtml)) html = filteredHtml;
  }
  const exportFields = collectFormFields(html);
  delete exportFields.btnGo;
  exportFields.btnExport = 'Export';
  const exported = await portalFetch(listUrl, session.cookies, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: listUrl,
    },
    body: new URLSearchParams(exportFields).toString(),
  });
  return parseDeviceLogExport(await exported.text());
}

export async function fetchLogsFromAtt4uPortal({
  portalUrl,
  username,
  password,
  fromDate,
  toDate,
  full = false,
}) {
  const creds = { portalUrl, username, password };
  const from = String(fromDate || '').slice(0, 10);
  const to = String(toDate || from).slice(0, 10);

  async function run(forceLogin) {
    if (forceLogin) clearSession();
    const session = await ensureSession(creds);
    const page = await loadDeviceLogPage(session);
    if (full) {
      const exported = await exportDeviceLogs(session, page.listUrl, page.listHtml, from, to);
      if (exported.length) return exported;
    }
    return parseDeviceLogGrid(page.listHtml);
  }

  try {
    return await run(false);
  } catch (err) {
    if (!/logged out/i.test(err.message || '')) throw err;
    return run(true);
  }
}
