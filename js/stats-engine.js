/* ============================================================
   stats-engine.js — pure functions that turn raw reading data
   into the stats bundle used by both the live Statistics page
   and the frozen yearly Wrapped retrospective.

   period shapes:
     { type: 'month', year, month }   month is 0-11
     { type: 'year', year }
     { type: 'allTime' }
   ============================================================ */

function inPeriod(dateStr, period) {
  if (!dateStr) return false;
  const d = new Date(`${normalizeDateStr(dateStr)}T00:00:00`);
  if (period.type === 'allTime') return true;
  if (period.type === 'year') return d.getFullYear() === period.year;
  if (period.type === 'month') return d.getFullYear() === period.year && d.getMonth() === period.month;
  return false;
}

function periodLabel(period) {
  if (period.type === 'allTime') return 'All Time';
  if (period.type === 'year') return String(period.year);
  if (period.type === 'month') return `${MONTH_NAMES[period.month]} ${period.year}`;
  return '';
}

function daysBetween(a, b) {
  return Math.max(1, Math.round((new Date(`${normalizeDateStr(b)}T00:00:00`) - new Date(`${normalizeDateStr(a)}T00:00:00`)) / 86400000));
}

/**
 * @param allEntries  reading entries joined with their book ({...entry, book})
 * @param allSessions all reading sessions
 * @param period      see shapes above
 */
function computeStats(allEntries, allSessions, period) {
  const finished = allEntries.filter((e) => e.book && e.status === 'finished' && inPeriod(e.dateFinished, period));
  const dnf = allEntries.filter((e) => e.book && e.status === 'dnf' && (e.dateFinished ? inPeriod(e.dateFinished, period) : period.type === 'allTime'));
  const started = allEntries.filter((e) => e.book && e.dateStarted && inPeriod(e.dateStarted, period));
  const sessions = allSessions.filter((s) => inPeriod(s.date, period));

  const pagesRead = finished.reduce((s, e) => s + (e.book.pageCount || 0), 0);
  const rated = finished.filter((e) => e.rating);
  const avgRating = rated.length ? rated.reduce((s, e) => s + e.rating, 0) / rated.length : null;
  const fiveStarBooks = finished.filter((e) => e.rating === 5);

  const withLength = finished.filter((e) => e.book.pageCount);
  const avgBookLength = withLength.length ? Math.round(withLength.reduce((s, e) => s + e.book.pageCount, 0) / withLength.length) : null;
  const longestBook = withLength.slice().sort((a, b) => b.book.pageCount - a.book.pageCount)[0] || null;
  const shortestBook = withLength.slice().sort((a, b) => a.book.pageCount - b.book.pageCount)[0] || null;

  const withDuration = finished.filter((e) => e.dateStarted && e.dateFinished);
  const durationOf = (e) => daysBetween(e.dateStarted, e.dateFinished);
  const fastestBook = withDuration.slice().sort((a, b) => durationOf(a) - durationOf(b))[0] || null;
  const slowestBook = withDuration.slice().sort((a, b) => durationOf(b) - durationOf(a))[0] || null;

  const highestRatedBooks = finished.filter((e) => e.rating).sort((a, b) => b.rating - a.rating).slice(0, 8);

  const genreCounts = tallyCounts(finished.flatMap((e) => (e.book.genres || []).filter((g) => !g.includes(':'))));
  const mostReadGenre = genreCounts[0] || null;
  const mostReadGenreBooks = mostReadGenre ? finished.filter((e) => (e.book.genres || []).includes(mostReadGenre[0])) : [];

  const authorCounts = tallyCounts(finished.flatMap((e) => e.book.authors || []));
  const mostReadAuthor = authorCounts[0] || null;
  const mostReadAuthorBooks = mostReadAuthor ? finished.filter((e) => (e.book.authors || []).includes(mostReadAuthor[0])) : [];

  const formatCounts = { physical: 0, ebook: 0, audiobook: 0 };
  finished.forEach((e) => { formatCounts[e.format] = (formatCounts[e.format] || 0) + 1; });

  let booksByMonth = null, pagesByMonth = null, busiestMonth = null, slowestMonth = null;
  if (period.type === 'year' || period.type === 'allTime') {
    const year = period.type === 'year' ? period.year : null;
    booksByMonth = Array(12).fill(0);
    pagesByMonth = Array(12).fill(0);
    finished.forEach((e) => {
      const d = new Date(`${normalizeDateStr(e.dateFinished)}T00:00:00`);
      if (year != null && d.getFullYear() !== year) return;
      booksByMonth[d.getMonth()]++;
      pagesByMonth[d.getMonth()] += e.book.pageCount || 0;
    });
    const maxCount = Math.max(...booksByMonth);
    if (maxCount > 0) busiestMonth = { month: booksByMonth.indexOf(maxCount), count: maxCount };
    const activeMonths = booksByMonth.map((c, i) => ({ i, c })).filter((m) => m.c > 0);
    if (activeMonths.length >= 2) {
      const min = Math.min(...activeMonths.map((m) => m.c));
      const slowest = activeMonths.find((m) => m.c === min);
      slowestMonth = { month: slowest.i, count: slowest.c };
    }
  }

  const sortedByDate = finished.slice().sort((a, b) => a.dateFinished.localeCompare(b.dateFinished));
  const firstFinished = sortedByDate[0] || null;
  const lastFinished = sortedByDate[sortedByDate.length - 1] || null;

  let pagesPerDay = null;
  if (finished.length) {
    const dates = finished.map((e) => e.dateFinished).sort();
    const spanDays = period.type === 'month' ? new Date(period.year, period.month + 1, 0).getDate()
      : period.type === 'year' ? daysBetween(`${period.year}-01-01`, dates[dates.length - 1])
      : daysBetween(dates[0], dates[dates.length - 1]);
    pagesPerDay = pagesRead / Math.max(1, spanDays);
  }

  const streak = period.type === 'allTime' ? computeReadingStreak(allSessions) : null;

  return {
    period, label: periodLabel(period),
    finished, dnf, started, sessions,
    booksFinished: finished.length,
    dnfCount: dnf.length,
    startedCount: started.length,
    pagesRead, avgRating, fiveStarBooks,
    avgBookLength, longestBook, shortestBook,
    fastestBook, slowestBook, durationOf,
    highestRatedBooks,
    genreCounts, mostReadGenre, mostReadGenreBooks,
    authorCounts, mostReadAuthor, mostReadAuthorBooks,
    formatCounts,
    booksByMonth, pagesByMonth, busiestMonth, slowestMonth,
    firstFinished, lastFinished,
    pagesPerDay,
    streak,
  };
}

