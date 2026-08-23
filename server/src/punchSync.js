import db from './db.js';
import { nowIst, todayIst } from './time.js';
import { isUniqueViolation } from './sqlDialect.js';
import { fetchLogsFromAtt4uPortal } from './att4uPortal.js';

const SOAP_NS_ACTION = 'http://tempuri.org/GetTransactionsLog';

function env(name, fallback = '') {
  return String(process.env[name] ?? fallback).trim();
}

/** Device emp code → portal user name. Override with ATT4U_DEVICE_MAP. */
const DEFAULT_DEVICE_MAP = [
  ['3010', 'Walter Michael Fernandes'],
  ['3011', 'Madhav Ketan Sompura'],
  ['22', 'Raushan Raj'],
  ['3001', 'Ashish Mohapatra'],
  ['3007', 'Yashi Mishra'],
  ['3008', 'Siddharth Singh'],
];

export function parseDeviceMap(raw = env('ATT4U_DEVICE_MAP')) {
  const text = String(raw || '').trim();
  if (!text) return DEFAULT_DEVICE_MAP.map(([code, name]) => [code, name]);
  const entries = [];
  for (const part of text.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const sep = trimmed.includes('=') ? '=' : ':';
    const idx = trimmed.indexOf(sep);
    if (idx <= 0) continue;
    const code = trimmed.slice(0, idx).trim();
    const name = trimmed.slice(idx + 1).trim();
    if (code && name) entries.push([code, name]);
  }
  return entries.length ? entries : DEFAULT_DEVICE_MAP.map(([code, name]) => [code, name]);
}

export function punchConfig() {
  const serials = env('ATT4U_SERIALS', env('ATT4U_SERIAL'))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    enabled: env('ATT4U_ENABLED', 'true') !== 'false',
    url: env('ATT4U_SOAP_URL', 'http://att4u.com/stan/WebApiService.asmx'),
    username: env('ATT4U_USER', 'Api'),
    password: env('ATT4U_PASSWORD'),
    portalUrl: env('ATT4U_PORTAL_URL', 'http://www.att4u.com/STAN'),
    portalUser: env('ATT4U_PORTAL_USER', 'essl'),
    portalPassword: env('ATT4U_PORTAL_PASSWORD', env('ATT4U_CLOUD_PASSWORD')),
    serials: serials.length ? serials : [''],
    lookbackDays: Math.max(1, Number(env('ATT4U_LOOKBACK_DAYS', '7')) || 7),
    pollMs: Math.max(3_000, Number(env('ATT4U_POLL_MS', '4000')) || 4_000),
    deviceMap: parseDeviceMap(),
  };
}

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function xmlTagText(xml, tag) {
  const re = new RegExp(`<(?:\\w+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, 'i');
  const m = String(xml).match(re);
  if (!m) return '';
  return m[1]
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .trim();
}

export function normalizeDeviceCode(code) {
  const raw = String(code ?? '').trim();
  if (!raw) return '';
  const stripped = raw.replace(/^0+(?=\d)/, '');
  return stripped || '0';
}

export function normalizePunchAt(raw) {
  const text = String(raw ?? '').trim().replace('T', ' ');
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})[ ](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (iso) {
    const [, y, mo, d, h, mi, s] = iso;
    return `${y}-${mo}-${d} ${String(h).padStart(2, '0')}:${mi}:${s || '00'}`;
  }
  const dmy = text.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})[ ](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (dmy) {
    const [, d, mo, y, h, mi, s] = dmy;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')} ${String(h).padStart(2, '0')}:${mi}:${s || '00'}`;
  }
  const named = text.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (named) {
    const months = {
      jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
      jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
    };
    const [, d, mon, y, h, mi, s] = named;
    const mo = months[mon.slice(0, 3).toLowerCase()];
    if (mo) {
      return `${y}-${mo}-${String(d).padStart(2, '0')} ${String(h).padStart(2, '0')}:${mi}:${s || '00'}`;
    }
  }
  return '';
}

function parseDirection(raw) {
  const v = String(raw ?? '').trim().toLowerCase();
  if (!v) return '';
  const compact = v.replace(/\s+/g, '-');
  if (['in', '0', 'i', 'check-in', 'checkin'].includes(compact)) return 'in';
  if (['out', '1', 'o', 'check-out', 'checkout'].includes(compact)) return 'out';
  return v.slice(0, 20);
}

