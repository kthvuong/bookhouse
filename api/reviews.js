/* ============================================================
   api/reviews.js — Vercel serverless function.

   Proxies a book-rating lookup to Hardcover's GraphQL API. Hardcover's
   own docs explicitly forbid calling their API from a browser (the
   token would be exposed) and forbid a third party from
   redistributing other users' review/rating data — this only ever
   returns the book's own aggregate community rating (average +
   count), which their policy treats as allowed aggregate data, not
   user-owned data.

   Protected by the same shared secret as api/sync.js (env var
   SYNC_TOKEN) — one token gates the whole backend, not just sync.
   The real Hardcover token (env var HARDCOVER_API_TOKEN) never
   reaches the browser.
   ============================================================ */

const { Redis } = require('@upstash/redis');
const { norm, lastName, titleVariants, pickMatches } = require('./_hardcover-match');

const HARDCOVER_ENDPOINT = 'https://api.hardcover.app/v1/graphql';

// Optional: ratings barely move, and Hardcover allows only ~10 requests in a
// burst and ~60 a minute, so lookups are cached in the same Redis as sync.
// If Redis isn't reachable this just falls through to asking Hardcover.
const redis = process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN
  ? new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN })
  : null;
const TTL_HIT = 7 * 24 * 3600;
const TTL_MISS = 24 * 3600;
const MAX_BATCH = 24;

// Hardcover allows at most 5 top-level queries per request, so each request
// carries up to 5 aliased lookups (one per book). Every lookup is a title
// prefix search (subtitled editions like "Atomic Habits: An Easy & Proven Way…"
// wouldn't match an exact title), best-known first. Author names are used to
// avoid matching a different book with the same title; if the API rejects the
// nested selection (query depth limits), retry title-only.
const PER_REQUEST = 5;
const PER_LOOKUP = 15;

function likeEscape(s) {
  return String(s).replace(/[%_\\]/g, ' ').trim();
}

function batchQuery(count, withAuthors) {
  const vars = Array.from({ length: count }, (_, i) => `$p${i}: String!, $e${i}: [String!]!`).join(', ');
  const fields = `title slug rating ratings_count users_count ${withAuthors ? 'contributions(limit: 4) { author { name } }' : ''}`;
  const lookups = Array.from({ length: count }, (_, i) => `
      b${i}: books(where: { _or: [{ title: { _ilike: $p${i} } }, { title: { _in: $e${i} } }] },
        order_by: { users_count: desc }, limit: ${PER_LOOKUP}) { ${fields} }`).join('');
  return `query Batch(${vars}) {${lookups}\n    }`;
}

