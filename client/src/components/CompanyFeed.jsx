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

const CHANNELS = [
  { key: 'all', label: 'All Feed Channels', emoji: '✨' },
  { key: 'celebration', label: 'Celebrations 🎂', emoji: '🎂' },
  { key: 'milestone', label: 'Milestones 🎖️', emoji: '🎖️' },
  { key: 'announcement', label: 'Announcements 📣', emoji: '📣' },
  { key: 'casual', label: 'Casual Coffee Chat ☕', emoji: '☕' },
  { key: 'poll', label: 'Polls 📊', emoji: '📊' },
];

const FEED_EMOJIS = ['❤️', '👍', '🎉', '👏', '😂', '🎂', '☕', '🔥', '💯', '😊', '🥳', '😎', '🙌', '💪', '🌟', '🚀'];
const LIKE_EMOJI = '❤️';
const FALLBACK_TAGS = ['#TeamCelebrations', '#WorkAnniversary', '#Announcements', '#DesignSync'];
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

function HashtagText({ text, onTag }) {
  const chunks = String(text || '').split(/(#[A-Za-z0-9_]{2,40})/g);
  return (
    <>
      {chunks.map((chunk, i) =>
        chunk.startsWith('#') ? (
          <button key={`${chunk}-${i}`} type="button" className="feed-hashtag" onClick={() => onTag(chunk)}>
            {chunk}
          </button>
        ) : (
          <span key={i}>{chunk}</span>
        )
      )}
    </>
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
                {item.emoji}
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
        😊
      </button>
      {picker}
    </div>
  );
}

const POLL_BAR_COLORS = [
  { fill: 'linear-gradient(90deg, #2563eb, #60a5fa)', glow: 'rgba(37, 99, 235, 0.38)' },
  { fill: 'linear-gradient(90deg, #ef4444, #fb7185)', glow: 'rgba(239, 68, 68, 0.36)' },
  { fill: 'linear-gradient(90deg, #16a34a, #4ade80)', glow: 'rgba(22, 163, 74, 0.36)' },
  { fill: 'linear-gradient(90deg, #7c3aed, #c084fc)', glow: 'rgba(124, 58, 237, 0.36)' },
  { fill: 'linear-gradient(90deg, #d97706, #fbbf24)', glow: 'rgba(217, 119, 6, 0.36)' },
  { fill: 'linear-gradient(90deg, #0891b2, #22d3ee)', glow: 'rgba(8, 145, 178, 0.36)' },
];

function PollCard({ post, busy, onVote }) {
  const poll = post.poll;
  const total = poll?.total || 0;
  const voted = Boolean(poll?.voted);
  if (!poll?.options?.length) return null;
  return (
    <div className="feed-poll-card">
      <div className="feed-poll-card-head">
        <h3>{post.content || 'Team poll'}</h3>
        <p>Asked by {post.author}</p>
      </div>
      <div className="feed-poll">
        {poll.options.map((option, index) => {
          const pct = total ? Math.round((option.votes / total) * 100) : 0;
          const color = POLL_BAR_COLORS[index % POLL_BAR_COLORS.length];
          const scale = pct > 0 ? Math.max(pct / 100, 0.08) : 0;
          return (
            <button
              key={option.id}
              type="button"
              className={`feed-poll-track${option.mine ? ' is-mine' : ''}${voted ? ' has-results' : ''}${voted && pct >= 28 ? ' is-filled' : ''}${voted && pct >= 62 ? ' is-wide' : ''}`}
              style={{
                '--poll-fill': color.fill,
                '--poll-glow': color.glow,
                '--poll-scale': scale,
                '--poll-delay': `${80 + index * 90}ms`,
              }}
              disabled={busy}
              aria-pressed={option.mine}
              onClick={() => onVote(post.id, option.id)}
            >
              {voted && pct > 0 && (
                <span className="feed-poll-fill" key={`${option.id}-${pct}-${option.mine ? 1 : 0}`} />
              )}
              {option.mine && (
                <span className="feed-poll-check" aria-hidden="true">
                  ✓
                </span>
              )}
              <span className="feed-poll-label">{option.label}</span>
              {voted && <span className="feed-poll-pct">{pct}%</span>}
            </button>
          );
        })}
      </div>
      <p className="feed-poll-meta">
        {total} {total === 1 ? 'vote' : 'votes'}
        {voted ? ' · tap a choice to change or clear' : ' · tap a choice to vote'}
      </p>
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
          <span>{r.emoji}</span>
          <span>{r.count}</span>
        </button>
      ))}
      <EmojiPicker onPick={onToggle} label="React with emoji" />
    </div>
  );
}

