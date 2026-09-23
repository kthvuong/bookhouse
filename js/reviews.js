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

  const batchKey = (b) => `t:${b.title}|${(b.authors || [])[0] || ''}`;

  /** Looks up many books in as few requests as possible (one per 24).
   *  Returns an array aligned to `books` of { rating, ratingsCount, hardcoverUrl } | null.
   *  Failures are never cached, so a blip doesn't hide a rating for the whole session. */
  async function fetchBatch(books) {
    const out = new Array(books.length).fill(null);
    if (typeof Sync === 'undefined' || !Sync.isConfigured()) return out;

    const pending = [];
    books.forEach((b, i) => {
      const k = batchKey(b);
      if (cache.has(k)) out[i] = cache.get(k);
      else if (b.title) pending.push(i);
    });

    for (let s = 0; s < pending.length; s += 24) {
      const chunk = pending.slice(s, s + 24);
      try {
        const res = await fetch('/api/reviews', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Sync.token()}` },
          body: JSON.stringify({ books: chunk.map((i) => ({ title: books[i].title, author: (books[i].authors || [])[0] || '' })) }),
        });
        if (!res.ok) continue;
        const data = await res.json();
        if (!data || !Array.isArray(data.results)) continue;
        chunk.forEach((i, j) => {
          const r = data.results[j];
          const value = r && typeof r.rating === 'number' ? r : null;
          out[i] = value;
          cache.set(batchKey(books[i]), value);
        });
      } catch (e) {
        console.warn('Hardcover batch lookup failed:', e.message);
      }
    }
    return out;
  }

  /** Compact card label, e.g. "★ 4.6 · Hardcover". Deliberately not the gold
   *  star row, which is reserved for your own ratings. */
  function compactHTML(rating, source) {
    return `<span class="cr-score">★ ${Number(rating).toFixed(1)}</span><span class="cr-src"> · ${escapeHtml(source)}</span>`;
  }

  /** "★ 4.4 (128,940) on Hardcover", linked to the book's Hardcover page when we have it. */
  function ratingHTML(result) {
    const stars = `★ ${result.rating.toFixed(1)}`;
    const count = result.ratingsCount ? ` (${result.ratingsCount.toLocaleString()})` : '';
    const text = `${stars}${count} on Hardcover`;
    return result.hardcoverUrl
      ? `<a href="${escapeHtml(result.hardcoverUrl)}" target="_blank" rel="noopener" class="hardcover-rating-link">${text}</a>`
      : text;
  }

  return { fetchRating, fetchBatch, compactHTML, ratingHTML };
})();
