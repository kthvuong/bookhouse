/* ============================================================
   stats.js — live editorial Statistics page.

   This absorbed the old separate "Wrapped" page: picking a past
   year here shows the same celebratory, frozen-feeling retrospective
   (personality read, superlative picks, finale collage) that Wrapped
   used to — just computed live instead of from a stored snapshot.
   ============================================================ */

(async function () {
  initHeader('stats');

  const container = document.getElementById('stats-container');
  const yearChipMount = document.getElementById('year-chip-mount');
  const segmented = document.getElementById('period-segmented');

  const now = new Date();
  let tab = 'year';
  let selectedYear = now.getFullYear();

  const allEntries = (await Storage.ReadingEntries.allWithBooks()).filter((e) => e.book);
  const allSessions = await Storage.ReadingSessions.getAll();

  const years = [...new Set(allEntries.filter((e) => e.dateFinished).map((e) => new Date(`${normalizeDateStr(e.dateFinished)}T00:00:00`).getFullYear()))];
  if (!years.includes(now.getFullYear())) years.push(now.getFullYear());
  years.sort((a, b) => b - a);

  function currentPeriod() {
    if (tab === 'month') return { type: 'month', year: now.getFullYear(), month: now.getMonth() };
    if (tab === 'allTime') return { type: 'allTime' };
    return { type: 'year', year: selectedYear };
  }

  function renderYearChips() {
    if (tab !== 'year') { yearChipMount.innerHTML = ''; return; }
    yearChipMount.innerHTML = yearChipRowHTML(years, selectedYear);
    yearChipMount.querySelectorAll('[data-year-chip]').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedYear = Number(btn.dataset.yearChip);
        renderYearChips();
        render();
      });
    });
  }

  function setTab(t) {
    tab = t;
    [...segmented.children].forEach((b) => b.classList.toggle('active', b.dataset.period === t));
    renderYearChips();
    render();
  }

  segmented.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (btn) setTab(btn.dataset.period);
  });

  async function render() {
    container.innerHTML = `<div class="empty-state"><p>Gathering your stats…</p></div>`;
    try {
      const period = currentPeriod();
      const stats = computeStats(allEntries, allSessions, period);
      const insights = generateInsights(stats);
      const isYearView = period.type === 'year';
      const isCompletedPastYear = isYearView && period.year < now.getFullYear();

      if (!stats.booksFinished) {
        container.innerHTML = (await statHeroHTML(stats)) + `
          <div class="empty-state"><div class="icon">📖</div><h3>Nothing finished yet ${stats.period.type === 'allTime' ? '' : 'for this period'}</h3><p>Finish a book and your stats will start filling in beautifully.</p></div>`;
        return;
      }

      const record = isYearView ? await Storage.Wrapped.get(period.year) : null;

      const sections = await Promise.all([
        statHeroHTML(stats, { tone: isCompletedPastYear ? 'final' : 'live' }),
        Promise.resolve(statCalloutsHTML(stats)),
        Promise.resolve(personalitySectionHTML(stats)),
        Promise.resolve(monthChartSectionHTML(stats)),
        genreSectionHTML(stats),
        authorSectionHTML(stats),
        Promise.resolve(formatSectionHTML(stats)),
        extremesSectionHTML(stats),
        highestRatedSectionHTML(stats),
        Promise.resolve(firstLastSectionHTML(stats)),
        Promise.resolve(insightsSectionHTML(insights)),
        isYearView ? superlativesSectionHTML(period.year, stats, record) : Promise.resolve(''),
        collageSectionHTML(stats, stats.period.type === 'allTime' ? 'Every book you\'ve finished' : `Every book you finished in ${stats.label}`),
      ]);
      container.innerHTML = sections.join('');
      if (isYearView) wireSuperlatives(container, render);
    } catch (err) {
      console.error('Statistics render failed:', err);
      container.innerHTML = `<div class="empty-state"><div class="icon">⚠️</div><h3>Something went wrong</h3><p>${escapeHtml(err && err.message ? err.message : 'Unknown error')}</p></div>`;
    }
  }

  setTab('year');
})();
