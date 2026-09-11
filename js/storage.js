/* ============================================================
   storage.js — IndexedDB persistence layer.

   Schema (deliberately denormalized where a join would add
   complexity without real benefit at personal-library scale):

   books              external/manual bibliographic metadata
   readingEntries     ALL personal data for one tracked book (1:1 with books)
   progressUpdates    page/percent snapshots over time, per reading entry
   readingSessions    optional session logs (date, pages, minutes)
   quotes             favourite quotes, per reading entry
   collections        named custom lists
   collectionItems    join: collectionId <-> readingEntryId (+ sortOrder)
   goals              annual reading goals, keyed by year
   wrapped            manual yearly superlative picks (favourite book, etc.),
                      keyed by year — shown on the Statistics page
   covers             cached cover image blobs, keyed by bookId

   Everything is exposed on the global `Storage` namespace.

   Cross-device sync (js/sync.js) hooks in here rather than in each
   namespace above: open() pulls the latest cloud snapshot once per
   page load (before anything reads the DB) if Sync is configured and
   newer than what's local, and put()/remove()/clearStore() schedule a
   debounced push after any write — so every Storage.* method gets
   sync for free without being touched individually. Covers aren't
   synced (blobs stay device-local); everything else round-trips
   through the same exportAll()/importAll() shape used by the manual
   JSON backup in Settings.
   ============================================================ */

