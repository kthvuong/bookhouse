/* ============================================================
   currently-reading.js — in-progress list with inline quick-update
   ============================================================ */

(async function () {
  initHeader('library');
  document.getElementById('subnav-root').innerHTML = renderLibrarySubnav('currently-reading');
  const list = document.getElementById('cr-list');

  async function load() {
    const entries = (await Storage.ReadingEntries.getByStatus('currently_reading')).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return Storage.ReadingEntries.listWithBooks(entries);
  }

  async function render() {
    const entries = await load();
    if (!entries.length) {
      list.innerHTML = `<div class="empty-state"><div class="icon">📖</div><h3>Nothing in progress right now</h3><p>Start a book from your <a href="want-to-read.html">Want to Read</a> list, or add something new.</p></div>`;
      return;
    }
    const progressData = await Promise.all(entries.map((e) => Storage.ProgressUpdates.listFor(e.id)));
    list.innerHTML = (await Promise.all(entries.map((e, i) => itemHTML(e, progressData[i])))).join('');
    wireEvents(entries);
  }

  async function itemHTML(entry, progressUpdates) {
    const book = entry.book;
    const cover = await coverMarkup(book);
    const stats = computeProgressStats(entry, progressUpdates, book);
    return `
      <div class="cr-item" data-entry-id="${entry.id}">
        <a href="book.html?id=${book.id}" class="cover-wrap">${cover}</a>
        <div>
          <div class="cr-top">
            <div>
              <h3 class="serif"><a href="book.html?id=${book.id}">${escapeHtml(book.title)}</a></h3>
              <div class="author">${escapeHtml(authorList(book.authors))}</div>
            </div>
          </div>
          <div class="progress-track"><span style="width:${stats.percent}%"></span></div>
          <div class="progress-meta">
            <span>${stats.percent}% · ${stats.pagesRead}${stats.totalPages ? ' / ' + stats.totalPages : ''} pages</span>
            <span>${stats.avgPagesPerDay ? stats.avgPagesPerDay.toFixed(1) + ' pg/day' : ''}</span>
          </div>
          <div class="quick-update-row">
            <input type="number" class="input" placeholder="Page…" data-page-input>
            <button class="btn btn-sm btn-primary" data-log-btn>Log Progress</button>
            <button class="btn btn-sm btn-ghost" data-finish-btn>Mark Finished</button>
            <a class="detail-link" href="book.html?id=${book.id}">Full details →</a>
          </div>
        </div>
      </div>`;
  }

  function wireEvents(entries) {
    const byId = new Map(entries.map((e) => [e.id, e]));
    list.querySelectorAll('[data-log-btn]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const item = btn.closest('.cr-item');
        const entry = byId.get(item.dataset.entryId);
        const pageVal = item.querySelector('[data-page-input]').value;
        if (!pageVal) { toast('Enter a page number'); return; }
        await logProgressUpdate(entry, entry.book, { currentPage: pageVal });
        await render();
        toast('Progress logged');
      });
    });
    list.querySelectorAll('[data-finish-btn]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const item = btn.closest('.cr-item');
        const entry = byId.get(item.dataset.entryId);
        const rating = await promptFinishedRating(entry.book);
        const patch = { status: 'finished', ...finishedProgressPatch(entry.book) };
        if (rating) patch.rating = rating;
        await Storage.ReadingEntries.update(entry.id, patch);
        await render();
        toast('Marked as Finished 🎉');
      });
    });
  }

  render();
})();
