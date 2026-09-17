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

const HARDCOVER_ENDPOINT = 'https://api.hardcover.app/v1/graphql';

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
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!process.env.HARDCOVER_API_TOKEN) {
    res.status(200).json({ rating: null, reason: 'HARDCOVER_API_TOKEN not configured' });
    return;
  }

  const { isbn, title, author } = req.query;
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
    if (!doc || typeof doc.rating !== 'number') {
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
