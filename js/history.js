/* ============================================================
   history.js — reading history calendar, browsable by year/month
   ============================================================ */

(async function () {
  initHeader('library');
  document.getElementById('subnav-root').innerHTML = renderLibrarySubnav('history');

  let year = new Date().getFullYear();
  let selectedMonth = null;
  let entries = [];
  let sessions = [];

  async function load() {
    entries = (await Storage.ReadingEntries.allWithBooks()).filter((e) => e.book);
    sessions = await Storage.ReadingSessions.getAll();
  }

  function finishedInMonth(m) {
    return entries.filter((e) => e.status === 'finished' && e.dateFinished && (() => {
      const d = new Date(e.dateFinished + 'T00:00:00');
      return d.getFullYear() === year && d.getMonth() === m;
    })());
  }

  function sessionsInMonth(m) {
    return sessions.filter((s) => {
      const d = new Date(s.date + 'T00:00:00');
      return d.getFullYear() === year && d.getMonth() === m;
    });
  }

  async function renderGrid() {
    document.getElementById('year-label').textContent = year;
    const grid = document.getElementById('month-grid');
    const tiles = await Promise.all(MONTH_NAMES.map(async (name, m) => {
      const finished = finishedInMonth(m);
      if (!finished.length) {
        return `<div class="month-tile empty"><h3 class="serif">${name}</h3><div class="count-line">No finishes</div></div>`;
      }
      const covers = await Promise.all(finished.slice(0, 4).map((e) => coverMarkup(e.book)));
      return `
        <div class="month-tile" data-month="${m}">
          <h3 class="serif">${name}</h3>
          <div class="mini-stack">${covers.map((c) => `<div class="tile">${c}</div>`).join('')}</div>
          <div class="count-line">${finished.length} book${finished.length === 1 ? '' : 's'} finished</div>
        </div>`;
    }));
    grid.innerHTML = tiles.join('');
    grid.querySelectorAll('[data-month]').forEach((tile) => {
      tile.addEventListener('click', () => { selectedMonth = Number(tile.dataset.month); renderDetail(); });
    });
  }

  async function renderDetail() {
    const panel = document.getElementById('month-detail');
    if (selectedMonth == null) { panel.hidden = true; return; }
    panel.hidden = false;
    const finished = finishedInMonth(selectedMonth).sort((a, b) => a.dateFinished.localeCompare(b.dateFinished));
    const monthSessions = sessionsInMonth(selectedMonth);
    const pages = finished.reduce((s, e) => s + (e.book.pageCount || 0), 0);
    const rated = finished.filter((e) => e.rating);
    const avgRating = rated.length ? (rated.reduce((s, e) => s + e.rating, 0) / rated.length) : null;

    panel.innerHTML = `
      <div class="section-heading"><h2>${MONTH_NAMES[selectedMonth]} ${year}</h2></div>
      <div class="stat-row">
        <div><div class="figure">${finished.length}</div><div class="label">Books finished</div></div>
        <div><div class="figure">${pages.toLocaleString()}</div><div class="label">Pages read</div></div>
        <div><div class="figure">${avgRating ? avgRating.toFixed(1) : '—'}</div><div class="label">Average rating</div></div>
        <div><div class="figure">${monthSessions.length}</div><div class="label">Reading sessions</div></div>
      </div>
      <div class="cover-grid" id="month-books-grid"></div>
    `;
    const bookGrid = document.getElementById('month-books-grid');
    if (!finished.length) {
      bookGrid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><p>Nothing finished this month.</p></div>`;
    } else {
      await renderCardList(bookGrid, finished);
    }
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  document.getElementById('prev-year').addEventListener('click', () => { year--; selectedMonth = null; renderGrid(); renderDetail(); });
  document.getElementById('next-year').addEventListener('click', () => { year++; selectedMonth = null; renderGrid(); renderDetail(); });

  await load();
  await renderGrid();
})();
