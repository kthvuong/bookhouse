/* ============================================================
   api/search.js — Vercel serverless function.

   Book search through Hardcover's catalog (the same Typesense index
   hardcover.app's own search uses): a modern, community-curated
   catalog that's strong on new and popular books, with a consistent
   synopsis, top genres and ISBNs on every result. The client merges
   these with Google Books results (js/books-api.js).

   Hardcover's search is excellent for a finished title or author name
   and poor for a half-typed or misspelled one ("fourth wi" returns
   nothing useful), so each result says whether it actually matches the
   words typed and how many readers have it. The client uses those to
   decide which of Hardcover's results should lead the merged list.

   Same protections as api/reviews.js: gated by the shared SYNC_TOKEN,
   and the real Hardcover token (HARDCOVER_API_TOKEN) never reaches the
   browser. Only a book's own catalog data is returned — never other
   users' reviews.
   ============================================================ */

const { Redis } = require('@upstash/redis');
const { lastName } = require('./_hardcover-match');
const { authorize } = require('./_auth');

const HARDCOVER_ENDPOINT = 'https://api.hardcover.app/v1/graphql';
const PER_PAGE = 25; // one page of hits, cleaned up and cached whole
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

/** Collapses whitespace and drops the zero-width characters that turn up
 *  inside catalog titles (Hardcover's "A Court of Silver Flames" has one
 *  after the "A"). */
function clean(s) {
  return String(s == null ? '' : s).replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
}

const strings = (list) => (Array.isArray(list) ? list.filter((x) => typeof x === 'string' || typeof x === 'number').map(String) : []);
const isbnChars = (s) => String(s).replace(/[^0-9Xx]/g, '').toUpperCase();

/** A string's words, comparable across punctuation and accents:
 *  "Sorcerer's" → sorcerers, "Brontë" → bronte, "&" → and. */
