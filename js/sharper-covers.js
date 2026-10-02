/* ============================================================
   sharper-covers.js — a bigger copy of a small cover.

   A cover that came from Google Books is a thumbnail about 128 pixels
   wide: fine in a list, soft in the book page's 240-pixel frame.
   Google will usually hand over the same picture bigger
   (BooksAPI.sharperCoverUrl), but not always: for some books the
   bigger "cover" is the title page, or a grey "no image" card. So
   nothing is swapped on its say-so. The bigger picture is compared
   with the thumbnail already stored on this device, and replaces it
   only when it is recognisably the same picture, the same shape, and
   really bigger. A cover that can't be confirmed stays as it is: a
   wrong cover is worse than a soft one.

   It is Google's own picture, rather than another catalog's, because
   then there is no "is this the same book, the same edition?" to get
   wrong. Open Library's cover for the same ISBN was a different picture
   for about half of 73 books sampled, and at most 383 pixels wide.

   Only this device's copy changes (the `covers` store). book.coverUrl
   is part of the synced library, and sync is whole-library,
   last-write-wins: a write made here in the background could overwrite
   a change just made on another device. So each device sharpens its
   own copies, and nothing is pushed.

   It all happens out of the way: one book at a time with a pause in
   between, covers on screen first, starting a few seconds after the
   page has loaded and only while it is visible and online. A cover
   that has been asked about isn't asked about again for a month (a
   day, if the request failed).
   ============================================================ */

