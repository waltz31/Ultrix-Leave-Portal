/** Tiny in-process TTL cache for attendance payloads. */
const store = new Map();

export function cacheGet(key) {
  const hit = store.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    store.delete(key);
    return null;
  }
  return hit.value;
}

export function cacheSet(key, value, ttlMs = 20_000) {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
  if (store.size > 200) {
    const first = store.keys().next().value;
    store.delete(first);
  }
}

export function cacheInvalidate(prefix = 'attendance:') {
  const key = String(prefix || '');
  for (const cacheKey of [...store.keys()]) {
    if (!key || cacheKey.startsWith(key)) store.delete(cacheKey);
  }
}
