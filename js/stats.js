/* ============================================================
   stats.js — live editorial Statistics page
   ============================================================ */

(async function () {
  initHeader('stats');

  const container = document.getElementById('stats-container');
  const yearPicker = document.getElementById('year-picker');
  const segmented = document.getElementById('period-segmented');

  const now = new Date();
  let tab = 'year';
  let selectedYear = now.getFullYear();

  const allEntries = (await Storage.ReadingEntries.allWithBooks()).filter((e) => e.book);
  const allSessions = await Storage.ReadingSessions.getAll();

  const years = [...new Set(allEntries.filter((e) => e.dateFinished).map((e) => new Date(`${normalizeDateStr(e.dateFinished)}T00:00:00`).getFullYear()))];
  if (!years.includes(now.getFullYear())) years.push(now.getFullYear());
  years.sort((a, b) => b - a);
  yearPicker.innerHTML = years.map((y) => `<option value="${y}">${y}</option>`).join('');
  yearPicker.value = selectedYear;

  function currentPeriod() {
    if (tab === 'month') return { type: 'month', year: now.getFullYear(), month: now.getMonth() };
    if (tab === 'allTime') return { type: 'allTime' };
    return { type: 'year', year: selectedYear };
  }

  function setTab(t) {
    tab = t;
    [...segmented.children].forEach((b) => b.classList.toggle('active', b.dataset.period === t));
    yearPicker.hidden = t !== 'year';
    render();
  }

  segmented.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (btn) setTab(btn.dataset.period);
  });
  yearPicker.addEventListener('change', () => { selectedYear = Number(yearPicker.value); render(); });

  async function render() {
    container.innerHTML = `<div class="empty-state"><p>Gathering your stats…</p></div>`;
    try {
      const stats = computeStats(allEntries, allSessions, currentPeriod());
      const insights = generateInsights(stats);

      if (!stats.booksFinished) {
        container.innerHTML = (await statHeroHTML(stats)) + `
          <div class="empty-state"><div class="icon">📖</div><h3>Nothing finished yet ${stats.period.type === 'allTime' ? '' : 'for this period'}</h3><p>Finish a book and your stats will start filling in beautifully.</p></div>`;
        return;
      }

      const sections = await Promise.all([
        statHeroHTML(stats),
        Promise.resolve(statCalloutsHTML(stats)),
        Promise.resolve(personalitySectionHTML(stats)),
        collageSectionHTML(stats, stats.period.type === 'allTime' ? 'Every book you\'ve finished' : `Everything you finished in ${stats.label}`),
        Promise.resolve(monthChartSectionHTML(stats)),
        genreSectionHTML(stats),
        authorSectionHTML(stats),
        Promise.resolve(formatSectionHTML(stats)),
        extremesSectionHTML(stats),
        highestRatedSectionHTML(stats),
        Promise.resolve(firstLastSectionHTML(stats)),
        Promise.resolve(insightsSectionHTML(insights)),
      ]);
      container.innerHTML = sections.join('');
    } catch (err) {
      console.error('Statistics render failed:', err);
      container.innerHTML = `<div class="empty-state"><div class="icon">⚠️</div><h3>Something went wrong</h3><p>${escapeHtml(err && err.message ? err.message : 'Unknown error')}</p></div>`;
    }
  }

  setTab('year');
})();
