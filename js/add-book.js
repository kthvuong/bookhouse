/* ============================================================
   add-book.js — the "Add Book" modal: search Open Library,
   confirm + add to personal library, or add a book manually.
   ============================================================ */

const AddBookFlow = (() => {
  let overlay, modal, addedExternalIds = new Set();

  function ensureModal() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `<div class="modal wide" role="dialog" aria-modal="true"></div>`;
    document.body.appendChild(overlay);
    modal = overlay.querySelector('.modal');
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  }

  function close() {
    overlay.classList.remove('open');
    setTimeout(() => { modal.innerHTML = ''; }, 200);
  }

  function open() {
    ensureModal();
    renderSearchStep();
    overlay.classList.add('open');
    setTimeout(() => modal.querySelector('#ab-search-input')?.focus(), 50);
  }

  async function openWithResult(result) {
    ensureModal();
    overlay.classList.add('open');
    renderAdding(result.title);
    const entry = await addExternalBook(result);
    close();
    toast(`Added "${result.title}" to your library`);
    window.location.href = `book.html?id=${entry.bookId}`;
  }

  function renderAdding(title) {
    modal.innerHTML = `<div class="modal-body" style="text-align:center;padding:60px 30px;">
      <div class="eyebrow">Adding to your library</div>
      <h3 class="serif" style="margin-top:8px;">${escapeHtml(title)}</h3>
    </div>`;
  }

  function renderSearchStep() {
    modal.innerHTML = `
      <div class="modal-header">
        <h3>Add a Book</h3>
        <button class="btn btn-ghost btn-icon" id="ab-close">${ICONS.close}</button>
      </div>
      <div class="modal-body">
        <div class="field">
          <input class="input" id="ab-search-input" placeholder="Search by title, author, or ISBN…" autocomplete="off">
        </div>
        <div id="ab-results" style="margin-top:18px;min-height:80px;"></div>
        <hr class="divider">
        <button class="btn btn-ghost btn-sm" id="ab-manual-link">Can't find it? Add a book manually →</button>
      </div>
    `;
    modal.querySelector('#ab-close').addEventListener('click', close);
    modal.querySelector('#ab-manual-link').addEventListener('click', renderManualStep);

    const input = modal.querySelector('#ab-search-input');
    const results = modal.querySelector('#ab-results');
    const run = debounce(async (q) => {
      if (!q || q.trim().length < 2) { results.innerHTML = ''; return; }
      results.innerHTML = `<div class="empty-state" style="padding:24px;"><p>Searching Open Library…</p></div>`;
      let list = [];
      try {
        list = await BooksAPI.search(q, { limit: 16 });
      } catch (e) {
        results.innerHTML = `<div class="empty-state" style="padding:24px;"><p>Couldn't reach Open Library. Check your connection and try again.</p></div>`;
        return;
      }
      if (!list.length) {
        results.innerHTML = `<div class="empty-state" style="padding:24px;"><p>No results. Try a different search, or add the book manually.</p></div>`;
        return;
      }
      const existing = await Storage.Books.getAll();
      const existingExternalIds = new Set(existing.map((b) => b.externalId).filter(Boolean));

      results.innerHTML = list.map((r, i) => searchResultRow(r, i, existingExternalIds.has(r.externalId))).join('');
      wireResultRows(results, list);
    }, 380);
    input.addEventListener('input', (e) => run(e.target.value));
  }

  const QUICK_STATUSES = [
    { status: 'want_to_read', label: 'Want to Read' },
    { status: 'currently_reading', label: 'Reading' },
    { status: 'finished', label: 'Finished' },
  ];

  function searchResultRow(r, idx, alreadyAdded) {
    const cover = r.coverUrl
      ? `<img class="thumb" src="${escapeHtml(r.coverUrl)}" alt="">`
      : `<span class="thumb" style="display:flex;align-items:center;justify-content:center;font-size:9px;color:var(--text-muted);text-align:center;">no cover</span>`;
    const meta = [
      r.firstPublishYear || null,
      r.editionCount ? `${r.editionCount} edition${r.editionCount > 1 ? 's' : ''}` : null,
      r.isbn13 || r.isbn10 || null,
    ].filter(Boolean).join(' · ');
    return `
      <div class="ab-result" data-idx="${idx}">
        <div class="search-result-row" style="padding:10px 4px;">
          ${cover}
          <div class="meta">
            <div class="title">${escapeHtml(r.title)}${r.subtitle ? ': ' + escapeHtml(r.subtitle) : ''}</div>
            <div class="sub">${escapeHtml(authorList(r.authors))}</div>
            <div class="sub">${escapeHtml(meta)}</div>
          </div>
          <div class="ab-quick-actions" data-actions>
            ${alreadyAdded
              ? `<span class="in-library-badge">In library</span>`
              : QUICK_STATUSES.map((s) => `<button class="btn btn-sm" data-quick-add="${s.status}">${s.label}</button>`).join('')}
          </div>
        </div>
        <div class="ab-quick-form" data-quick-form hidden></div>
      </div>`;
  }

  function quickFormHTML(status) {
    if (status === 'currently_reading') {
      return `
        <div class="form-row">
          <div class="field"><label>Current page</label><input class="input" type="number" data-field="currentPage" placeholder="Optional"></div>
          <div class="field"><label>Date started</label><input class="input" type="date" data-field="dateStarted" value="${todayStr()}"></div>
        </div>
        <div style="margin-top:10px;display:flex;gap:8px;">
          <button class="btn btn-primary btn-sm" data-confirm-add="currently_reading">Add to Currently Reading</button>
          <button class="btn btn-ghost btn-sm" data-cancel-quick>Cancel</button>
        </div>`;
    }
    return `
      <div class="form-row">
        <div class="field"><label>Rating</label><div data-rating-mount style="padding-top:4px;"></div></div>
        <div class="field"><label>Date finished</label><input class="input" type="date" data-field="dateFinished" value="${todayStr()}"></div>
      </div>
      <div style="margin-top:10px;display:flex;gap:8px;">
        <button class="btn btn-primary btn-sm" data-confirm-add="finished">Add to Finished</button>
        <button class="btn btn-ghost btn-sm" data-cancel-quick>Cancel</button>
      </div>`;
  }

  function wireResultRows(container, list) {
    container.querySelectorAll('.ab-result').forEach((rowEl) => {
      const idx = Number(rowEl.dataset.idx);
      const r = list[idx];
      const formEl = rowEl.querySelector('[data-quick-form]');
      let pendingRating = 0;

      rowEl.querySelectorAll('[data-quick-add]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const status = btn.dataset.quickAdd;
          if (status === 'want_to_read') {
            await confirmAdd(rowEl, r, { status });
            return;
          }
          formEl.hidden = false;
          formEl.innerHTML = quickFormHTML(status);
          if (status === 'finished') {
            pendingRating = 0;
            mountStarInput(formEl.querySelector('[data-rating-mount]'), { size: '', onChange: (v) => (pendingRating = v) });
          }
          formEl.querySelector('[data-cancel-quick]').addEventListener('click', () => { formEl.hidden = true; formEl.innerHTML = ''; });
          formEl.querySelector('[data-confirm-add]').addEventListener('click', async () => {
            const extra = { status };
            formEl.querySelectorAll('[data-field]').forEach((input) => { if (input.value) extra[input.dataset.field] = input.value; });
            if (status === 'finished' && pendingRating) extra.rating = pendingRating;
            await confirmAdd(rowEl, r, extra);
          });
        });
      });
    });
  }

  async function confirmAdd(rowEl, result, extra) {
    const actions = rowEl.querySelector('[data-actions]');
    actions.innerHTML = `<span class="text-muted" style="font-size:12.5px;">Adding…</span>`;
    const entry = await addExternalBook(result, extra);
    rowEl.querySelector('[data-quick-form]').hidden = true;
    actions.innerHTML = `<a class="btn btn-sm" href="book.html?id=${entry.bookId}">View →</a>`;
    rowEl.classList.add('fade-in');
    const labels = { want_to_read: 'Want to Read', currently_reading: 'Currently Reading', finished: 'Finished' };
    toast(`✓ Added to ${labels[extra.status]}`);
  }

  function renderManualStep() {
    modal.innerHTML = `
      <div class="modal-header">
        <h3>Add a Book Manually</h3>
        <button class="btn btn-ghost btn-icon" id="ab-close">${ICONS.close}</button>
      </div>
      <div class="modal-body">
        <div class="form-row">
          <div class="field" style="flex:0 0 110px;">
            <label>Cover</label>
            <div id="ab-cover-preview" style="width:100px;aspect-ratio:2/3;border-radius:8px;background:var(--surface-hover);display:flex;align-items:center;justify-content:center;overflow:hidden;font-size:11px;color:var(--text-muted);text-align:center;">Upload</div>
            <input type="file" id="ab-cover-file" accept="image/*" style="font-size:11px;">
          </div>
          <div class="field" style="flex:1;">
            <label>Title *</label>
            <input class="input" id="ab-title">
            <label style="margin-top:8px;">Author(s)</label>
            <input class="input" id="ab-authors" placeholder="Comma-separated">
          </div>
        </div>
        <div class="form-row" style="margin-top:12px;">
          <div class="field"><label>Publication year</label><input class="input" id="ab-year" type="number"></div>
          <div class="field"><label>Page count</label><input class="input" id="ab-pages" type="number"></div>
          <div class="field"><label>ISBN</label><input class="input" id="ab-isbn"></div>
        </div>
        <div class="field" style="margin-top:12px;">
          <label>Genres</label>
          <input class="input" id="ab-genres" placeholder="Comma-separated, e.g. Fantasy, Romance">
        </div>
        <div class="field" style="margin-top:12px;">
          <label>Description</label>
          <textarea class="textarea" id="ab-description"></textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" id="ab-back">← Back to search</button>
        <button class="btn btn-primary" id="ab-save">Add to Library</button>
      </div>
    `;
    modal.querySelector('#ab-close').addEventListener('click', close);
    modal.querySelector('#ab-back').addEventListener('click', renderSearchStep);

    let coverFile = null;
    modal.querySelector('#ab-cover-file').addEventListener('change', (e) => {
      coverFile = e.target.files[0] || null;
      if (coverFile) {
        modal.querySelector('#ab-cover-preview').innerHTML = `<img src="${URL.createObjectURL(coverFile)}" style="width:100%;height:100%;object-fit:cover;">`;
      }
    });

    modal.querySelector('#ab-save').addEventListener('click', async () => {
      const title = modal.querySelector('#ab-title').value.trim();
      if (!title) { toast('Title is required'); return; }
      const book = await Storage.Books.create({
        source: 'manual',
        title,
        authors: modal.querySelector('#ab-authors').value.split(',').map((s) => s.trim()).filter(Boolean),
        firstPublishYear: Number(modal.querySelector('#ab-year').value) || null,
        pageCount: Number(modal.querySelector('#ab-pages').value) || null,
        isbn13: modal.querySelector('#ab-isbn').value.trim(),
        genres: modal.querySelector('#ab-genres').value.split(',').map((s) => s.trim()).filter(Boolean),
        description: modal.querySelector('#ab-description').value.trim(),
      });
      if (coverFile) await Storage.Covers.save(book.id, coverFile, '');
      const entry = await Storage.ReadingEntries.create({ bookId: book.id, status: 'want_to_read' });
      close();
      toast(`Added "${title}" to your library`);
      window.location.href = `book.html?id=${book.id}`;
    });
  }

  async function addExternalBook(result, extra = {}) {
    const status = extra.status || 'want_to_read';
    const entryPatch = { bookId: null, status };
    if (extra.currentPage) entryPatch.currentPage = Number(extra.currentPage);
    if (extra.dateStarted) entryPatch.dateStarted = extra.dateStarted;
    if (extra.dateFinished) entryPatch.dateFinished = extra.dateFinished;
    if (!entryPatch.dateStarted && status === 'currently_reading') entryPatch.dateStarted = todayStr();
    if (!entryPatch.dateFinished && status === 'finished') entryPatch.dateFinished = todayStr();
    if (extra.rating) entryPatch.rating = extra.rating;

    const existingBooks = await Storage.Books.getAll();
    const dupe = existingBooks.find((b) => b.externalId === result.externalId);
    if (dupe) {
      const entry = await Storage.ReadingEntries.getByBookId(dupe.id);
      if (entry) return Storage.ReadingEntries.update(entry.id, entryPatch);
      entryPatch.bookId = dupe.id;
      return Storage.ReadingEntries.create(entryPatch);
    }

    let details = { description: '', genres: [] };
    try { details = await BooksAPI.getDetails(result.externalId); } catch (e) {}

    const book = await Storage.Books.create({
      source: 'openlibrary',
      externalId: result.externalId,
      title: result.title,
      subtitle: result.subtitle,
      authors: result.authors,
      firstPublishYear: result.firstPublishYear,
      isbn10: result.isbn10,
      isbn13: result.isbn13,
      pageCount: result.pageCount,
      description: stripMarkdown(details.description),
      genres: details.genres,
      coverUrl: result.coverUrlLarge || result.coverUrl,
    });

    const blob = await BooksAPI.fetchCoverBlob(result.coverUrlLarge || result.coverUrl);
    if (blob) await Storage.Covers.save(book.id, blob, result.coverUrlLarge || result.coverUrl);

    entryPatch.bookId = book.id;
    if (entryPatch.currentPage && book.pageCount) entryPatch.progressPercent = percentFromPages(entryPatch.currentPage, book.pageCount);
    const entry = await Storage.ReadingEntries.create(entryPatch);
    if (entryPatch.currentPage) {
      await Storage.ProgressUpdates.add(entry.id, { date: entryPatch.dateStarted || todayStr(), currentPage: entryPatch.currentPage, percent: entryPatch.progressPercent || null });
    }
    return entry;
  }

  return { open, openWithResult, close };
})();
