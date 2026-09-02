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

const GET_CACHE_MS = {
  '/holidays': 5 * 60_000,
  '/reports/overview': 60_000,
  '/users': 60_000,
  '/auth/me': 30_000,
};

const getCache = new Map();
const inflight = new Map();

function cacheTtl(path) {
  const base = path.split('?')[0];
  if (GET_CACHE_MS[base]) return GET_CACHE_MS[base];
  if (base.startsWith('/holidays')) return GET_CACHE_MS['/holidays'];
  if (base.startsWith('/reports/overview')) return GET_CACHE_MS['/reports/overview'];
  return 0;
}

export function invalidateApiCache(prefix = '') {
  const key = String(prefix || '');
  for (const cacheKey of [...getCache.keys()]) {
    if (!key || cacheKey.startsWith(key)) getCache.delete(cacheKey);
  }
}

async function fetchApi(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}/api${path}`, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || `Request failed (${res.status})`);
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return data;
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
