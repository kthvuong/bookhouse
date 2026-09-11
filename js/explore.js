/* ============================================================
   explore.js — book discovery: trending, new releases, and
   personalized recommendations.

   No ML, no embeddings, no AI calls: trending/new-release sections
   come straight from Open Library / Google Books, and the two
   personalized sections use simple, explainable scoring over your
   own reading data (favourite genres, authors you rate highly,
   books you loved, DNFs as a weak negative). Anything already in
   your library is filtered out everywhere.
   ============================================================ */

(async function () {
  initHeader('explore');
  const container = document.getElementById('explore-container');

  // Canonical, searchable Open Library/Google subject per genre bucket —
  // reused from the Reading Personality genre buckets so "Trending in
  // Fantasy" means the same thing as your personality read does.
  const PRIMARY_SUBJECT = {
    fantasy: 'fantasy', scifi: 'science_fiction', mythology: 'mythology',
    romance: 'romance', mystery: 'mystery', horror: 'horror',
    historical: 'historical_fiction', nonfiction: 'biography', classics: 'classic_literature',
    ya: 'young_adult_fiction', poetry: 'poetry', literary: 'literary_fiction',
  };
  const GENRE_LABEL = {
    all: 'All', fantasy: 'Fantasy', scifi: 'Science Fiction', mythology: 'Mythology', romance: 'Romance',
    mystery: 'Mystery', horror: 'Horror', historical: 'Historical Fiction', nonfiction: 'Nonfiction',
    classics: 'Classics', ya: 'Young Adult', poetry: 'Poetry', literary: 'Literary Fiction',
  };

  function bucketKeysFor(book) {
    const genres = (book.genres || []).map((g) => g.toLowerCase());
    const keys = new Set();
    genres.forEach((g) => {
      GENRE_ARCHETYPES.forEach((arc) => {
        if (arc.match.some((kw) => g.includes(kw))) keys.add(arc.key);
      });
    });
    return [...keys];
  }

  function bucketGenreCounts(entriesList) {
    const buckets = {};
    entriesList.forEach((e) => {
      bucketKeysFor(e.book).forEach((key) => { buckets[key] = (buckets[key] || 0) + 1; });
    });
    return Object.entries(buckets).sort((a, b) => b[1] - a[1]);
  }

  // ---- your own reading data ----
  const entries = (await Storage.ReadingEntries.allWithBooks()).filter((e) => e.book);
  const ownedExternalIds = new Set(entries.map((e) => e.book.externalId).filter(Boolean));
  const finished = entries.filter((e) => e.status === 'finished');
  const loved = finished.filter((e) => e.rating >= 4).sort((a, b) => (b.rating - a.rating) || (b.dateFinished || '').localeCompare(a.dateFinished || ''));
  const dnfAuthors = new Set(entries.filter((e) => e.status === 'dnf').flatMap((e) => e.book.authors || []));
  const genreCounts = bucketGenreCounts(finished);

  const authorRatingTotals = {};
  finished.forEach((e) => {
    if (!e.rating) return;
    (e.book.authors || []).forEach((a) => {
      authorRatingTotals[a] = authorRatingTotals[a] || { sum: 0, count: 0 };
      authorRatingTotals[a].sum += e.rating;
      authorRatingTotals[a].count += 1;
    });
  });
  const authorsByRating = Object.entries(authorRatingTotals)
    .map(([author, { sum, count }]) => [author, sum / count, count])
    .filter(([author, avg]) => avg >= 4 && !dnfAuthors.has(author))
    .sort((a, b) => (b[1] - a[1]) || (b[2] - a[2]));

  // ---- genre selector: a general "All" home, then your most-read
  // genres first, the rest after. "All" is the default landing state —
  // genre-specific sections only appear once you pick one.
  const allGenreKeys = Object.keys(PRIMARY_SUBJECT);
  const orderedGenres = ['all', ...genreCounts.map(([k]) => k), ...allGenreKeys.filter((k) => !genreCounts.some(([gk]) => gk === k))];
  let selectedGenre = null;
  try { selectedGenre = localStorage.getItem('exploreGenre'); } catch (e) {}
  if (!selectedGenre || (selectedGenre !== 'all' && !PRIMARY_SUBJECT[selectedGenre])) selectedGenre = 'all';

  // ---- dedupe across sections + exclusion rules ----
  let seen = new Set();
  function filterCandidates(results, limit) {
    const out = [];
    for (const r of results || []) {
      if (!r.externalId || ownedExternalIds.has(r.externalId) || seen.has(r.externalId)) continue;
      if ((r.authors || []).some((a) => dnfAuthors.has(a))) continue;
      seen.add(r.externalId);
      out.push(r);
      if (out.length >= limit) break;
    }
    return out;
  }

  const shownItems = new Map();
  const RAIL_INITIAL = 12;
  let railCounter = 0;
  // railId -> { items, fetchNext } — fetchNext is an optional async () =>
  // newItems[], used to pull a fresh page from the API once the locally
  // held items run out (see makeSubjectFetcher below). Sections without
  // a natural "next page" (Trending Now's fixed list, the blended
  // Recommended rail) just omit it and stop once items are exhausted.
  const railStateById = new Map();

  async function cardHTML(item) {
    shownItems.set(item.externalId, item);
    const fakeEntry = {
      book: { id: item.externalId, title: item.title, authors: item.authors, coverUrl: item.coverUrl, hasCachedCover: false },
      status: null,
      rating: item.averageRating || null,
    };
    return bookCardHTML(fakeEntry);
  }

  // Shows the first RAIL_INITIAL cards; anything beyond that sits behind a
  // "show more" tile at the end of the rail — clicking it, or scrolling
  // near the end, reveals more from the local pool first and then (if
  // fetchNext is given) fetches another page once that pool runs dry.
  // Tracks the id of the rail it just built so the following sectionHTML()
  // call (always made inline, right after awaiting this) can wire up nav
  // arrows for it.
  let lastRailId = null;
  async function railHTML(items, fetchNext) {
    if (!items.length) { lastRailId = null; return ''; }
    const railId = `rail-${railCounter++}`;
    lastRailId = railId;
    railStateById.set(railId, { items: items.slice(), fetchNext: fetchNext || null });
    const visible = items.slice(0, RAIL_INITIAL);
    const remainingCount = items.length - RAIL_INITIAL;
    const cardsHtml = (await Promise.all(visible.map(cardHTML))).join('');
    const tileHtml = (remainingCount > 0 || fetchNext)
      ? `<button type="button" class="show-more-tile" data-show-more="${railId}"><span class="count">${remainingCount > 0 ? '+' + remainingCount : '···'}</span><span>Show more</span></button>`
      : '';
    return `<div class="rail explore-rail" id="${railId}">${cardsHtml}${tileHtml}</div>`;
  }

  function sectionHTML(title, subtitle, innerHtml) {
    if (!innerHtml) return '';
    const railId = lastRailId;
    const navHtml = railId
      ? `<div class="rail-nav">
          <button type="button" class="rail-nav-btn" data-rail-scroll="${railId}" data-dir="-1" aria-label="Scroll left">‹</button>
          <button type="button" class="rail-nav-btn" data-rail-scroll="${railId}" data-dir="1" aria-label="Scroll right">›</button>
        </div>`
      : '';
    return `
      <section class="explore-section fade-in">
        <div class="explore-section-heading">
          <div>
            <h2 class="serif">${escapeHtml(title)}</h2>
            <p>${escapeHtml(subtitle)}</p>
          </div>
          ${navHtml}
        </div>
        ${innerHtml}
      </section>`;
  }

  function wireRailNav() {
    container.querySelectorAll('[data-rail-scroll]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const rail = document.getElementById(btn.dataset.railScroll);
        if (!rail) return;
        const dir = Number(btn.dataset.dir);
        rail.scrollBy({ left: dir * rail.clientWidth * 0.9, behavior: 'smooth' });
      });
    });
  }

  function genreChipRowHTML() {
    return `
      <div class="genre-chip-row" id="genre-chip-row">
        ${orderedGenres.map((k) => `<button type="button" class="chip genre-chip ${k === selectedGenre ? 'active' : ''}" data-genre-chip="${k}">${GENRE_LABEL[k]}</button>`).join('')}
      </div>`;
  }

  function wireGenreChips() {
    container.querySelectorAll('[data-genre-chip]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset.genreChip === selectedGenre) return;
        selectedGenre = btn.dataset.genreChip;
        try { localStorage.setItem('exploreGenre', selectedGenre); } catch (e) {}
        render();
      });
    });
  }

  function wireCardClicks(root) {
    root.querySelectorAll('.book-card[data-book-id]').forEach((card) => {
      if (card.dataset.wired) return;
      card.dataset.wired = '1';
      const item = shownItems.get(card.dataset.bookId);
      if (!item) return;
      card.addEventListener('click', () => BookPreviewFlow.open(item));
    });
  }

  const REVEAL_BATCH = 8;

  // Reveals the next batch for a rail — used by both the "show more" tile
  // (click) and the endless-scroll listener below, so scrolling near the
  // end works exactly like clicking it. Draws from the local pool first;
  // once that's exhausted, calls the rail's fetchNext() (if it has one)
  // for a fresh page before giving up, so "show more" keeps working
  // rather than going stale after a couple of presses.
  async function revealMore(railId) {
    const state = railStateById.get(railId);
    if (!state) return;
    const railEl = document.getElementById(railId);
    if (!railEl) return;
    const tile = railEl.querySelector('.show-more-tile');
    let shownCount = railEl.querySelectorAll('.book-card').length;

    if (shownCount >= state.items.length && state.fetchNext) {
      if (tile) tile.querySelector('.count').textContent = '···';
      let more = [];
      try { more = await state.fetchNext(); } catch (e) { more = []; }
      if (more.length) state.items.push(...more);
      else state.fetchNext = null; // API has nothing left either
    }

    if (shownCount >= state.items.length) {
      if (tile) tile.remove();
      return;
    }

    const nextBatch = state.items.slice(shownCount, shownCount + REVEAL_BATCH);
    const cardsHtml = (await Promise.all(nextBatch.map(cardHTML))).join('');
    if (tile) tile.insertAdjacentHTML('beforebegin', cardsHtml);
    else railEl.insertAdjacentHTML('beforeend', cardsHtml);
    wireCardClicks(railEl);

    shownCount += nextBatch.length;
    const remaining = state.items.length - shownCount;
    if (tile) {
      if (remaining > 0) tile.querySelector('.count').textContent = `+${remaining}`;
      else if (state.fetchNext) tile.querySelector('.count').textContent = '···';
      else tile.remove();
    }
  }

  function wireShowMore() {
    container.querySelectorAll('[data-show-more]').forEach((btn) => {
      btn.addEventListener('click', () => revealMore(btn.dataset.showMore));
    });
  }

  // Endless scroll: scrolling a rail within ~1 card-width of its end
  // reveals the next batch automatically, same pool/fetchNext as "show more".
  function wireRailAutoLoad() {
    railStateById.forEach((state, railId) => {
      const railEl = document.getElementById(railId);
      if (!railEl) return;
      let loading = false;
      railEl.addEventListener('scroll', () => {
        if (loading) return;
        const nearEnd = railEl.scrollLeft + railEl.clientWidth >= railEl.scrollWidth - 200;
        if (!nearEnd) return;
        loading = true;
        Promise.resolve(revealMore(railId)).finally(() => { loading = false; });
      });
    });
  }

  const RAIL_POOL = 40; // how many candidates each rail keeps up front, before "show more"/endless scroll needs to fetch a fresh page

  // A rail's fetchNext(): pulls the next page for a subject search once the
  // initial RAIL_POOL is exhausted, applying the same global dedupe/
  // exclusion rules as everything else. Keeps its own offset, starting
  // right after the page already fetched up front.
  function makeSubjectFetcher(subject, sort) {
    let offset = RAIL_POOL;
    return async () => {
      let raw = [];
      try { raw = await BooksAPI.searchBySubject(subject, { limit: RAIL_POOL, sort, offset }); } catch (e) { return []; }
      offset += RAIL_POOL;
      return filterCandidates(raw, raw.length);
    };
  }

  async function render() {
    seen = new Set();
    shownItems.clear();
    railStateById.clear();
    railCounter = 0;
    container.innerHTML = genreChipRowHTML() + `<div class="empty-state"><p>Curating your shelf…</p></div>`;
    wireGenreChips();

    const genreSelected = selectedGenre !== 'all';
    const genreLabel = GENRE_LABEL[selectedGenre];
    const subject = PRIMARY_SUBJECT[selectedGenre];

    const [trendingRaw, trendingGenreRaw, newRaw] = await Promise.all([
      BooksAPI.trending({ limit: 100 }).catch(() => []),
      genreSelected ? BooksAPI.searchBySubject(subject, { limit: RAIL_POOL, sort: 'rating' }).catch(() => []) : Promise.resolve([]),
      genreSelected ? BooksAPI.searchBySubject(subject, { limit: RAIL_POOL, sort: 'new' }).catch(() => []) : Promise.resolve([]),
    ]);

    const sections = [];
    sections.push(sectionHTML('Trending Now', 'What readers everywhere are picking up right now.', await railHTML(filterCandidates(trendingRaw, RAIL_POOL))));
    if (genreSelected) {
      sections.push(sectionHTML(`Trending in ${genreLabel}`, `Popular right now in ${genreLabel.toLowerCase()}.`, await railHTML(filterCandidates(trendingGenreRaw, RAIL_POOL), makeSubjectFetcher(subject, 'rating'))));
      sections.push(sectionHTML('New & Noteworthy', `Recently released in ${genreLabel.toLowerCase()}.`, await railHTML(filterCandidates(newRaw, RAIL_POOL), makeSubjectFetcher(subject, 'new'))));
    }

    // ---- Recommended for You: your favourite authors + genres, blended ----
    // Shows as soon as there's any signal at all (one rated author, or one
    // finished book with genre info) rather than requiring a minimum
    // library size — the section itself just won't render if both come
    // back empty, via sectionHTML's own empty check below.
    if (authorsByRating.length || genreCounts.length) {
      const recommendedRaw = [];
      for (const [author] of authorsByRating.slice(0, 3)) {
        let results = [];
        try { results = await BooksAPI.search(author, { limit: 16 }); } catch (e) {}
        recommendedRaw.push(...results.filter((r) => (r.authors || []).some((a) => a.toLowerCase() === author.toLowerCase())));
      }
      for (const [bucketKey] of genreCounts.slice(0, 3)) {
        const subj = PRIMARY_SUBJECT[bucketKey];
        if (!subj) continue;
        let results = [];
        try { results = await BooksAPI.searchBySubject(subj, { limit: 24 }); } catch (e) {}
        recommendedRaw.push(...results);
      }
      sections.push(sectionHTML('Recommended for You', 'Based on your ratings, genres, and authors.', await railHTML(filterCandidates(recommendedRaw, RAIL_POOL))));
    }

    // ---- Because You Liked [Book] ----
    if (loved.length) {
      const anchor = loved[0];
      const bucketKey = bucketKeysFor(anchor.book)[0];
      const subj = bucketKey && PRIMARY_SUBJECT[bucketKey];
      if (subj) {
        let results = [];
        try { results = await BooksAPI.searchBySubject(subj, { limit: 40 }); } catch (e) {}
        const picks = filterCandidates(results, RAIL_POOL);
        if (picks.length) {
          sections.push(sectionHTML(`Because You Liked ${anchor.book.title}`, `More books in the spirit of ${anchor.book.title}.`, await railHTML(picks, makeSubjectFetcher(subj, 'rating'))));
        }
      }
    }

    const rendered = sections.filter(Boolean);
    container.innerHTML = genreChipRowHTML() + (rendered.length
      ? rendered.join('')
      : `<div class="explore-empty empty-state"><div class="icon">🔭</div><h3>Couldn't load anything right now</h3><p>This needs a working connection to Open Library or Google Books. Check your connection and try again.</p></div>`);
    wireGenreChips();
    wireCardClicks(container);
    wireShowMore();
    wireRailAutoLoad();
    wireRailNav();
  }

  render();
})();
