/* ============================================================
   book-preview.js — a read-only "tell me more about this book"
   panel for external search results. Browsing and adding are
   deliberately separate: this view never adds anything to the
   library on its own — it just surfaces info, with an explicit
   "+ Add to Library" action that hands off to AddBookFlow.
   ============================================================ */

const BookPreviewFlow = (() => {
  let overlay, modal;

  function ensureModal() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `<div class="modal" role="dialog" aria-modal="true"></div>`;
    document.body.appendChild(overlay);
    modal = overlay.querySelector('.modal');
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  }

  function close() {
    overlay.classList.remove('open');
    setTimeout(() => { modal.innerHTML = ''; }, 200);
  }

  // Guards against a slow lookup from a previously-opened book landing in
  // the modal after it's been reopened for a different one.
  let openToken = 0;

  async function open(result) {
    const token = ++openToken;
    ensureModal();
    // Resolved up front so the very first paint already says "In your
    // library" instead of flashing an Add button for a book you own.
    let owned = null;
    try { owned = buildOwnedMatcher(await Storage.Books.getAll())(result); } catch (e) {}
    if (token !== openToken) return;
    render(result, { description: '', genres: [] }, true, owned);
    overlay.classList.add('open');

    // Started in parallel with the description fetch, but never awaited
    // before rendering — a slow rating lookup shouldn't hold up the synopsis.
    const ratingPromise = typeof Reviews !== 'undefined' ? Reviews.fetchRating(result) : Promise.resolve(null);

    let details = { description: '', genres: [] };
    try { details = await BooksAPI.getDetails(result.externalId); } catch (e) {}
    if (token !== openToken) return;
    render(result, details, false, owned);

    const rating = await ratingPromise;
    if (token !== openToken || !rating) return;
    const mount = modal.querySelector('#bp-hardcover-mount');
    if (mount) mount.innerHTML = Reviews.ratingHTML(rating);
  }

  function render(result, details, loading, owned) {
    const cover = result.coverUrlLarge || result.coverUrl
      ? `<img src="${escapeHtml(result.coverUrlLarge || result.coverUrl)}" alt="">`
      : coverFallbackHTML(result.title);
    const metaBits = [
      result.firstPublishYear,
      result.pageCount ? `${result.pageCount} pages` : null,
      result.isbn13 || result.isbn10 || null,
      result.editionCount ? `${result.editionCount} edition${result.editionCount > 1 ? 's' : ''}` : null,
    ].filter(Boolean).join(' · ');
    const genres = (details.genres || []).filter((g) => !g.includes(':')).slice(0, 8);

    modal.innerHTML = `
      <div class="modal-header">
        <h3>Book Info</h3>
        <button class="btn btn-ghost btn-icon" id="bp-close">${ICONS.close}</button>
      </div>
      <div class="modal-body">
        <div class="ab-preview-row" style="align-items:flex-start;">
          <div class="cover-wrap" style="width:100px;">${cover}</div>
          <div>
            <div class="title" style="font-size:17px;">${escapeHtml(result.title)}</div>
            ${result.subtitle ? `<div class="sub">${escapeHtml(result.subtitle)}</div>` : ''}
            <div class="sub" style="margin-top:4px;">${escapeHtml(authorList(result.authors))}</div>
            <div class="sub">${escapeHtml(metaBits)}</div>
            <div class="sub" id="bp-hardcover-mount"></div>
          </div>
        </div>
        ${genres.length ? `<div class="chip-row" style="margin-top:14px;">${genres.map((g) => `<span class="chip">${escapeHtml(g)}</span>`).join('')}</div>` : ''}
        <div style="margin-top:16px;">
          <div class="eyebrow">Synopsis</div>
          <p class="description-text" style="margin-top:8px;">${loading ? 'Loading description…' : escapeHtml(details.description) || 'No description available.'}</p>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" id="bp-close-2">Close</button>
        ${owned
          ? `<button class="btn btn-primary" id="bp-view-btn">View in Library →</button>`
          : `<button class="btn btn-primary" id="bp-add-btn">+ Add to Library</button>`}
      </div>`;

    modal.querySelector('#bp-close').addEventListener('click', close);
    modal.querySelector('#bp-close-2').addEventListener('click', close);
    if (owned) {
      modal.querySelector('#bp-view-btn').addEventListener('click', () => {
        window.location.href = `book.html?id=${owned.id}`;
      });
    } else {
      modal.querySelector('#bp-add-btn').addEventListener('click', () => {
        close();
        setTimeout(() => AddBookFlow.openWithResult(result), 210);
      });
    }
  }

  return { open, close };
})();
