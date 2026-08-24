import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { useTheme } from '../theme';
import {
  ROLE_LABELS,
  avatarSrc,
  formatDate,
  formatRelativeTime,
} from '../utils';

const COMPOSER_TYPES = [
  { key: 'casual', label: 'Casual Chat ☕' },
  { key: 'celebration', label: 'Celebration 🎉' },
  { key: 'milestone', label: 'Milestone 🏅' },
  { key: 'announcement', label: 'Announcement 📢' },
  { key: 'poll', label: 'Poll 📊' },
];

const BADGE_EMOJI = {
  celebration: '🎉',
  milestone: '🏅',
  announcement: '📢',
  casual: '☕',
  poll: '📊',
};

const VIEW_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'mentions', label: 'Mentions' },
  { key: 'bookmarks', label: 'Bookmarks' },
];

function storageKey(kind, userId) {
  return `ultrix-feed-${kind}-${userId || 'anon'}`;
}

function readIdSet(kind, userId) {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey(kind, userId)) || '[]');
    return new Set(Array.isArray(raw) ? raw.map(Number).filter(Number.isFinite) : []);
  } catch {
    return new Set();
  }
}

function writeIdSet(kind, userId, ids) {
  try {
    localStorage.setItem(storageKey(kind, userId), JSON.stringify([...ids]));
  } catch {
    /* ignore quota */
  }
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function mentionRegex(user, people = []) {
  const name = String(user?.name || '').trim();
  if (!name) return null;
  const first = name.split(/\s+/)[0];
  const names = [name];
  if (first && first.length >= 2) {
    const firstHits = (people || []).filter(
      (person) => String(person.name || '').split(/\s+/)[0].toLowerCase() === first.toLowerCase()
    );
    if (firstHits.length <= 1) names.push(first);
  }
  const parts = [...new Set(names.filter(Boolean))].map(escapeRegExp);
  return new RegExp(`(^|\\W)@(${parts.join('|')})(?=$|\\W)`, 'i');
}

function textMentionsUser(text, user, people = []) {
  const re = mentionRegex(user, people);
  return re ? re.test(String(text || '')) : false;
}

function mentionToken(value, caret) {
  const text = String(value || '');
  const pos = caret ?? text.length;
  const left = text.slice(0, pos);
  const match = left.match(/(^|[\s([{])@([^\n@]*)$/);
  if (!match) return null;
  if (match[2].endsWith(' ')) return null;
  return { start: match.index + match[1].length, query: match[2] };
}

function insertMentionText(value, caret, person) {
  const text = String(value || '');
  const pos = caret ?? text.length;
  const token = mentionToken(text, pos);
  const start = token ? token.start : pos;
  const inserted = `@${person.name} `;
  const next = `${text.slice(0, start)}${inserted}${text.slice(pos)}`;
  return { value: next, caret: start + inserted.length };
}

function filterPeople(people, query) {
  const q = String(query || '').trim().toLowerCase();
  return (people || [])
    .filter((person) => {
      if (!q) return true;
      return [person.name, person.department, person.location, person.designation]
        .some((value) => String(value || '').toLowerCase().includes(q));
    })
    .slice(0, 8);
}

function postMentionsUser(post, user, people = []) {
  if (textMentionsUser(post.content, user, people)) return true;
  return (post.comments || []).some((comment) => textMentionsUser(comment.content, user, people));
}

function countdownTone(days) {
  if (days <= 2) return 'soon';
  if (days <= 7) return 'mid';
  return 'later';
}

function countdownLabel(days) {
  if (days === 0) return 'Today';
  if (days === 1) return '1 day';
  return `${days} days`;
}

function formatCount(value) {
  const n = Number(value) || 0;
  if (n >= 1000) {
    const compact = n / 1000;
    return `${compact >= 10 ? Math.round(compact) : compact.toFixed(1).replace(/\.0$/, '')}K`;
  }
  return String(n);
}

const FEED_EMOJIS = ['❤️', '👍', '🎉', '👏', '😂', '🎂', '☕', '🔥', '💯', '😊', '🥳', '😎', '🙌', '💪', '🌟', '🚀'];
const LIKE_EMOJI = '❤️';
const FALLBACK_EMOJI_GROUPS = [
  { key: 'frequent', label: 'Frequent', emojis: FEED_EMOJIS.map((emoji) => ({ emoji, annotation: '' })) },
];

let emojiCatalogPromise = null;
const MAX_FEED_IMAGE_EDGE = 1600;
const MAX_FEED_IMAGE_CHARS = 1_800_000;

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read that image'));
    reader.readAsDataURL(file);
  });
}

function compressFeedImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_FEED_IMAGE_EDGE / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Could not process that image'));
        return;
      }
      ctx.fillStyle = '#0b1220';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      let quality = 0.84;
      let out = canvas.toDataURL('image/jpeg', quality);
      while (out.length > MAX_FEED_IMAGE_CHARS && quality > 0.48) {
        quality -= 0.08;
        out = canvas.toDataURL('image/jpeg', quality);
      }
      if (out.length > MAX_FEED_IMAGE_CHARS) {
        reject(new Error('Could not compress that image enough. Try a smaller photo.'));
        return;
      }
      resolve(out);
    };
    img.onerror = () => reject(new Error('Could not read that image'));
    img.src = dataUrl;
  });
}

async function prepareFeedImage(file) {
  if (!file) return '';
  if (!/^image\/(jpeg|jpg|png|gif|webp)$/i.test(file.type)) {
    throw new Error('Please choose a JPG, PNG, GIF, or WebP image.');
  }
  if (file.size > 12 * 1024 * 1024) {
    throw new Error('Image must be under 12 MB.');
  }
  const dataUrl = await readFileAsDataUrl(file);
  if (dataUrl.length <= MAX_FEED_IMAGE_CHARS) return dataUrl;
  return compressFeedImage(dataUrl);
}

function loadEmojiCatalog() {
  if (!emojiCatalogPromise) {
    emojiCatalogPromise = api('/feed/emojis')
      .then((data) => ({
        source: data.source || 'emoji.family',
        groups: Array.isArray(data.groups) && data.groups.length ? data.groups : FALLBACK_EMOJI_GROUPS,
      }))
      .catch(() => {
        emojiCatalogPromise = null;
        return { source: 'fallback', groups: FALLBACK_EMOJI_GROUPS };
      });
  }
  return emojiCatalogPromise;
}

