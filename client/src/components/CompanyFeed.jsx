import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
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
];

const FEED_EMOJIS = ['❤️', '👍', '🎉', '👏', '😂', '🎂', '☕', '🔥', '💯'];
const LIKE_EMOJI = '❤️';
const FALLBACK_TAGS = ['#TeamCelebrations', '#WorkAnniversary', '#Announcements', '#DesignSync'];

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
  if (photo && !broken) {
    return (
      <img
        className={`feed-avatar feed-avatar-${size}`}
        src={avatarSrc(photo)}
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
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function onDoc(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

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
      {open && (
        <div className="feed-emoji-pop" role="listbox" aria-label="Emoji picker">
          {FEED_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className="feed-emoji-opt"
              onClick={() => {
                onPick(emoji);
                setOpen(false);
              }}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
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
  const [counts, setCounts] = useState({ all: 0, celebration: 0, milestone: 0, announcement: 0, casual: 0 });
  const [tags, setTags] = useState([]);
  const [celebrations, setCelebrations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [composer, setComposer] = useState('');
  const [composerType, setComposerType] = useState('casual');
  const [posting, setPosting] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set());
  const [drafts, setDrafts] = useState({});
  const [busyKey, setBusyKey] = useState('');
  const composerRef = useRef(null);
  const toastTimer = useRef(null);

  const showToast = useCallback((message) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 3200);
  }, []);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

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
      setCounts(data.counts || { all: 0, celebration: 0, milestone: 0, announcement: 0, casual: 0 });
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
    if (!composer.trim()) {
      showToast('Write something before sharing.');
      return;
    }
    setPosting(true);
    setError('');
    try {
      const data = await api('/feed/posts', {
        method: 'POST',
        body: { category: composerType, content: composer.trim() },
      });
      setComposer('');
      setExpanded((prev) => new Set(prev).add(data.post.id));
      if (category === 'all' || category === composerType) {
        setPosts((list) => [data.post, ...list.filter((p) => p.id !== data.post.id)]);
      }
      setCounts((prev) => ({
        ...prev,
        all: (prev.all || 0) + 1,
        [composerType]: (prev[composerType] || 0) + 1,
      }));
      showToast('Post shared with the team.');
    } catch (err) {
      setError(err.message);
    } finally {
      setPosting(false);
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
                placeholder="Share a celebration wish, team kudos, or announcement…"
              />
            </div>
            <div className="feed-composer-actions">
              <label>
                Channel
                <select value={composerType} onChange={(e) => setComposerType(e.target.value)}>
                  <option value="celebration">Celebration 🎂</option>
                  <option value="milestone">Milestone 🎖️</option>
                  <option value="announcement">Announcement 📣</option>
                  <option value="casual">Casual Chat ☕</option>
                </select>
              </label>
              <div className="feed-composer-right">
                <EmojiPicker
                  onPick={(emoji) => {
                    setComposer((value) => insertEmoji(value, emoji, composerRef.current));
                    requestAnimationFrame(() => composerRef.current?.focus());
                  }}
                  label="Insert emoji in post"
                />
                <button type="button" className="btn primary" disabled={posting} onClick={handleShare}>
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
                <p className="feed-post-body">
                  <HashtagText text={post.content} onTag={applyTag} />
                </p>
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
    </div>
  );
}
