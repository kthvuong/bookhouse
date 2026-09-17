/* ============================================================
   reviews.js — optional Hardcover community rating lookup.

   Hardcover's API explicitly forbids being called directly from a
   browser (their token would be exposed), so this only ever talks to
   our own api/reviews.js serverless function, which holds the real
   Hardcover token server-side and proxies the lookup. Reuses the same
   Bearer token as sync (js/sync.js) — one token unlocks both, so
   there's no separate field to set up for this.

   Only the aggregate community rating (average + count) is fetched,
   never other users' review text — that's their own data, and
   Hardcover's terms don't allow a third party to redistribute it.
   ============================================================ */

const Reviews = (() => {
  const cache = new Map();

  async function fetchRating(book) {
    if (!book || (typeof Sync === 'undefined') || !Sync.isConfigured()) return null;

    const isbn = book.isbn13 || book.isbn10 || '';
    const cacheKey = isbn || `${book.title}|${(book.authors || [])[0] || ''}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);

    const params = new URLSearchParams();
    if (isbn) {
      params.set('isbn', isbn);
    } else if (book.title) {
      params.set('title', book.title);
      if (book.authors && book.authors[0]) params.set('author', book.authors[0]);
    } else {
      return null;
    }

    let result = null;
    try {
      const res = await fetch(`/api/reviews?${params.toString()}`, {
        headers: { Authorization: `Bearer ${Sync.token()}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (data && typeof data.rating === 'number') result = data;
      }
    } catch (e) {
      console.warn('Hardcover rating lookup failed:', e.message);
    }

    cache.set(cacheKey, result);
    return result;
  }

  return { fetchRating };
})();