function initialsFromName(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function roleLine(person) {
  return person?.designation || ROLE_LABELS[person?.role] || person?.role || '';
}

function insertEmoji(value, emoji, el) {
  if (!el) return `${value || ''}${emoji}`;
  const start = el.selectionStart ?? String(value || '').length;
  const end = el.selectionEnd ?? start;
  return `${String(value || '').slice(0, start)}${emoji}${String(value || '').slice(end)}`;
}

function HashtagText({ text, onTag, people = [] }) {
  const splitter = useMemo(() => {
    const names = [...people]
      .map((person) => String(person.name || '').trim())
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);
    const mention = names.length
      ? names.map(escapeRegExp).join('|')
      : '[A-Za-z][\\w.]{0,40}';
    return new RegExp(`(@(?:${mention})|#[A-Za-z0-9_]{2,40})`, 'gi');
  }, [people]);

  const chunks = String(text || '').split(splitter);
  return (
    <>
      {chunks.map((chunk, i) => {
        if (chunk.startsWith('#')) {
          if (onTag) {
            return (
              <button key={`${chunk}-${i}`} type="button" className="feed-hashtag" onClick={() => onTag(chunk)}>
                {chunk}
              </button>
            );
          }
          return (
            <span key={`${chunk}-${i}`} className="feed-hashtag">
              {chunk}
            </span>
          );
        }
        if (chunk.startsWith('@')) {
          const needle = chunk.slice(1).toLowerCase();
          const person = people.find((item) => String(item.name || '').toLowerCase() === needle);
          return (
            <span key={`${chunk}-${i}`} className="feed-mention">
              {chunk}
              {person && (person.department || person.location) ? (
                <em>{[person.department, person.location].filter(Boolean).join(' · ')}</em>
              ) : null}
            </span>
          );
        }
        return <span key={i}>{chunk}</span>;
      })}
    </>
  );
}

function MentionMenu({ people, query, activeIndex, onPick }) {
  const list = filterPeople(people, query);
  if (!list.length) return null;
  return (
    <div className="feed-mention-menu" role="listbox">
      {list.map((person, index) => (
        <button
          key={person.id}
          type="button"
          className={index === activeIndex ? 'is-on' : ''}
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(person);
          }}
        >
          <Avatar name={person.name} photo={person.photo} userId={person.id} size="sm" />
          <span>
            <strong>{person.name}</strong>
            <em>{[person.department, person.location].filter(Boolean).join(' · ') || 'Teammate'}</em>
          </span>
        </button>
      ))}
    </div>
  );
}