const Storage = (() => {
  const DB_NAME = 'reading-tracker';
  const DB_VERSION = 1;
  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (e) => {
        const db = e.target.result;

        const books = db.createObjectStore('books', { keyPath: 'id' });
        books.createIndex('isbn13', 'isbn13', { unique: false });
        books.createIndex('title', 'title', { unique: false });

        const entries = db.createObjectStore('readingEntries', { keyPath: 'id' });
        entries.createIndex('bookId', 'bookId', { unique: true });
        entries.createIndex('status', 'status', { unique: false });
        entries.createIndex('dateFinished', 'dateFinished', { unique: false });
        entries.createIndex('sortOrder', 'sortOrder', { unique: false });

        const progress = db.createObjectStore('progressUpdates', { keyPath: 'id' });
        progress.createIndex('readingEntryId', 'readingEntryId', { unique: false });

        const sessions = db.createObjectStore('readingSessions', { keyPath: 'id' });
        sessions.createIndex('readingEntryId', 'readingEntryId', { unique: false });
        sessions.createIndex('date', 'date', { unique: false });

        const quotes = db.createObjectStore('quotes', { keyPath: 'id' });
        quotes.createIndex('readingEntryId', 'readingEntryId', { unique: false });

        db.createObjectStore('collections', { keyPath: 'id' });

        const collectionItems = db.createObjectStore('collectionItems', { keyPath: 'id' });
        collectionItems.createIndex('collectionId', 'collectionId', { unique: false });
        collectionItems.createIndex('readingEntryId', 'readingEntryId', { unique: false });

        db.createObjectStore('goals', { keyPath: 'id' });
        db.createObjectStore('wrapped', { keyPath: 'id' });
        db.createObjectStore('covers', { keyPath: 'bookId' });
      };

      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = (e) => reject(e.target.error);
    });
    return dbPromise;
  }

  const SYNCED_STORES = [
    'books', 'readingEntries', 'progressUpdates', 'readingSessions',
    'quotes', 'collections', 'collectionItems', 'goals', 'wrapped',
  ];

  // Applies a pulled snapshot directly against the raw IDB handle (not
  // through put()/clearStore() below) so this can run from inside ready()
  // itself without recursing back into ready() through tx().
  function applySnapshotRaw(db, data) {
    return new Promise((resolve, reject) => {
      const t = db.transaction(SYNCED_STORES, 'readwrite');
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      SYNCED_STORES.forEach((name) => {
        const store = t.objectStore(name);
        store.clear();
        (data[name] || []).forEach((row) => store.put(row));
      });
    });
  }

  // Opens the DB, then — once per page load, before anything else touches
  // it — pulls the latest cloud snapshot (if Sync is configured and newer
  // than what's local) so every page starts from the same data regardless
  // of which device last wrote it. Falls back to local data silently if
  // Sync isn't set up or the network request fails.
  // `Sync` (js/sync.js) is declared with `const` at global scope, which —
  // unlike `var`/function declarations — does NOT attach to `window`, so
  // this must check the bare identifier via `typeof`, never `window.Sync`.
  function syncAvailable() {
    return typeof Sync !== 'undefined' && Sync.isConfigured();
  }

  let readyPromise = null;
  function open() {
    if (readyPromise) return readyPromise;
    readyPromise = openDB().then(async (db) => {
      if (syncAvailable()) {
        try {
          const remote = await Sync.fetchRemote();
          const localWatermark = Sync.getLastSyncedAt();
          if (remote && remote.data && (!localWatermark || remote.updatedAt > localWatermark)) {
            await applySnapshotRaw(db, remote.data);
            Sync.recordSyncedAt(remote.updatedAt);
          }
        } catch (e) {
          console.warn('Sync pull skipped:', e.message);
        }
      }
      return db;
    });
    return readyPromise;
  }

  // Batches rapid successive writes into one push a couple seconds after
  // the last one, instead of a network round-trip per keystroke/click.
  let pushTimer = null;
  function scheduleAutoPush() {
    if (!syncAvailable()) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(async () => {
      try {
        const snapshot = await exportAll();
        delete snapshot.covers;
        const { updatedAt } = await Sync.pushSnapshot(snapshot);
        Sync.recordSyncedAt(updatedAt);
      } catch (e) {
        console.warn('Auto-sync push failed:', e.message);
      }
    }, 2500);
  }

  function tx(storeNames, mode = 'readonly') {
    return open().then((db) => db.transaction(storeNames, mode));
  }

  function reqToPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function put(storeName, value) {
    return tx(storeName, 'readwrite').then((t) => {
      const store = t.objectStore(storeName);
      return reqToPromise(store.put(value)).then(() => {
        scheduleAutoPush();
        return value;
      });
    });
  }

  function get(storeName, key) {
    return tx(storeName).then((t) => reqToPromise(t.objectStore(storeName).get(key)));
  }

  function getAll(storeName) {
    return tx(storeName).then((t) => reqToPromise(t.objectStore(storeName).getAll()));
  }

  function getAllByIndex(storeName, indexName, value) {
    return tx(storeName).then((t) =>
      reqToPromise(t.objectStore(storeName).index(indexName).getAll(value))
    );
  }

  function remove(storeName, key) {
    return tx(storeName, 'readwrite').then((t) =>
      reqToPromise(t.objectStore(storeName).delete(key)).then(() => scheduleAutoPush())
    );
  }

  function removeWhere(storeName, indexName, value) {
    return getAllByIndex(storeName, indexName, value).then((rows) =>
      Promise.all(rows.map((r) => remove(storeName, r.id)))
    );
  }

  function clearStore(storeName) {
    return tx(storeName, 'readwrite').then((t) =>
      reqToPromise(t.objectStore(storeName).clear()).then(() => scheduleAutoPush())
    );
  }

  function uid() {
    return (
      Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9)
    );
  }

  const nowIso = () => new Date().toISOString();

  // ---------------------------------------------------------
  // Domain helpers
  // ---------------------------------------------------------

  const Books = {
    async create(book) {
      const record = {
        id: uid(),
        source: book.source || 'manual',
        externalId: book.externalId || null,
        title: book.title || 'Untitled',
        subtitle: book.subtitle || '',
        authors: book.authors || [],
        isbn10: book.isbn10 || '',
        isbn13: book.isbn13 || '',
        firstPublishYear: book.firstPublishYear || null,
        description: book.description || '',
        pageCount: book.pageCount || null,
        genres: book.genres || [],
        coverUrl: book.coverUrl || '',
        hasCachedCover: false,
        createdAt: nowIso(),
      };
      await put('books', record);
      return record;
    },
    get: (id) => get('books', id),
    getAll: () => getAll('books'),
    update: (id, patch) =>
      get('books', id).then((b) => (b ? put('books', { ...b, ...patch }) : null)),
    remove: (id) => remove('books', id),
  };

  const Covers = {
    async save(bookId, blob, remoteUrl) {
      await put('covers', { bookId, blob, remoteUrl: remoteUrl || '' });
      await Books.update(bookId, { hasCachedCover: true });
    },
    get: (bookId) => get('covers', bookId),
    async getObjectUrl(bookId) {
      const rec = await get('covers', bookId);
      if (!rec || !rec.blob) return null;
      return URL.createObjectURL(rec.blob);
    },
    remove: (bookId) => remove('covers', bookId),
  };

  const ReadingEntries = {
    async create(entry) {
      const record = {
        id: uid(),
        bookId: entry.bookId,
        status: entry.status || 'want_to_read',
        format: entry.format || 'physical',
        rating: entry.rating ?? null,
        review: entry.review || '',
        privateNotes: entry.privateNotes || '',
        dateStarted: entry.dateStarted || null,
        dateFinished: entry.dateFinished || null,
        currentPage: entry.currentPage || 0,
        progressPercent: entry.progressPercent || 0,
        priority: entry.priority || 'normal',
        sortOrder: entry.sortOrder ?? Date.now(),
        tags: entry.tags || [],
        addedAt: nowIso(),
        updatedAt: nowIso(),
      };
      await put('readingEntries', record);
      return record;
    },
    get: (id) => get('readingEntries', id),
    getByBookId: async (bookId) => {
      const rows = await getAllByIndex('readingEntries', 'bookId', bookId);
      return rows[0] || null;
    },
    getAll: () => getAll('readingEntries'),
    getByStatus: (status) => getAllByIndex('readingEntries', 'status', status),
    async update(id, patch) {
      const existing = await get('readingEntries', id);
      if (!existing) return null;
      const updated = { ...existing, ...patch, updatedAt: nowIso() };
      await put('readingEntries', updated);
      return updated;
    },
    async remove(id) {
      await removeWhere('progressUpdates', 'readingEntryId', id);
      await removeWhere('readingSessions', 'readingEntryId', id);
      await removeWhere('quotes', 'readingEntryId', id);
      await removeWhere('collectionItems', 'readingEntryId', id);
      await remove('readingEntries', id);
    },
    // joined view: reading entry + its book
    async withBook(entry) {
      const book = await Books.get(entry.bookId);
      return { ...entry, book };
    },
    async listWithBooks(entries) {
      const books = await Books.getAll();
      const byId = new Map(books.map((b) => [b.id, b]));
      return entries.map((e) => ({ ...e, book: byId.get(e.bookId) || null }));
    },
    async allWithBooks() {
      const [entries, books] = await Promise.all([getAll('readingEntries'), getAll('books')]);
      const byId = new Map(books.map((b) => [b.id, b]));
      return entries.map((e) => ({ ...e, book: byId.get(e.bookId) || null }));
    },
  };

  const ProgressUpdates = {
    async add(readingEntryId, { date, currentPage, percent }) {
      const record = {
        id: uid(),
        readingEntryId,
        date: date || todayStr(),
        currentPage: currentPage ?? null,
        percent: percent ?? null,
        createdAt: nowIso(),
      };
      await put('progressUpdates', record);
      return record;
    },
    listFor: (readingEntryId) =>
      getAllByIndex('progressUpdates', 'readingEntryId', readingEntryId).then((rows) =>
        rows.sort((a, b) => (a.date < b.date ? -1 : 1))
      ),
    remove: (id) => remove('progressUpdates', id),
  };

  const ReadingSessions = {
    async add(readingEntryId, { date, pagesStarted, pagesEnded, minutes }) {
      const record = {
        id: uid(),
        readingEntryId,
        date: date || todayStr(),
        pagesStarted: pagesStarted ?? null,
        pagesEnded: pagesEnded ?? null,
        minutes: minutes ?? null,
        createdAt: nowIso(),
      };
      await put('readingSessions', record);
      return record;
    },
    listFor: (readingEntryId) =>
      getAllByIndex('readingSessions', 'readingEntryId', readingEntryId).then((rows) =>
        rows.sort((a, b) => (a.date < b.date ? -1 : 1))
      ),
    getAll: () => getAll('readingSessions'),
    remove: (id) => remove('readingSessions', id),
  };

  const Quotes = {
    async add(readingEntryId, { text, pageNumber }) {
      const record = { id: uid(), readingEntryId, text, pageNumber: pageNumber ?? null, createdAt: nowIso() };
      await put('quotes', record);
      return record;
    },
    listFor: (readingEntryId) => getAllByIndex('quotes', 'readingEntryId', readingEntryId),
    async update(id, patch) {
      const existing = await get('quotes', id);
      if (!existing) return null;
      const updated = { ...existing, ...patch };
      await put('quotes', updated);
      return updated;
    },
    remove: (id) => remove('quotes', id),
  };

  const Collections = {
    async create({ name, description }) {
      const record = { id: uid(), name, description: description || '', sortOrder: Date.now(), createdAt: nowIso() };
      await put('collections', record);
      return record;
    },
    get: (id) => get('collections', id),
    getAll: () => getAll('collections').then((rows) => rows.sort((a, b) => a.sortOrder - b.sortOrder)),
    update: (id, patch) => get('collections', id).then((c) => (c ? put('collections', { ...c, ...patch }) : null)),
    async remove(id) {
      await removeWhere('collectionItems', 'collectionId', id);
      await remove('collections', id);
    },
    async addBook(collectionId, readingEntryId) {
      const items = await getAllByIndex('collectionItems', 'collectionId', collectionId);
      if (items.some((i) => i.readingEntryId === readingEntryId)) return items.find(i => i.readingEntryId === readingEntryId);
      const record = { id: uid(), collectionId, readingEntryId, sortOrder: Date.now() };
      await put('collectionItems', record);
      return record;
    },
    async removeBook(collectionId, readingEntryId) {
      const items = await getAllByIndex('collectionItems', 'collectionId', collectionId);
      const match = items.find((i) => i.readingEntryId === readingEntryId);
      if (match) await remove('collectionItems', match.id);
    },
    async itemsFor(collectionId) {
      const items = await getAllByIndex('collectionItems', 'collectionId', collectionId);
      return items.sort((a, b) => a.sortOrder - b.sortOrder);
    },
    async collectionsForEntry(readingEntryId) {
      return getAllByIndex('collectionItems', 'readingEntryId', readingEntryId);
    },
    async reorder(collectionId, orderedItemIds) {
      const items = await getAllByIndex('collectionItems', 'collectionId', collectionId);
      const byId = new Map(items.map((i) => [i.id, i]));
      await Promise.all(
        orderedItemIds.map((id, idx) => {
          const item = byId.get(id);
          if (!item) return null;
          return put('collectionItems', { ...item, sortOrder: idx });
        })
      );
    },
  };

  const Goals = {
    async set(year, { targetBooks, targetPages }) {
      const id = String(year);
      const existing = await get('goals', id);
      const record = { id, year, targetBooks: targetBooks ?? existing?.targetBooks ?? null, targetPages: targetPages ?? existing?.targetPages ?? null };
      await put('goals', record);
      return record;
    },
    get: (year) => get('goals', String(year)),
    getAll: () => getAll('goals').then((rows) => rows.sort((a, b) => b.year - a.year)),
  };

  const Wrapped = {
    get: (year) => get('wrapped', String(year)),
    getAll: () => getAll('wrapped').then((rows) => rows.sort((a, b) => b.year - a.year)),
    async save(year, data) {
      const existing = await get('wrapped', String(year));
      const record = { ...existing, id: String(year), year, updatedAt: nowIso(), ...data };
      await put('wrapped', record);
      return record;
    },
    remove: (year) => remove('wrapped', String(year)),
  };

  async function exportAll() {
    const [books, entries, progress, sessions, quotes, collections, collectionItems, goals, wrapped] =
      await Promise.all([
        getAll('books'),
        getAll('readingEntries'),
        getAll('progressUpdates'),
        getAll('readingSessions'),
        getAll('quotes'),
        getAll('collections'),
        getAll('collectionItems'),
        getAll('goals'),
        getAll('wrapped'),
      ]);

    const coverRows = await getAll('covers');
    const covers = await Promise.all(
      coverRows.map(
        (c) =>
          new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve({ bookId: c.bookId, remoteUrl: c.remoteUrl, dataUrl: reader.result });
            reader.readAsDataURL(c.blob);
          })
      )
    );

    return {
      meta: { app: 'reading-tracker', version: DB_VERSION, exportedAt: nowIso() },
      books, readingEntries: entries, progressUpdates: progress, readingSessions: sessions,
      quotes, collections, collectionItems, goals, wrapped, covers,
    };
  }

  async function importAll(data, { replace = true } = {}) {
    if (replace) {
      await Promise.all([
        'books', 'readingEntries', 'progressUpdates', 'readingSessions', 'quotes',
        'collections', 'collectionItems', 'goals', 'wrapped', 'covers',
      ].map(clearStore));
    }
    const puts = [];
    (data.books || []).forEach((r) => puts.push(put('books', r)));
    (data.readingEntries || []).forEach((r) => puts.push(put('readingEntries', r)));
    (data.progressUpdates || []).forEach((r) => puts.push(put('progressUpdates', r)));
    (data.readingSessions || []).forEach((r) => puts.push(put('readingSessions', r)));
    (data.quotes || []).forEach((r) => puts.push(put('quotes', r)));
    (data.collections || []).forEach((r) => puts.push(put('collections', r)));
    (data.collectionItems || []).forEach((r) => puts.push(put('collectionItems', r)));
    (data.goals || []).forEach((r) => puts.push(put('goals', r)));
    (data.wrapped || []).forEach((r) => puts.push(put('wrapped', r)));
    await Promise.all(puts);

    for (const c of data.covers || []) {
      if (!c.dataUrl) continue;
      const blob = await (await fetch(c.dataUrl)).blob();
      await put('covers', { bookId: c.bookId, blob, remoteUrl: c.remoteUrl || '' });
    }
  }

  return {
    uid, nowIso, open,
    Books, Covers, ReadingEntries, ProgressUpdates, ReadingSessions, Quotes,
    Collections, Goals, Wrapped,
    exportAll, importAll,
  };
})();