export function parsePunchLines(dataList) {
  const text = String(dataList || '').replace(/\r/g, '').trim();
  if (!text) return [];
  const punches = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.includes('\t')
      ? trimmed.split('\t')
      : trimmed.split(',').map((p) => p.trim());
    const deviceUserCode = String(parts[0] || '').trim();
    const punchedAt = normalizePunchAt(parts[1]);
    if (!deviceUserCode || !punchedAt) continue;
    const extra = parts.slice(2).map((p) => String(p || '').trim()).filter(Boolean);
    const direction = parseDirection(extra.find((p) => parseDirection(p)) || '');
    punches.push({
      deviceUserCode,
      punchedAt,
      punchDate: punchedAt.slice(0, 10),
      direction,
      rawLine: trimmed.slice(0, 500),
    });
  }
  return punches;
}

function soapEnvelope({ fromDateTime, toDateTime, serialNumber, username, password }) {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <GetTransactionsLog xmlns="http://tempuri.org/">
      <FromDateTime>${xmlEscape(fromDateTime)}</FromDateTime>
      <ToDateTime>${xmlEscape(toDateTime)}</ToDateTime>
      <SerialNumber>${xmlEscape(serialNumber)}</SerialNumber>
      <UserName>${xmlEscape(username)}</UserName>
      <UserPassword>${xmlEscape(password)}</UserPassword>
      <strDataList></strDataList>
    </GetTransactionsLog>
  </soap:Body>
</soap:Envelope>`;
}

async function fetchLogsViaPortal(fromDateTime, toDateTime, { full = false } = {}) {
  const cfg = punchConfig();
  if (!cfg.portalPassword) {
    throw new Error('att4u portal password is not configured');
  }
  const rows = await fetchLogsFromAtt4uPortal({
    portalUrl: cfg.portalUrl,
    username: cfg.portalUser,
    password: cfg.portalPassword,
    fromDate: String(fromDateTime).slice(0, 10),
    toDate: String(toDateTime).slice(0, 10),
    full,
  });
  return rows.filter((row) => row.punchedAt >= fromDateTime && row.punchedAt <= toDateTime);
}

async function fetchDeviceLogs({ fromDateTime, toDateTime, serialNumber }) {
  const cfg = punchConfig();
  if (!cfg.password) {
    throw new Error('Punch API password is not configured (ATT4U_PASSWORD)');
  }
  const body = soapEnvelope({
    fromDateTime,
    toDateTime,
    serialNumber,
    username: cfg.username,
    password: cfg.password,
  });
  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: `"${SOAP_NS_ACTION}"`,
    },
    body,
    signal: AbortSignal.timeout(25_000),
  });
  const xml = await res.text();
  if (!res.ok) {
    throw new Error(`Punch API HTTP ${res.status}`);
  }
  const result = xmlTagText(xml, 'GetTransactionsLogResult');
  const dataList = xmlTagText(xml, 'strDataList');
  const combined = dataList || (result.includes('\t') || result.includes('\n') ? result : '');
  const resultNorm = result.toLowerCase();
  if (resultNorm.includes('unathorised') || resultNorm.includes('unauthorised') || resultNorm.includes('unauthorized')) {
    throw new Error(
      'Punch device API rejected the user (Unathorised User). Confirm the Web API login, password, and device serial in ATT4U_* env vars.'
    );
  }
  if (result && !combined && !/success|ok|true|1/i.test(result)) {
    throw new Error(`Punch device API: ${result}`);
  }
  return parsePunchLines(combined).map((p) => ({
    ...p,
    serialNumber: serialNumber || '',
  }));
}

let userMapCache = { until: 0, map: null, allowed: null };

function mapLookup(userMap, deviceUserCode) {
  const raw = String(deviceUserCode ?? '').trim();
  if (!raw) return null;
  return userMap.get(raw) || userMap.get(normalizeDeviceCode(raw)) || null;
}

async function loadUserCodeMap() {
  if (userMapCache.map && Date.now() < userMapCache.until) return userMapCache;
  const entries = punchConfig().deviceMap;
  const users = await db
    .prepare(`SELECT id, name FROM users WHERE active = 1`)
    .all();
  const byName = new Map();
  for (const row of users) {
    const key = String(row.name || '').trim().toLowerCase();
    if (key && !byName.has(key)) byName.set(key, row.id);
  }
  const map = new Map();
  const allowed = new Set();
  for (const [code, name] of entries) {
    const raw = String(code).trim();
    const norm = normalizeDeviceCode(raw);
    const userId = byName.get(String(name).trim().toLowerCase());
    if (!userId) {
      console.warn(`Punch map: no active user named "${name}" for device code ${raw}`);
      continue;
    }
    if (raw) {
      map.set(raw, userId);
      allowed.add(raw);
    }
    if (norm) {
      map.set(norm, userId);
      allowed.add(norm);
    }
  }
  userMapCache = { until: Date.now() + 5 * 60 * 1000, map, allowed };
  return userMapCache;
}

async function getMeta(key) {
  const row = await db.prepare(`SELECT value FROM app_meta WHERE key = ?`).get(key);
  return row?.value ?? '';
}

async function setMeta(key, value) {
  const updated = await db.prepare(`UPDATE app_meta SET value = ? WHERE key = ?`).run(value, key);
  if (!updated?.changes) {
    try {
      await db.prepare(`INSERT INTO app_meta (key, value) VALUES (?, ?)`).run(key, value);
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      await db.prepare(`UPDATE app_meta SET value = ? WHERE key = ?`).run(value, key);
    }
  }
}

async function latestPunchAt() {
  const row = await db.prepare(`SELECT MAX(punched_at) AS latest FROM punch_logs`).get();
  return row?.latest || '';
}

function shiftMinutes(istStamp, minutes) {
  const m = String(istStamp).match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return istStamp;
  const utc = Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]) - 5,
    Number(m[5]) - 30 + minutes,
    Number(m[6])
  );
  const d = new Date(utc + (5 * 60 + 30) * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

function lookbackStamp(days) {
  const today = todayIst();
  const [y, mo, d] = today.split('-').map(Number);
  const utc = Date.UTC(y, mo - 1, d - days, 0, 0, 0);
  const dt = new Date(utc);
  const pad = (n) => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())} 00:00:00`;
}

