/* ============================================================
   api/explore.js — Vercel serverless function.

   What's current, for the Explore page, from two places:

   - Hardcover: the books its readers have been adding most over the
     last month ("trending"), and the most-shelved books released in
     the last few months ("fresh"). Their Hardcover ratings come with
     them, so Explore needn't look those up one by one.
   - The New York Times bestseller lists, if an NYT_API_KEY is set
     (free, from developer.nytimes.com). Without one they're left out.

   Each source is cached in Redis, so a visit to Explore normally
   costs neither of them anything. Same token gate as the rest.

   GET → { trending: [...], fresh: [...], nyt: [{ name, books: [...] }],
           reasons: { ... } }
   Books have the same shape as api/search.js's results. `reasons`
   says, per source, why it came back empty.
   ============================================================ */

const { Redis } = require('@upstash/redis');
const { authorize } = require('./_auth');
const { clean, strings, cleanGenres, coverUrls } = require('./search').shared;

const HARDCOVER_ENDPOINT = 'https://api.hardcover.app/v1/graphql';
const HARDCOVER_TTL = 6 * 3600;
const NYT_TTL = 12 * 3600; // the lists change once a week
const TRENDING_DAYS = 30;
const FRESH_DAYS = 150;
const LIST_SIZE = 40;

const redis = process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN
  ? new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN })
  : null;

const day = (offsetDays) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);

const BOOK_FIELDS = `id title subtitle slug rating ratings_count users_count release_year pages
  description compilation cached_image cached_contributors cached_tags`;

async function hardcover(query, variables) {
  const res = await fetch(HARDCOVER_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.HARDCOVER_API_TOKEN}` },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || body.errors || !body.data) {
    const said = JSON.stringify((body && (body.errors || body)) || `HTTP ${res.status}`);
    console.error('Hardcover explore query failed:', said);
    throw new Error(said.slice(0, 300));
  }
  return body.data;
}

/** A row of Hardcover's books table in the shape api/search.js gives. */
function mapBook(b) {
  if (!b || !b.title) return null;
  const authors = (Array.isArray(b.cached_contributors) ? b.cached_contributors : [])
    .filter((c) => c && c.author && c.author.name && (!c.contribution || /author/i.test(c.contribution)))
    .map((c) => clean(c.author.name)).filter(Boolean).slice(0, 4);
  if (!authors.length) return null;
  const tags = b.cached_tags && typeof b.cached_tags === 'object' ? b.cached_tags : {};
  const genres = (Array.isArray(tags.Genre) ? tags.Genre : []).map((t) => (t && t.tag) || '');
  const year = Number(b.release_year);
  return {
    id: String(b.id),
    slug: b.slug || '',
    title: clean(b.title),
    subtitle: clean(b.subtitle),
    authors,
    year: year >= 1000 && year <= new Date().getFullYear() + 3 ? year : null,
    pages: Number(b.pages) || null,
    isbn13: '',
    isbn10: '',
    ...coverUrls(b.cached_image),
    description: String(b.description || '').replace(/\r\n?/g, '\n').trim(),
    genres: cleanGenres(genres),
    rating: Number(b.rating) > 0 ? Number(b.rating) : null,
    ratingsCount: Number(b.ratings_count) || 0,
    users: Number(b.users_count) || 0,
    compilation: b.compilation === true,
    matched: true,
  };
}

async function hardcoverTrending() {
  const found = await hardcover(
    `query Trending($from: date!, $to: date!, $n: Int!) {
      books_trending(from: $from, to: $to, limit: $n, offset: 0) { ids }
    }`,
    { from: day(-TRENDING_DAYS), to: day(0), n: LIST_SIZE },
  );
  const ids = ((found.books_trending && found.books_trending.ids) || []).map(Number).filter(Number.isInteger);
  if (!ids.length) return [];
  const data = await hardcover(
    `query TrendingBooks($ids: [Int!]!) { books(where: { id: { _in: $ids } }) { ${BOOK_FIELDS} } }`,
    { ids },
  );
  const byId = new Map((data.books || []).map((b) => [Number(b.id), b]));
  return ids.map((id) => mapBook(byId.get(id))).filter(Boolean); // in trending order
}

async function hardcoverFresh() {
  const data = await hardcover(
    `query Fresh($since: date!, $today: date!, $n: Int!) {
      books(where: { release_date: { _gte: $since, _lte: $today }, canonical_id: { _is_null: true } },
        order_by: { users_count: desc }, limit: $n) { ${BOOK_FIELDS} }
    }`,
    { since: day(-FRESH_DAYS), today: day(0), n: LIST_SIZE },
  );
  return (data.books || []).map(mapBook).filter((b) => b && !b.compilation);
}

// ---- New York Times ----
const NYT_LISTS = [
  ['combined-print-and-e-book-fiction', 'Fiction'],
  ['combined-print-and-e-book-nonfiction', 'Nonfiction'],
];
const SMALL_WORD = /^(a|an|and|as|at|but|by|for|in|of|on|or|the|to|with)$/;

/** The Times prints titles in capitals: "THE GOD OF THE WOODS". */
function titleCase(s) {
  return clean(s).toLowerCase().split(' ')
    .map((w, i, all) => (i && i < all.length - 1 && SMALL_WORD.test(w) ? w : w.replace(/(^|-)(\p{L})/gu, (m, sep, ch) => sep + ch.toUpperCase())))
    .join(' ');
}

/** "Rebecca Yarros and Someone Else" → both names. */
const nytAuthors = (s) => clean(s).split(/\s+(?:and|with)\s+|,\s*/).map(clean).filter(Boolean).slice(0, 4);

async function nytList([slug, name]) {
  const res = await fetch(`https://api.nytimes.com/svc/books/v3/lists/current/${slug}.json?api-key=${encodeURIComponent(process.env.NYT_API_KEY)}`);
  if (!res.ok) throw new Error(`New York Times answered ${res.status}`);
  const body = await res.json();
  const books = ((body.results && body.results.books) || []).map((b) => {
    const title = titleCase(b.title);
    const authors = nytAuthors(b.author);
    const isbn13 = /^\d{13}$/.test(b.primary_isbn13 || '') ? b.primary_isbn13 : '';
    if (!title || !authors.length) return null;
    const image = typeof b.book_image === 'string' && b.book_image.startsWith('https://') ? b.book_image : '';
    return {
      id: `nyt-${isbn13 || `${slug}-${b.rank}`}`,
      slug: '',
      title,
      subtitle: '',
      authors,
      year: null,
      pages: null,
      isbn13,
      isbn10: /^[\dX]{10}$/.test(b.primary_isbn10 || '') ? b.primary_isbn10 : '',
      cover: image,
      thumb: image,
      description: clean(b.description),
      genres: [],
      rating: null,
      ratingsCount: 0,
      users: 0,
      compilation: false,
      matched: true,
    };
  }).filter(Boolean);
  return { name, books };
}

