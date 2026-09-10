/* ============================================================
   book.js — book detail page.

   Reading first, editing second: the header is read-only viewing,
   and edits below are grouped into Reading Details, Rating &
   Review, Favourite Quotes, Tags, and Collections. Status changes,
   quotes, tags, and collection membership save immediately (each
   is its own explicit action); format, dates, rating, and review
   are staged locally and only persist when "Save Changes" is
   pressed, via the sticky bar at the bottom of the page.
   ============================================================ */

(async function () {
  initHeader('library');

  const root = document.getElementById('book-root');
  const bookId = getQueryParam('id');

  let book, entry, progressUpdates, sessions, quotes, allCollections, myCollectionIds;
  let staged, baseline;

  function snapshotStaged(e) {
    return {
      format: e.format || 'physical',
      dateStarted: e.dateStarted || '',
      dateFinished: e.dateFinished || '',
      rating: e.rating || 0,
      review: e.review || '',
    };
  }
  function isDirty() {
    return JSON.stringify(staged) !== JSON.stringify(baseline);
  }

  async function loadAll() {
    book = await Storage.Books.get(bookId);
    if (!book) return false;
    entry = await Storage.ReadingEntries.getByBookId(bookId);
    if (!entry) entry = await Storage.ReadingEntries.create({ bookId, status: 'want_to_read' });
    [progressUpdates, sessions, quotes, allCollections] = await Promise.all([
      Storage.ProgressUpdates.listFor(entry.id),
      Storage.ReadingSessions.listFor(entry.id),
      Storage.Quotes.listFor(entry.id),
      Storage.Collections.getAll(),
    ]);
    const memberships = await Storage.Collections.collectionsForEntry(entry.id);
    myCollectionIds = new Set(memberships.map((m) => m.collectionId));
    baseline = snapshotStaged(entry);
    staged = { ...baseline };
    return true;
  }

  async function refresh() {
    await loadAll();
    render();
  }

  async function updateEntry(patch) {
    entry = await Storage.ReadingEntries.update(entry.id, patch);
  }

  function render() {
    if (!book) {
      root.innerHTML = `<div class="empty-state"><h3>Book not found</h3><p>It may have been removed. <a href="library.html">Back to Library →</a></p></div>`;
      return;
    }
    document.title = `${APP_NAME} — ${book.title}`;
    root.innerHTML = `
      ${headerHTML()}
      ${descriptionSectionHTML()}
      ${readingDetailsSectionHTML()}
      ${ratingReviewSectionHTML()}
      ${quotesSectionHTML()}
      ${tagsSectionHTML()}
      ${collectionsSectionHTML()}
      ${dangerZoneHTML()}
      <div style="height:88px;"></div>
      ${saveBarHTML()}
    `;
    wireEvents();
    fillCoverAsync();
  }

  async function fillCoverAsync() {
    const wrap = root.querySelector('#book-cover-wrap');
    if (!wrap) return;
    wrap.innerHTML = await coverMarkup(book);
  }

  // ---------------------------------------------------------
  // Sections
  // ---------------------------------------------------------

  function headerHTML() {
    const genres = (book.genres || []).filter((g) => !g.includes(':')).slice(0, 8);
    const isbn = book.isbn13 || book.isbn10 || '';
    return `
      <div class="book-header">
        <div class="cover-wrap" id="book-cover-wrap"></div>
        <div class="book-info">
          <div class="eyebrow-row"><span class="status-badge status-${entry.status}">${STATUS_LABELS[entry.status]}</span></div>
          <h1 class="serif">${escapeHtml(book.title)}</h1>
          ${book.subtitle ? `<div class="subtitle-line">${escapeHtml(book.subtitle)}</div>` : ''}
          <div class="authors-line">by ${escapeHtml(authorList(book.authors))}</div>

          <div class="meta-strip">
            ${book.pageCount ? `<span class="meta-item"><strong>${book.pageCount}</strong> pages</span>` : ''}
            ${book.firstPublishYear ? `<span class="meta-item">Published <strong>${book.firstPublishYear}</strong></span>` : ''}
            ${isbn ? `<span class="meta-item">ISBN <strong>${escapeHtml(isbn)}</strong></span>` : ''}
          </div>

          ${genres.length ? `<div class="chip-row">${genres.map((g) => `<span class="chip">${escapeHtml(g)}</span>`).join('')}</div>` : ''}
        </div>
      </div>`;
  }

  function descriptionSectionHTML() {
    if (!book.description) return '';
    const long = book.description.length > 420;
    return `
      <div class="book-section">
        <h2>Synopsis</h2>
        <p class="description-text ${long ? 'clamped' : ''}" id="description-text">${escapeHtml(book.description)}</p>
        ${long ? `<button class="description-toggle" id="description-toggle">Read more</button>` : ''}
      </div>`;
  }

  function readingDetailsSectionHTML() {
    return `
      <div class="book-section">
        <h2>Reading Details</h2>
        <div class="control-row">
          <div class="field-inline">
            <label class="mini">Status</label>
            <div class="status-select-wrap">
              <select class="status-select" id="status-select">
                ${Object.entries(STATUS_LABELS).map(([v, l]) => `<option value="${v}" ${entry.status === v ? 'selected' : ''}>${l}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="field-inline">
            <label class="mini">Format</label>
            <div class="status-select-wrap">
              <select class="status-select" id="format-select">
                ${Object.entries(FORMAT_LABELS).map(([v, l]) => `<option value="${v}" ${staged.format === v ? 'selected' : ''}>${l}</option>`).join('')}
              </select>
            </div>
          </div>
        </div>

        <div class="control-row">
          <div class="field-inline">
            <label class="mini">Started</label>
            <div class="date-with-today">
              <input type="date" class="input" id="date-started" value="${staged.dateStarted}" style="width:150px;">
              <button type="button" class="btn btn-ghost btn-sm" data-today-for="date-started">Today</button>
            </div>
          </div>
          <div class="field-inline">
            <label class="mini">Finished</label>
            <div class="date-with-today">
              <input type="date" class="input" id="date-finished" value="${staged.dateFinished}" style="width:150px;">
              <button type="button" class="btn btn-ghost btn-sm" data-today-for="date-finished">Today</button>
            </div>
          </div>
        </div>

        ${progressBlockHTML()}
        ${sessionsBlockHTML()}
      </div>`;
  }

  function progressBlockHTML() {
    const applicable = ['currently_reading', 'paused', 'finished'].includes(entry.status);
    if (!applicable) return '';
    const stats = computeProgressStats(entry, progressUpdates, book);
    const showSuggestFinish = entry.status !== 'finished' && stats.percent >= 100;
    return `
      <hr class="divider">
      <div class="subsection-label">Progress</div>
      <div class="progress-track"><span style="width:${stats.percent}%"></span></div>
      <div class="progress-meta"><span>${stats.percent}% complete</span><span>${stats.pagesRead}${stats.totalPages ? ' / ' + stats.totalPages : ''} pages</span></div>

      ${showSuggestFinish ? `<div class="chip active" style="margin-top:12px;cursor:pointer;" id="suggest-finish-chip">Looks finished — mark as Finished →</div>` : ''}

      ${entry.status !== 'finished' ? `
      <div class="progress-input-row" style="margin-top:20px;">
        <div class="field">
          <label>Current page</label>
          <input type="number" class="input" id="progress-page-input" min="0" ${book.pageCount ? `max="${book.pageCount}"` : ''} placeholder="e.g. 152">
        </div>
        <div class="field">
          <label>or percent</label>
          <input type="number" class="input" id="progress-percent-input" min="0" max="100" placeholder="e.g. 45">
        </div>
        <div class="field">
          <label>Date</label>
          <input type="date" class="input" id="progress-date-input" value="${todayStr()}" style="width:150px;">
        </div>
        <button class="btn btn-primary btn-sm" id="log-progress-btn">Log Progress</button>
      </div>` : ''}

      <div class="progress-stats-grid">
        <div class="stat"><div class="figure">${stats.pagesRead}</div><div class="label">Pages read</div></div>
        <div class="stat"><div class="figure">${stats.pagesRemaining ?? '—'}</div><div class="label">Pages left</div></div>
        <div class="stat"><div class="figure">${stats.avgPagesPerDay ? stats.avgPagesPerDay.toFixed(1) : '—'}</div><div class="label">Pages / day</div></div>
        ${stats.estCompletionDate ? `<div class="stat subtle"><div class="figure" style="font-size:14px;">${formatDate(stats.estCompletionDate, 'short')}</div><div class="label">Est. finish</div></div>` : ''}
      </div>

      ${progressUpdates.length ? `
      <div class="progress-history">
        <div class="eyebrow">History</div>
        ${progressUpdates.slice().reverse().map((p) => `
          <div class="progress-history-row" data-progress-id="${p.id}">
            <span>${formatDate(p.date, 'short')}</span>
            <span>${p.currentPage != null ? 'page ' + p.currentPage : ''}${p.percent != null ? ' · ' + p.percent + '%' : ''}</span>
            <button class="remove-btn" data-remove-progress="${p.id}">Remove</button>
          </div>`).join('')}
      </div>` : ''}`;
  }

  function sessionsBlockHTML() {
    return `
      <hr class="divider">
      <div class="subsection-label">Sessions <span class="text-muted" style="font-weight:400;text-transform:none;letter-spacing:0;">— optional</span></div>
      ${sessions.length ? sessions.slice().reverse().map((s) => `
        <div class="session-row" data-session-id="${s.id}">
          <span>${formatDate(s.date, 'short')}</span>
          <span class="session-pages">${s.pagesStarted != null && s.pagesEnded != null ? `p. ${s.pagesStarted}–${s.pagesEnded}` : ''}</span>
          <span class="session-minutes">${s.minutes ? s.minutes + ' min' : ''}</span>
          <button class="remove-btn" data-remove-session="${s.id}" style="opacity:0.5;">✕</button>
        </div>`).join('') : ''}
      <div class="add-inline-form">
        <div class="field"><label>Date</label><input type="date" class="input" id="session-date" value="${todayStr()}" style="width:150px;"></div>
        <div class="field"><label>Page from</label><input type="number" class="input" id="session-page-start" style="width:100px;"></div>
        <div class="field"><label>Page to</label><input type="number" class="input" id="session-page-end" style="width:100px;"></div>
        <div class="field"><label>Minutes</label><input type="number" class="input" id="session-minutes" style="width:100px;"></div>
        <button class="btn btn-sm" id="add-session-btn">+ Add Session</button>
      </div>`;
  }

  function ratingReviewSectionHTML() {
    return `
      <div class="book-section">
        <h2>Rating &amp; Review</h2>
        <div id="rating-input-mount" style="margin-bottom:18px;"></div>
        <textarea class="textarea" id="review-textarea" placeholder="What did you think?" style="min-height:130px;">${escapeHtml(staged.review)}</textarea>
      </div>`;
  }

  function quotesSectionHTML() {
    return `
      <div class="book-section">
        <h2>Favourite Quotes</h2>
        <div id="quotes-list">
          ${quotes.map((q) => quoteItemHTML(q)).join('')}
        </div>
        <button type="button" class="btn btn-sm" id="add-quote-toggle-btn">+ Add Quote</button>
        <div class="add-quote-form" id="add-quote-form" hidden>
          <textarea class="textarea" id="quote-text-input" placeholder="Type or paste a quote…" style="min-height:70px;"></textarea>
          <div class="form-row" style="margin-top:8px;">
            <div class="field" style="max-width:100px;"><label>Page</label><input type="number" class="input" id="quote-page-input"></div>
          </div>
          <div style="display:flex;gap:8px;margin-top:10px;">
            <button class="btn btn-sm btn-primary" id="save-quote-btn">Save Quote</button>
            <button class="btn btn-sm btn-ghost" id="cancel-quote-btn">Cancel</button>
          </div>
        </div>
      </div>`;
  }

  function quoteItemHTML(q) {
    return `
      <div class="quote-item" data-quote-id="${q.id}">
        <p class="quote-text">"${escapeHtml(q.text)}"</p>
        ${q.pageNumber ? `<div class="quote-page">p. ${q.pageNumber}</div>` : ''}
        <div class="quote-actions">
          <button class="link-btn" data-edit-quote="${q.id}">Edit</button>
          <button class="link-btn" data-delete-quote="${q.id}">Delete</button>
        </div>
      </div>`;
  }

  function quoteEditFormHTML(q) {
    return `
      <div class="quote-item editing" data-quote-id="${q.id}">
        <textarea class="textarea" id="edit-quote-text-${q.id}" style="min-height:70px;">${escapeHtml(q.text)}</textarea>
        <div class="form-row" style="margin-top:8px;">
          <div class="field" style="max-width:100px;"><label>Page</label><input type="number" class="input" id="edit-quote-page-${q.id}" value="${q.pageNumber || ''}"></div>
        </div>
        <div style="display:flex;gap:8px;margin-top:10px;">
          <button class="btn btn-sm btn-primary" data-save-quote-edit="${q.id}">Save</button>
          <button class="btn btn-sm btn-ghost" data-cancel-quote-edit="${q.id}">Cancel</button>
        </div>
      </div>`;
  }

  function tagsSectionHTML() {
    return `
      <div class="book-section">
        <h2>Tags</h2>
        <div class="chip-row">
          ${(entry.tags || []).map((t) => `<span class="chip removable">${escapeHtml(t)}<button data-remove-tag="${escapeHtml(t)}">&times;</button></span>`).join('')}
          <button type="button" class="chip" id="add-tag-chip">+ Add Tag</button>
        </div>
        <div class="inline-reveal-form" id="add-tag-inline" hidden>
          <input class="input" id="tag-input" placeholder="Tag name" style="max-width:160px;">
          <button class="btn btn-sm btn-primary" id="confirm-tag-btn">Add</button>
        </div>
      </div>`;
  }

  function collectionsSectionHTML() {
    return `
      <div class="book-section">
        <h2>Collections</h2>
        <div class="chip-row">
          ${allCollections.map((c) => `<button type="button" class="chip ${myCollectionIds.has(c.id) ? 'active' : ''}" data-collection-toggle="${c.id}">${myCollectionIds.has(c.id) ? '✓ ' : ''}${escapeHtml(c.name)}</button>`).join('')}
          <button type="button" class="chip" id="new-collection-chip">+ New Collection</button>
        </div>
        <div class="inline-reveal-form" id="new-collection-inline" hidden>
          <input class="input" id="new-collection-input" placeholder="Collection name" style="max-width:200px;">
          <button class="btn btn-sm btn-primary" id="confirm-new-collection-btn">Create</button>
        </div>
      </div>`;
  }

  function dangerZoneHTML() {
    return `
      <div class="danger-zone">
        <button class="btn btn-ghost btn-danger btn-sm" id="remove-book-btn">Remove from Library</button>
      </div>`;
  }

  function saveBarHTML() {
    return `
      <div class="save-bar">
        <span class="save-bar-hint" id="save-bar-hint">${isDirty() ? 'You have unsaved changes' : 'No changes to save'}</span>
        <button class="btn btn-primary btn-lg" id="save-changes-btn" ${isDirty() ? '' : 'disabled'}>Save Changes</button>
      </div>`;
  }

  // ---------------------------------------------------------
  // Events
  // ---------------------------------------------------------

  function syncSaveBar() {
    const dirty = isDirty();
    root.querySelector('#save-changes-btn').disabled = !dirty;
    root.querySelector('#save-bar-hint').textContent = dirty ? 'You have unsaved changes' : 'No changes to save';
  }

  function wireEvents() {
    mountStarInput(root.querySelector('#rating-input-mount'), {
      value: staged.rating,
      onChange: (v) => { staged.rating = v; syncSaveBar(); },
    });

    root.querySelector('#status-select').addEventListener('change', async (e) => {
      const newStatus = e.target.value;
      let patch = { status: newStatus };
      if (isDirty()) {
        patch = {
          format: staged.format, dateStarted: staged.dateStarted || null,
          dateFinished: staged.dateFinished || null, rating: staged.rating || null,
          review: staged.review, ...patch,
        };
      }
      if (newStatus === 'finished') {
        const rating = await promptFinishedRating(book);
        if (rating) patch.rating = rating;
      }
      await updateEntry(patch);
      await refresh();
      toast(`Marked as ${STATUS_LABELS[newStatus]}`);
    });

    root.querySelector('#format-select').addEventListener('change', (e) => { staged.format = e.target.value; syncSaveBar(); });
    root.querySelector('#date-started').addEventListener('change', (e) => { staged.dateStarted = e.target.value; syncSaveBar(); });
    root.querySelector('#date-finished').addEventListener('change', (e) => { staged.dateFinished = e.target.value; syncSaveBar(); });
    root.querySelector('#review-textarea').addEventListener('input', (e) => { staged.review = e.target.value; syncSaveBar(); });

    root.querySelectorAll('[data-today-for]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const input = root.querySelector(`#${btn.dataset.todayFor}`);
        input.value = todayStr();
        input.dispatchEvent(new Event('change'));
      });
    });

    root.querySelector('#save-changes-btn').addEventListener('click', async () => {
      await updateEntry({
        format: staged.format,
        dateStarted: staged.dateStarted || null,
        dateFinished: staged.dateFinished || null,
        rating: staged.rating || null,
        review: staged.review,
      });
      baseline = { ...staged };
      syncSaveBar();
      toast('Changes saved');
    });

    const descToggle = root.querySelector('#description-toggle');
    if (descToggle) {
      descToggle.addEventListener('click', () => {
        const el = root.querySelector('#description-text');
        el.classList.toggle('clamped');
        descToggle.textContent = el.classList.contains('clamped') ? 'Read more' : 'Show less';
      });
    }

    const logBtn = root.querySelector('#log-progress-btn');
    if (logBtn) {
      logBtn.addEventListener('click', async () => {
        const pageVal = root.querySelector('#progress-page-input').value;
        const pctVal = root.querySelector('#progress-percent-input').value;
        const date = root.querySelector('#progress-date-input').value || todayStr();
        if (!pageVal && !pctVal) { toast('Enter a page number or percent'); return; }
        entry = await logProgressUpdate(entry, book, { currentPage: pageVal, percent: pctVal, date });
        await refresh();
        toast('Progress logged');
      });
    }

    const suggestFinish = root.querySelector('#suggest-finish-chip');
    if (suggestFinish) {
      suggestFinish.addEventListener('click', async () => {
        const rating = await promptFinishedRating(book);
        const patch = { status: 'finished' };
        if (rating) patch.rating = rating;
        await updateEntry(patch);
        await refresh();
        toast('Marked as Finished 🎉');
      });
    }

    root.querySelectorAll('[data-remove-progress]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await Storage.ProgressUpdates.remove(btn.dataset.removeProgress);
        await refresh();
      });
    });

    const addSessionBtn = root.querySelector('#add-session-btn');
    if (addSessionBtn) {
      addSessionBtn.addEventListener('click', async () => {
        const date = root.querySelector('#session-date').value || todayStr();
        const pagesStarted = root.querySelector('#session-page-start').value;
        const pagesEnded = root.querySelector('#session-page-end').value;
        const minutes = root.querySelector('#session-minutes').value;
        await Storage.ReadingSessions.add(entry.id, {
          date,
          pagesStarted: pagesStarted ? Number(pagesStarted) : null,
          pagesEnded: pagesEnded ? Number(pagesEnded) : null,
          minutes: minutes ? Number(minutes) : null,
        });
        await refresh();
        toast('Session logged');
      });
    }
    root.querySelectorAll('[data-remove-session]').forEach((btn) => {
      btn.addEventListener('click', async () => { await Storage.ReadingSessions.remove(btn.dataset.removeSession); await refresh(); });
    });

    // ---- quotes ----
    const addQuoteToggle = root.querySelector('#add-quote-toggle-btn');
    const addQuoteForm = root.querySelector('#add-quote-form');
    addQuoteToggle.addEventListener('click', () => {
      addQuoteForm.hidden = false;
      addQuoteToggle.hidden = true;
      root.querySelector('#quote-text-input').focus();
    });
    root.querySelector('#cancel-quote-btn').addEventListener('click', () => {
      addQuoteForm.hidden = true;
      addQuoteToggle.hidden = false;
    });
    root.querySelector('#save-quote-btn').addEventListener('click', async () => {
      const text = root.querySelector('#quote-text-input').value.trim();
      if (!text) return;
      const pageNumber = root.querySelector('#quote-page-input').value;
      await Storage.Quotes.add(entry.id, { text, pageNumber: pageNumber ? Number(pageNumber) : null });
      await refresh();
    });
    root.querySelectorAll('[data-delete-quote]').forEach((btn) => {
      btn.addEventListener('click', async () => { await Storage.Quotes.remove(btn.dataset.deleteQuote); await refresh(); });
    });
    root.querySelectorAll('[data-edit-quote]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.editQuote;
        const q = quotes.find((x) => x.id === id);
        const item = root.querySelector(`.quote-item[data-quote-id="${id}"]`);
        item.outerHTML = quoteEditFormHTML(q);
        wireQuoteEditForm(id);
      });
    });

    function wireQuoteEditForm(id) {
      root.querySelector(`[data-save-quote-edit="${id}"]`).addEventListener('click', async () => {
        const text = root.querySelector(`#edit-quote-text-${id}`).value.trim();
        if (!text) return;
        const pageNumber = root.querySelector(`#edit-quote-page-${id}`).value;
        await Storage.Quotes.update(id, { text, pageNumber: pageNumber ? Number(pageNumber) : null });
        await refresh();
      });
      root.querySelector(`[data-cancel-quote-edit="${id}"]`).addEventListener('click', () => refresh());
    }

    // ---- tags ----
    const addTagChip = root.querySelector('#add-tag-chip');
    const addTagInline = root.querySelector('#add-tag-inline');
    addTagChip.addEventListener('click', () => {
      addTagInline.hidden = false;
      addTagChip.hidden = true;
      root.querySelector('#tag-input').focus();
    });
    async function commitTag() {
      const tagInput = root.querySelector('#tag-input');
      const val = tagInput.value.trim();
      if (!val) return;
      const tags = new Set(entry.tags || []);
      tags.add(val);
      await updateEntry({ tags: [...tags] });
      await refresh();
    }
    root.querySelector('#confirm-tag-btn').addEventListener('click', commitTag);
    root.querySelector('#tag-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commitTag(); } });
    root.querySelectorAll('[data-remove-tag]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const tags = (entry.tags || []).filter((t) => t !== btn.dataset.removeTag);
        await updateEntry({ tags });
        await refresh();
      });
    });

    // ---- collections ----
    root.querySelectorAll('[data-collection-toggle]').forEach((chip) => {
      chip.addEventListener('click', async () => {
        const id = chip.dataset.collectionToggle;
        const active = chip.classList.contains('active');
        if (active) await Storage.Collections.removeBook(id, entry.id);
        else await Storage.Collections.addBook(id, entry.id);
        toast(active ? 'Removed from collection' : 'Added to collection');
        await refresh();
      });
    });
    const newCollectionChip = root.querySelector('#new-collection-chip');
    const newCollectionInline = root.querySelector('#new-collection-inline');
    newCollectionChip.addEventListener('click', () => {
      newCollectionInline.hidden = false;
      newCollectionChip.hidden = true;
      root.querySelector('#new-collection-input').focus();
    });
    async function commitNewCollection() {
      const input = root.querySelector('#new-collection-input');
      const name = input.value.trim();
      if (!name) return;
      const c = await Storage.Collections.create({ name });
      await Storage.Collections.addBook(c.id, entry.id);
      await refresh();
      toast(`Created "${name}"`);
    }
    root.querySelector('#confirm-new-collection-btn').addEventListener('click', commitNewCollection);
    root.querySelector('#new-collection-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commitNewCollection(); } });

    root.querySelector('#remove-book-btn').addEventListener('click', async () => {
      if (!confirm(`Remove "${book.title}" from your library? This deletes all your reading data for this book.`)) return;
      await Storage.ReadingEntries.remove(entry.id);
      await Storage.Covers.remove(book.id);
      await Storage.Books.remove(book.id);
      window.location.href = 'library.html';
    });
  }

  const ok = await loadAll();
  if (!ok) {
    root.innerHTML = `<div class="empty-state"><h3>Book not found</h3><p><a href="library.html">Back to Library →</a></p></div>`;
  } else {
    render();
  }
})();