/** Simple rule-based "cute insight" sentences generated from a stats bundle — no AI, just heuristics. */
function generateInsights(stats) {
  const insights = [];
  if (stats.mostReadGenre && stats.mostReadGenre[1] >= 2) {
    insights.push(`${stats.mostReadGenre[0]} has taken over your bookshelf lately.`);
  }
  if (stats.mostReadAuthor && stats.mostReadAuthor[1] >= 2) {
    insights.push(`You keep coming back to ${stats.mostReadAuthor[0]}.`);
  }
  const formats = Object.entries(stats.formatCounts).sort((a, b) => b[1] - a[1]);
  if (formats[0] && formats[0][1] > 0) {
    const label = { physical: 'Physical books', ebook: 'eBooks', audiobook: 'Audiobooks' }[formats[0][0]];
    insights.push(`${label} are still your favourite way to read.`);
  }
  if (stats.fiveStarBooks.length >= 3) {
    insights.push(`You were generous with five-star ratings — ${stats.fiveStarBooks.length} books earned one.`);
  }
  if (stats.avgRating && stats.avgRating < 3.2 && stats.booksFinished >= 3) {
    insights.push(`Your ratings were pretty tough this stretch.`);
  }
  if (stats.busiestMonth && stats.booksFinished >= 3) {
    insights.push(`${MONTH_NAMES[stats.busiestMonth.month]} was clearly your reading month.`);
  }
  if (stats.dnfCount >= 2) {
    insights.push(`You walked away from ${stats.dnfCount} books — no shame in that.`);
  }
  return insights;
}
