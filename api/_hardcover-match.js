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
 *  rows: [{ title, alternative_titles?, slug, rating, ratings_count, users_count, contributions? }]
 *  Returns an array aligned to `books`: { rating, ratingsCount, hardcoverUrl } | null.
 *  A book with an author is only matched to a row whose credited authors include
 *  that author's last name — a wrong-book rating is worse than none. (A row
 *  with no authors at all doesn't pass either: that let a study guide named
 *  after the book stand in for it.) */
function pickMatches(books, rows) {
  // Rows are indexed by their full title and by the part before a colon, so
  // "Atomic Habits: An Easy & Proven Way…" is found for a plain "Atomic Habits".
  const byTitle = new Map();
  const byOtherTitle = new Map();
  const add = (key, row, map = byTitle) => {
    if (!key) return;
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(row);
  };
  for (const row of rows || []) {
    const full = String(row.title || '');
    add(norm(full), row);
    const i = full.indexOf(':');
    if (i > 0) add(norm(full.slice(0, i)), row);
    // "The Hobbit, or There and Back Again"
    const alt = full.search(/,\s+or\s/i);
    if (alt > 0) add(norm(full.slice(0, alt)), row);
    // "Harry Potter and the Sorcerer's Stone", filed under the Philosopher's.
    // Kept apart: these are only a fallback (see below).
    for (const other of row.alternative_titles || []) add(norm(other), row, byOtherTitle);
  }

  return books.map((book) => {
    const wantLast = lastName(book.author);
    const wantFull = String(book.title || '').trim();
    // A row's before-colon form only counts against the full requested title
    // when that title has no colon of its own; otherwise "Mistborn: X" and
    // "Mistborn: Y" would both collapse to "Mistborn" and match each other.
    const variants = wantFull.includes(':') ? titleVariants(wantFull) : [wantFull];
    let best = null;
    for (const variant of variants) {
      for (const row of byTitle.get(norm(variant)) || []) {
        const rowHasColon = String(row.title || '').includes(':');
        const rowKeyIsPrefix = rowHasColon && norm(String(row.title).slice(0, String(row.title).indexOf(':'))) === norm(variant)
          && norm(row.title) !== norm(variant);
        if (rowKeyIsPrefix && wantFull.includes(':')) continue;
        const credited = (row.contributions || []).map((c) => lastName(c && c.author && c.author.name)).filter(Boolean);
        if (wantLast && !credited.includes(wantLast)) continue;
        const rating = Number(row.rating);
        if (!(rating > 0)) continue;
        if (!best || (row.users_count || 0) > (best.users_count || 0)) best = row;
      }
    }
    // A row that has the title as an alternative competes on readers with
    // the rows that have it outright: the SparkNotes for "Harry Potter and
    // the Sorcerer's Stone" has that exact title, credits Rowling, and has
    // one rating, while the book itself is filed under the Philosopher's.
    // Never, though, a row whose own title merely contains the one asked
    // for: "Sandworms of Dune" lists plain "Dune" among its alternatives.
    for (const variant of variants) {
      const want = norm(variant);
      for (const row of byOtherTitle.get(want) || []) {
        if (` ${norm(row.title)} `.includes(` ${want} `)) continue;
        const credited = (row.contributions || []).map((c) => lastName(c && c.author && c.author.name)).filter(Boolean);
        if (wantLast && !credited.includes(wantLast)) continue;
        if (!(Number(row.rating) > 0)) continue;
        if (!best || (row.users_count || 0) > (best.users_count || 0)) best = row;
      }
    }
    if (!best) return null;
    return {
      rating: Number(best.rating),
      ratingsCount: Number(best.ratings_count) || 0,
      hardcoverUrl: best.slug ? `https://hardcover.app/books/${best.slug}` : null,
      // Hardcover's own synopsis — usually a single consistent, editorial
      // description, unlike Open Library (often missing or a one-line stub)
      // and Google Books (quality varies wildly by publisher feed). Only
      // attached to a match that already passed the rating/author checks
      // above, so this never widens which books get matched at all.
      description: String(best.description || '').trim(),
    };
  });
}

module.exports = { norm, lastName, titleVariants, pickMatches };
