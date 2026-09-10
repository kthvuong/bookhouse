/* ============================================================
   collections.js — collection list + create
   ============================================================ */

(async function () {
  initHeader('collections');
  const grid = document.getElementById('collections-grid');

  async function render() {
    const collections = await Storage.Collections.getAll();
    const tiles = await Promise.all(collections.map(tileHTML));
    grid.innerHTML = tiles.join('') + `
      <div class="collection-tile new-tile" id="new-collection-tile">+ New Collection</div>`;
    grid.querySelectorAll('[data-collection-id]').forEach((el) => {
      el.addEventListener('click', () => { window.location.href = `collection.html?id=${el.dataset.collectionId}`; });
    });
    document.getElementById('new-collection-tile').addEventListener('click', async () => {
      const name = prompt('Name this collection:');
      if (!name || !name.trim()) return;
      const c = await Storage.Collections.create({ name: name.trim() });
      window.location.href = `collection.html?id=${c.id}`;
    });
  }

  async function tileHTML(collection) {
    const items = await Storage.Collections.itemsFor(collection.id);
    const entries = await Promise.all(items.slice(0, 4).map((i) => Storage.ReadingEntries.get(i.readingEntryId)));
    const books = await Promise.all(entries.filter(Boolean).map((e) => Storage.Books.get(e.bookId)));
    const covers = await Promise.all(books.filter(Boolean).map((b) => coverMarkup(b)));
    const tiles = covers.map((c) => `<div class="tile">${c}</div>`).join('') +
      Array(Math.max(0, 4 - covers.length)).fill('<div class="tile"></div>').join('');
    return `
      <div class="collection-tile" data-collection-id="${collection.id}">
        <div class="mini-collage">${tiles}</div>
        <h3 class="serif">${escapeHtml(collection.name)}</h3>
        <div class="count">${items.length} book${items.length === 1 ? '' : 's'}</div>
      </div>`;
  }

  render();
})();