export default function CompanyFeed() {
  const { user } = useAuth();
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [posts, setPosts] = useState([]);
  const [counts, setCounts] = useState({ all: 0, celebration: 0, milestone: 0, announcement: 0, casual: 0, poll: 0 });
  const [tags, setTags] = useState([]);
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
  const composerRef = useRef(null);
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

  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), search.trim() ? 220 : 0);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async ({ silent } = {}) => {
    setError('');
    if (!silent) setLoading(true);
    try {
      const params = new URLSearchParams();
      if (category !== 'all') params.set('category', category);
      if (query) params.set('q', query);
      const qs = params.toString();
      const data = await api(`/feed${qs ? `?${qs}` : ''}`);
      setPosts(data.posts || []);
      setCounts(data.counts || { all: 0, celebration: 0, milestone: 0, announcement: 0, casual: 0, poll: 0 });
      setTags(data.tags?.length ? data.tags : FALLBACK_TAGS.map((tag) => ({ tag, count: 0 })));
      setCelebrations(data.celebrations || []);
    } catch (err) {
      setError(err.message || 'Could not load the feed');
    } finally {
      setLoading(false);
    }
  }, [category, query]);

  const didLoad = useRef(false);
  useEffect(() => {
    load({ silent: didLoad.current });
    didLoad.current = true;
  }, [load]);

  const displayTags = useMemo(
    () => (tags.length ? tags : FALLBACK_TAGS.map((tag) => ({ tag, count: 0 }))),
    [tags]
  );

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

  function applyTag(tag) {
    setSearch(tag);
    setQuery(tag);
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

  return (
    <div className="feed-page">
      {toast && (
        <div className="feed-toast" role="status">
          <span>✅</span>
          {toast}
        </div>
      )}

      <div className="feed-toolbar">
        <label className="feed-search">
          <span className="sr-only">Search the feed</span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search conversations, tags, or names…"
          />
        </label>
      </div>

      {error && <p className="form-error">{error}</p>}

      <div className="feed-layout">
        <aside className="feed-col">
          <section className="feed-card feed-profile">
            <div className="feed-profile-avatar-wrap">
              <Avatar name={user?.name} photo={user?.profilePhoto} userId={user?.id} size="lg" />
              <span className="feed-online" aria-hidden="true" />
            </div>
            <h3>{user?.name || 'You'}</h3>
            <p>{roleLine(user)}</p>
            <div className="feed-profile-meta">
              <div>
                <span>Department</span>
                <strong>{user?.department || '—'}</strong>
              </div>
              <div>
                <span>Location</span>
                <strong>{user?.location || '—'}</strong>
              </div>
            </div>
          </section>

          <section className="feed-card feed-channels">
            <h4>Feed Channels</h4>
            {CHANNELS.map((ch) => (
              <button
                key={ch.key}
                type="button"
                className={`feed-channel${category === ch.key ? ' is-active' : ''}`}
                onClick={() => setCategory(ch.key)}
              >
                <span>
                  <i className={`feed-dot ${ch.key}`} />
                  {ch.label}
                </span>
                <em>{counts[ch.key] ?? 0}</em>
              </button>
            ))}
          </section>
        </aside>

        <section className="feed-col feed-main">
          <div className="feed-card feed-composer">
            <div className="feed-composer-row">
              <Avatar name={user?.name} photo={user?.profilePhoto} userId={user?.id} />
              <textarea
                ref={composerRef}
                rows={3}
                value={composer}
                onChange={(e) => setComposer(e.target.value)}
                placeholder={
                  composerType === 'poll'
                    ? 'Ask a question for the team…'
                    : 'Share a celebration wish, team kudos, or announcement…'
                }
              />
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
              <label>
                Channel
                <select
                  value={composerType}
                  onChange={(e) => {
                    const value = e.target.value;
                    setComposerType(value);
                    if (value !== 'poll') setPollOptions(['', '']);
                  }}
                >
                  <option value="celebration">Celebration 🎂</option>
                  <option value="milestone">Milestone 🎖️</option>
                  <option value="announcement">Announcement 📣</option>
                  <option value="casual">Casual Chat ☕</option>
                  <option value="poll">Poll 📊</option>
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
                  className="feed-image-toggle"
                  disabled={imageBusy || posting}
                  onClick={() => imageInputRef.current?.click()}
                >
                  {imageBusy ? 'Uploading…' : composerImage ? 'Change photo' : 'Add photo'}
                </button>
                <EmojiPicker
                  onPick={(emoji) => {
                    setComposer((value) => insertEmoji(value, emoji, composerRef.current));
                    requestAnimationFrame(() => composerRef.current?.focus());
                  }}
                  label="Insert emoji in post"
                />
                <button type="button" className="btn primary" disabled={posting || imageBusy} onClick={handleShare}>
                  Share Post
                </button>
              </div>
            </div>
          </div>

          {loading && <p className="muted">Loading feed…</p>}
          {!loading && posts.length === 0 && (
            <div className="feed-card feed-empty">No conversations match the current filters.</div>
          )}

          {posts.map((post) => {
            const open = expanded.has(post.id);
            const canDelete = canModerate || post.userId === user?.id;
            return (
              <article key={post.id} className={`feed-card feed-post cat-${post.category}`}>
                <header className="feed-post-head">
                  <div className="feed-post-who">
                    <Avatar name={post.author} photo={post.photo} userId={post.userId} />
                    <div>
                      <strong>{post.author}</strong>
                      <span>
                        {roleLine(post)} · {formatRelativeTime(post.createdAt)}
                      </span>
                    </div>
                  </div>
                  <span className={`feed-badge ${post.category}`}>{post.badgeText}</span>
                </header>
                {post.poll?.options?.length ? (
                  <PollCard
                    post={post}
                    busy={busyKey === `poll-${post.id}`}
                    onVote={votePoll}
                  />
                ) : post.content ? (
                  <p className="feed-post-body">
                    <HashtagText text={post.content} onTag={applyTag} />
                  </p>
                ) : null}
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
                  <button
                    type="button"
                    className={`feed-like${post.hasLiked ? ' is-on' : ''}`}
                    disabled={busyKey.startsWith(`post-${post.id}`)}
                    onClick={() => toggleReaction('post', post.id, LIKE_EMOJI)}
                  >
                    <span aria-hidden="true">{post.hasLiked ? '❤️' : '🤍'}</span>
                    {post.likes || 0}
                  </button>
                  <button type="button" className="feed-comment-btn" onClick={() => toggleExpanded(post.id)}>
                    <span aria-hidden="true">💬</span>
                    Comments ({post.comments?.length || 0})
                  </button>
                  <ReactionBar
                    reactions={post.reactions}
                    busy={Boolean(busyKey)}
                    onToggle={(emoji) => toggleReaction('post', post.id, emoji)}
                  />
                  {canDelete && (
                    <button type="button" className="feed-delete" onClick={() => removePost(post.id)}>
                      Delete
                    </button>
                  )}
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
                            <HashtagText text={comment.content} onTag={applyTag} />
                          </p>
                          <div className="feed-comment-actions">
                            <button
                              type="button"
                              className={`feed-like sm${comment.hasLiked ? ' is-on' : ''}`}
                              onClick={() => toggleReaction('comment', comment.id, LIKE_EMOJI)}
                            >
                              <span aria-hidden="true">{comment.hasLiked ? '❤️' : '🤍'}</span>
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
                      <input
                        type="text"
                        value={drafts[post.id] || ''}
                        onChange={(e) => setDrafts((d) => ({ ...d, [post.id]: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            submitComment(post.id);
                          }
                        }}
                        placeholder="Write a supportive reply…"
                      />
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

        <aside className="feed-col">
          <section className="feed-card">
            <div className="feed-widget-head">
              <h4>🎉 Upcoming Celebrations</h4>
              <span className="feed-pulse" aria-hidden="true" />
            </div>
            {celebrations.length === 0 && (
              <p className="muted slim">Birthdays and work anniversaries from onboarding will show here.</p>
            )}
            <div className="feed-people">
              {celebrations.map((person) => (
                <div key={`${person.kind}-${person.userId}-${person.date}`} className="feed-person">
                  <Avatar name={person.name} photo={person.photo} userId={person.userId} size="sm" />
                  <div>
                    <strong>{person.name}</strong>
                    <span>
                      {person.label}
                      {person.department ? ` · ${person.department}` : ''}
                      {person.daysUntil === 0 ? '' : ` · ${formatDate(person.date)}`}
                    </span>
                  </div>
                  <button type="button" className="feed-wish" onClick={() => fillWish(person)}>
                    {person.kind === 'anniversary' ? 'Congratulate' : 'Wish'}
                  </button>
                </div>
              ))}
            </div>
          </section>

          <section className="feed-card">
            <div className="feed-widget-head">
              <h4>📈 Active Trending Tags</h4>
            </div>
            <div className="feed-tags">
              {displayTags.map((item) => (
                <button key={item.tag} type="button" className="feed-tag" onClick={() => applyTag(item.tag)}>
                  {item.tag}
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
