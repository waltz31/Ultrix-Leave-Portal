export const FEED_CATEGORIES = ['celebration', 'milestone', 'announcement', 'casual'];

export const FEED_CATEGORY_META = {
  celebration: { label: 'Celebrations', badge: 'Celebration 🎂', emoji: '🎂' },
  milestone: { label: 'Milestones', badge: 'Milestone 🎖️', emoji: '🎖️' },
  announcement: { label: 'Announcements', badge: 'Announcement 📣', emoji: '📣' },
  casual: { label: 'Casual Coffee Chat', badge: 'Casual Chat ☕', emoji: '☕' },
};

export const FEED_EMOJIS = ['❤️', '👍', '🎉', '👏', '😂', '🎂', '☕', '🔥', '💯', '😊', '🥳', '😎', '🙌', '💪', '🌟', '🚀'];
export const LIKE_EMOJI = '❤️';
export const MAX_POST_LEN = 2000;
export const MAX_COMMENT_LEN = 800;
export const MAX_FEED_IMAGE_CHARS = 2_000_000;
export const HASHTAG_RE = /#[A-Za-z0-9_]{2,40}/g;
export const EMOJI_FAMILY_URL = 'https://www.emoji.family/api/emojis';

export const EMOJI_GROUP_LABELS = {
  'smileys-emotion': 'Smileys',
  'people-body': 'People',
  'animals-nature': 'Animals',
  'food-drink': 'Food',
  'travel-places': 'Travel',
  'activities': 'Activities',
  'objects': 'Objects',
  'symbols': 'Symbols',
};

export const EMOJI_GROUP_ORDER = Object.keys(EMOJI_GROUP_LABELS);

export function initialsFromName(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function normalizeEmoji(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 16) return null;
  if (/[\u0000-\u001f\u007f]/.test(raw)) return null;
  if (/^[A-Za-z0-9 .,!?'"\-_/]+$/.test(raw)) return null;
  return raw;
}

export function compactEmojiCatalog(rows) {
  const byGroup = new Map(EMOJI_GROUP_ORDER.map((key) => [key, []]));
  for (const row of rows || []) {
    const emoji = String(row?.emoji || '').trim();
    const group = row?.group;
    if (!emoji || !byGroup.has(group)) continue;
    if (row.variation || row.group === 'component') continue;
    byGroup.get(group).push({
      emoji,
      annotation: String(row.annotation || '').trim(),
    });
  }
  return {
    groups: EMOJI_GROUP_ORDER.map((key) => ({
      key,
      label: EMOJI_GROUP_LABELS[key],
      emojis: byGroup.get(key) || [],
    })).filter((group) => group.emojis.length),
  };
}

export function fallbackEmojiCatalog() {
  return {
    source: 'fallback',
    groups: [
      {
        key: 'frequent',
        label: 'Frequent',
        emojis: FEED_EMOJIS.map((emoji) => ({ emoji, annotation: '' })),
      },
    ],
  };
}

export function extractHashtags(text) {
  return Array.from(String(text || '').matchAll(HASHTAG_RE), (m) => m[0]);
}

export function normalizeFeedImage(value) {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value);
  if (!/^data:image\/(jpeg|jpg|png|gif|webp);base64,/i.test(text)) {
    const err = new Error('Post image must be a JPG, PNG, GIF, or WebP');
    err.status = 400;
    throw err;
  }
  if (text.length > MAX_FEED_IMAGE_CHARS) {
    const err = new Error('Post image is too large (max about 1.5MB)');
    err.status = 400;
    throw err;
  }
  return text;
}

function nextMonthDay(ymd, todayYmd) {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(String(ymd).slice(0, 10))) return null;
  const mmdd = String(ymd).slice(5, 10);
  if (!/^\d{2}-\d{2}$/.test(mmdd)) return null;
  const year = Number(todayYmd.slice(0, 4));
  let candidate = `${year}-${mmdd}`;
  if (candidate < todayYmd) candidate = `${year + 1}-${mmdd}`;
  return candidate;
}

