import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, invalidateApiCache } from './api';

export const NOTIFICATIONS_UPDATED = 'ultrix-notifications-updated';
const POLL_MS = 90_000;
const MIN_FETCH_GAP_MS = 2_500;

let inflight = null;
let cache = { notifications: [], unreadCount: 0, fetchedAt: 0 };

export function emitNotificationsUpdated() {
  window.dispatchEvent(new Event(NOTIFICATIONS_UPDATED));
}

export function pathForNotification(role, type) {
  if (String(type || '').startsWith('attendance_regularize')) {
    if (role === 'hr') return '/hr/regularization';
    if (role === 'manager') return '/manager/regularization';
    return '/app/attendance';
  }
  if (String(type || '').startsWith('reimbursement_')) {
    if (role === 'hr') return '/hr/reimbursements';
    if (role === 'manager') return '/manager/reimbursements';
    return '/app/reimbursements';
  }
  if (role === 'manager') {
    if (type === 'pending_manager') return '/manager/approvals';
    if (type === 'approved' || type === 'cancelled') return '/manager/calendar';
    return '/manager/history';
  }
  if (role === 'hr') {
    if (type === 'pending_hr') return '/hr/approvals';
    if (type === 'approved' || type === 'cancelled') return '/hr/calendar';
    if (type === 'invoice_submitted') return '/hr/invoices';
    return '/hr/history';
  }
  if (type === 'approved') return '/app/attendance';
  if (type === 'balance_credited') return '/app';
  if (type === 'rating_received') return '/app/ratings';
  if (type === 'invoice_submitted') return '/hr/invoices';
  if (type === 'cancelled') return '/app/history';
  if (type === 'pending_manager' || type === 'pending_hr') return '/app';
  return '/app/history';
}

export function unreadCountsByPath(notifications, role) {
  const counts = {};
  for (const n of notifications || []) {
    if (n.read) continue;
    const path = pathForNotification(role, n.type);
    counts[path] = (counts[path] || 0) + 1;
  }
  return counts;
}

export async function fetchNotifications({ force = false } = {}) {
  if (inflight) return inflight;
  if (!force && cache.fetchedAt && Date.now() - cache.fetchedAt < MIN_FETCH_GAP_MS) {
    return cache;
  }
  if (force) invalidateApiCache('/notifications');
  inflight = api('/notifications')
    .then((data) => {
      cache = {
        notifications: data.notifications || [],
        unreadCount: Number(data.unreadCount) || 0,
        fetchedAt: Date.now(),
      };
      return cache;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

function syncCache(notifications, unreadCount) {
  cache = {
    notifications,
    unreadCount,
    fetchedAt: Date.now(),
  };
}

export function useNotifications(role) {
  const [notifications, setNotifications] = useState(cache.notifications);
  const [unreadCount, setUnreadCount] = useState(cache.unreadCount);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const apply = useCallback((data) => {
    if (!mounted.current) return;
    setNotifications(data.notifications);
    setUnreadCount(data.unreadCount);
    syncCache(data.notifications, data.unreadCount);
  }, []);

  const refresh = useCallback(
    async (force = false) => {
      const data = await fetchNotifications({ force });
      apply(data);
      return data;
    },
    [apply]
  );

  useEffect(() => {
    let cancelled = false;
    let pollTimer = 0;
    let debounceTimer = 0;

    const load = (force = false) => {
      if (cancelled) return;
      if (document.visibilityState !== 'visible' && !force) return;
      refresh(force).catch(() => {});
    };

    const schedule = () => {
      window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => load(false), 800);
    };

    load(true);
    pollTimer = window.setInterval(() => load(false), POLL_MS);
    window.addEventListener(NOTIFICATIONS_UPDATED, schedule);
    document.addEventListener('visibilitychange', schedule);

    return () => {
      cancelled = true;
      window.clearInterval(pollTimer);
      window.clearTimeout(debounceTimer);
      window.removeEventListener(NOTIFICATIONS_UPDATED, schedule);
      document.removeEventListener('visibilitychange', schedule);
    };
  }, [refresh, role]);

  const unreadByPath = useMemo(
    () => unreadCountsByPath(notifications, role),
    [notifications, role]
  );

  const markIdsRead = useCallback(
    async (ids) => {
      if (!ids?.length) return;
      const idSet = new Set(ids.map(Number));
      const data = await api('/notifications/read', { method: 'PATCH', body: { ids } });
      const next = notifications.map((n) => (idSet.has(n.id) ? { ...n, read: true } : n));
      const nextUnread = Number(data.unreadCount) || 0;
      apply({ notifications: next, unreadCount: nextUnread });
    },
    [apply, notifications]
  );

  const markAllRead = useCallback(async () => {
    const data = await api('/notifications/read', { method: 'PATCH', body: {} });
    const next = notifications.map((n) => ({ ...n, read: true }));
    apply({ notifications: next, unreadCount: Number(data.unreadCount) || 0 });
  }, [apply, notifications]);

  const clearAll = useCallback(async () => {
    await api('/notifications', { method: 'DELETE' });
    apply({ notifications: [], unreadCount: 0 });
  }, [apply]);

  const markPathRead = useCallback(
    async (pathname) => {
      if (!pathname) return;
      const ids = notifications
        .filter((n) => !n.read && pathForNotification(role, n.type) === pathname)
        .map((n) => n.id);
      if (!ids.length) return;
      await markIdsRead(ids);
    },
    [markIdsRead, notifications, role]
  );

  return {
    notifications,
    unreadCount,
    unreadByPath,
    refresh,
    markIdsRead,
    markAllRead,
    clearAll,
    markPathRead,
  };
}
