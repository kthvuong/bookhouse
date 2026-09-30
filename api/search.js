/* ============================================================
   api/search.js — Vercel serverless function.

   Book search through Hardcover's catalog (the same Typesense index
   hardcover.app's own search uses): a modern, community-curated
   catalog that's strong on new and popular books, with a consistent
   synopsis, top genres and ISBNs on every result. The client merges
   these with Google Books results (js/books-api.js), so Hardcover
   leads and Google fills in anything it doesn't have.

   Same protections as api/reviews.js: gated by the shared SYNC_TOKEN,
   and the real Hardcover token (HARDCOVER_API_TOKEN) never reaches the
   browser. Only a book's own catalog data is returned — never other
   users' reviews.
   ============================================================ */

const { Redis } = require('@upstash/redis');
const { norm } = require('./_hardcover-match');

const HARDCOVER_ENDPOINT = 'https://api.hardcover.app/v1/graphql';
const MAX_RESULTS = 25;
const TTL = 24 * 3600;

// Searches barely change within a day, and Hardcover allows ~60 requests a
// minute, so each distinct query is cached in the same Redis as sync.
const redis = process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN
  ? new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN })
  : null;

const SEARCH_QUERY = `
  query SearchBooks($q: String!, $n: Int!) {
    search(query: $q, query_type: "Book", per_page: $n, page: 1) {
      results
    }
  }`;

/** `results` is Typesense's raw response, passed through as JSON —
 *  normally { hits: [{ document }] }. Parsed defensively. */
function hitsFrom(results) {
  if (!results) return [];
  const hits = results.hits || (results.results && results.results[0] && results.results[0].hits);
  return Array.isArray(hits) ? hits.map((h) => h.document || h) : [];
}

function pickIsbn(isbns, length) {
  return (isbns || []).map(String).find((i) => i.replace(/-/g, '').length === length) || '';
}

/** Maps a Hardcover search document to a compact, stable shape. */
function mapDocument(doc) {
  if (!doc || !doc.title) return null;
  const image = doc.image && (typeof doc.image === 'string' ? doc.image : doc.image.url);
  return {
    id: String(doc.id || doc.slug || ''),
    slug: doc.slug || '',
    title: String(doc.title),
    subtitle: doc.subtitle || '',
    authors: Array.isArray(doc.author_names) ? doc.author_names.slice(0, 4) : [],
    year: Number(doc.release_year) || null,
    pages: Number(doc.pages) || null,
    isbn13: pickIsbn(doc.isbns, 13),
    isbn10: pickIsbn(doc.isbns, 10),
    cover: image || '',
    description: doc.description || '',
    genres: Array.isArray(doc.genres) ? doc.genres.slice(0, 5) : [],
    rating: Number(doc.rating) > 0 ? Number(doc.rating) : null,
    ratingsCount: Number(doc.ratings_count) || 0,
  };
}

module.exports = async function handler(req, res) {
  const authHeader = req.headers.authorization || '';
  const providedToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!process.env.SYNC_TOKEN || providedToken !== process.env.SYNC_TOKEN) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const q = String(req.query.q || '').trim();
  const limit = Math.min(MAX_RESULTS, Math.max(1, Number(req.query.limit) || 20));
  if (q.length < 2) {
    res.status(400).json({ error: 'Query must be at least 2 characters' });
    return;
  }
  if (!process.env.HARDCOVER_API_TOKEN) {
    res.status(200).json({ results: [], reason: 'HARDCOVER_API_TOKEN not configured' });
    return;
  }

  const key = `hc:s:v1:${norm(q)}|${limit}`;
  if (redis) {
    try {
      const cached = await redis.get(key);
      if (cached && Array.isArray(cached.results)) {
        res.status(200).json(cached);
        return;
      }
    } catch (e) { /* fall through to Hardcover */ }
  }

  try {
    const gqlRes = await fetch(HARDCOVER_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.HARDCOVER_API_TOKEN}` },
      body: JSON.stringify({ query: SEARCH_QUERY, variables: { q, n: limit } }),
    });
    if (!gqlRes.ok) {
      res.status(200).json({ results: [], reason: `Hardcover API returned ${gqlRes.status}` });
      return;
    }
    const data = await gqlRes.json();
    if (data.errors) {
      res.status(200).json({ results: [], reason: (data.errors[0] && data.errors[0].message) || 'Hardcover API error' });
      return;
    }
    const body = { results: hitsFrom(data.data && data.data.search && data.data.search.results).map(mapDocument).filter(Boolean) };
    if (redis) {
      try { await redis.set(key, body, { ex: TTL }); } catch (e) { /* caching is best-effort */ }
    }
    res.status(200).json(body);
  } catch (e) {
    res.status(200).json({ results: [], reason: e.message });
  }
};