function words(s) {
  return String(s || '')
    .normalize('NFKD').replace(/[\u0300-\u036F]/g, '')
    .toLowerCase()
    .replace(/['’‘`]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim().split(' ').filter(Boolean);
}

/** True when every word typed starts some word of `text` ("fourth wi" →
 *  "Fourth Wing"). Prefixes rather than whole words, because the query is
 *  usually still being typed. */
function covers(queryWords, text) {
  const have = words(text);
  return queryWords.every((q) => have.some((w) => w.startsWith(q)));
}

/** Hardcover lists every edition's ISBNs together, so the first is as
 *  likely a Latvian paperback as the original — prefer an English-language
 *  prefix (978-0, 978-1, 979-8). */
function pickIsbn(isbns, length) {
  const all = isbns.filter((i) => i.length === length);
  const english = length === 13 ? /^(9780|9781|9798)/ : /^[01]/;
  return all.find((i) => english.test(i)) || all[0] || '';
}

// "Genres" are a book's top community tags, so shelf names sneak in.
const NOT_A_GENRE = /^(did[- ]not[- ]finish|dnf|audiobooks?|audio|e-?books?|kindle|owned|favou?rites?|to[- ]read|tbr|library|book ?club|default|\d{4})$/i;
const SMALL_WORD = /^(a|an|and|for|in|of|on|or|the|to)$/;

/** "science fiction" and "Science fiction" would otherwise show up as two
 *  different genres in the Library filter and in stats. */
function titleCase(s) {
  return s.split(' ')
    .map((w, i) => (i && SMALL_WORD.test(w) ? w : w.replace(/(^|-)([a-z])/g, (m, sep, ch) => sep + ch.toUpperCase())))
    .join(' ');
}

function cleanGenres(genres) {
  const seen = new Set();
  return strings(genres).map(clean)
    .filter((g) => g && g.length <= 30 && /^[\x20-\x7E]+$/.test(g) && !NOT_A_GENRE.test(g))
    .map(titleCase)
    .filter((g) => !seen.has(g) && seen.add(g))
    .slice(0, 5);
}

/** Originals run to several hundred KB each, far too heavy for a list of
 *  thumbnails on a phone — so alongside the original this returns the
 *  small resized copy Hardcover's own site uses in its lists. */
function coverUrls(image) {
  const url = image && (typeof image === 'string' ? image : image.url);
  if (typeof url !== 'string' || !url.startsWith('https://')) return { cover: '', thumb: '' };
  const thumb = url.startsWith('https://assets.hardcover.app/')
    ? `https://production-img.hardcover.app/enlarge?height=150&type=webp&url=${encodeURIComponent(url)}&width=100`
    : url;
  return { cover: url, thumb };
}

/** A query that is nothing but an ISBN is matched on ISBN, not on words. */
function parseQuery(q) {
  const compact = q.replace(/[\s-]/g, '').toUpperCase();
  return { words: words(q), isbn: /^(\d{9}[\dX]|\d{13})$/.test(compact) ? compact : '' };
}

/** Maps a Hardcover search document to a compact, stable shape. */
function mapDocument(doc, query) {
  if (!doc || !doc.title) return null;
  const title = clean(doc.title);
  const subtitle = clean(doc.subtitle);
  const authors = strings(doc.author_names).map(clean).filter(Boolean).slice(0, 4);
  const ratingsCount = Number(doc.ratings_count) || 0;
  // No author and next to no readers: a stub record, not a book to add.
  if (!title || (!authors.length && ratingsCount < 5)) return null;

  const isbns = strings(doc.isbns).map(isbnChars);
  const who = authors.join(' ');
  // An alternative title counts too ("Harry Potter and the Sorcerer's Stone",
  // which Hardcover files under the Philosopher's Stone). It's never shown,
  // though, so every word typed has to be in it, bar any that are an
  // author's name in full — otherwise a half-typed "fourth wi" matches
  // Henry IV ("King Henry the Fourth") through its William.
  const authorWords = new Set(words(who));
  const titleWords = query.words.filter((w) => !authorWords.has(w));
  const matched = query.isbn
    ? isbns.includes(query.isbn)
    : covers(query.words, `${title} ${subtitle} ${who} ${strings(doc.series_names).join(' ')}`)
      || (titleWords.length > 0 && strings(doc.alternative_titles).some((t) => covers(titleWords, t)));

  const year = Number(doc.release_year);
  const { cover, thumb } = coverUrls(doc.image);
  return {
    id: String(doc.id || doc.slug || ''),
    slug: doc.slug || '',
    title,
    subtitle,
    authors,
    year: year >= 1000 && year <= new Date().getFullYear() + 3 ? year : null,
    pages: Number(doc.pages) || null,
    isbn13: pickIsbn(isbns, 13),
    isbn10: pickIsbn(isbns, 10),
    cover,
    thumb,
    description: String(doc.description || '').replace(/\r\n?/g, '\n').trim(),
    genres: cleanGenres(doc.genres),
    rating: Number(doc.rating) > 0 ? Number(doc.rating) : null,
    ratingsCount,
    users: Number(doc.users_count) || 0, // readers who've saved it: Hardcover's own measure of how well known a book is
    compilation: doc.compilation === true, // a box set or omnibus
    matched,
  };
}

/** Hardcover often holds the same book as several unmerged records; keep
 *  the first (best-ranked) of each title + author. */
function dedupe(list) {
  const seen = new Set();
  return list.filter((r) => {
    const key = `${words(r.title).join(' ')}|${lastName(r.authors[0])}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

module.exports = async function handler(req, res) {
  if (!(await authorize(req, res))) return;
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const q = clean(req.query.q);
  const limit = Math.min(PER_PAGE, Math.max(1, Number(req.query.limit) || 20));
  if (q.length < 2) {
    res.status(400).json({ error: 'Query must be at least 2 characters' });
    return;
  }
  if (!process.env.HARDCOVER_API_TOKEN) {
    res.status(200).json({ results: [], reason: 'HARDCOVER_API_TOKEN not configured' });
    return;
  }

  // Keyed on the query as typed (not its ASCII words), so two searches in
  // another script never share an entry.
  const key = `hc:s:v2:${q.toLowerCase()}`;
  const send = (list) => res.status(200).json({ results: list.slice(0, limit) });
  if (redis) {
    try {
      const cached = await redis.get(key);
      if (cached && Array.isArray(cached.results)) {
        send(cached.results);
        return;
      }
    } catch (e) { /* fall through to Hardcover */ }
  }

  try {
    const gqlRes = await fetch(HARDCOVER_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.HARDCOVER_API_TOKEN}` },
      body: JSON.stringify({ query: SEARCH_QUERY, variables: { q, n: PER_PAGE } }),
    });
    if (!gqlRes.ok) {
      res.status(200).json({ results: [], reason: `Hardcover API returned ${gqlRes.status}` });
      return;
    }
    const data = await gqlRes.json();
    if (data.errors) {
      // What Hardcover said goes to the function's log, not back to the page.
      console.error('Hardcover search error:', data.errors);
      res.status(200).json({ results: [], reason: 'Hardcover API error' });
      return;
    }
    const query = parseQuery(q);
    const results = dedupe(
      hitsFrom(data.data && data.data.search && data.data.search.results)
        .map((doc) => mapDocument(doc, query))
        .filter(Boolean)
    );
    if (redis) {
      try { await redis.set(key, { results }, { ex: TTL }); } catch (e) { /* caching is best-effort */ }
    }
    send(results);
  } catch (e) {
    console.error('Hardcover search failed:', e);
    res.status(200).json({ results: [], reason: 'Could not reach Hardcover' });
  }
};
