/* ============================================================
   api/reviews.js — Vercel serverless function.

   Proxies a book lookup to Hardcover's GraphQL API (through its search). Hardcover's own docs
   explicitly forbid calling their API from a browser (the token would be
   exposed) and forbid a third party from redistributing other users'
   review/rating data — this only ever returns the book's own aggregate
   community rating (average + count) and its catalog description, which
   their policy treats as allowed aggregate/bibliographic data, never a
   specific user's review text.

   Protected by the same shared secret as api/sync.js (env var
   SYNC_TOKEN) — one token gates the whole backend, not just sync.
   The real Hardcover token (env var HARDCOVER_API_TOKEN) never
   reaches the browser.
   ============================================================ */

const { Redis } = require('@upstash/redis');
const { norm, lastName, titleVariants, pickMatches } = require('./_hardcover-match');
const { authorize } = require('./_auth');

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

// Each book is found through Hardcover's search (the same one api/search.js
// uses) and its rating read off the search result. Looking books up in the
// books table by title needed a pattern match (_ilike), which Hardcover has
// switched off.
//
// Hardcover's limits (docs.hardcover.app, "Rate Limits"): every top-level
// field in a request costs one token, the bucket holds 10 and refills at one
// a second. So one search per book, a few to a request, never more than the
// tokens Hardcover says are left (its RateLimit header); when the bucket is
// empty the lookups wait for it to refill, and whatever hasn't been asked by
// the time TIME_BUDGET is up is left for the next visit.
const PER_REQUEST = 5;
const PER_LOOKUP = 10;
const TIME_BUDGET = 7000; // ms spent asking Hardcover before giving the page what there is
const REFILL_WAIT = 2000; // ms to let the bucket take in a couple of tokens

function searchQuery(count) {
  const vars = Array.from({ length: count }, (_, i) => `$q${i}: String!`).join(', ');
  const lookups = Array.from({ length: count }, (_, i) => `
      s${i}: search(query: $q${i}, query_type: "Book", per_page: ${PER_LOOKUP}, page: 1) { results }`).join('');
  return `query Ratings(${vars}) {${lookups}\n    }`;
}

/** Same zero-width clean-up as api/search.js: without it Hardcover's
 *  "A Court of Silver Flames" never equals the title asked for. */
function clean(s) {
  return String(s == null ? '' : s).replace(/[​-‍⁠﻿]/g, '').replace(/\s+/g, ' ').trim();
}

const strings = (list) => (Array.isArray(list) ? list.filter((x) => typeof x === 'string').map(clean).filter(Boolean) : []);

/** Search results (Typesense's raw response, normally { hits: [{ document }] })
 *  as the rows pickMatches expects. */
function rowsFrom(results) {
  if (!results) return [];
  const hits = results.hits || (results.results && results.results[0] && results.results[0].hits);
  if (!Array.isArray(hits)) return [];
  return hits.map((h) => h.document || h).filter((d) => d && d.title).map((d) => ({
    title: clean(d.title),
    alternative_titles: strings(d.alternative_titles),
    slug: d.slug,
    rating: d.rating,
    ratings_count: d.ratings_count,
    users_count: d.users_count,
    description: d.description,
    contributions: strings(d.author_names).map((name) => ({ author: { name } })),
  }));
}

/** What to search for, in the order to try it. The title alone comes first:
 *  it puts the best-known book of that name on top ("Dune herbert" buries
 *  Dune itself under its sequels and study guides). Then the title with the
 *  author's last name, for a book that shares its title with better-known
 *  ones. Last, the title cut at a colon: Hardcover often files "Atomic
 *  Habits: An Easy & Proven Way…" as plain "Atomic Habits", and its search
 *  wants every word typed to be there. */
function searchTexts(book) {
  const title = clean(book.title);
  const last = lastName(book.author);
  const texts = [title];
  if (last) texts.push(`${title} ${last}`);
  texts.push(titleVariants(title).slice(0, 2).pop());
  return [...new Set(texts.filter(Boolean))];
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** One request for up to 5 books. Returns their rows, aligned, or null if
 *  Hardcover didn't answer properly (which is written to the function's log). */
/** Tokens left in the per-minute bucket, from a header like
 *  `"Free";r=8;t=0, "daily";r=4231;t=51234`; null if it isn't there. */
function tokensLeft(gqlRes) {
  const m = /;\s*r=(\d+)/.exec((gqlRes.headers && gqlRes.headers.get('ratelimit')) || '');
  return m ? Number(m[1]) : null;
}

/** One request for up to 5 searches. Returns { rows, left }: each search's
 *  rows, aligned (null if Hardcover didn't answer properly, which is written
 *  to the function's log), and the tokens left afterwards if known. */