const SharperCovers = (() => {
  /* ---- is it the same picture? ----
     Each picture is boiled down to a 16x24 grid of average colours, and
     the two grids are compared: do light and dark fall in the same
     places, and are the colours close. The cut-offs come from 219 sampled
     covers. A genuine bigger copy scored 0.93 or more on shape and under
     15 on colour. Nothing else passed 0.83 on shape: a title page or a
     "no image" card reached 0.40, another book's cover 0.77 (17,000
     pairs), another printing's cover of the same book 0.79, and a scan
     of the same cover with parts blacked out 0.83 (85 on colour). */
  const GRID_W = 16, GRID_H = 24;
  const SAME_SHAPE = 0.9;   // how well brightness lines up across the grid, -1..1
  const SAME_COLOUR = 40;   // average distance between matching cells' colours, 0..441
  const SAME_ASPECT = 0.05; // width-to-height may differ by this fraction (genuine copies: under 0.01)
  const WORTH_IT = 1.5;     // times wider than the copy it replaces
  const MAX_CANVAS = 1024;  // the longest side a picture is drawn at to be measured

  function loadImage(blob) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }

  function canvasOf(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    return canvas;
  }

  /** { width, height, cells } for a picture: its pixel size, and its grid
   *  (r, g, b per cell). Null if it isn't a picture this browser can read. */
  async function signature(blob) {
    const img = await loadImage(blob);
    if (!img || !img.naturalWidth || !img.naturalHeight) return null;
    const width = img.naturalWidth, height = img.naturalHeight;

    // Halved until it's within reach of the grid, so that every pixel
    // counts: a browser asked to shrink a picture 30 times in one go skips
    // most of them, and how many depends on the browser. (The first canvas
    // is capped, in case a host ever answers with a 20-megapixel scan.)
    const fit = Math.min(1, MAX_CANVAS / Math.max(width, height));
    let w = Math.max(1, Math.round(width * fit)), h = Math.max(1, Math.round(height * fit));
    let canvas = canvasOf(w, h);
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    while (w >= GRID_W * 8 && h >= GRID_H * 8) {
      const half = canvasOf(w >> 1, h >> 1);
      half.getContext('2d').drawImage(canvas, 0, 0, w, h, 0, 0, half.width, half.height);
      canvas = half; w = half.width; h = half.height;
    }
    let data;
    try { data = canvas.getContext('2d').getImageData(0, 0, w, h).data; } catch (e) { return null; }

    const cells = new Float32Array(GRID_W * GRID_H * 3);
    const counts = new Uint32Array(GRID_W * GRID_H);
    for (let y = 0; y < h; y++) {
      const row = Math.min(GRID_H - 1, Math.floor((y * GRID_H) / h));
      for (let x = 0; x < w; x++) {
        const cell = row * GRID_W + Math.min(GRID_W - 1, Math.floor((x * GRID_W) / w));
        const i = (y * w + x) * 4;
        const alpha = data[i + 3] / 255; // a see-through pixel counts as the white behind it
        for (let c = 0; c < 3; c++) cells[cell * 3 + c] += data[i + c] * alpha + 255 * (1 - alpha);
        counts[cell]++;
      }
    }
    for (let cell = 0; cell < counts.length; cell++) {
      for (let c = 0; c < 3; c++) cells[cell * 3 + c] /= counts[cell] || 1;
    }
    return { width, height, cells };
  }

  /** How alike two grids are: `shape` is the correlation of their
   *  brightness (so one scan being darker or flatter than the other
   *  doesn't count against it), `colour` the average distance between
   *  matching cells. */
  function likeness(a, b) {
    const n = GRID_W * GRID_H;
    const brightness = ({ cells }, i) => 0.299 * cells[i * 3] + 0.587 * cells[i * 3 + 1] + 0.114 * cells[i * 3 + 2];
    let meanA = 0, meanB = 0, colour = 0;
    for (let i = 0; i < n; i++) {
      meanA += brightness(a, i) / n;
      meanB += brightness(b, i) / n;
      colour += Math.hypot(a.cells[i * 3] - b.cells[i * 3], a.cells[i * 3 + 1] - b.cells[i * 3 + 1], a.cells[i * 3 + 2] - b.cells[i * 3 + 2]) / n;
    }
    let both = 0, spreadA = 0, spreadB = 0;
    for (let i = 0; i < n; i++) {
      const da = brightness(a, i) - meanA, db = brightness(b, i) - meanB;
      both += da * db; spreadA += da * da; spreadB += db * db;
    }
    // A blank picture has no shape to compare, so it matches nothing.
    return { shape: spreadA && spreadB ? both / Math.sqrt(spreadA * spreadB) : 0, colour };
  }

  /** True if `big` is the picture in `small`, only bigger. */
  function sameButSharper(small, big) {
    if (big.width < small.width * WORTH_IT) return false;
    const aspect = (big.width / big.height) / (small.width / small.height);
    if (Math.abs(aspect - 1) > SAME_ASPECT) return false;
    const { shape, colour } = likeness(small, big);
    return shape >= SAME_SHAPE && colour <= SAME_COLOUR;
  }

  /* ---- one book ---- */
  const DAY = 24 * 60 * 60 * 1000;
  const ASK_AGAIN_MS = 30 * DAY; // after "nothing better here": catalogs do get better covers
  const RETRY_MS = DAY;          // after a request that failed
  const PAUSE_MS = 1000;         // between one book and the next

  const turns = new Map();      // bookId -> its turn, waiting or under way
  let line = Promise.resolve(); // one book at a time, in the order asked

  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function candidate(book) {
    return !!book && !!book.id && !!book.coverUrl
      && typeof BooksAPI !== 'undefined' && !!BooksAPI.sharperCoverUrl(book.coverUrl)
      // The bigger copy comes through api/cover.js, which needs the sync token.
      && typeof Sync !== 'undefined' && Sync.isConfigured();
  }

  /** Puts the copy just stored wherever that book's cover is on screen
   *  (coverMarkup tags each <img> with its book). */
  async function show(bookId) {
    const imgs = [...document.querySelectorAll('img[data-cover-of]')].filter((img) => img.dataset.coverOf === bookId);
    if (!imgs.length) return;
    const url = await Storage.Covers.getObjectUrl(bookId).catch(() => null);
    if (!url) return;
    // Loaded before it's shown, so soft turns to sharp with no blank between.
    // (Waiting on the load event, not decode(): that never settles while the
    // page is in the background.)
    await new Promise((resolve) => {
      const ready = new Image();
      ready.onload = ready.onerror = resolve;
      ready.src = url;
    });
    imgs.forEach((img) => { img.src = url; });
  }

  /** Looks for a sharper copy of one book's cover. Resolves to what
   *  happened: 'swapped'; 'kept' (asked, and the cover it has stays);
   *  'failed' (couldn't ask); 'missing' (no copy on this device to compare
   *  with); 'settled' (nothing to ask). */
  async function look(book) {
    const stored = await Storage.Covers.get(book.id);
    if (!stored || !stored.blob) return 'missing';
    // Only a plain copy of the book's own cover is ever replaced: not an
    // uploaded picture, and not one that is already the sharper copy.
    if (stored.remoteUrl !== book.coverUrl || stored.sharperAfter > Date.now()) return 'settled';
    if (navigator.onLine === false) return 'failed';

    const sharperUrl = BooksAPI.sharperCoverUrl(book.coverUrl);
    const blob = await BooksAPI.fetchCoverBlob(sharperUrl);
    let outcome = 'failed';
    if (blob) {
      const [small, big] = await Promise.all([signature(stored.blob), signature(blob)]);
      if (!small || !big || !sameButSharper(small, big)) {
        outcome = 'kept';
      } else if (await Storage.Covers.save(book.id, blob, sharperUrl).then(() => true, () => false)) {
        show(book.id);
        return 'swapped';
      }
    }
    await Storage.Covers.update(book.id, { sharperAfter: Date.now() + (outcome === 'kept' ? ASK_AGAIN_MS : RETRY_MS) }).catch(() => {});
    return outcome;
  }

  function turnFor(book) {
    if (!turns.has(book.id)) {
      const turn = line.then(() => look(book)).catch(() => 'failed').finally(() => turns.delete(book.id));
      // The pause follows a look that asked for something; one with nothing
      // to ask lets the next book straight in.
      line = turn.then((outcome) => (outcome === 'settled' || outcome === 'missing' ? null : pause(PAUSE_MS)));
      turns.set(book.id, turn);
    }
    return turns.get(book.id);
  }

  /** Looks for a sharper copy of a library book's cover, in its turn.
   *  Resolves true if one was swapped in. */
  function lookFor(book) {
    return candidate(book) ? turnFor(book).then((outcome) => outcome === 'swapped') : Promise.resolve(false);
  }

  /* ---- the whole library, a little at a time ---- */
  const SWEEP_DELAY_MS = 4000;              // after the page has loaded: its own work comes first
  const NEXT_SWEEP_KEY = 'bh_sharper_next'; // no sweep before this time: the last one reached the end of the library
  const GIVE_UP_AFTER = 3;                  // failures in a row: the network or a host is having a bad time
  let sweeping = false;

  function goodTime() {
    return document.visibilityState === 'visible' && navigator.onLine !== false
      && !(navigator.connection && navigator.connection.saveData);
  }

  async function sweep() {
    if (sweeping || !goodTime()) return;
    let next = 0;
    try { next = Number(localStorage.getItem(NEXT_SWEEP_KEY)) || 0; } catch (e) {}
    if (Date.now() < next) return;
    sweeping = true;
    try {
      const books = (await Storage.Books.getAll()).filter(candidate);
      // Covers on screen go first, in the order they appear.
      const place = new Map();
      document.querySelectorAll('img[data-cover-of]').forEach((img, i) => {
        if (!place.has(img.dataset.coverOf)) place.set(img.dataset.coverOf, i);
      });
      const placeOf = (book) => (place.has(book.id) ? place.get(book.id) : Number.MAX_SAFE_INTEGER);
      books.sort((a, b) => placeOf(a) - placeOf(b));

      let failures = 0, leftOver = 0, finished = true;
      for (const book of books) {
        if (!goodTime() || failures >= GIVE_UP_AFTER) { finished = false; break; }
        // A cover that couldn't be fetched a little while ago isn't asked for
        // again yet (cacheCover), so its absence now says nothing new.
        const missedEarlier = readCoverMisses()[book.id] > Date.now();
        await cacheCover(book); // the thumbnail to compare with, if this device hasn't one yet
        const outcome = await turnFor(book);
        if (outcome === 'failed' || outcome === 'missing') leftOver++;
        if (outcome === 'failed' || (outcome === 'missing' && !missedEarlier)) failures++;
        else if (outcome === 'swapped' || outcome === 'kept') failures = 0;
      }
      // Reached the end: nothing more to do until tomorrow. If some covers
      // couldn't be fetched, look again once cacheCover will retry them.
      if (finished) {
        try { localStorage.setItem(NEXT_SWEEP_KEY, String(Date.now() + (leftOver ? COVER_RETRY_MS : DAY))); } catch (e) {}
      }
    } catch (e) {
      // Left for the next page: nothing here is worth interrupting anyone for.
    } finally {
      sweeping = false;
    }
  }

  // A few seconds after the page has loaded, and again when it comes back
  // to the front (a home-screen app can go days without a reload).
  const soon = () => setTimeout(sweep, SWEEP_DELAY_MS);
  if (document.readyState === 'complete') soon();
  else window.addEventListener('load', soon);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') soon(); });

  return { lookFor };
})();
