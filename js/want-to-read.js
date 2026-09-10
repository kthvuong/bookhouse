/* ============================================================
   want-to-read.js — TBR list: drag reorder, priority, filters,
   and the "what should I read next?" random picker.
   ============================================================ */

(async function () {
  initHeader('library');
  document.getElementById('subnav-root').innerHTML = renderLibrarySubnav('want-to-read');

  const list = document.getElementById('tbr-list');
  const state = { genre: 'all', author: 'all', length: 'all' };

  let entries = [];

  function lengthBucket(pageCount) {
    if (!pageCount) return 'unknown';
    if (pageCount < 300) return 'short';
    if (pageCount <= 450) return 'medium';
    return 'long';
  }

  async function load() {
    const raw = await Storage.ReadingEntries.getByStatus('want_to_read');
    entries = (await Storage.ReadingEntries.listWithBooks(raw))
      .filter((e) => e.book)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  function populateSelect(select, values) {
    const current = select.value;
    select.innerHTML = select.options[0].outerHTML + values.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
    select.value = values.includes(current) ? current : 'all';
  }

  function refreshFilterOptions() {
    const genres = [...new Set(entries.flatMap((e) => e.book.genres || []).filter((g) => !g.includes(':')))].sort();
    const authors = [...new Set(entries.flatMap((e) => e.book.authors || []))].sort();
    [document.getElementById('filter-genre'), document.getElementById('picker-genre')].forEach((s) => populateSelect(s, genres));
    [document.getElementById('filter-author'), document.getElementById('picker-author')].forEach((s) => populateSelect(s, authors));
  }

  function applyFilters(list, filters) {
    return list.filter((e) => {
      if (filters.genre !== 'all' && !(e.book.genres || []).includes(filters.genre)) return false;
      if (filters.author !== 'all' && !(e.book.authors || []).includes(filters.author)) return false;
      if (filters.length !== 'all' && lengthBucket(e.book.pageCount) !== filters.length) return false;
      return true;
    });
  }

  const filtersActive = () => state.genre !== 'all' || state.author !== 'all' || state.length !== 'all';

  async function render() {
    const filtered = applyFilters(entries, state);
    document.getElementById('result-count').textContent = `${filtered.length} book${filtered.length === 1 ? '' : 's'}`;

    if (!filtered.length) {
      list.innerHTML = `<div class="empty-state"><div class="icon">📚</div><h3>Nothing here</h3><p>${entries.length ? 'No books match these filters.' : 'Search for a book above to add it to your Want to Read list.'}</p></div>`;
      return;
    }

    const draggable = !filtersActive();
    list.innerHTML = (await Promise.all(filtered.map((e) => rowHTML(e, draggable)))).join('');
    wireRowEvents(draggable);
  }

  async function rowHTML(entry, draggable) {
    const book = entry.book;
    const cover = await coverMarkup(book, 'thumb');
    return `
      <div class="tbr-row" data-entry-id="${entry.id}" ${draggable ? 'draggable="true"' : ''}>
        <span class="drag-handle ${draggable ? '' : 'disabled'}">⠿</span>
        <a href="book.html?id=${book.id}" style="position:relative;display:block;width:42px;height:62px;flex-shrink:0;">${cover}</a>
        <div class="info">
          <a href="book.html?id=${book.id}"><div class="title">${escapeHtml(book.title)}</div></a>
          <div class="author">${escapeHtml(authorList(book.authors))}</div>
          ${(entry.tags || []).length ? `<div class="chip-row">${entry.tags.map((t) => `<span class="chip">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
        </div>
        <span class="pages-label">${book.pageCount ? book.pageCount + ' pg' : ''}</span>
        <select class="priority-select priority-${entry.priority}" data-priority-select>
          <option value="high" ${entry.priority === 'high' ? 'selected' : ''}>High priority</option>
          <option value="normal" ${entry.priority === 'normal' ? 'selected' : ''}>Normal priority</option>
          <option value="low" ${entry.priority === 'low' ? 'selected' : ''}>Low priority</option>
        </select>
      </div>`;
  }

  function wireRowEvents(draggable) {
    list.querySelectorAll('[data-priority-select]').forEach((sel) => {
      sel.addEventListener('change', async (e) => {
        const row = e.target.closest('.tbr-row');
        const id = row.dataset.entryId;
        await Storage.ReadingEntries.update(id, { priority: e.target.value });
        e.target.className = `priority-select priority-${e.target.value}`;
        const entry = entries.find((x) => x.id === id);
        if (entry) entry.priority = e.target.value;
      });
    });

    if (!draggable) return;
    let draggedId = null;
    list.querySelectorAll('.tbr-row').forEach((row) => {
      row.addEventListener('dragstart', () => { draggedId = row.dataset.entryId; row.classList.add('dragging'); });
      row.addEventListener('dragend', () => row.classList.remove('dragging'));
      row.addEventListener('dragover', (e) => { e.preventDefault(); row.classList.add('drag-over'); });
      row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
      row.addEventListener('drop', async (e) => {
        e.preventDefault();
        row.classList.remove('drag-over');
        const targetId = row.dataset.entryId;
        if (!draggedId || draggedId === targetId) return;
        const fromIdx = entries.findIndex((x) => x.id === draggedId);
        const toIdx = entries.findIndex((x) => x.id === targetId);
        const [moved] = entries.splice(fromIdx, 1);
        entries.splice(toIdx, 0, moved);
        await Promise.all(entries.map((e, i) => Storage.ReadingEntries.update(e.id, { sortOrder: i })));
        entries.forEach((e, i) => (e.sortOrder = i));
        await render();
      });
    });
  }

  document.getElementById('filter-genre').addEventListener('change', (e) => { state.genre = e.target.value; render(); });
  document.getElementById('filter-author').addEventListener('change', (e) => { state.author = e.target.value; render(); });
  document.getElementById('filter-length').addEventListener('change', (e) => { state.length = e.target.value; render(); });

  // ---- random picker ----
  const pickerModal = document.getElementById('picker-modal');
  const pickerResult = document.getElementById('picker-result');
  document.getElementById('picker-btn').addEventListener('click', () => {
    pickerResult.innerHTML = '';
    pickerModal.classList.add('open');
  });
  document.getElementById('picker-close').addEventListener('click', () => pickerModal.classList.remove('open'));
  pickerModal.addEventListener('click', (e) => { if (e.target === pickerModal) pickerModal.classList.remove('open'); });

  async function runPick() {
    const filters = {
      genre: document.getElementById('picker-genre').value,
      author: document.getElementById('picker-author').value,
      length: document.getElementById('picker-length').value,
    };
    const pool = applyFilters(entries, filters);
    if (!pool.length) {
      pickerResult.innerHTML = `<div class="empty-state"><p>No books match those filters.</p></div>`;
      return;
    }
    const pick = pool[Math.floor(Math.random() * pool.length)];
    const cover = await coverMarkup(pick.book);
    pickerResult.innerHTML = `
      <div class="picker-reveal fade-in">
        <div class="cover-wrap">${cover}</div>
        <h3 class="serif">${escapeHtml(pick.book.title)}</h3>
        <div class="author">${escapeHtml(authorList(pick.book.authors))}</div>
        <div class="picker-actions">
          <button class="btn btn-primary" id="picker-start-btn" data-book-id="${pick.book.id}">Start Reading</button>
          <button class="btn btn-ghost" id="picker-again-btn">Pick Again</button>
        </div>
      </div>`;
    document.getElementById('picker-again-btn').addEventListener('click', runPick);
    document.getElementById('picker-start-btn').addEventListener('click', async () => {
      await Storage.ReadingEntries.update(pick.id, { status: 'currently_reading' });
      window.location.href = `book.html?id=${pick.book.id}`;
    });
  }

  const rollBtnHtml = document.createElement('div');
  rollBtnHtml.style.marginTop = '16px';
  rollBtnHtml.innerHTML = `<button class="btn btn-primary" id="picker-roll-btn" style="width:100%;">Pick for Me</button>`;
  document.getElementById('picker-filters').after(rollBtnHtml);
  document.getElementById('picker-roll-btn').addEventListener('click', runPick);

  await load();
  refreshFilterOptions();
  await render();
})();