async function searchOnce(texts) {
  const variables = {};
  texts.forEach((text, i) => { variables[`q${i}`] = text; });
  const gqlRes = await fetch(HARDCOVER_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.HARDCOVER_API_TOKEN}` },
    body: JSON.stringify({ query: searchQuery(texts.length), variables }),
  });
  const left = tokensLeft(gqlRes);
  if (!gqlRes.ok) {
    console.error(`Hardcover rating lookup: HTTP ${gqlRes.status} for`, texts);
    return { rows: null, left };
  }
  const data = await gqlRes.json();
  if (data.errors || !data.data) {
    console.error('Hardcover rating lookup error:', JSON.stringify(data.errors || data), 'for', texts);
    return { rows: null, left };
  }
  return { rows: texts.map((text, i) => rowsFrom(data.data[`s${i}`] && data.data[`s${i}`].results)), left };
}

/** Returns an array aligned to `books` of { rating, ratingsCount, hardcoverUrl, description } | null,
 *  with `undefined` for any book that couldn't be asked about or whose request
 *  failed (so callers don't cache that as "no match"). */
async function queryHardcover(books) {
  const out = books.map(() => undefined);
  const texts = books.map(searchTexts);
  const queue = books.map((b, i) => ({ i, attempt: 0 }));
  const deadline = Date.now() + TIME_BUDGET;
  let left = PER_REQUEST; // until Hardcover says otherwise
  let refusals = 0;
  while (queue.length && refusals < 2 && Date.now() < deadline) {
    if (left < 1) {
      if (Date.now() + REFILL_WAIT >= deadline) break;
      await pause(REFILL_WAIT);
      left = Math.floor(REFILL_WAIT / 1000);
    }
    const batch = queue.splice(0, Math.min(PER_REQUEST, left));
    const answer = await searchOnce(batch.map(({ i, attempt }) => texts[i][attempt]));
    if (!answer.rows) {
      // Turned away: put them back and let the bucket refill before the one retry.
      queue.unshift(...batch);
      refusals++;
      left = 0;
      continue;
    }
    refusals = 0;
    left = answer.left == null ? left - batch.length : answer.left;
    const again = [];
    batch.forEach(({ i, attempt }, j) => {
      const match = pickMatches([books[i]], answer.rows[j])[0];
      if (match || attempt + 1 >= texts[i].length) out[i] = match;
      else again.push({ i, attempt: attempt + 1 });
    });
    // A book's next try goes to the back, so one obscure title doesn't hold
    // up the tokens for books not yet asked about at all.
    queue.push(...again);
  }
  return out;
}

function cacheKey(b) {
  return `hc:r:v6:${norm(b.title)}|${lastName(b.author)}`;
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
  if (!misses.length) return { results };

  const fetched = await queryHardcover(misses.map((i) => books[i]));
  const writes = [];
  let failed = false;
  misses.forEach((idx, j) => {
    if (fetched[j] === undefined) { failed = true; return; }
    results[idx] = fetched[j];
    if (redis) writes.push(redis.set(keys[idx], fetched[j] || { miss: true }, { ex: fetched[j] ? TTL_HIT : TTL_MISS }));
  });
  await Promise.allSettled(writes);
  return failed ? { results, reason: 'Hardcover lookup failed' } : { results };
}

async function handleBatch(req, res) {
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  const books = body && Array.isArray(body.books) ? body.books.slice(0, MAX_BATCH) : null;
  if (!books) { res.status(400).json({ error: 'Expected { books: [{ title, author }] }' }); return; }
  const wanted = books.map((b) => ({ title: String((b && b.title) || ''), author: String((b && b.author) || '') }));
  if (!process.env.HARDCOVER_API_TOKEN) {
    res.status(200).json({ results: wanted.map(() => null), reason: 'HARDCOVER_API_TOKEN not configured' });
    return;
  }
  try {
    res.status(200).json(await lookupBatch(wanted));
  } catch (e) {
    console.error('Hardcover batch lookup failed:', e);
    res.status(200).json({ results: wanted.map(() => null), reason: 'Could not reach Hardcover' });
  }
}

module.exports = async function handler(req, res) {
  if (!(await authorize(req, res))) return;
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

  // A single lookup uses the exact same title+author matcher as the batch
  // path above (isbn isn't used for matching — Hardcover's book-level rows
  // aren't indexed by ISBN, editions are — so a caller that only has an isbn
  // should resolve a title from it before calling this).
  const { title, author } = req.query;
  if (!title) {
    res.status(400).json({ error: 'Missing title query param' });
    return;
  }
  try {
    const { results, reason } = await lookupBatch([{ title: String(title), author: String(author || '') }]);
    res.status(200).json(results[0] || (reason ? { rating: null, reason } : { rating: null }));
  } catch (e) {
    console.error('Hardcover lookup failed:', e);
    res.status(200).json({ rating: null, reason: 'Could not reach Hardcover' });
  }
};
