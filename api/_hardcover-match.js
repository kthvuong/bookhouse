/* Pure title/author matching for api/reviews.js — no network, no env, so it
   can be tested in isolation. The leading underscore keeps Vercel from
   exposing this file as its own route. */

function norm(s) {
  return String(s || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function lastName(s) {
  const parts = norm(s).split(' ');
  return parts[parts.length - 1] || '';
}

// "Mistborn: The Final Empire" is stored on Hardcover under one half of the
// colon or the other depending on the edition, so ask for all three.
function titleVariants(title) {
  const full = String(title || '').trim();
  const out = new Set([full]);
  const i = full.indexOf(':');
  if (i > 0) {
    out.add(full.slice(0, i).trim());
    out.add(full.slice(i + 1).trim());
  }
  return [...out].filter(Boolean);
}

/** For each requested { title, author }, pick the best matching Hardcover row.
 *  rows: [{ title, slug, rating, ratings_count, users_count, contributions? }]
 *  Returns an array aligned to `books`: { rating, ratingsCount, hardcoverUrl } | null.
 *  A book with an author is only matched to a row whose credited authors include
 *  that author's last name — a wrong-book rating is worse than none. */
function pickMatches(books, rows) {
  const byTitle = new Map();
  for (const row of rows || []) {
    const key = norm(row.title);
    if (!byTitle.has(key)) byTitle.set(key, []);
    byTitle.get(key).push(row);
  }

  return books.map((book) => {
    const wantLast = lastName(book.author);
    let best = null;
    for (const variant of titleVariants(book.title)) {
      for (const row of byTitle.get(norm(variant)) || []) {
        const credited = (row.contributions || []).map((c) => lastName(c && c.author && c.author.name)).filter(Boolean);
        if (wantLast && credited.length && !credited.includes(wantLast)) continue;
        const rating = Number(row.rating);
        if (!(rating > 0)) continue;
        if (!best || (row.users_count || 0) > (best.users_count || 0)) best = row;
      }
    }
    if (!best) return null;
    return {
      rating: Number(best.rating),
      ratingsCount: Number(best.ratings_count) || 0,
      hardcoverUrl: best.slug ? `https://hardcover.app/books/${best.slug}` : null,
    };
  });
}

module.exports = { norm, lastName, titleVariants, pickMatches };
