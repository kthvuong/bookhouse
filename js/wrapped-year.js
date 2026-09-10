/* ============================================================
   wrapped-year.js — a single year's frozen Wrapped retrospective
   ============================================================ */

(async function () {
  initHeader('wrapped');
  const root = document.getElementById('wrapped-root');
  const year = Number(getQueryParam('year'));

  const SUPERLATIVES = [
    { key: 'favoriteBookId', label: 'Favourite Book of the Year' },
    { key: 'biggestSurpriseId', label: 'Biggest Surprise' },
    { key: 'biggestDisappointmentId', label: 'Biggest Disappointment' },
    { key: 'bestCoverId', label: 'Best Cover' },
    { key: 'couldntStopId', label: "Couldn't Stop Thinking About It" },
  ];

  function serializeStats(stats) {
    const { durationOf, ...rest } = stats;
    return rest;
  }
  function rehydrateStats(stored) {
    return { ...stored, durationOf: (e) => daysBetween(e.dateStarted, e.dateFinished) };
  }

  async function generate() {
    const allEntries = (await Storage.ReadingEntries.allWithBooks()).filter((e) => e.book);
    const allSessions = await Storage.ReadingSessions.getAll();
    const stats = computeStats(allEntries, allSessions, { type: 'year', year });
    await Storage.Wrapped.save(year, { stats: serializeStats(stats), favoriteBookId: null, biggestSurpriseId: null, biggestDisappointmentId: null, bestCoverId: null, couldntStopId: null });
    render();
  }

  async function renderGenerateScreen() {
    root.innerHTML = `
      <div class="empty-state">
        <div class="icon">🎁</div>
        <h3>No Wrapped for ${year} yet</h3>
        <p>Generate one from your finished books to create a permanent snapshot for this year.</p>
        <button class="btn btn-primary" id="generate-btn" style="margin-top:16px;">Generate ${year} Wrapped</button>
      </div>`;
    document.getElementById('generate-btn').addEventListener('click', generate);
  }

  async function render() {
    const record = await Storage.Wrapped.get(year);
    if (!record) { await renderGenerateScreen(); return; }
    const stats = rehydrateStats(record.stats);
    const insights = generateInsights(stats);

    const sections = await Promise.all([
      Promise.resolve(`<div class="wrapped-cover-band fade-in"><div class="eyebrow">${year} Wrapped</div><h1 class="serif">Your year in books</h1></div>`),
      statHeroHTML(stats, { tone: 'final' }),
      Promise.resolve(statCalloutsHTML(stats)),
      Promise.resolve(monthChartSectionHTML(stats)),
      genreSectionHTML(stats),
      authorSectionHTML(stats),
      Promise.resolve(formatSectionHTML(stats)),
      extremesSectionHTML(stats),
      highestRatedSectionHTML(stats),
      Promise.resolve(firstLastSectionHTML(stats)),
      Promise.resolve(insightsSectionHTML(insights)),
      superlativesSectionHTML(record, stats),
      collageSectionHTML(stats, `Every book you finished in ${year}`),
      Promise.resolve(`<div style="text-align:center;margin-top:var(--space-8);"><button class="btn btn-ghost btn-sm" id="regenerate-btn">Regenerate from current data</button></div>`),
    ]);
    root.innerHTML = sections.join('');
    document.getElementById('regenerate-btn').addEventListener('click', async () => {
      if (confirm('Recompute this Wrapped from your current library data? Your favourite-book picks will be kept.')) {
        const allEntries = (await Storage.ReadingEntries.allWithBooks()).filter((e) => e.book);
        const allSessions = await Storage.ReadingSessions.getAll();
        const fresh = computeStats(allEntries, allSessions, { type: 'year', year });
        await Storage.Wrapped.save(year, { ...record, stats: serializeStats(fresh) });
        render();
      }
    });
    wireSuperlatives(record, stats);
  }

  async function superlativesSectionHTML(record, stats) {
    const eligible = stats.finished;
    const cards = await Promise.all(SUPERLATIVES.map(async (s) => {
      const bookId = record[s.key];
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
          <select class="select" data-superlative="${s.key}" style="margin-top:6px;font-size:12px;padding:5px 8px;">${options}</select>
        </div>`;
    }));
    return `
      <section class="stat-section fade-in">
        <h2 class="stat-section-title">Your Picks</h2>
        <p class="stat-section-caption">Choose from the books you finished this year.</p>
        <div class="superlative-grid">${cards.join('')}</div>
      </section>`;
  }

  function wireSuperlatives(record) {
    root.querySelectorAll('[data-superlative]').forEach((sel) => {
      sel.addEventListener('change', async () => {
        await Storage.Wrapped.save(year, { ...record, [sel.dataset.superlative]: sel.value || null });
        render();
      });
    });
  }

  if (!year) {
    root.innerHTML = `<div class="empty-state"><h3>No year specified</h3><p><a href="wrapped.html">Back to Wrapped →</a></p></div>`;
  } else {
    render();
  }
})();
