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

/* ---------------------------------------------------------
   Reading Personality — a fun, rule-based "reading horoscope."
   No AI call here (this app has no backend to make one from) —
   just a genre-driven archetype plus a few stat-driven traits,
   picked deterministically from your own data.
   --------------------------------------------------------- */
const GENRE_ARCHETYPES = [
  { key: 'fantasy', match: ['fantasy', 'wizard', 'dragon', 'sword and sorcery'], title: 'The Fantasy Wanderer', emoji: '🗡️', blurb: "You're drawn to invented worlds, ancient magic, and heroes who don't know their own power yet." },
  { key: 'scifi', match: ['science fiction', 'sci-fi', 'dystopia', 'space opera'], title: 'The Star Charter', emoji: '🚀', blurb: "You'd rather orbit a strange new world than stay grounded in this one." },
  { key: 'mythology', match: ['mytholog', 'gods', 'retelling', 'legend'], title: 'The Myth Keeper', emoji: '🏺', blurb: "You're drawn to old stories retold — gods, monsters, and the humans caught between them." },
  { key: 'romance', match: ['romance', 'love stor'], title: 'The Hopeless Romantic', emoji: '💌', blurb: "You're here for the longing glances, the slow burn, and the happily ever after." },
  { key: 'mystery', match: ['mystery', 'thriller', 'crime', 'detective', 'suspense'], title: 'The Detective', emoji: '🔍', blurb: "You can't resist a good puzzle — you're already three suspects ahead of everyone else." },
  { key: 'horror', match: ['horror', 'ghost stor', 'supernatural'], title: 'The Thrill Seeker', emoji: '🕯️', blurb: 'Nothing like a little dread before bed — you read with the lights on, just in case.' },
  { key: 'historical', match: ['historical fiction', 'history'], title: 'The Time Traveler', emoji: '🕰️', blurb: "You're happiest a few centuries away from the present, learning how people actually lived." },
  { key: 'nonfiction', match: ['biography', 'memoir', 'autobiograph', 'nonfiction', 'essay'], title: 'The Truth Seeker', emoji: '📖', blurb: "You'd rather read someone's real life than anyone's invented one." },
  { key: 'classics', match: ['classic'], title: 'The Classicist', emoji: '🏛️', blurb: 'You like your stories tested by time.' },
  { key: 'ya', match: ['young adult', 'coming of age'], title: 'The Eternal Teenager', emoji: '🌙', blurb: 'You never stopped loving a good coming-of-age story.' },
  { key: 'poetry', match: ['poetry', 'poems'], title: 'The Dreamer', emoji: '🌸', blurb: 'You read in fragments and feelings.' },
  { key: 'literary', match: ['literary fiction', 'literature'], title: 'The Literary Wanderer', emoji: '🖋️', blurb: 'You read for the sentences as much as the story.' },
];
const FALLBACK_ARCHETYPE = { key: 'wanderer', title: 'The Genre Wanderer', emoji: '🧭', blurb: "You don't belong to just one shelf — you read wherever the mood takes you." };

function deriveArchetype(stats) {
  const buckets = {};
  stats.finished.forEach((e) => {
    const genres = (e.book.genres || []).map((g) => g.toLowerCase());
    const matchedKeys = new Set();
    genres.forEach((g) => {
      GENRE_ARCHETYPES.forEach((arc) => {
        if (!matchedKeys.has(arc.key) && arc.match.some((kw) => g.includes(kw))) matchedKeys.add(arc.key);
      });
    });
    matchedKeys.forEach((key) => { buckets[key] = (buckets[key] || 0) + 1; });
  });
  const sorted = Object.entries(buckets).sort((a, b) => b[1] - a[1]);
  if (!sorted.length) return FALLBACK_ARCHETYPE;
  return GENRE_ARCHETYPES.find((a) => a.key === sorted[0][0]) || FALLBACK_ARCHETYPE;
}