function daysBetween(fromYmd, toYmd) {
  const [ay, am, ad] = fromYmd.split('-').map(Number);
  const [by, bm, bd] = toYmd.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

export function buildCelebrations(rows, todayYmd, windowDays = 45) {
  const out = [];
  for (const row of rows || []) {
    if (row.date_of_birth) {
      const next = nextMonthDay(row.date_of_birth, todayYmd);
      if (next) {
        const days = daysBetween(todayYmd, next);
        if (days >= 0 && days <= windowDays) {
          out.push({
            userId: row.id,
            name: row.name,
            photo: row.profile_photo || null,
            initials: initialsFromName(row.name),
            designation: row.designation || null,
            department: row.department || null,
            kind: 'birthday',
            label: days === 0 ? 'Birthday today' : 'Birthday',
            date: next,
            daysUntil: days,
            years: null,
          });
        }
      }
    }
    if (row.date_of_joining) {
      const next = nextMonthDay(row.date_of_joining, todayYmd);
      if (next) {
        const joinYear = Number(String(row.date_of_joining).slice(0, 4));
        const nextYear = Number(next.slice(0, 4));
        const years = nextYear - joinYear;
        if (years >= 1) {
          const days = daysBetween(todayYmd, next);
          if (days >= 0 && days <= windowDays) {
            out.push({
              userId: row.id,
              name: row.name,
              photo: row.profile_photo || null,
              initials: initialsFromName(row.name),
              designation: row.designation || null,
              department: row.department || null,
              kind: 'anniversary',
              label: days === 0 ? `${years}yr today` : `${years}yr anniversary`,
              date: next,
              daysUntil: days,
              years,
            });
          }
        }
      }
    }
  }
  return out
    .sort((a, b) => a.daysUntil - b.daysUntil || String(a.name).localeCompare(String(b.name)))
    .slice(0, 8);
}

export function groupReactionRows(rows, idKey) {
  const byTarget = new Map();
  for (const row of rows || []) {
    const id = row[idKey];
    if (id == null) continue;
    const list = byTarget.get(id) || [];
    list.push({
      emoji: row.emoji,
      count: Number(row.count) || 0,
      mine: Number(row.mine) > 0,
    });
    byTarget.set(id, list);
  }
  return byTarget;
}

function mapPerson(row) {
  return {
    userId: row.user_id,
    author: row.author_name,
    initials: initialsFromName(row.author_name),
    photo: row.profile_photo || null,
    role: row.author_role || null,
    designation: row.designation || null,
    department: row.department || null,
  };
}

function withLikeStats(reactions) {
  const like = (reactions || []).find((r) => r.emoji === LIKE_EMOJI);
  return {
    reactions: reactions || [],
    likes: like?.count || 0,
    hasLiked: Boolean(like?.mine),
  };
}

export function mapComment(row, reactions) {
  return {
    id: row.id,
    postId: row.post_id,
    content: row.content,
    createdAt: row.created_at,
    ...mapPerson(row),
    ...withLikeStats(reactions),
  };
}

export function assembleFeed(postRows, commentRows, postReactionMap, commentReactionMap) {
  const commentsByPost = new Map();
  for (const row of commentRows || []) {
    const list = commentsByPost.get(row.post_id) || [];
    list.push(mapComment(row, commentReactionMap.get(row.id) || []));
    commentsByPost.set(row.post_id, list);
  }
  return (postRows || []).map((row) => {
    const reactions = postReactionMap.get(row.id) || [];
    return {
      id: row.id,
      category: row.category,
      badgeText: FEED_CATEGORY_META[row.category]?.badge || row.category,
      content: row.content,
      image: row.image_data || null,
      createdAt: row.created_at,
      comments: commentsByPost.get(row.id) || [],
      ...mapPerson(row),
      ...withLikeStats(reactions),
    };
  });
}

export function emptyCounts() {
  return {
    all: 0,
    celebration: 0,
    milestone: 0,
    announcement: 0,
    casual: 0,
  };
}

export function countsFromRows(rows) {
  const counts = emptyCounts();
  for (const row of rows || []) {
    const n = Number(row.n) || 0;
    counts.all += n;
    if (row.category in counts) counts[row.category] = n;
  }
  return counts;
}

export function trendingTagsFromPosts(posts, limit = 8) {
  const tally = new Map();
  for (const post of posts || []) {
    for (const tag of extractHashtags(post.content)) {
      tally.set(tag, (tally.get(tag) || 0) + 1);
    }
  }
  return [...tally.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([tag, count]) => ({ tag, count }));
}

export function feedSchemaStatements(postgres) {
  const idCol = postgres
    ? 'id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY'
    : 'id INTEGER PRIMARY KEY AUTOINCREMENT';
  const ts = postgres
    ? `to_char((now() AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM-DD HH24:MI:SS')`
    : `datetime('now', '+5 hours', '30 minutes')`;
  return [
    `CREATE TABLE IF NOT EXISTS feed_posts (
      ${idCol},
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category TEXT NOT NULL CHECK(category IN ('celebration', 'milestone', 'announcement', 'casual')),
      content TEXT NOT NULL,
      image_data TEXT,
      created_at TEXT NOT NULL DEFAULT (${ts})
    )`,
    `CREATE INDEX IF NOT EXISTS idx_feed_posts_created ON feed_posts(created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_feed_posts_category ON feed_posts(category)`,
    `CREATE TABLE IF NOT EXISTS feed_comments (
      ${idCol},
      post_id INTEGER NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (${ts})
    )`,
    `CREATE INDEX IF NOT EXISTS idx_feed_comments_post ON feed_comments(post_id, created_at)`,
    `CREATE TABLE IF NOT EXISTS feed_reactions (
      ${idCol},
      post_id INTEGER REFERENCES feed_posts(id) ON DELETE CASCADE,
      comment_id INTEGER REFERENCES feed_comments(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      emoji TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (${ts}),
      CHECK (
        (post_id IS NOT NULL AND comment_id IS NULL) OR
        (post_id IS NULL AND comment_id IS NOT NULL)
      )
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_feed_reactions_post
      ON feed_reactions(post_id, user_id, emoji) WHERE post_id IS NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_feed_reactions_comment
      ON feed_reactions(comment_id, user_id, emoji) WHERE comment_id IS NOT NULL`,
  ];
}

export function isMissingFeedTable(err) {
  const msg = String(err?.message || err || '');
  return (
    err?.code === '42P01' ||
    err?.code === '42703' ||
    /no such table/i.test(msg) ||
    /no such column/i.test(msg) ||
    (/feed_(posts|comments|reactions)/i.test(msg) && /does not exist|undefined/i.test(msg))
  );
}

export async function ensureFeedImageColumn(db, postgres) {
  if (postgres) {
    await db.exec(`ALTER TABLE feed_posts ADD COLUMN IF NOT EXISTS image_data TEXT`);
    return;
  }
  const cols = await db.prepare(`PRAGMA table_info(feed_posts)`).all();
  if (!cols?.some((col) => String(col.name) === 'image_data')) {
    await db.exec(`ALTER TABLE feed_posts ADD COLUMN image_data TEXT`);
  }
}
