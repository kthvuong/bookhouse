/* ============================================================
   collection.js — single collection detail
   ============================================================ */

(async function () {
  initHeader('collections');
  const root = document.getElementById('collection-root');
  const collectionId = getQueryParam('id');

  async function render() {
    const collection = await Storage.Collections.get(collectionId);
    if (!collection) {
      root.innerHTML = `<div class="empty-state"><h3>Collection not found</h3><p><a href="collections.html">Back to Collections →</a></p></div>`;
      return;
    }
    const items = await Storage.Collections.itemsFor(collectionId);
    const entries = (await Promise.all(items.map((i) => Storage.ReadingEntries.get(i.readingEntryId)))).filter(Boolean);
    const withBooks = await Storage.ReadingEntries.listWithBooks(entries);

    root.innerHTML = `
      <div class="collection-detail-header page-header">
        <div>
          <h1 class="page-title serif" contenteditable="true" id="collection-name">${escapeHtml(collection.name)}</h1>
          <p class="page-subtitle" contenteditable="true" id="collection-desc" data-placeholder="Add a description…">${escapeHtml(collection.description || '')}</p>
        </div>
        <div style="display:flex;gap:10px;">
          <button class="btn btn-sm" id="add-books-btn">+ Add Books</button>
          <button class="btn btn-sm btn-ghost btn-danger" id="delete-collection-btn">Delete Collection</button>
        </div>
      </div>
      <div class="cover-grid" id="collection-grid" style="margin-top:24px;"></div>
    `;

    const grid = document.getElementById('collection-grid');
    if (!withBooks.length) {
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><p>No books in this collection yet.</p></div>`;
    } else {
      await renderCardList(grid, withBooks);
    }

    document.getElementById('collection-name').addEventListener('blur', async (e) => {
      await Storage.Collections.update(collectionId, { name: e.target.textContent.trim() || 'Untitled' });
    });
    document.getElementById('collection-desc').addEventListener('blur', async (e) => {
      await Storage.Collections.update(collectionId, { description: e.target.textContent.trim() });
    });
    document.getElementById('delete-collection-btn').addEventListener('click', async () => {
      if (!confirm(`Delete "${collection.name}"? This won't remove the books from your library.`)) return;
      await Storage.Collections.remove(collectionId);
      window.location.href = 'collections.html';
    });
    document.getElementById('add-books-btn').addEventListener('click', () => openAddBooksModal(withBooks.map((e) => e.id)));
  }

  let modal;
  async function openAddBooksModal(existingEntryIds) {
    if (!modal) {
      modal = document.createElement('div');
      modal.className = 'modal-overlay';
      modal.innerHTML = `<div class="modal"><div class="modal-header"><h3>Add Books to Collection</h3><button class="btn btn-ghost btn-icon" id="add-books-close">✕</button></div><div class="modal-body" id="add-books-body"></div></div>`;
      document.body.appendChild(modal);
      modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('open'); });
      modal.querySelector('#add-books-close').addEventListener('click', () => modal.classList.remove('open'));
    }
    const all = (await Storage.ReadingEntries.allWithBooks()).filter((e) => e.book && !existingEntryIds.includes(e.id));
    const body = modal.querySelector('#add-books-body');
    if (!all.length) {
      body.innerHTML = `<p class="text-muted">Every book in your library is already in this collection.</p>`;
    } else {
      body.innerHTML = all.map((e) => `
        <div class="search-result-row" data-add-entry="${e.id}">
          ${e.book.coverUrl ? `<img class="thumb" src="${escapeHtml(e.book.coverUrl)}">` : '<span class="thumb"></span>'}
          <div class="meta"><div class="title">${escapeHtml(e.book.title)}</div><div class="sub">${escapeHtml(authorList(e.book.authors))}</div></div>
          <button class="btn btn-sm" data-add-entry-btn="${e.id}">+ Add</button>
        </div>`).join('');
      body.querySelectorAll('[data-add-entry-btn]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          await Storage.Collections.addBook(collectionId, btn.dataset.addEntryBtn);
          btn.outerHTML = `<span class="in-library-badge">Added</span>`;
        });
      });
    }
    modal.classList.add('open');
    modal.addEventListener('transitionend', function reload() {
      if (!modal.classList.contains('open')) { render(); modal.removeEventListener('transitionend', reload); }
    });
  }

  render();
})();