async function insertPunches(punches, userMap) {
  const mapped = punches
    .map((punch) => {
      const userId = mapLookup(userMap, punch.deviceUserCode);
      if (!userId) return null;
      return { ...punch, userId };
    })
    .filter(Boolean);
  if (!mapped.length) return 0;
  let inserted = 0;
  const chunkSize = 40;
  for (let i = 0; i < mapped.length; i += chunkSize) {
    const chunk = mapped.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ');
    const params = [];
    for (const punch of chunk) {
      params.push(
        punch.userId,
        punch.deviceUserCode,
        punch.punchedAt,
        punch.punchDate,
        punch.serialNumber || '',
        punch.direction || '',
        punch.rawLine || ''
      );
    }
    try {
      const result = await db
        .prepare(
          `INSERT INTO punch_logs (user_id, device_user_code, punched_at, punch_date, serial_number, direction, raw_line)
           VALUES ${placeholders}
           ON CONFLICT(device_user_code, punched_at, serial_number) DO NOTHING`
        )
        .run(...params);
      inserted += Number(result.changes) || 0;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
  }
  return inserted;
}

/** Drop non-allowlisted punches and attach user_id for mapped device codes. */
export async function reconcilePunchAllowlist() {
  const { map, allowed } = await loadUserCodeMap();
  if (!allowed?.size) {
    return { deleted: 0, remapped: 0 };
  }
  const codes = [...allowed];
  const placeholders = codes.map(() => '?').join(', ');
  const deleted = await db
    .prepare(`DELETE FROM punch_logs WHERE device_user_code NOT IN (${placeholders})`)
    .run(...codes);
  let remapped = 0;
  for (const code of codes) {
    const userId = mapLookup(map, code);
    if (!userId) continue;
    const result = await db
      .prepare(
        `UPDATE punch_logs SET user_id = ?
         WHERE device_user_code = ? AND (user_id IS NULL OR user_id <> ?)`
      )
      .run(userId, code, userId);
    remapped += Number(result.changes) || 0;
  }
  return {
    deleted: Number(deleted.changes) || 0,
    remapped,
    codes,
  };
}

let inflight = null;
let lastFullExportAt = 0;
let hadPunchError = true;

export async function syncPunchesFromDevice() {
  const cfg = punchConfig();
  if (!cfg.enabled) {
    return { ok: false, skipped: true, error: 'Punch sync is disabled' };
  }
  if (!cfg.portalPassword && !cfg.password) {
    return { ok: false, skipped: true, error: 'Punch sync credentials are not configured' };
  }
  const fromStored = await latestPunchAt();
  const lookback = lookbackStamp(cfg.lookbackDays);
  const todayStart = `${todayIst()} 00:00:00`;
  // Full export periodically (and on cold start). Live mode still rescans all of today
  // so earlier punches for other allowlisted IDs are not skipped after a later punch arrives.
  const needFull =
    !fromStored || !lastFullExportAt || Date.now() - lastFullExportAt > 10 * 60 * 1000;
  const liveFrom = fromStored ? shiftMinutes(fromStored, -5) : lookback;
  const fromDateTime = needFull ? lookback : liveFrom < todayStart ? liveFrom : todayStart;
  const toDateTime = `${todayIst()} 23:59:59`;
  const { map: userMap } = await loadUserCodeMap();
  let rows = [];
  let source = 'portal';
  if (cfg.portalPassword) {
    rows = await fetchLogsViaPortal(fromDateTime, toDateTime, { full: needFull });
    if (needFull) lastFullExportAt = Date.now();
    else if (!lastFullExportAt) lastFullExportAt = Date.now();
  } else {
    source = 'soap';
    for (const serial of cfg.serials) {
      rows = rows.concat(await fetchDeviceLogs({ fromDateTime, toDateTime, serialNumber: serial }));
    }
  }
  const allowedRows = rows.filter((row) => mapLookup(userMap, row.deviceUserCode));
  const inserted = await insertPunches(allowedRows, userMap);
  const at = nowIst();
  await setMeta('punch_last_sync_at', at);
  await setMeta('punch_last_ok', at);
  if (hadPunchError) {
    await setMeta('punch_last_error', '');
    hadPunchError = false;
  }
  return {
    ok: true,
    fetched: rows.length,
    kept: allowedRows.length,
    inserted,
    fromDateTime,
    toDateTime,
    source: needFull ? `${source}-full` : `${source}-live`,
  };
}

export async function syncPunchesSafe() {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const result = await syncPunchesFromDevice();
      return result;
    } catch (err) {
      const message = err?.message || 'Punch sync failed';
      console.error('Punch sync failed:', message);
      try {
        await setMeta('punch_last_sync_at', nowIst());
        await setMeta('punch_last_error', message.slice(0, 500));
        hadPunchError = true;
      } catch (metaErr) {
        console.error('Punch sync meta write failed:', metaErr?.message || metaErr);
      }
      return { ok: false, error: message };
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function assignInOut(punches) {
  const groups = new Map();
  for (const punch of punches) {
    const key = `${punch.userId || punch.deviceUserCode}|${punch.punchDate}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(punch);
  }
  const out = [];
  for (const list of groups.values()) {
    list.sort((a, b) => String(a.punchedAt).localeCompare(String(b.punchedAt)));
    list.forEach((punch, index) => {
      const inferred = index % 2 === 0 ? 'in' : 'out';
      out.push({
        ...punch,
        direction: punch.direction === 'in' || punch.direction === 'out' ? punch.direction : inferred,
      });
    });
  }
  out.sort((a, b) => String(b.punchedAt).localeCompare(String(a.punchedAt)));
  return out;
}

/** Full-day expected presence used for short-hours / regularize checks. */
export const EXPECTED_WORK_MINUTES = 540;

export function isIstWeekday(ymd) {
  const [year, month, day] = String(ymd || '').split('-').map(Number);
  if (!year || !month || !day) return false;
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday >= 1 && weekday <= 5;
}

export function isNotFutureIstDate(ymd, todayYmd) {
  return String(ymd || '').slice(0, 10) <= String(todayYmd || '').slice(0, 10);
}

export function isUnderRequiredHours(workMinutes) {
  if (workMinutes == null) return true;
  return Number(workMinutes) < EXPECTED_WORK_MINUTES;
}

export function isRegularizeEligible(session, todayYmd) {
  if (!session?.punchDate) return false;
  const punchDate = String(session.punchDate).slice(0, 10);
  if (!isIstWeekday(punchDate)) return false;
  if (!isNotFutureIstDate(punchDate, todayYmd)) return false;
  return isUnderRequiredHours(session.workMinutes);
}

/** One row per device/user per day — earliest = punch in, latest = punch out. */
export function formatWorkHours(minutes) {
  if (minutes == null || Number.isNaN(minutes) || minutes < 0) return null;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

export function istStampToUtcMs(stamp) {
  const m = String(stamp || '').match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/
  );
  if (!m) return null;
  return Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]) - 5,
    Number(m[5]) - 30,
    Number(m[6] || 0)
  );
}

export function workMinutesBetween(punchIn, punchOut) {
  if (!punchIn || !punchOut) return null;
  const startMs = istStampToUtcMs(punchIn);
  const endMs = istStampToUtcMs(punchOut);
  if (startMs == null || endMs == null) return null;
  return Math.max(0, Math.round((endMs - startMs) / 60000));
}

export function isShortWorkDay(workMinutes) {
  return workMinutes != null && Number(workMinutes) < EXPECTED_WORK_MINUTES;
}

export function summarizeDaySessions(punches) {
  const groups = new Map();
  for (const punch of punches) {
    const identity = punch.userId || punch.deviceUserCode;
    const key = `${punch.punchDate}|${identity}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(punch);
  }
  const sessions = [];
  for (const list of groups.values()) {
    list.sort((a, b) => String(a.punchedAt).localeCompare(String(b.punchedAt)));
    const first = list[0];
    const last = list[list.length - 1];
    const punchIn = first.punchedAt;
    const punchDate = String(first.punchDate || '').slice(0, 10);
    const dayClosed = punchDate && punchDate < todayIst();
    const lastIsOut =
      last.direction === 'out' ||
      (last.direction !== 'in' && list.length > 1 && list.length % 2 === 0);
    let punchOut = lastIsOut && list.length > 1 ? last.punchedAt : null;
    if (!punchOut && dayClosed) {
      punchOut = last.punchedAt;
    }
    let workMinutes = null;
    if (punchOut) {
      workMinutes = workMinutesBetween(punchIn, punchOut);
    }
    sessions.push({
      id: first.id,
      userId: first.userId ?? null,
      userName: first.userName ?? null,
      employeeNumber: first.employeeNumber ?? null,
      deviceUserCode: first.deviceUserCode,
      punchDate: first.punchDate,
      punchIn,
      punchOut,
      workMinutes,
      workHours: formatWorkHours(workMinutes),
      punchCount: list.length,
      stillIn: !punchOut,
      missingPunchOut: false,
      punchedAt: punchIn,
      direction: punchOut ? 'out' : 'in',
      needsRegularize: isShortWorkDay(workMinutes),
    });
  }
  return sessions.sort((a, b) => String(b.punchIn || '').localeCompare(String(a.punchIn || '')));
}

/** @deprecated use summarizeDaySessions — kept for any callers expecting earliest-only. */
export function earliestPunchPerId(punches) {
  return summarizeDaySessions(punches).map((session) => ({
    id: session.id,
    userId: session.userId,
    userName: session.userName,
    employeeNumber: session.employeeNumber,
    deviceUserCode: session.deviceUserCode,
    punchedAt: session.punchIn,
    punchDate: session.punchDate,
    direction: 'in',
  }));
}

export function mapPunch(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id ?? null,
    userName: row.user_name ?? null,
    employeeNumber: row.employee_number ?? null,
    deviceUserCode: row.device_user_code,
    punchedAt: row.punched_at,
    punchDate: row.punch_date,
    serialNumber: row.serial_number || '',
    direction: row.direction || '',
  };
}

export async function punchStatus() {
  const cfg = punchConfig();
  return {
    enabled: cfg.enabled && Boolean(cfg.portalPassword || cfg.password),
    configured: Boolean(cfg.portalPassword || cfg.password),
    url: cfg.portalPassword ? cfg.portalUrl : cfg.url,
    serials: cfg.serials.filter(Boolean),
    allowlist: cfg.deviceMap.map(([code, name]) => ({ deviceUserCode: code, name })),
    lastSyncAt: await getMeta('punch_last_sync_at'),
    lastOkAt: await getMeta('punch_last_ok'),
    lastError: await getMeta('punch_last_error'),
  };
}

export function startPunchPolling() {
  const cfg = punchConfig();
  if (!cfg.enabled || !(cfg.portalPassword || cfg.password)) {
    console.log('Punch device sync: off (set ATT4U_PORTAL_PASSWORD or ATT4U_PASSWORD)');
    return;
  }
  let delay = cfg.pollMs;
  const run = async () => {
    let result = null;
    try {
      result = await syncPunchesSafe();
      if (result?.ok && result.inserted > 0) {
        console.log(`Punch sync: stored ${result.inserted} new punch(es)`);
      } else if (result?.error) {
        console.log(`Punch sync: ${result.error}`);
      }
    } catch (err) {
      console.error('Punch sync loop error:', err?.message || err);
    }
    delay = result?.ok ? cfg.pollMs : Math.min(delay * 2, 5 * 60 * 1000);
    setTimeout(run, delay);
  };
  const mapped = cfg.deviceMap.map(([code, name]) => `${code}→${name}`).join(', ');
  console.log(
    `Punch device sync: every ${Math.round(cfg.pollMs / 1000)}s → ${
      cfg.portalPassword ? cfg.portalUrl : cfg.url
    }`
  );
  console.log(`Punch allowlist: ${mapped}`);
  reconcilePunchAllowlist()
    .then((summary) => {
      if (summary.deleted || summary.remapped) {
        console.log(
          `Punch allowlist cleanup: removed ${summary.deleted}, remapped ${summary.remapped}`
        );
      }
    })
    .catch((err) => {
      console.error('Punch allowlist cleanup failed:', err?.message || err);
    })
    .finally(() => {
      run();
    });
}