function deriveTraits(stats) {
  const traits = [];
  if (stats.avgRating != null) {
    if (stats.avgRating >= 4.3) traits.push("You're a generous rater — most of what you read earns four stars or more.");
    else if (stats.avgRating <= 3.2) traits.push("You're a tough critic — a book has to work to impress you.");
  }
  if (stats.pagesPerDay) {
    if (stats.pagesPerDay >= 25) traits.push('You devour books at a serious pace.');
    else if (stats.pagesPerDay <= 6) traits.push("You're a savorer, taking your time with every page.");
  }
  if (stats.mostReadAuthor && stats.mostReadAuthor[1] >= 2) {
    traits.push(`You keep returning to ${stats.mostReadAuthor[0]} like an old friend.`);
  }
  const formats = Object.entries(stats.formatCounts).filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]);
  if (formats.length && formats[0][1] >= Math.ceil(stats.booksFinished * 0.6)) {
    const label = { physical: 'Physical books are your comfort zone.', ebook: "You're rarely without your eReader.", audiobook: 'Audiobooks are basically part of your routine.' }[formats[0][0]];
    if (label) traits.push(label);
  }
  if (stats.dnfCount >= 2) traits.push("You have no patience for a book that isn't working — and that's a good thing.");
  return traits.slice(0, 3);
}

function personalitySectionHTML(stats) {
  if (!stats.booksFinished) return '';
  const archetype = deriveArchetype(stats);
  const traits = deriveTraits(stats);
  return `
    <section class="personality-section fade-in">
      <div class="eyebrow">Your Reading Personality</div>
      <div class="personality-emoji">${archetype.emoji}</div>
      <h2 class="personality-title serif">${archetype.title}</h2>
      <p class="personality-blurb">${archetype.blurb}</p>
      ${traits.length ? `<div class="personality-traits">${traits.map((t) => `<p class="trait-line">${escapeHtml(t)}</p>`).join('')}</div>` : ''}
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

/* ---------------------------------------------------------
   Yearly superlative picks (favourite book of the year, etc.)
   — the one piece of Wrapped that isn't purely computed: a
   handful of manual picks you make, stored per year and shown
   whenever Stats is viewing that year.
   --------------------------------------------------------- */
const SUPERLATIVES = [
  { key: 'favoriteBookId', label: 'Favourite Book of the Year' },
  { key: 'biggestSurpriseId', label: 'Biggest Surprise' },
  { key: 'biggestDisappointmentId', label: 'Biggest Disappointment' },
  { key: 'bestCoverId', label: 'Best Cover' },
  { key: 'couldntStopId', label: "Couldn't Stop Thinking About It" },
];

async function superlativesSectionHTML(year, stats, record) {
  const eligible = stats.finished;
  if (!eligible.length) return '';
  const picks = record || {};
  const cards = await Promise.all(SUPERLATIVES.map(async (s) => {
    const bookId = picks[s.key];
    const entry = bookId ? eligible.find((e) => e.book.id === bookId) : null;
    const cover = entry ? await coverMarkup(entry.book) : '';
    const options = [`<option value="">— choose —</option>`].concat(
      eligible.map((e) => `<option value="${e.book.id}" ${e.book.id === bookId ? 'selected' : ''}>${escapeHtml(e.book.title)}</option>`)
    ).join('');
    return `
      <div class="superlative-card">
        <div class="cover-wrap ${entry ? '' : 'empty'}">${entry ? cover : 'Not chosen yet'}</div>
        <div class="label">${s.label}</div>
        ${entry ? `<div class="pick-title">${escapeHtml(entry.book.title)}</div>` : ''}
        <select class="select" data-superlative="${s.key}" data-superlative-year="${year}" style="margin-top:6px;font-size:12px;padding:5px 8px;">${options}</select>
      </div>`;
  }));
  return `
    <section class="stat-section fade-in">
      <h2 class="stat-section-title">Your Picks for ${year}</h2>
      <p class="stat-section-caption">Choose from the books you finished this year.</p>
      <div class="superlative-grid">${cards.join('')}</div>
    </section>`;
}

/** Wires up superlative <select> elements rendered anywhere in `root`; calls onSaved() after each pick persists. */
function wireSuperlatives(root, onSaved) {
  root.querySelectorAll('[data-superlative]').forEach((sel) => {
    sel.addEventListener('change', async () => {
      const year = Number(sel.dataset.superlativeYear);
      await Storage.Wrapped.save(year, { [sel.dataset.superlative]: sel.value || null });
      onSaved && onSaved();
    });
  });
}

/** Compact, theme-matched year picker — replaces a plain <select> with a row of chips. */
function yearChipRowHTML(years, selectedYear) {
  return `
    <div class="year-chip-row">
      ${years.map((y) => `<button type="button" class="chip year-chip ${y === selectedYear ? 'active' : ''}" data-year-chip="${y}">${y}</button>`).join('')}
    </div>`;
}
