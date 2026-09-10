/* ============================================================
   stats-render.js — shared editorial section renderers used by
   both the live Statistics page and the frozen Wrapped page.
   Each function takes a `stats` bundle (from computeStats) and
   returns an HTML string. Async where cover lookups are needed.
   ============================================================ */

async function coverRow(entries, max = 6) {
  const covers = await Promise.all(entries.slice(0, max).map((e) => coverMarkup(e.book)));
  return `<div class="cover-row">${covers.map((c, i) => `<div class="cover-row-item" style="animation-delay:${i * 60}ms">${c}</div>`).join('')}</div>`;
}

async function statHeroHTML(stats, opts = {}) {
  const final = opts.tone === 'final';
  if (!stats.booksFinished) {
    return `
      <section class="stat-hero fade-in">
        <div class="stat-hero-figure serif">0</div>
        <p class="stat-hero-line">books finished ${stats.label === 'All Time' ? 'so far' : 'in ' + stats.label}. The story starts whenever you're ready.</p>
      </section>`;
  }
  const line = final
    ? `book${stats.booksFinished === 1 ? '' : 's'} read in ${stats.label}`
    : `book${stats.booksFinished === 1 ? '' : 's'} finished ${stats.period.type === 'allTime' ? '' : stats.period.type === 'month' ? 'in ' + stats.label : 'so far in ' + stats.label}`;
  return `
    <section class="stat-hero fade-in">
      <div class="stat-hero-figure serif">${stats.booksFinished}</div>
      <p class="stat-hero-line">${line}</p>
      <p class="stat-hero-sub">${stats.pagesRead.toLocaleString()} pages turned${stats.pagesPerDay ? ` · about ${stats.pagesPerDay.toFixed(1)} pages a day` : ''}</p>
    </section>`;
}

async function collageSectionHTML(stats, title) {
  if (!stats.finished.length) return '';
  const covers = await Promise.all(stats.finished.map((e) => coverMarkup(e.book)));
  return `
    <section class="stat-section fade-in">
      <h2 class="stat-section-title">${title || 'Everything you finished'}</h2>
      <div class="cover-collage">${covers.map((c) => `<div class="collage-tile">${c}</div>`).join('')}</div>
    </section>`;
}

function statCalloutsHTML(stats) {
  const items = [
    { figure: stats.avgRating ? stats.avgRating.toFixed(1) : '—', label: 'Average rating' },
    { figure: stats.fiveStarBooks.length, label: '5-star reads' },
    { figure: stats.avgBookLength || '—', label: 'Avg. book length' },
    { figure: stats.dnfCount, label: 'Did not finish' },
  ];
  return `
    <section class="stat-callouts fade-in">
      ${items.map((it) => `<div class="callout"><div class="callout-figure serif">${it.figure}</div><div class="callout-label">${it.label}</div></div>`).join('')}
    </section>`;
}

function monthChartSectionHTML(stats) {
  if (!stats.booksByMonth) return '';
  const data = MONTH_SHORT.map((label, i) => ({ label, value: stats.booksByMonth[i] }));
  const total = stats.booksByMonth.reduce((a, b) => a + b, 0);
  if (!total) return '';
  return `
    <section class="stat-section fade-in">
      <h2 class="stat-section-title">Books by month</h2>
      ${stats.busiestMonth ? `<p class="stat-section-caption">${MONTH_NAMES[stats.busiestMonth.month]} was your biggest reading month${stats.slowestMonth && stats.slowestMonth.month !== stats.busiestMonth.month ? `, ${MONTH_NAMES[stats.slowestMonth.month]} your quietest` : ''}.</p>` : ''}
      ${barChartSVG(data, { height: 150 })}
    </section>`;
}

async function genreSectionHTML(stats) {
  if (!stats.mostReadGenre) return '';
  const [genre, count] = stats.mostReadGenre;
  return `
    <section class="stat-section fade-in">
      <h2 class="stat-section-title">${escapeHtml(genre)} has taken over your bookshelf</h2>
      <p class="stat-section-caption">${count} of your ${stats.booksFinished} book${stats.booksFinished === 1 ? '' : 's'} fell into this genre.</p>
      ${await coverRow(stats.mostReadGenreBooks)}
      ${stats.genreCounts.length > 1 ? donutLegendHTML(stats.genreCounts.slice(0, 6)) : ''}
    </section>`;
}