/** A cached copy if there is one, else `make()`, cached when it has
 *  anything in it. A failure comes back as an empty value and a reason. */
async function cached(key, ttl, empty, make) {
  if (redis) {
    try {
      const hit = await redis.get(key);
      if (hit && hit.value) return { value: hit.value };
    } catch (e) { /* fall through */ }
  }
  try {
    const value = await make();
    const has = Array.isArray(value) ? value.length : value;
    if (has && redis) {
      try { await redis.set(key, { value }, { ex: ttl }); } catch (e) { /* caching is best-effort */ }
    }
    return { value };
  } catch (e) {
    return { value: empty, reason: String(e.message || e) };
  }
}

/** At most PER_AUTHOR books by any one author, keeping the order: left
 *  alone, one series on a run (eight Dungeon Crawler Carl books in the
 *  first ten, when this was checked) is most of the row. */
const PER_AUTHOR = 2;
function varied(books) {
  const counts = new Map();
  return books.filter((b) => {
    const who = String((b.authors && b.authors[0]) || '').toLowerCase();
    counts.set(who, (counts.get(who) || 0) + 1);
    return counts.get(who) <= PER_AUTHOR;
  });
}

module.exports = async function handler(req, res) {
  if (!(await authorize(req, res))) return;
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const reasons = {};
  const noToken = { value: [], reason: 'HARDCOVER_API_TOKEN not configured' };
  const hasHardcover = !!process.env.HARDCOVER_API_TOKEN;
  const [trending, fresh, nyt] = await Promise.all([
    hasHardcover ? cached('hc:x:v1:trending', HARDCOVER_TTL, [], hardcoverTrending) : noToken,
    hasHardcover ? cached('hc:x:v1:fresh', HARDCOVER_TTL, [], hardcoverFresh) : noToken,
    process.env.NYT_API_KEY
      ? cached('nyt:x:v1:lists', NYT_TTL, [], async () => (await Promise.all(NYT_LISTS.map(nytList))).filter((l) => l.books.length))
      : { value: [], reason: 'NYT_API_KEY not configured' },
  ]);
  if (trending.reason) reasons.trending = trending.reason;
  if (fresh.reason) reasons.fresh = fresh.reason;
  if (nyt.reason) reasons.nyt = nyt.reason;
  res.status(200).json({ trending: varied(trending.value), fresh: varied(fresh.value), nyt: nyt.value, reasons });
};
