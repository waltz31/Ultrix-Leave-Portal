const TOKEN_KEY = 'ultrix_leave_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

/** Per-attempt fetch timeout (Render free-tier cold starts are slow). */
const REQUEST_TIMEOUT_MS = 28_000;
/** Enough attempts to cover ~50–60s wake + DB ready. */
const MAX_TRANSIENT_ATTEMPTS = 10;

const GET_CACHE_MS = {
  '/holidays': 5 * 60_000,
  '/reports/overview': 60_000,
  '/users': 60_000,
  '/managers': 60_000,
  '/onboarding': 45_000,
  '/auth/me': 30_000,
  '/balances/me': 30_000,
  '/notifications': 15_000,
  '/dashboard/stats': 30_000,
  '/leave-policy/acknowledgement': 60_000,
};

const getCache = new Map();
const inflight = new Map();

function cacheTtl(path) {
  const base = path.split('?')[0];
  if (GET_CACHE_MS[base]) return GET_CACHE_MS[base];
  if (base.startsWith('/holidays')) return GET_CACHE_MS['/holidays'];
  if (base.startsWith('/reports/overview')) return GET_CACHE_MS['/reports/overview'];
  if (base.startsWith('/attendance/overview')) return 45_000;
  if (base.startsWith('/attendance/muster')) return 45_000;
  if (base.startsWith('/attendance/calendar')) return 30_000;
  if (base.startsWith('/punches')) return 20_000;
  if (base.startsWith('/leaves')) return 15_000;
  return 0;
}

export function invalidateApiCache(prefix = '') {
  const key = String(prefix || '');
  for (const cacheKey of [...getCache.keys()]) {
    if (!key || cacheKey.startsWith(key)) getCache.delete(cacheKey);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(attempt) {
  // 1.5s, 2.5s, 4s, 6s… capped — covers Render free-tier wake.
  return Math.min(12_000, 1500 + attempt * 1200);
}

function isTransientHttp(status, data) {
  if (status === 502 || status === 504) return true;
  if (status === 503) return true;
  if (status === 429) return true;
  const msg = String(data?.error || data?.status || '');
  return /start|boot|unavailable|timeout|overloaded/i.test(msg);
}

function isTransientNetworkError(err) {
  if (!err) return false;
  if (err.name === 'AbortError' || err.name === 'TimeoutError') return true;
  const msg = String(err.message || err);
  return /failed to fetch|networkerror|load failed|network request failed|aborted|timed out|timeout/i.test(
    msg
  );
}

export function isTransientApiError(err) {
  if (!err) return false;
  if (err.transient) return true;
  if (err.status && isTransientHttp(err.status, err.data)) return true;
  return isTransientNetworkError(err);
}

async function fetchOnce(path, options = {}) {
  const { onRetry: _onRetry, signal: parentSignal, ...fetchOptions } = options;
  const headers = {
    'Content-Type': 'application/json',
    ...(fetchOptions.headers || {}),
  };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const onParentAbort = () => controller.abort();
  if (parentSignal) {
    if (parentSignal.aborted) controller.abort();
    else parentSignal.addEventListener('abort', onParentAbort, { once: true });
  }

  try {
    const res = await fetch(`${API_BASE}/api${path}`, {
      ...fetchOptions,
      headers,
      body: fetchOptions.body ? JSON.stringify(fetchOptions.body) : undefined,
      signal: controller.signal,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const error = new Error(data.error || `Request failed (${res.status})`);
      error.status = res.status;
      error.data = data;
      error.transient = isTransientHttp(res.status, data);
      throw error;
    }
    return data;
  } catch (err) {
    if (isTransientNetworkError(err)) {
      const error = new Error(
        'Server is waking up — please wait a moment and try again'
      );
      error.status = 0;
      error.transient = true;
      error.cause = err;
      throw error;
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
    if (parentSignal) parentSignal.removeEventListener('abort', onParentAbort);
  }
}

async function fetchApi(path, options = {}, attempt = 0) {
  try {
    return await fetchOnce(path, options);
  } catch (err) {
    const canRetry = isTransientApiError(err) && attempt < MAX_TRANSIENT_ATTEMPTS - 1;
    if (!canRetry) throw err;
    if (typeof options.onRetry === 'function') {
      try {
        options.onRetry({ attempt: attempt + 1, max: MAX_TRANSIENT_ATTEMPTS, error: err });
      } catch {
        // ignore listener errors
      }
    }
    await sleep(backoffMs(attempt));
    return fetchApi(path, options, attempt + 1);
  }
}

/** Ping API to start a Render cold start before the user submits login. */
export async function wakeApiServer() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8_000);
    await fetch(`${API_BASE}/api/health`, { signal: controller.signal, cache: 'no-store' });
    clearTimeout(timeoutId);
  } catch {
    // Wake is best-effort; login retries will finish the job.
  }
}

export async function api(path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  if (method !== 'GET') {
    if (method === 'POST' || method === 'PATCH' || method === 'PUT' || method === 'DELETE') {
      invalidateApiCache('/balances');
      invalidateApiCache('/leaves');
      invalidateApiCache('/reports/overview');
      invalidateApiCache('/notifications');
      invalidateApiCache('/holidays');
      invalidateApiCache('/attendance');
      invalidateApiCache('/punches');
      invalidateApiCache('/onboarding');
      invalidateApiCache('/users');
      invalidateApiCache('/managers');
      invalidateApiCache('/leave-policy');
      invalidateApiCache('/dashboard');
    }
    return fetchApi(path, options);
  }

  const ttl = cacheTtl(path);
  if (ttl <= 0) return fetchApi(path, options);

  const hit = getCache.get(path);
  if (hit && Date.now() - hit.at < ttl) return hit.data;

  if (inflight.has(path)) return inflight.get(path);

  const promise = fetchApi(path, options)
    .then((data) => {
      getCache.set(path, { data, at: Date.now() });
      inflight.delete(path);
      return data;
    })
    .catch((err) => {
      inflight.delete(path);
      throw err;
    });

  inflight.set(path, promise);
  return promise;
}