function donutLegendHTML(counts) {
  const palette = ['var(--accent)', 'var(--sage)', 'var(--gold)', 'var(--danger)', 'var(--text-muted)', 'var(--accent-strong)'];
  const data = counts.map(([label, value], i) => ({ label, value, color: palette[i % palette.length] }));
  return `
    <div class="donut-row">
      ${donutChartSVG(data, { size: 140, stroke: 22 })}
      <div class="donut-legend">
        ${data.map((d) => `<div class="legend-item"><span class="dot" style="background:${d.color}"></span>${escapeHtml(d.label)} <span class="text-muted">(${d.value})</span></div>`).join('')}
      </div>
    </div>`;
}

async function authorSectionHTML(stats) {
  if (!stats.mostReadAuthor) return '';
  const [author, count] = stats.mostReadAuthor;
  if (count < 2) return '';
  return `
    <section class="stat-section fade-in">
      <h2 class="stat-section-title">You keep coming back to ${escapeHtml(author)}</h2>
      <p class="stat-section-caption">${count} books this stretch.</p>
      ${await coverRow(stats.mostReadAuthorBooks)}
    </section>`;
}

function formatSectionHTML(stats) {
  const entries = Object.entries(stats.formatCounts).filter(([, c]) => c > 0);
  if (!entries.length) return '';
  const top = entries.sort((a, b) => b[1] - a[1])[0];
  const labels = { physical: 'Physical books', ebook: 'eBooks', audiobook: 'Audiobooks' };
  return `
    <section class="stat-section fade-in">
      <h2 class="stat-section-title">${labels[top[0]]} are still your favourite</h2>
      ${donutLegendHTML(entries.map(([k, v]) => [labels[k], v]))}
    </section>`;
}

async function extremesSectionHTML(stats) {
  const cards = [];
  if (stats.longestBook) cards.push(await extremeCard(stats.longestBook, 'Longest read', `${stats.longestBook.book.pageCount} pages`));
  if (stats.shortestBook && stats.shortestBook.id !== stats.longestBook?.id) cards.push(await extremeCard(stats.shortestBook, 'Shortest read', `${stats.shortestBook.book.pageCount} pages`));
  if (stats.fastestBook) cards.push(await extremeCard(stats.fastestBook, 'Fastest finish', `${stats.durationOf(stats.fastestBook)} days`));
  if (stats.slowestBook && stats.slowestBook.id !== stats.fastestBook?.id) cards.push(await extremeCard(stats.slowestBook, 'Slowest finish', `${stats.durationOf(stats.slowestBook)} days`));
  if (!cards.length) return '';
  return `
    <section class="stat-section fade-in">
      <h2 class="stat-section-title">Extremes</h2>
      <div class="extremes-row">${cards.join('')}</div>
    </section>`;
}

async function extremeCard(entry, label, value) {
  const cover = await coverMarkup(entry.book);
  return `
    <div class="extreme-card">
      <div class="cover-wrap">${cover}</div>
      <div class="extreme-label">${label}</div>
      <div class="extreme-title">${escapeHtml(entry.book.title)}</div>
      <div class="extreme-value">${value}</div>
    </div>`;
}

async function highestRatedSectionHTML(stats) {
  if (!stats.highestRatedBooks.length) return '';
  return `
    <section class="stat-section fade-in">
      <h2 class="stat-section-title">Your top rated reads</h2>
      <div class="rated-row">
        ${(await Promise.all(stats.highestRatedBooks.map(async (e) => `
          <div class="rated-item">
            <div class="cover-wrap">${await coverMarkup(e.book)}</div>
            ${starsDisplayHTML(e.rating, 'sm')}
          </div>`))).join('')}
      </div>
    </section>`;
}

function insightsSectionHTML(insights) {
  if (!insights.length) return '';
  return `
    <section class="stat-section insights-section fade-in">
      <h2 class="stat-section-title">Little observations</h2>
      <div class="insights-list">
        ${insights.map((s) => `<p class="insight-line">✦ ${escapeHtml(s)}</p>`).join('')}
      </div>
    </section>`;
}

function firstLastSectionHTML(stats) {
  if (!stats.firstFinished || stats.firstFinished.id === stats.lastFinished?.id) return '';
  return `
    <section class="stat-section fade-in">
      <h2 class="stat-section-title">Bookends</h2>
      <div class="bookends-row">
        <div><div class="eyebrow">First finished</div><div class="bookend-title serif">${escapeHtml(stats.firstFinished.book.title)}</div><div class="text-muted">${formatDate(stats.firstFinished.dateFinished, 'short')}</div></div>
        <div><div class="eyebrow">Last finished</div><div class="bookend-title serif">${escapeHtml(stats.lastFinished.book.title)}</div><div class="text-muted">${formatDate(stats.lastFinished.dateFinished, 'short')}</div></div>
      </div>
    </section>`;
}