function iconProps(size = 18) {
  return { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', 'aria-hidden': true };
}

function SmileIcon({ size = 18 }) {
  return (
    <svg {...iconProps(size)}>
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8.4 13.6a4.2 4.2 0 0 0 7.2 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M9 9.4h.01M15 9.4h.01" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

function HeartIcon({ size = 16, filled = false }) {
  return (
    <svg {...iconProps(size)}>
      <path
        d="M12 19.2S4.8 14.4 4.8 9.8A3.7 3.7 0 0 1 12 7.6a3.7 3.7 0 0 1 7.2 2.2C19.2 14.4 12 19.2 12 19.2Z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CommentIcon({ size = 16 }) {
  return (
    <svg {...iconProps(size)}>
      <path d="M5 7.8h10.2A2.2 2.2 0 0 1 17.4 10v4.4a2.2 2.2 0 0 1-2.2 2.2H9.2L5.6 19.4v-3H5A2.2 2.2 0 0 1 2.8 14V10A2.2 2.2 0 0 1 5 7.8Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

function PartyIcon({ size = 18 }) {
  return (
    <svg {...iconProps(size)}>
      <path d="m5 20 4.2-9.4L15 14.8 5 20Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M14.2 6.2c.8-1.6 2.6-2.4 4.2-1.6M12.5 8.8c1.7-.2 3.2.8 3.6 2.4M17.8 11.2c.4-1.6 2-2.6 3.6-2.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function CakeIcon({ size = 16 }) {
  return (
    <svg {...iconProps(size)}>
      <path d="M4.8 12.4h14.4v6.2A1.8 1.8 0 0 1 17.4 20.4H6.6A1.8 1.8 0 0 1 4.8 18.6v-6.2Z" stroke="currentColor" strokeWidth="1.7" />
      <path d="M4.8 12.4c1.4 1 2.9 1 4.4 0s3-.9 4.4 0 3 .9 4.4 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M8.2 8.4v4M12 7.2v5.2M15.8 8.4v4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function MedalIcon({ size = 16 }) {
  return (
    <svg {...iconProps(size)}>
      <circle cx="12" cy="13.2" r="4.4" stroke="currentColor" strokeWidth="1.7" />
      <path d="m9.2 4.6 2.8 4.2L14.8 4.6" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

function BookmarkIcon({ size = 16, filled = false }) {
  return (
    <svg {...iconProps(size)}>
      <path
        d="M7 5.2h10a1.2 1.2 0 0 1 1.2 1.2v13l-6.2-3.4L6 19.4V6.4A1.2 1.2 0 0 1 7.2 5.2H7Z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ShareIcon({ size = 16 }) {
  return (
    <svg {...iconProps(size)}>
      <path d="M8.2 12.2 15.8 8.4M8.2 12.2l7.6 3.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="6.4" cy="12.2" r="2.1" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="17.4" cy="7.6" r="2.1" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="17.4" cy="16.8" r="2.1" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function EyeIcon({ size = 20 }) {
  return (
    <svg {...iconProps(size)}>
      <path d="M3.6 12s3.2-5.4 8.4-5.4S20.4 12 20.4 12s-3.2 5.4-8.4 5.4S3.6 12 3.6 12Z" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="12" cy="12" r="2.4" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function CheckIcon({ size = 16 }) {
  return (
    <svg {...iconProps(size)}>
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.7" />
      <path d="m8.6 12.2 2.2 2.2 4.6-4.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <rect x="3.5" y="5.5" width="17" height="13" rx="2.4" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="9" cy="10.2" r="1.6" stroke="currentColor" strokeWidth="1.6" />
      <path d="m7.5 16.5 3.2-3.4 2.6 2.4 2.4-2.7 3.3 3.7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MembersIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
      <circle cx="9" cy="9" r="3.1" stroke="currentColor" strokeWidth="1.7" />
      <path d="M4.4 18.2c.7-2.6 2.8-4.1 4.6-4.1s3.9 1.5 4.6 4.1" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M16.4 9.4a2.4 2.4 0 1 1 0 4.7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M19.2 18.2c.3-1.6 1.3-2.8 2.6-3.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
      <path d="M5 8.6h9.4a2 2 0 0 1 2 2v4.1a2 2 0 0 1-2 2H9.2L6 19.6v-2.8H5a2 2 0 0 1-2-2V10.6a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

function BriefcaseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
      <rect x="3.5" y="8" width="17" height="11" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M9 8V6.8A2.3 2.3 0 0 1 11.3 4.5h1.4A2.3 2.3 0 0 1 15 6.8V8" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
      <path d="M12 21s6.2-5.1 6.2-10.2A6.2 6.2 0 0 0 12 4.6a6.2 6.2 0 0 0-6.2 6.2C5.8 15.9 12 21 12 21Z" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="12" cy="10.6" r="2" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function SortIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
      <path d="M4 7h10M4 12h7M4 17h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M16 8.5 19 5.5 22 8.5M19 5.5v13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Avatar({ name, photo, userId, size = 'md' }) {
  const [broken, setBroken] = useState(false);
  const initials = initialsFromName(name);
  const tone = Number(userId || 0) % 6;
  const src = avatarSrc(photo);
  if (!broken) {
    return (
      <img
        className={`feed-avatar feed-avatar-${size}${photo ? '' : ' is-default-avatar'}`}
        src={src}
        alt=""
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <span className={`feed-avatar feed-avatar-${size} feed-avatar-fallback tone-${tone}`} aria-hidden="true">
      {initials}
    </span>
  );
}

function EmojiPicker({ onPick, label = 'Add emoji' }) {
  const { mode } = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [groupKey, setGroupKey] = useState('all');
  const [catalog, setCatalog] = useState(null);
  const [loading, setLoading] = useState(false);
  const [coords, setCoords] = useState(null);
  const wrapRef = useRef(null);
  const popRef = useRef(null);
  const searchRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function onDoc(e) {
      if (wrapRef.current?.contains(e.target) || popRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setLoading(!catalog);
    loadEmojiCatalog()
      .then((data) => {
        if (!cancelled) setCatalog(data);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    const t = setTimeout(() => searchRef.current?.focus(), 40);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [open, catalog]);

  useLayoutEffect(() => {
    if (!open) {
      setCoords(null);
      return undefined;
    }
    function place() {
      const trigger = wrapRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const width = Math.min(360, window.innerWidth - 16);
      const gap = 8;
      const spaceBelow = window.innerHeight - rect.bottom - gap - 8;
      const spaceAbove = rect.top - gap - 8;
      const openBelow = spaceBelow >= 260 || spaceBelow >= spaceAbove;
      const maxHeight = Math.min(420, Math.max(220, openBelow ? spaceBelow : spaceAbove));
      let left = rect.right - width;
      left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
      let top = openBelow ? rect.bottom + gap : rect.top - maxHeight - gap;
      top = Math.max(8, Math.min(top, window.innerHeight - maxHeight - 8));
      setCoords({ top, left, width, maxHeight });
    }
    place();
    window.addEventListener('resize', place);
    document.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      document.removeEventListener('scroll', place, true);
    };
  }, [open]);

  const groups = catalog?.groups || FALLBACK_EMOJI_GROUPS;
  const needle = query.trim().toLowerCase();
  const visibleEmojis = useMemo(() => {
    const pool = (groupKey === 'all' ? groups.flatMap((g) => g.emojis) : groups.find((g) => g.key === groupKey)?.emojis) || [];
    if (!needle) return pool;
    return pool.filter(
      (item) =>
        item.emoji.includes(query.trim()) ||
        String(item.annotation || '').toLowerCase().includes(needle)
    );
  }, [groups, groupKey, needle, query]);

  const picker = open && coords
    ? createPortal(
        <div
          ref={popRef}
          className="feed-emoji-pop"
          data-theme={mode}
          role="dialog"
          aria-label="Emoji picker"
          style={{
            top: coords.top,
            left: coords.left,
            width: coords.width,
            maxHeight: coords.maxHeight,
          }}
        >
          <input
            ref={searchRef}
            type="search"
            className="feed-emoji-search"
            placeholder="Search emoji…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="feed-emoji-groups">
            <button
              type="button"
              className={groupKey === 'all' ? 'is-on' : ''}
              onClick={() => setGroupKey('all')}
            >
              All
            </button>
            {groups.map((group) => (
              <button
                key={group.key}
                type="button"
                className={groupKey === group.key ? 'is-on' : ''}
                onClick={() => setGroupKey(group.key)}
              >
                {group.label}
              </button>
            ))}
          </div>
          <div className="feed-emoji-grid" role="listbox">
            {loading && <p className="muted slim">Loading emoji…</p>}
            {!loading && visibleEmojis.length === 0 && (
              <p className="muted slim">No emoji match that search.</p>
            )}
            {visibleEmojis.map((item) => (
              <button
                key={`${item.emoji}-${item.annotation}`}
                type="button"
                className="feed-emoji-opt"
                title={item.annotation || item.emoji}
                onClick={() => {
                  onPick(item.emoji);
                  setOpen(false);
                  setQuery('');
                }}
              >
                <span className="feed-emoji">{item.emoji}</span>
              </button>
            ))}
          </div>
        </div>,
        document.body
      )
    : null;

  return (
    <div className="feed-emoji-wrap" ref={wrapRef}>
      <button
        type="button"
        className="feed-emoji-toggle"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <SmileIcon />
      </button>
      {picker}
    </div>
  );
}

function PollChartIcon({ size = 14 }) {
  return (
    <svg {...iconProps(size)}>
      <path d="M7 16.5v-5M12 16.5v-9M17 16.5v-6.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

function ClockIcon({ size = 14 }) {
  return (
    <svg {...iconProps(size)}>
      <circle cx="12" cy="12" r="7.2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 8.2v4.1l2.6 1.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PollRadio({ checked }) {
  return (
    <span className={`feed-poll-radio${checked ? ' is-on' : ''}`} aria-hidden="true">
      {checked ? (
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none">
          <path d="m6.6 12.2 3.3 3.2 7.5-7.6" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : null}
    </span>
  );
}

function pollCrowdLabel(total, voted) {
  if (voted) {
    const others = Math.max(0, total - 1);
    if (total <= 1) return 'You voted';
    if (others === 1) return 'You and 1 other voted';
    return `You and ${others} others voted`;
  }
  if (total === 1) return '1 vote so far';
  if (total > 1) return `${total} votes so far`;
  return '';
}

function PollCard({ post, busy, onVote, people = [], user }) {
  const poll = post.poll;
  const total = poll?.total || 0;
  const voted = Boolean(poll?.voted);
  const faces = useMemo(() => {
    if (!voted) return [];
    const selfId = user?.id != null ? Number(user.id) : null;
    const ordered = [];
    const seen = new Set();
    const ids = poll?.voterIds || [];
    if (selfId != null) ordered.push(selfId);
    ids.forEach((id) => ordered.push(Number(id)));
    const next = [];
    for (const id of ordered) {
      if (!Number.isFinite(id) || seen.has(id) || next.length >= 3) continue;
      seen.add(id);
      const person = people.find((item) => Number(item.id) === id);
      if (person) {
        next.push(person);
      } else if (id === selfId) {
        next.push({ id: user.id, name: user.name, photo: user.profilePhoto });
      }
    }
    return next;
  }, [voted, poll?.voterIds, people, user]);

  if (!poll?.options?.length) return null;
  const crowdLabel = pollCrowdLabel(total, voted);

  return (
    <div className="feed-poll-card">
      <span className="feed-poll-pill">
        <PollChartIcon />
        Poll
      </span>
      <h3 className="feed-poll-question">{post.content || 'Team poll'}</h3>
      {!voted && (
        <p className="feed-poll-hint">You can see how others voted after you vote.</p>
      )}
      <div className="feed-poll">
        {poll.options.map((option) => {
          const pct = total ? Math.round((option.votes / total) * 100) : 0;
          return (
            <button
              key={option.id}
              type="button"
              className={`feed-poll-option${option.mine ? ' is-mine' : ''}${voted ? ' has-results' : ''}`}
              disabled={busy}
              aria-pressed={option.mine}
              aria-label={
                voted
                  ? `${option.label}, ${option.votes} ${option.votes === 1 ? 'vote' : 'votes'}, ${pct} percent`
                  : option.label
              }
              onClick={() => onVote(post.id, option.id)}
            >
              <span className="feed-poll-option-row">
                <PollRadio checked={Boolean(option.mine)} />
                <span className="feed-poll-label">{option.label}</span>
                {voted && (
                  <>
                    <span className="feed-poll-votes">
                      {option.votes} {option.votes === 1 ? 'vote' : 'votes'}
                    </span>
                    <span className="feed-poll-pct">{pct}%</span>
                  </>
                )}
              </span>
              {voted && (
                <span className="feed-poll-bar" aria-hidden="true">
                  <span className="feed-poll-bar-fill" style={{ width: `${pct}%` }} />
                </span>
              )}
            </button>
          );
        })}
      </div>
      {crowdLabel ? (
        <div className="feed-poll-foot">
          <span className="feed-poll-foot-left">
            {faces.length > 0 && (
              <span className="feed-poll-faces">
                {faces.map((person) => (
                  <Avatar
                    key={person.id}
                    name={person.name}
                    photo={person.photo}
                    userId={person.id}
                    size="xs"
                  />
                ))}
              </span>
            )}
            <span className="feed-poll-crowd">{crowdLabel}</span>
          </span>
          <span className="feed-poll-time">
            <ClockIcon />
            Open poll
          </span>
        </div>
      ) : null}
    </div>
  );
}

function ReactionBar({ reactions, onToggle, busy }) {
  const extras = (reactions || []).filter((r) => r.emoji !== LIKE_EMOJI && r.count > 0);
  return (
    <div className="feed-reaction-chips">
      {extras.map((r) => (
        <button
          key={r.emoji}
          type="button"
          className={`feed-chip${r.mine ? ' is-mine' : ''}`}
          disabled={busy}
          onClick={() => onToggle(r.emoji)}
        >
          <span className="feed-emoji">{r.emoji}</span>
          <span>{r.count}</span>
        </button>
      ))}
      <EmojiPicker onPick={onToggle} label="React with emoji" />
    </div>
  );
}

export default function CompanyFeed() {
  const { user } = useAuth();
  const category = 'all';
  const [posts, setPosts] = useState([]);
  const [counts, setCounts] = useState({ all: 0, celebration: 0, milestone: 0, announcement: 0, casual: 0, poll: 0 });
  const [celebrations, setCelebrations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [composer, setComposer] = useState('');
  const [composerType, setComposerType] = useState('casual');
  const [composerImage, setComposerImage] = useState('');
  const [pollOptions, setPollOptions] = useState(['', '']);
  const [imageBusy, setImageBusy] = useState(false);
  const [lightbox, setLightbox] = useState('');
  const [posting, setPosting] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set());
  const [drafts, setDrafts] = useState({});
  const [busyKey, setBusyKey] = useState('');
  const [viewFilter, setViewFilter] = useState('all');
  const [sortKey, setSortKey] = useState('latest');
  const [stats, setStats] = useState({ members: 0, reactions: 0, views: 0 });
  const [menuPostId, setMenuPostId] = useState(null);
  const [showAllCelebrations, setShowAllCelebrations] = useState(false);
  const [bookmarks, setBookmarks] = useState(() => readIdSet('bookmarks', user?.id));
  const [seenIds, setSeenIds] = useState(() => readIdSet('seen', user?.id));
  const [people, setPeople] = useState([]);
  const [mention, setMention] = useState(null);
  const composerRef = useRef(null);
  const replyRefs = useRef({});
  const imageInputRef = useRef(null);
  const toastTimer = useRef(null);

  const showToast = useCallback((message) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 3200);
  }, []);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  useEffect(() => {
    if (!lightbox) return undefined;
    function onKey(e) {
      if (e.key === 'Escape') setLightbox('');
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [lightbox]);

  const load = useCallback(async ({ silent } = {}) => {
    setError('');
    if (!silent) setLoading(true);
    try {
      const params = new URLSearchParams();
      if (category !== 'all') params.set('category', category);
      const qs = params.toString();
      const data = await api(`/feed${qs ? `?${qs}` : ''}`);
      setPosts(data.posts || []);
      setCounts(data.counts || { all: 0, celebration: 0, milestone: 0, announcement: 0, casual: 0, poll: 0 });
      setCelebrations(data.celebrations || []);
      setPeople(data.people || []);
      setStats(data.stats || { members: 0, reactions: 0, views: 0 });
    } catch (err) {
      setError(err.message || 'Could not load the feed');
    } finally {
      setLoading(false);
    }
  }, [category]);

  const didLoad = useRef(false);
  useEffect(() => {
    load({ silent: didLoad.current });
    didLoad.current = true;
  }, [load]);

  function patchPost(postId, next) {
    setPosts((list) => list.map((p) => (p.id === postId ? { ...p, ...next } : p)));
  }

  function patchComment(commentId, next) {
    setPosts((list) =>
      list.map((p) => ({
        ...p,
        comments: (p.comments || []).map((c) => (c.id === commentId ? { ...c, ...next } : c)),
      }))
    );
  }

  async function handleShare() {
    const wantsPoll = composerType === 'poll';
    const cleanedPoll = wantsPoll
      ? pollOptions.map((opt) => opt.trim()).filter(Boolean)
      : [];
    if (wantsPoll && cleanedPoll.length < 2) {
      showToast('Add at least two poll options.');
      return;
    }
    if (!composer.trim() && !composerImage && cleanedPoll.length < 2) {
      showToast('Write something, attach an image, or add a poll before sharing.');
      return;
    }
    if (wantsPoll && !composer.trim()) {
      showToast('Add a question for the poll.');
      return;
    }
    setPosting(true);
    setError('');
    try {
      const data = await api('/feed/posts', {
        method: 'POST',
        body: {
          category: composerType,
          content: composer.trim(),
          image: composerImage || null,
          poll: cleanedPoll.length >= 2 ? { options: cleanedPoll } : null,
        },
      });
      setComposer('');
      setComposerImage('');
      setPollOptions(['', '']);
      setExpanded((prev) => new Set(prev).add(data.post.id));
      if (category === 'all' || category === composerType) {
        setPosts((list) => [data.post, ...list.filter((p) => p.id !== data.post.id)]);
      }
      setCounts((prev) => ({
        ...prev,
        all: (prev.all || 0) + 1,
        [composerType]: (prev[composerType] || 0) + 1,
      }));
      showToast(cleanedPoll.length >= 2 ? 'Poll shared with the team.' : 'Post shared with the team.');
    } catch (err) {
      setError(err.message);
    } finally {
      setPosting(false);
    }
  }

  async function votePoll(postId, optionId) {
    const key = `poll-${postId}`;
    setBusyKey(key);
    try {
      const data = await api(`/feed/posts/${postId}/poll/votes`, {
        method: 'POST',
        body: { optionId },
      });
      if (data.post) patchPost(postId, data.post);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyKey('');
    }
  }

  async function handleImagePick(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImageBusy(true);
    setError('');
    try {
      setComposerImage(await prepareFeedImage(file));
    } catch (err) {
      showToast(err.message || 'Could not attach that image.');
    } finally {
      setImageBusy(false);
    }
  }

  async function toggleReaction(kind, id, emoji = LIKE_EMOJI) {
    const key = `${kind}-${id}-${emoji}`;
    setBusyKey(key);
    try {
      const path =
        kind === 'post' ? `/feed/posts/${id}/reactions` : `/feed/comments/${id}/reactions`;
      const data = await api(path, { method: 'POST', body: { emoji } });
      if (kind === 'post') patchPost(id, data);
      else patchComment(id, data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyKey('');
    }
  }

  async function submitComment(postId) {
    const text = String(drafts[postId] || '').trim();
    if (!text) return;
    setBusyKey(`comment-${postId}`);
    try {
      const data = await api(`/feed/posts/${postId}/comments`, {
        method: 'POST',
        body: { content: text },
      });
      patchPost(postId, data.post);
      setDrafts((d) => ({ ...d, [postId]: '' }));
      showToast('Reply added.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyKey('');
    }
  }

  async function removePost(postId) {
    if (!window.confirm('Delete this post?')) return;
    try {
      await api(`/feed/posts/${postId}`, { method: 'DELETE' });
      const removed = posts.find((p) => p.id === postId);
      setPosts((list) => list.filter((p) => p.id !== postId));
      if (removed) {
        setCounts((prev) => ({
          ...prev,
          all: Math.max(0, (prev.all || 0) - 1),
          [removed.category]: Math.max(0, (prev[removed.category] || 0) - 1),
        }));
      }
      showToast('Post removed.');
    } catch (err) {
      setError(err.message);
    }
  }

  async function removeComment(commentId) {
    try {
      const data = await api(`/feed/comments/${commentId}`, { method: 'DELETE' });
      if (data.post) patchPost(data.post.id, data.post);
      showToast('Reply removed.');
    } catch (err) {
      setError(err.message);
    }
  }

  function fillWish(person) {
    setComposerType(person.kind === 'anniversary' ? 'milestone' : 'celebration');
    setComposer(
      person.kind === 'anniversary'
        ? `Huge congratulations ${person.name} on this work anniversary! Thank you for everything you bring to the team. 🎖️👏 #WorkAnniversary`
        : `Happy Birthday, ${person.name}! Hope you have an incredible day. 🎉🥳 #TeamCelebrations`
    );
    composerRef.current?.focus();
    composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function toggleExpanded(postId) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(postId)) next.delete(postId);
      else next.add(postId);
      return next;
    });
  }

  const canModerate = user?.role === 'hr';

  useEffect(() => {
    setBookmarks(readIdSet('bookmarks', user?.id));
    setSeenIds(readIdSet('seen', user?.id));
  }, [user?.id]);

  useEffect(() => {
    if (menuPostId == null) return undefined;
    function onDoc(e) {
      if (!e.target.closest?.('.feed-post-menu')) setMenuPostId(null);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menuPostId]);

  useEffect(() => {
    if (loading || viewFilter !== 'all' || !posts.length) return undefined;
    const timer = setTimeout(() => {
      setSeenIds((prev) => {
        const next = new Set(prev);
        posts.forEach((post) => next.add(post.id));
        writeIdSet('seen', user?.id, next);
        return next;
      });
    }, 1800);
    return () => clearTimeout(timer);
  }, [loading, viewFilter, posts, user?.id]);

  function toggleBookmark(postId) {
    setBookmarks((prev) => {
      const next = new Set(prev);
      if (next.has(postId)) next.delete(postId);
      else next.add(postId);
      writeIdSet('bookmarks', user?.id, next);
      return next;
    });
    setMenuPostId(null);
  }

  const visiblePosts = useMemo(() => {
    let list = posts;
    if (viewFilter === 'unread') {
      list = list.filter((post) => !seenIds.has(post.id) && post.userId !== user?.id);
    } else if (viewFilter === 'mentions') {
      list = list.filter((post) => postMentionsUser(post, user, people));
    } else if (viewFilter === 'bookmarks') {
      list = list.filter((post) => bookmarks.has(post.id));
    }
    if (sortKey === 'top') {
      list = [...list].sort((a, b) => (b.likes || 0) - (a.likes || 0) || b.id - a.id);
    }
    return list;
  }, [posts, viewFilter, seenIds, user, bookmarks, sortKey, people]);

  const mentionMatches = mention ? filterPeople(people, mention.query) : [];

  function syncMention(scope, value, caret) {
    const token = mentionToken(value, caret);
    if (!token) {
      setMention(null);
      return;
    }
    const matches = filterPeople(people, token.query);
    setMention((current) => ({
      scope,
      query: token.query,
      index: current?.scope === scope ? Math.min(current.index || 0, Math.max(0, matches.length - 1)) : 0,
    }));
  }

  function pickMention(person) {
    if (!mention || !person) return;
    if (mention.scope === 'composer') {
      const caret = composerRef.current?.selectionStart ?? composer.length;
      const next = insertMentionText(composer, caret, person);
      setComposer(next.value);
      setMention(null);
      requestAnimationFrame(() => {
        composerRef.current?.focus();
        composerRef.current?.setSelectionRange(next.caret, next.caret);
      });
      return;
    }
    const field = replyRefs.current[mention.scope];
    const current = drafts[mention.scope] || '';
    const caret = field?.selectionStart ?? current.length;
    const next = insertMentionText(current, caret, person);
    setDrafts((d) => ({ ...d, [mention.scope]: next.value }));
    setMention(null);
    requestAnimationFrame(() => {
      field?.focus();
      field?.setSelectionRange(next.caret, next.caret);
    });
  }

  function handleMentionKey(e) {
    if (!mention || !mentionMatches.length) return false;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setMention((m) => ({ ...m, index: ((m.index || 0) + 1) % mentionMatches.length }));
      return true;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setMention((m) => ({ ...m, index: ((m.index || 0) - 1 + mentionMatches.length) % mentionMatches.length }));
      return true;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      pickMention(mentionMatches[mention.index] || mentionMatches[0]);
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setMention(null);
      return true;
    }
    return false;
  }

  const visibleCelebrations = showAllCelebrations ? celebrations : celebrations.slice(0, 4);

  async function sharePost(post) {
    const text = [post.author, post.content].filter(Boolean).join(': ') || 'Shared a post from the team feed.';
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Team Feed', text });
      } else {
        await navigator.clipboard.writeText(text);
        showToast('Post copied.');
      }
    } catch {
      /* user cancelled */
    }
  }

  return (
    <div className="feed-page">
      {toast && (
        <div className="feed-toast" role="status">
          <CheckIcon />
          {toast}
        </div>
      )}

      {error && <p className="form-error">{error}</p>}

      <div className="feed-layout">
        <aside className="feed-col feed-col-side">
          <section className="feed-card feed-profile">
            <div className="feed-profile-avatar-wrap">
              <Avatar name={user?.name} photo={user?.profilePhoto} userId={user?.id} size="lg" />
              <span className="feed-online" aria-hidden="true" />
            </div>
            <h3>{user?.name || 'You'}</h3>
            <p>{user?.department || roleLine(user)}</p>
            <span className="feed-online-pill">Online</span>
            <div className="feed-profile-facts">
              <div>
                <span className="feed-fact-icon"><BriefcaseIcon /></span>
                <div>
                  <span>Department</span>
                  <strong>{user?.department || '—'}</strong>
                </div>
              </div>
              <div>
                <span className="feed-fact-icon"><PinIcon /></span>
                <div>
                  <span>Location</span>
                  <strong>{user?.location || 'Remote'}</strong>
                </div>
              </div>
            </div>
          </section>

          <section className="feed-card feed-quick-stats">
            <h4>Quick Stats</h4>
            <div className="feed-stats-grid">
              <div className="feed-stat">
                <span className="feed-stat-icon is-members"><MembersIcon /></span>
                <div>
                  <strong>{formatCount(stats.members)}</strong>
                  <span>Members</span>
                </div>
              </div>
              <div className="feed-stat">
                <span className="feed-stat-icon is-chats"><ChatIcon /></span>
                <div>
                  <strong>{formatCount(counts.all)}</strong>
                  <span>Conversations</span>
                </div>
              </div>
              <div className="feed-stat">
                <span className="feed-stat-icon is-hearts"><HeartIcon /></span>
                <div>
                  <strong>{formatCount(stats.reactions)}</strong>
                  <span>Reactions</span>
                </div>
              </div>
              <div className="feed-stat">
                <span className="feed-stat-icon is-views"><EyeIcon /></span>
                <div>
                  <strong>{formatCount(stats.views)}</strong>
                  <span>Views</span>
                </div>
              </div>
            </div>
          </section>
        </aside>

        <section className="feed-col feed-main">
          <div className="feed-card feed-composer">
            <div className="feed-composer-row">
              <Avatar name={user?.name} photo={user?.profilePhoto} userId={user?.id} />
              <div className="feed-composer-field">
                <textarea
                  ref={composerRef}
                  rows={3}
                  value={composer}
                  onChange={(e) => {
                    setComposer(e.target.value);
                    syncMention('composer', e.target.value, e.target.selectionStart);
                  }}
                  onKeyDown={(e) => handleMentionKey(e)}
                  onKeyUp={(e) => syncMention('composer', e.target.value, e.target.selectionStart)}
                  placeholder={
                    composerType === 'poll'
                      ? 'Ask a question for the team…'
                      : 'Share a celebration, team shout-out, or announcement... Type @ to mention someone.'
                  }
                />
                {mention?.scope === 'composer' && (
                  <MentionMenu
                    people={people}
                    query={mention.query}
                    activeIndex={mention.index}
                    onPick={pickMention}
                  />
                )}
                <div className="feed-composer-emoji">
                  <EmojiPicker
                    onPick={(emoji) => {
                      setComposer((value) => insertEmoji(value, emoji, composerRef.current));
                      requestAnimationFrame(() => composerRef.current?.focus());
                    }}
                    label="Insert emoji in post"
                  />
                </div>
              </div>
            </div>
            {composerImage && (
              <div className="feed-composer-preview">
                <img src={composerImage} alt="Attachment preview" />
                <button
                  type="button"
                  className="feed-composer-preview-remove"
                  onClick={() => setComposerImage('')}
                >
                  Remove
                </button>
              </div>
            )}
            {composerType === 'poll' && (
              <div className="feed-poll-editor">
                {pollOptions.map((option, index) => (
                  <div key={index} className="feed-poll-editor-row">
                    <input
                      value={option}
                      maxLength={80}
                      placeholder={`Option ${index + 1}`}
                      onChange={(e) =>
                        setPollOptions((list) => list.map((item, i) => (i === index ? e.target.value : item)))
                      }
                    />
                    {pollOptions.length > 2 && (
                      <button
                        type="button"
                        className="feed-poll-remove"
                        onClick={() => setPollOptions((list) => list.filter((_, i) => i !== index))}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
                {pollOptions.length < 6 && (
                  <button
                    type="button"
                    className="feed-poll-add"
                    onClick={() => setPollOptions((list) => [...list, ''])}
                  >
                    + Add option
                  </button>
                )}
              </div>
            )}
            <div className="feed-composer-actions">
              <label className="feed-mini-select">
                <span className="sr-only">Post channel</span>
                <select
                  value={composerType}
                  onChange={(e) => {
                    const value = e.target.value;
                    setComposerType(value);
                    if (value !== 'poll') setPollOptions(['', '']);
                  }}
                >
                  {COMPOSER_TYPES.map((type) => (
                    <option key={type.key} value={type.key}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="feed-composer-right">
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  className="sr-only"
                  onChange={handleImagePick}
                />
                <button
                  type="button"
                  className="feed-photo-btn"
                  disabled={imageBusy || posting}
                  onClick={() => imageInputRef.current?.click()}
                >
                  <ImageIcon />
                  {imageBusy ? 'Uploading…' : composerImage ? 'Change photo' : 'Add photo'}
                </button>
                <EmojiPicker
                  onPick={(emoji) => {
                    setComposer((value) => insertEmoji(value, emoji, composerRef.current));
                    requestAnimationFrame(() => composerRef.current?.focus());
                  }}
                  label="Insert emoji in post"
                />
                <button type="button" className="btn feed-share-btn" disabled={posting || imageBusy} onClick={handleShare}>
                  Share Post
                </button>
              </div>
            </div>
          </div>

          <div className="feed-filter-bar">
            <div className="feed-filter-pills" role="tablist" aria-label="Feed filters">
              {VIEW_FILTERS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  role="tab"
                  aria-selected={viewFilter === item.key}
                  className={`feed-filter-pill${viewFilter === item.key ? ' is-on' : ''}`}
                  onClick={() => setViewFilter(item.key)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="feed-filter-right">
              <label className="feed-mini-select feed-sort-select">
                <SortIcon />
                <span className="sr-only">Sort posts</span>
                <select value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
                  <option value="latest">Latest</option>
                  <option value="top">Top</option>
                </select>
              </label>
            </div>
          </div>

          {loading && <p className="muted">Loading feed…</p>}
          {!loading && visiblePosts.length === 0 && (
            <div className="feed-card feed-empty">
              {viewFilter === 'unread'
                ? 'You are all caught up. No unread posts.'
                : viewFilter === 'mentions'
                  ? 'No posts mention you right now.'
                  : viewFilter === 'bookmarks'
                    ? 'No bookmarked conversations yet.'
                    : 'No conversations match the current filters.'}
            </div>
          )}

          {visiblePosts.map((post) => {
            const open = expanded.has(post.id);
            const canDelete = canModerate || post.userId === user?.id;
            const bookmarked = bookmarks.has(post.id);
            return (
              <article key={post.id} className={`feed-card feed-post cat-${post.category}`}>
                <header className="feed-post-head">
                  <div className="feed-post-who">
                    <Avatar name={post.author} photo={post.photo} userId={post.userId} />
                    <div>
                      <strong>{post.author}</strong>
                      <span>
                        {post.department || roleLine(post)} · {formatRelativeTime(post.createdAt)}
                      </span>
                    </div>
                  </div>
                  <div className="feed-post-menu">
                    <button
                      type="button"
                      className="feed-more-btn"
                      aria-label="Post actions"
                      aria-expanded={menuPostId === post.id}
                      onClick={() => setMenuPostId((id) => (id === post.id ? null : post.id))}
                    >
                      ⋯
                    </button>
                    {menuPostId === post.id && (
                      <div className="feed-more-menu" role="menu">
                        <button type="button" onClick={() => toggleBookmark(post.id)}>
                          {bookmarked ? 'Remove bookmark' : 'Bookmark'}
                        </button>
                        {canDelete && (
                          <button type="button" className="is-danger" onClick={() => removePost(post.id)}>
                            Delete
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </header>
                {post.poll?.options?.length ? null : (
                  <span className={`feed-badge ${post.category}`}>
                    <span className="feed-emoji">{BADGE_EMOJI[post.category] || '✨'}</span>
                    {post.badgeText}
                  </span>
                )}
                <div className="feed-post-main">
                  {post.poll?.options?.length ? (
                    <PollCard
                      post={post}
                      busy={busyKey === `poll-${post.id}`}
                      onVote={votePoll}
                      people={people}
                      user={user}
                    />
                  ) : post.content ? (
                    <p className="feed-post-body">
                      <HashtagText text={post.content} people={people} />
                    </p>
                  ) : null}
                </div>
                {post.image ? (
                  <button
                    type="button"
                    className="feed-post-image"
                    onClick={() => setLightbox(post.image)}
                    aria-label="View attached photo"
                  >
                    <img src={post.image} alt="" />
                  </button>
                ) : null}
                <div className="feed-post-actions">
                  <ReactionBar
                    reactions={post.reactions}
                    busy={Boolean(busyKey)}
                    onToggle={(emoji) => toggleReaction('post', post.id, emoji)}
                  />
                  <div className="feed-post-toolbar">
                    <button
                      type="button"
                      className={`feed-tool-btn${post.hasLiked ? ' is-on' : ''}`}
                      disabled={busyKey.startsWith(`post-${post.id}`)}
                      onClick={() => toggleReaction('post', post.id, LIKE_EMOJI)}
                    >
                      <HeartIcon filled={post.hasLiked} />
                      Like
                    </button>
                    <button type="button" className="feed-tool-btn" onClick={() => toggleExpanded(post.id)}>
                      <CommentIcon />
                      Comment
                    </button>
                    <button type="button" className="feed-tool-btn" onClick={() => sharePost(post)}>
                      <ShareIcon />
                      Share
                    </button>
                    <button
                      type="button"
                      className={`feed-tool-btn${bookmarked ? ' is-saved' : ''}`}
                      onClick={() => toggleBookmark(post.id)}
                    >
                      <BookmarkIcon filled={bookmarked} />
                      Bookmark
                    </button>
                  </div>
                </div>
                {open && (
                  <div className="feed-comments">
                    {(post.comments || []).length === 0 && (
                      <p className="muted slim">No comments yet. Start the conversation below.</p>
                    )}
                    {(post.comments || []).map((comment) => (
                      <div key={comment.id} className="feed-comment">
                        <Avatar name={comment.author} photo={comment.photo} userId={comment.userId} size="sm" />
                        <div className="feed-comment-body">
                          <div className="feed-comment-head">
                            <strong>{comment.author}</strong>
                            <span>{formatRelativeTime(comment.createdAt)}</span>
                          </div>
                          <p>
                            <HashtagText text={comment.content} people={people} />
                          </p>
                          <div className="feed-comment-actions">
                            <button
                              type="button"
                              className={`feed-like sm${comment.hasLiked ? ' is-on' : ''}`}
                              onClick={() => toggleReaction('comment', comment.id, LIKE_EMOJI)}
                            >
                              <HeartIcon filled={comment.hasLiked} />
                              {comment.likes || 0}
                            </button>
                            <ReactionBar
                              reactions={comment.reactions}
                              onToggle={(emoji) => toggleReaction('comment', comment.id, emoji)}
                            />
                            {(canModerate || comment.userId === user?.id) && (
                              <button type="button" className="feed-delete" onClick={() => removeComment(comment.id)}>
                                Delete
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                    <div className="feed-reply">
                      <div className="feed-reply-field">
                        <input
                          ref={(el) => {
                            replyRefs.current[post.id] = el;
                          }}
                          type="text"
                          value={drafts[post.id] || ''}
                          onChange={(e) => {
                            setDrafts((d) => ({ ...d, [post.id]: e.target.value }));
                            syncMention(post.id, e.target.value, e.target.selectionStart);
                          }}
                          onKeyDown={(e) => {
                            if (handleMentionKey(e)) return;
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              submitComment(post.id);
                            }
                          }}
                          onKeyUp={(e) => syncMention(post.id, e.target.value, e.target.selectionStart)}
                          placeholder="Write a reply… Type @ to mention someone."
                        />
                        {mention?.scope === post.id && (
                          <MentionMenu
                            people={people}
                            query={mention.query}
                            activeIndex={mention.index}
                            onPick={pickMention}
                          />
                        )}
                      </div>
                      <EmojiPicker
                        onPick={(emoji) =>
                          setDrafts((d) => ({ ...d, [post.id]: `${d[post.id] || ''}${emoji}` }))
                        }
                        label="Insert emoji in reply"
                      />
                      <button
                        type="button"
                        className="btn secondary"
                        disabled={busyKey === `comment-${post.id}`}
                        onClick={() => submitComment(post.id)}
                      >
                        Reply
                      </button>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </section>

        <aside className="feed-col feed-col-side">
          <section className="feed-card">
            <div className="feed-widget-head">
              <h4>
                <span className="feed-widget-icon"><PartyIcon /></span>
                Upcoming celebrations
              </h4>
              {celebrations.length > 4 && (
                <button
                  type="button"
                  className="feed-view-all"
                  onClick={() => setShowAllCelebrations((v) => !v)}
                >
                  {showAllCelebrations ? 'Show less' : 'View all'}
                </button>
              )}
            </div>
            {celebrations.length === 0 && (
              <p className="muted slim">Birthdays and work anniversaries from onboarding will show here.</p>
            )}
            <div className="feed-people">
              {visibleCelebrations.map((person) => (
                <button
                  key={`${person.kind}-${person.userId}-${person.date}`}
                  type="button"
                  className="feed-person"
                  onClick={() => fillWish(person)}
                >
                  <span className={`feed-event-icon is-${person.kind}`}>
                    {person.kind === 'anniversary' ? <MedalIcon /> : <CakeIcon />}
                  </span>
                  <span className="feed-person-copy">
                    <strong>{person.name}{person.kind === 'anniversary' ? "'s Anniversary" : "'s Birthday"}</strong>
                    <span>{person.daysUntil === 0 ? 'Today' : formatDate(person.date)}</span>
                  </span>
                  <span className={`feed-countdown is-${countdownTone(person.daysUntil)}`}>
                    {countdownLabel(person.daysUntil)}
                  </span>
                </button>
              ))}
            </div>
          </section>

        </aside>
      </div>

      {lightbox
        ? createPortal(
            <button
              type="button"
              className="feed-lightbox"
              onClick={() => setLightbox('')}
              aria-label="Close photo"
            >
              <img src={lightbox} alt="" />
            </button>,
            document.body
          )
        : null}
    </div>
  );
}