async function runBatchQuery(group, withAuthors) {
  const variables = {};
  group.forEach((b, i) => {
    const vs = titleVariants(b.title);
    const head = vs.length > 1 ? vs[1] : vs[0];
    variables[`p${i}`] = `${likeEscape(head)}%`;
    variables[`e${i}`] = vs;
  });
  const gqlRes = await fetch(HARDCOVER_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.HARDCOVER_API_TOKEN}` },
    body: JSON.stringify({ query: batchQuery(group.length, withAuthors), variables }),
  });
  if (!gqlRes.ok) return { failed: true, status: gqlRes.status };
  const data = await gqlRes.json();
  if (data.errors) return { failed: true, errors: data.errors };
  return { data: data.data || {} };
}

/** Looks one group (<= 5 books) up; returns aligned results or null on failure. */
async function queryGroup(group) {
  let out = await runBatchQuery(group, true);
  if (out.failed && out.errors) out = await runBatchQuery(group, false);
  if (out.failed) return null;
  return group.map((b, i) => pickMatches([b], out.data[`b${i}`] || [])[0]);
}

/** Returns an array aligned to `books` of { rating, ratingsCount, hardcoverUrl } | null,
 *  with `undefined` for any book whose request failed (so callers don't cache a
 *  failure as "no match"). */
async function queryHardcover(books) {
  const groups = [];
  for (let i = 0; i < books.length; i += PER_REQUEST) groups.push(books.slice(i, i + PER_REQUEST));
  const settled = await Promise.all(groups.map(queryGroup));
  return settled.flatMap((r, gi) => r || groups[gi].map(() => undefined));
}

function cacheKey(b) {
  return `hc:r:v2:${norm(b.title)}|${lastName(b.author)}`;
}

async function lookupBatch(books) {
  const results = new Array(books.length).fill(null);
  const keys = books.map(cacheKey);
  let cached = [];
  if (redis) {
    try { cached = await redis.mget(...keys); } catch (e) { cached = []; }
  }
  const misses = [];
  books.forEach((b, i) => {
    const c = cached[i];
    if (c && typeof c === 'object') results[i] = c.miss ? null : c;
    else if (b.title) misses.push(i);
  });
  if (!misses.length) return results;

  const fetched = await queryHardcover(misses.map((i) => books[i]));
  const writes = [];
  misses.forEach((idx, j) => {
    if (fetched[j] === undefined) return;
    results[idx] = fetched[j];
    if (redis) writes.push(redis.set(keys[idx], fetched[j] || { miss: true }, { ex: fetched[j] ? TTL_HIT : TTL_MISS }));
  });
  await Promise.allSettled(writes);
  return results;
}

async function handleBatch(req, res) {
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  const books = body && Array.isArray(body.books) ? body.books.slice(0, MAX_BATCH) : null;
  if (!books) { res.status(400).json({ error: 'Expected { books: [{ title, author }] }' }); return; }
  const clean = books.map((b) => ({ title: String((b && b.title) || ''), author: String((b && b.author) || '') }));
  if (!process.env.HARDCOVER_API_TOKEN) {
    res.status(200).json({ results: clean.map(() => null), reason: 'HARDCOVER_API_TOKEN not configured' });
    return;
  }
  try {
    res.status(200).json({ results: await lookupBatch(clean) });
  } catch (e) {
    res.status(200).json({ results: clean.map(() => null), reason: e.message });
  }
}

const SEARCH_QUERY = `
  query FindBook($q: String!) {
    search(query: $q, query_type: "Book", per_page: 1) {
      results
    }
  }`;

function extractFirstHit(results) {
  // `results` is Typesense's raw response, passed through as JSON by
  // Hardcover's API — normally { hits: [{ document: {...} }], ... }.
  // Parsed defensively since this is undocumented wire shape.
  if (!results) return null;
  const hits = results.hits || (results.results && results.results[0] && results.results[0].hits);
  if (!Array.isArray(hits) || !hits.length) return null;
  return hits[0].document || hits[0];
}

module.exports = async function handler(req, res) {
  const authHeader = req.headers.authorization || '';
  const providedToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!process.env.SYNC_TOKEN || providedToken !== process.env.SYNC_TOKEN) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  if (req.method === 'POST') {
    await handleBatch(req, res);
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!process.env.HARDCOVER_API_TOKEN) {
    res.status(200).json({ rating: null, reason: 'HARDCOVER_API_TOKEN not configured' });
    return;
  }

  const { isbn, title, author } = req.query;
  if (!isbn && title) {
    try {
      const [match] = await lookupBatch([{ title: String(title), author: String(author || '') }]);
      res.status(200).json(match || { rating: null });
    } catch (e) {
      res.status(200).json({ rating: null, reason: e.message });
    }
    return;
  }
  let query = '';
  if (isbn) query = String(isbn);
  else if (title) query = author ? `${title} ${author}` : String(title);
  if (!query) {
    res.status(400).json({ error: 'Missing isbn or title query param' });
    return;
  }

  try {
    const gqlRes = await fetch(HARDCOVER_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.HARDCOVER_API_TOKEN}`,
      },
      body: JSON.stringify({ query: SEARCH_QUERY, variables: { q: query } }),
    });
    if (!gqlRes.ok) {
      res.status(200).json({ rating: null, reason: `Hardcover API returned ${gqlRes.status}` });
      return;
    }
    const gqlData = await gqlRes.json();
    if (gqlData.errors) {
      res.status(200).json({ rating: null, reason: gqlData.errors[0]?.message || 'Hardcover API error' });
      return;
    }
    const doc = extractFirstHit(gqlData?.data?.search?.results);
    if (!doc || !(Number(doc.rating) > 0)) {
      res.status(200).json({ rating: null });
      return;
    }
    res.status(200).json({
      rating: doc.rating,
      ratingsCount: doc.ratings_count || 0,
      hardcoverUrl: doc.slug ? `https://hardcover.app/books/${doc.slug}` : null,
    });
  } catch (e) {
    res.status(200).json({ rating: null, reason: e.message });
  }
};
