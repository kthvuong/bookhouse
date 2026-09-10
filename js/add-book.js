/* ============================================================
   add-book.js — the "Add Book" modal.

   Flow: search Open Library → tap a result → a focused quick-add
   panel for just that book, with a big obvious "status" choice and
   a large primary action pinned to the bottom. Optional details are
   tucked behind "More details" so adding a normal book takes seconds.
   Dates are never invented — every date field starts empty with an
   optional "Today" shortcut.
   ============================================================ */

const AddBookFlow = (() => {
  let overlay, modal;
  let lastQuery = '';
  let lastResults = [];

  const STATUS_CHOICES = [
    { status: 'want_to_read', icon: '📚', label: 'Want to Read' },
    { status: 'currently_reading', icon: '📖', label: 'Currently Reading' },
    { status: 'finished', icon: '✓', label: 'Finished' },
  ];
  const PRIMARY_LABEL = {
    want_to_read: 'Add to Want to Read',
    currently_reading: 'Start Reading',
    finished: 'Add as Finished',
  };

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
    setTimeout(() => { modal.innerHTML = ''; modal.className = 'modal wide'; }, 200);
  }

  function open(query) {
    ensureModal();
    if (query) lastQuery = query;
    renderSearchStep();
    overlay.classList.add('open');
    setTimeout(() => modal.querySelector('#ab-search-input')?.focus(), 50);
  }

  function openWithResult(result) {
    ensureModal();
    overlay.classList.add('open');
    renderQuickAddStep(result);
  }

  // ---------------------------------------------------------
  // Step 1: search
  // ---------------------------------------------------------
  function renderSearchStep() {
    modal.className = 'modal wide';
    modal.innerHTML = `
      <div class="modal-header">
        <h3>Add a Book</h3>
        <button class="btn btn-ghost btn-icon" id="ab-close">${ICONS.close}</button>
      </div>
      <div class="modal-body">
        <div class="field">
          <input class="input" id="ab-search-input" placeholder="Search by title, author, or ISBN…" autocomplete="off" value="${escapeHtml(lastQuery)}">
        </div>
        <div id="ab-results" style="margin-top:18px;min-height:60px;"></div>
        <hr class="divider">
        <button class="btn btn-ghost btn-sm" id="ab-manual-link">Can't find it? Add a book manually →</button>
      </div>
    `;
    modal.querySelector('#ab-close').addEventListener('click', close);
    modal.querySelector('#ab-manual-link').addEventListener('click', () => renderManualStep());

    const input = modal.querySelector('#ab-search-input');
    const results = modal.querySelector('#ab-results');

    const run = debounce(async (q) => {
      lastQuery = q;
      if (!q || q.trim().length < 2) { results.innerHTML = ''; lastResults = []; return; }
      results.innerHTML = `<div class="empty-state" style="padding:24px;"><p>Searching Open Library…</p></div>`;
      let list = [];
      try {
        list = await BooksAPI.search(q, { limit: 16 });
      } catch (e) {
        results.innerHTML = `<div class="empty-state" style="padding:24px;"><p>Couldn't reach Open Library. Check your connection and try again.</p></div>`;
        return;
      }
      lastResults = list;
      if (!list.length) {
        results.innerHTML = `<div class="empty-state" style="padding:24px;"><p>No results. Try a different search, or add the book manually.</p></div>`;
        return;
      }
      const existing = await Storage.Books.getAll();
      const existingByExternalId = new Map(existing.filter((b) => b.externalId).map((b) => [b.externalId, b]));

      results.innerHTML = list.map((r, i) => searchResultRow(r, i, existingByExternalId.get(r.externalId))).join('');
      results.querySelectorAll('[data-result-idx]').forEach((row) => {
        row.addEventListener('click', () => {
          const owned = existingByExternalId.get(list[Number(row.dataset.resultIdx)].externalId);
          if (owned) window.location.href = `book.html?id=${owned.id}`;
          else renderQuickAddStep(list[Number(row.dataset.resultIdx)]);
        });
      });
    }, 380);

    if (lastQuery) run(lastQuery);
    input.addEventListener('input', (e) => run(e.target.value));
  }

  function searchResultRow(r, idx, ownedBook) {
    const cover = r.coverUrl
      ? `<img class="thumb" src="${escapeHtml(r.coverUrl)}" alt="">`
      : `<span class="thumb" style="display:flex;align-items:center;justify-content:center;font-size:9px;color:var(--text-muted);text-align:center;">no cover</span>`;
    const meta = [
      r.firstPublishYear || null,
      r.editionCount ? `${r.editionCount} edition${r.editionCount > 1 ? 's' : ''}` : null,
      r.isbn13 || r.isbn10 || null,
    ].filter(Boolean).join(' · ');
    return `
      <div class="ab-result-row" data-result-idx="${idx}">
        ${cover}
        <div class="meta">
          <div class="title">${escapeHtml(r.title)}${r.subtitle ? ': ' + escapeHtml(r.subtitle) : ''}</div>
          <div class="sub">${escapeHtml(authorList(r.authors))}</div>
          <div class="sub">${escapeHtml(meta)}</div>
        </div>
        ${ownedBook ? `<span class="in-library-badge">In library</span>` : `<span class="chevron">›</span>`}
      </div>`;
  }

  // ---------------------------------------------------------
  // Step 2: focused quick-add for one book
  // ---------------------------------------------------------
  function renderQuickAddStep(result) {
    modal.className = 'modal wide stepped';
    let selectedStatus = 'want_to_read';
    let pendingRating = 0;

    const cover = result.coverUrl
      ? `<img src="${escapeHtml(result.coverUrl)}" alt="">`
      : coverFallbackHTML(result.title);
    const metaLine = [result.firstPublishYear, result.pageCount ? result.pageCount + ' pages' : null].filter(Boolean).join(' · ');

    modal.innerHTML = `
      <div class="modal-header">
        <h3>Add to Your Library</h3>
        <button class="btn btn-ghost btn-icon" id="ab-close">${ICONS.close}</button>
      </div>
      <div class="modal-scroll-body">
        <button class="ab-back-link" id="ab-back-to-search">← Back to search</button>
        <div class="ab-preview-row">
          <div class="cover-wrap">${cover}</div>
          <div>
            <div class="title">${escapeHtml(result.title)}</div>
            <div class="sub">${escapeHtml(authorList(result.authors))}</div>
            ${metaLine ? `<div class="sub">${escapeHtml(metaLine)}</div>` : ''}
          </div>
        </div>

        <div class="status-choice-row" id="ab-status-row">
          ${STATUS_CHOICES.map((s) => `
            <button type="button" class="status-choice-btn ${s.status === selectedStatus ? 'active' : ''}" data-status-choice="${s.status}">
              <span class="icon">${s.icon}</span>${s.label}
            </button>`).join('')}
        </div>

        <div id="ab-secondary-fields"></div>

        <button type="button" class="more-details-toggle" id="ab-more-toggle"><span class="chev">›</span> More details</button>
        <div class="more-details-panel" id="ab-more-panel" hidden>
          <div class="field" style="margin-top:6px;">
            <label>Format</label>
            <select class="select" id="ab-format-select">
              <option value="physical">Physical</option>
              <option value="ebook">Kindle / eBook</option>
              <option value="audiobook">Audiobook</option>
            </select>
          </div>
        </div>
      </div>
      <div class="modal-footer-sticky">
        <button class="btn btn-primary btn-lg btn-block" id="ab-primary-btn">${PRIMARY_LABEL[selectedStatus]}</button>
      </div>
    `;

    modal.querySelector('#ab-close').addEventListener('click', close);
    modal.querySelector('#ab-back-to-search').addEventListener('click', () => renderSearchStep());

    const moreToggle = modal.querySelector('#ab-more-toggle');
    const morePanel = modal.querySelector('#ab-more-panel');
    moreToggle.addEventListener('click', () => {
      morePanel.hidden = !morePanel.hidden;
      moreToggle.classList.toggle('expanded', !morePanel.hidden);
    });

    function renderSecondaryFields() {
      const container = modal.querySelector('#ab-secondary-fields');
      if (selectedStatus === 'currently_reading') {
        container.innerHTML = `
          <div class="form-row">
            <div class="field"><label>Current page</label><input class="input" type="number" id="ab-current-page" placeholder="Optional"></div>
            ${partialDateFieldHTML('ab-date-started', 'Date started', '')}
          </div>
          <p class="text-muted" style="font-size:12px;margin-top:6px;">Don't remember the exact day? Leave Day blank.</p>`;
        wirePartialDateField(container, 'ab-date-started', () => {});
      } else if (selectedStatus === 'finished') {
        container.innerHTML = `
          <div class="field" style="margin-bottom:14px;">
            <label>Rating</label>
            <div id="ab-rating-mount" style="padding-top:4px;"></div>
          </div>
          <div class="form-row">
            ${partialDateFieldHTML('ab-date-started', 'Date started', '')}
            ${partialDateFieldHTML('ab-date-finished', 'Date finished', '')}
          </div>
          <p class="text-muted" style="font-size:12px;margin-top:6px;">Don't remember the exact day? Leave Day blank.</p>`;
        pendingRating = 0;
        mountStarInput(container.querySelector('#ab-rating-mount'), { size: '', onChange: (v) => (pendingRating = v) });
        wirePartialDateField(container, 'ab-date-started', () => {});
        wirePartialDateField(container, 'ab-date-finished', () => {});
      } else {
        container.innerHTML = '';
      }
    }
    renderSecondaryFields();

    modal.querySelectorAll('[data-status-choice]').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedStatus = btn.dataset.statusChoice;
        modal.querySelectorAll('[data-status-choice]').forEach((b) => b.classList.toggle('active', b === btn));
        modal.querySelector('#ab-primary-btn').textContent = PRIMARY_LABEL[selectedStatus];
        renderSecondaryFields();
      });
    });

    modal.querySelector('#ab-primary-btn').addEventListener('click', async () => {
      const btn = modal.querySelector('#ab-primary-btn');
      btn.disabled = true;
      btn.textContent = 'Adding…';

      const extra = { status: selectedStatus, format: modal.querySelector('#ab-format-select').value };
      const currentPageEl = modal.querySelector('#ab-current-page');
      if (currentPageEl && currentPageEl.value) extra.currentPage = currentPageEl.value;
      if (modal.querySelector('#ab-date-started-month')) {
        const dateStarted = readPartialDateField(modal, 'ab-date-started');
        if (dateStarted) extra.dateStarted = dateStarted;
      }
      if (modal.querySelector('#ab-date-finished-month')) {
        const dateFinished = readPartialDateField(modal, 'ab-date-finished');
        if (dateFinished) extra.dateFinished = dateFinished;
      }
      if (selectedStatus === 'finished' && pendingRating) extra.rating = pendingRating;

      const entry = await addExternalBook(result, extra);
      renderSuccessStep(result, selectedStatus, entry);
    });
  }

  function renderSuccessStep(result, status, entry) {
    const cover = result.coverUrl ? `<img src="${escapeHtml(result.coverUrl)}" alt="">` : coverFallbackHTML(result.title);
    const labels = { want_to_read: 'Want to Read', currently_reading: 'Currently Reading', finished: 'Finished' };
    modal.querySelector('.modal-scroll-body').innerHTML = `
      <div class="finished-popup fade-in" style="padding:10px 0;">
        <div class="finished-popup-cover">${cover}</div>
        <div class="eyebrow" style="margin-top:16px;">✓ Added</div>
        <h3 class="serif" style="margin-top:4px;">${escapeHtml(result.title)}</h3>
        <p class="text-muted" style="font-size:13.5px;">Added to ${labels[status]}</p>
      </div>`;
    modal.querySelector('.modal-footer-sticky').innerHTML = `
      <div style="display:flex;gap:10px;width:100%;">
        <button class="btn btn-ghost" id="ab-close-success" style="flex:1;">Close</button>
        <a class="btn btn-primary" id="ab-view-book" href="book.html?id=${entry.bookId}" style="flex:1;text-align:center;">View Book →</a>
      </div>`;
    modal.querySelector('#ab-close-success').addEventListener('click', close);
  }

  // ---------------------------------------------------------
  // Manual entry
  // ---------------------------------------------------------
  function renderManualStep() {
    modal.className = 'modal wide stepped';
    modal.innerHTML = `
      <div class="modal-header">
        <h3>Add a Book Manually</h3>
        <button class="btn btn-ghost btn-icon" id="ab-close">${ICONS.close}</button>
      </div>
      <div class="modal-scroll-body">
        <button class="ab-back-link" id="ab-back-to-search">← Back to search</button>
        <div class="form-row">
          <div class="field" style="flex:0 0 100px;">
            <label>Cover</label>
            <div id="ab-cover-preview" style="width:90px;aspect-ratio:2/3;border-radius:8px;background:var(--surface-hover);display:flex;align-items:center;justify-content:center;overflow:hidden;font-size:11px;color:var(--text-muted);text-align:center;">Upload</div>
            <input type="file" id="ab-cover-file" accept="image/*" style="font-size:11px;margin-top:6px;">
          </div>
          <div class="field" style="flex:1;">
            <label>Title *</label>
            <input class="input" id="ab-title">
            <label style="margin-top:8px;">Author(s)</label>
            <input class="input" id="ab-authors" placeholder="Comma-separated">
          </div>
        </div>

        <button type="button" class="more-details-toggle" id="ab-more-toggle"><span class="chev">›</span> More details</button>
        <div class="more-details-panel" id="ab-more-panel" hidden>
          <div class="form-row" style="margin-top:6px;">
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
      </div>
      <div class="modal-footer-sticky">
        <button class="btn btn-primary btn-lg btn-block" id="ab-save">Create Book</button>
      </div>
    `;
    modal.querySelector('#ab-close').addEventListener('click', close);
    modal.querySelector('#ab-back-to-search').addEventListener('click', () => renderSearchStep());

    const moreToggle = modal.querySelector('#ab-more-toggle');
    const morePanel = modal.querySelector('#ab-more-panel');
    moreToggle.addEventListener('click', () => {
      morePanel.hidden = !morePanel.hidden;
      moreToggle.classList.toggle('expanded', !morePanel.hidden);
    });

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

  // ---------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------
  async function addExternalBook(result, extra = {}) {
    const status = extra.status || 'want_to_read';
    const entryPatch = { bookId: null, status };
    if (extra.format) entryPatch.format = extra.format;
    if (extra.currentPage) entryPatch.currentPage = Number(extra.currentPage);
    if (extra.dateStarted) entryPatch.dateStarted = extra.dateStarted;
    if (extra.dateFinished) entryPatch.dateFinished = extra.dateFinished;
    if (extra.rating) entryPatch.rating = extra.rating;

    const existingBooks = await Storage.Books.getAll();
    const dupe = existingBooks.find((b) => b.externalId === result.externalId);
    if (dupe) {
      if (status === 'finished') Object.assign(entryPatch, finishedProgressPatch(dupe));
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
    if (status === 'finished') Object.assign(entryPatch, finishedProgressPatch(book));
    else if (entryPatch.currentPage && book.pageCount) entryPatch.progressPercent = percentFromPages(entryPatch.currentPage, book.pageCount);
    const entry = await Storage.ReadingEntries.create(entryPatch);
    if (entryPatch.currentPage) {
      await Storage.ProgressUpdates.add(entry.id, {
        date: entryPatch.dateStarted || todayStr(),
        currentPage: entryPatch.currentPage,
        percent: entryPatch.progressPercent || null,
      });
    }
    return entry;
  }

  return { open, openWithResult, close, quickAdd: addExternalBook };
})();
