/* ============================================================
   library.js — filterable/sortable grid + list views
   ============================================================ */

(async function () {
  initHeader('library');
  document.getElementById('subnav-root').innerHTML = renderLibrarySubnav('library');

  let allEntries = await Storage.ReadingEntries.allWithBooks();
  allEntries = allEntries.filter((e) => e.book);

  const state = {
    status: getQueryParam('status') || 'all',
    genre: 'all',
    author: 'all',
    format: 'all',
    minRating: 0,
    sort: 'dateAdded_desc',
    view: localStorage.getItem('libraryView') || 'grid',
  };

  const els = {
    status: document.getElementById('filter-status'),
    genre: document.getElementById('filter-genre'),
    author: document.getElementById('filter-author'),
    format: document.getElementById('filter-format'),
    rating: document.getElementById('filter-rating'),
    sort: document.getElementById('sort-select'),
    grid: document.getElementById('library-grid'),
    list: document.getElementById('library-list'),
    empty: document.getElementById('library-empty'),
    count: document.getElementById('result-count'),
    gridBtn: document.getElementById('view-grid-btn'),
    listBtn: document.getElementById('view-list-btn'),
  };

  els.status.value = state.status;

  populateSelect(els.genre, unique(allEntries.flatMap((e) => e.book.genres || [])), 'All genres');
  populateSelect(els.author, unique(allEntries.flatMap((e) => e.book.authors || [])), 'All authors');

  function unique(arr) {
    return [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b));
  }

  function populateSelect(select, values, allLabel) {
    const current = select.value;
    select.innerHTML = `<option value="all">${allLabel}</option>` + values.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
    select.value = values.includes(current) ? current : 'all';
  }

  setView(state.view);

  els.status.addEventListener('change', () => { state.status = els.status.value; render(); });
  els.genre.addEventListener('change', () => { state.genre = els.genre.value; render(); });
  els.author.addEventListener('change', () => { state.author = els.author.value; render(); });
  els.format.addEventListener('change', () => { state.format = els.format.value; render(); });
  els.rating.addEventListener('change', () => { state.minRating = Number(els.rating.value); render(); });
  els.sort.addEventListener('change', () => { state.sort = els.sort.value; render(); });
  els.gridBtn.addEventListener('click', () => setView('grid'));
  els.listBtn.addEventListener('click', () => setView('list'));

  function setView(view) {
    state.view = view;
    localStorage.setItem('libraryView', view);
    els.gridBtn.classList.toggle('active', view === 'grid');
    els.listBtn.classList.toggle('active', view === 'list');
    els.grid.hidden = view !== 'grid';
    els.list.hidden = view !== 'list';
    render();
  }

  function applyFilters() {
    return allEntries.filter((e) => {
      if (state.status !== 'all' && e.status !== state.status) return false;
      if (state.genre !== 'all' && !(e.book.genres || []).includes(state.genre)) return false;
      if (state.author !== 'all' && !(e.book.authors || []).includes(state.author)) return false;
      if (state.format !== 'all' && e.format !== state.format) return false;
      if (state.minRating > 0 && !(e.rating >= state.minRating)) return false;
      return true;
    });
  }

  function applySort(list) {
    const sorted = list.slice();
    const [key, dir] = state.sort.split('_');
    const mult = dir === 'asc' ? 1 : -1;
    const cmp = {
      dateAdded: (a, b) => a.addedAt.localeCompare(b.addedAt),
      title: (a, b) => a.book.title.localeCompare(b.book.title),
      author: (a, b) => authorList(a.book.authors).localeCompare(authorList(b.book.authors)),
      dateFinished: (a, b) => (a.dateFinished || '').localeCompare(b.dateFinished || ''),
      rating: (a, b) => (a.rating || 0) - (b.rating || 0),
      pubYear: (a, b) => (a.book.firstPublishYear || 0) - (b.book.firstPublishYear || 0),
    }[key];
    if (cmp) sorted.sort((a, b) => mult * cmp(a, b));
    return sorted;
  }

  async function render() {
    const filtered = applySort(applyFilters());
    els.count.textContent = `${filtered.length} book${filtered.length === 1 ? '' : 's'}`;

    if (!filtered.length) {
      els.empty.innerHTML = `<div class="empty-state"><div class="icon">📚</div><h3>No books match these filters</h3><p>Try widening your filters, or add a new book from the search bar above.</p></div>`;
      els.grid.innerHTML = '';
      els.list.innerHTML = '';
      return;
    }
    els.empty.innerHTML = '';

    if (state.view === 'grid') {
      await renderCardList(els.grid, filtered, { showProgress: true });
    } else {
      els.list.innerHTML = await Promise.all(filtered.map(listRowHTML)).then((rows) => rows.join(''));
      wireBookCardClicks(els.list);
    }
  }

  async function listRowHTML(entry) {
    const book = entry.book;
    const cover = await coverMarkup(book, 'thumb');
    return `
      <div class="book-row" data-book-id="${book.id}">
        <div style="position:relative;width:42px;height:62px;flex-shrink:0;">${cover}</div>
        <div class="col-title">
          <div class="title">${escapeHtml(book.title)}</div>
          <div class="author">${escapeHtml(authorList(book.authors))}</div>
        </div>
        <div class="col-status"><span class="status-badge status-${entry.status}">${STATUS_LABELS[entry.status]}</span></div>
        <div class="col">${entry.rating ? starsDisplayHTML(entry.rating, 'sm') : '<span class="text-muted">Not rated</span>'}</div>
        <div class="col">${FORMAT_LABELS[entry.format] || ''}</div>
        <div class="col">${book.firstPublishYear || ''}</div>
        <div class="col">${book.pageCount ? book.pageCount + ' pg' : ''}</div>
      </div>`;
  }

  render();
})();
