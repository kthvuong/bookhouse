/* ============================================================
   book.js — book detail page: status, rating, progress tracking,
   sessions, review, notes, quotes, tags, collections.
   ============================================================ */

(async function () {
  initHeader('library');

  const root = document.getElementById('book-root');
  const bookId = getQueryParam('id');

  let book, entry, progressUpdates, sessions, quotes, allCollections, myCollectionIds;

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
      ${progressSectionHTML()}
      ${sessionsSectionHTML()}
      ${reviewSectionHTML()}
      ${notesSectionHTML()}
      ${quotesSectionHTML()}
      ${tagsSectionHTML()}
      ${collectionsSectionHTML()}
      ${dangerZoneHTML()}
    `;
    wireEvents();
    fillCoverAsync();
  }

  async function fillCoverAsync() {
    const wrap = root.querySelector('#book-cover-wrap');
    if (!wrap) return;
    wrap.innerHTML = await coverMarkup(book);
  }

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
                  ${Object.entries(FORMAT_LABELS).map(([v, l]) => `<option value="${v}" ${entry.format === v ? 'selected' : ''}>${l}</option>`).join('')}
                </select>
              </div>
            </div>
          </div>

          <div class="control-row">
            <div id="rating-input-mount"></div>
          </div>

          <div class="control-row">
            <div class="field-inline"><label class="mini">Started</label><input type="date" class="input" id="date-started" value="${entry.dateStarted || ''}" style="width:150px;"></div>
            <div class="field-inline"><label class="mini">Finished</label><input type="date" class="input" id="date-finished" value="${entry.dateFinished || ''}" style="width:150px;"></div>
          </div>

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

  function progressSectionHTML() {
    const applicable = ['currently_reading', 'paused', 'finished'].includes(entry.status);
    if (!applicable) return '';
    const stats = computeProgressStats(entry, progressUpdates, book);
    const showSuggestFinish = entry.status !== 'finished' && stats.percent >= 100;
    return `
      <div class="book-section progress-panel">
        <h2>Reading Progress</h2>
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
          <button class="btn btn-primary" id="log-progress-btn">Log Progress</button>
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
        </div>` : ''}
      </div>`;
  }

  function sessionsSectionHTML() {
    return `
      <div class="book-section">
        <h2>Reading Sessions</h2>
        <p class="text-muted" style="font-size:13px;margin-bottom:10px;">Optional — log individual sessions to power pace &amp; streak stats.</p>
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
        </div>
      </div>`;
  }

  function reviewSectionHTML() {
    return `
      <div class="book-section">
        <h2>My Review</h2>
        <textarea class="textarea" id="review-textarea" placeholder="What did you think?" style="min-height:130px;">${escapeHtml(entry.review || '')}</textarea>
      </div>`;
  }

  function notesSectionHTML() {
    return `
      <div class="book-section">
        <h2>Private Notes</h2>
        <textarea class="textarea" id="notes-textarea" placeholder="Notes just for you — never shown anywhere else." style="min-height:100px;">${escapeHtml(entry.privateNotes || '')}</textarea>
      </div>`;
  }

  function quotesSectionHTML() {
    return `
      <div class="book-section">
        <h2>Favourite Quotes</h2>
        ${quotes.map((q) => `
          <div class="quote-card" data-quote-id="${q.id}">
            <button class="remove-btn" data-remove-quote="${q.id}">Remove</button>
            "${escapeHtml(q.text)}"
            ${q.pageNumber ? `<div class="quote-page">p. ${q.pageNumber}</div>` : ''}
          </div>`).join('')}
        <div class="add-inline-form">
          <div class="field" style="flex:1;min-width:220px;"><label>Quote</label><input class="input" id="quote-text-input" placeholder="Type or paste a quote…"></div>
          <div class="field"><label>Page</label><input type="number" class="input" id="quote-page-input" style="width:90px;"></div>
          <button class="btn btn-sm" id="add-quote-btn">+ Add Quote</button>
        </div>
      </div>`;
  }

  function tagsSectionHTML() {
    return `
      <div class="book-section">
        <h2>Tags</h2>
        <div class="chip-row" id="tag-chip-row">
          ${(entry.tags || []).map((t) => `<span class="chip removable">${escapeHtml(t)}<button data-remove-tag="${escapeHtml(t)}">&times;</button></span>`).join('')}
        </div>
        <div class="tag-input-row">
          <input class="input" id="tag-input" placeholder="Add a tag and press Enter">
        </div>
      </div>`;
  }

  function collectionsSectionHTML() {
    return `
      <div class="book-section">
        <h2>Collections</h2>
        ${allCollections.length ? `<div class="collection-checklist">
          ${allCollections.map((c) => `
            <label><input type="checkbox" data-collection-id="${c.id}" ${myCollectionIds.has(c.id) ? 'checked' : ''}> ${escapeHtml(c.name)}</label>
          `).join('')}
        </div>` : `<p class="text-muted" style="font-size:13.5px;">No collections yet.</p>`}
        <div class="add-inline-form">
          <div class="field"><label>New collection</label><input class="input" id="new-collection-input" placeholder="e.g. Comfort Reads" style="width:200px;"></div>
          <button class="btn btn-sm" id="add-collection-btn">+ Create</button>
        </div>
      </div>`;
  }

  function dangerZoneHTML() {
    return `
      <div class="danger-zone">
        <button class="btn btn-ghost btn-danger btn-sm" id="remove-book-btn">Remove from Library</button>
      </div>`;
  }

  function wireEvents() {
    mountStarInput(root.querySelector('#rating-input-mount'), {
      value: entry.rating || 0,
      onChange: async (v) => { await updateEntry({ rating: v }); },
    });

    root.querySelector('#status-select').addEventListener('change', async (e) => {
      const newStatus = e.target.value;
      if (newStatus === 'finished') {
        const rating = await promptFinishedRating(book);
        const patch = { status: newStatus };
        if (rating) patch.rating = rating;
        await updateEntry(patch);
      } else {
        await updateEntry({ status: newStatus });
      }
      await refresh();
      toast(`Marked as ${STATUS_LABELS[newStatus]}`);
    });

    root.querySelector('#format-select').addEventListener('change', async (e) => {
      await updateEntry({ format: e.target.value });
    });

    root.querySelector('#date-started').addEventListener('change', async (e) => {
      await updateEntry({ dateStarted: e.target.value || null });
    });
    root.querySelector('#date-finished').addEventListener('change', async (e) => {
      await updateEntry({ dateFinished: e.target.value || null });
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

    root.querySelector('#review-textarea').addEventListener('blur', async (e) => {
      await updateEntry({ review: e.target.value });
      toast('Review saved');
    });
    root.querySelector('#notes-textarea').addEventListener('blur', async (e) => {
      await updateEntry({ privateNotes: e.target.value });
      toast('Notes saved');
    });

    root.querySelector('#add-quote-btn').addEventListener('click', async () => {
      const text = root.querySelector('#quote-text-input').value.trim();
      if (!text) return;
      const pageNumber = root.querySelector('#quote-page-input').value;
      await Storage.Quotes.add(entry.id, { text, pageNumber: pageNumber ? Number(pageNumber) : null });
      await refresh();
    });
    root.querySelectorAll('[data-remove-quote]').forEach((btn) => {
      btn.addEventListener('click', async () => { await Storage.Quotes.remove(btn.dataset.removeQuote); await refresh(); });
    });

    const tagInput = root.querySelector('#tag-input');
    tagInput.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const val = tagInput.value.trim();
      if (!val) return;
      const tags = new Set(entry.tags || []);
      tags.add(val);
      await updateEntry({ tags: [...tags] });
      await refresh();
    });
    root.querySelectorAll('[data-remove-tag]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const tags = (entry.tags || []).filter((t) => t !== btn.dataset.removeTag);
        await updateEntry({ tags });
        await refresh();
      });
    });

    root.querySelectorAll('[data-collection-id]').forEach((cb) => {
      cb.addEventListener('change', async () => {
        if (cb.checked) await Storage.Collections.addBook(cb.dataset.collectionId, entry.id);
        else await Storage.Collections.removeBook(cb.dataset.collectionId, entry.id);
        toast(cb.checked ? 'Added to collection' : 'Removed from collection');
      });
    });
    root.querySelector('#add-collection-btn').addEventListener('click', async () => {
      const input = root.querySelector('#new-collection-input');
      const name = input.value.trim();
      if (!name) return;
      const c = await Storage.Collections.create({ name });
      await Storage.Collections.addBook(c.id, entry.id);
      await refresh();
      toast(`Created "${name}"`);
    });

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
