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
    fantasy: 'Fantasy', scifi: 'Science Fiction', mythology: 'Mythology', romance: 'Romance',
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

  // ---- genre selector: your most-read genres first, the rest after ----
  const allGenreKeys = Object.keys(PRIMARY_SUBJECT);
  const orderedGenres = [...genreCounts.map(([k]) => k), ...allGenreKeys.filter((k) => !genreCounts.some(([gk]) => gk === k))];
  let selectedGenre = null;
  try { selectedGenre = localStorage.getItem('exploreGenre'); } catch (e) {}
  if (!selectedGenre || !PRIMARY_SUBJECT[selectedGenre]) selectedGenre = orderedGenres[0] || 'fantasy';

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

  async function cardHTML(item) {
    shownItems.set(item.externalId, item);
    const fakeEntry = {
      book: { id: item.externalId, title: item.title, authors: item.authors, coverUrl: item.coverUrl, hasCachedCover: false },
      status: null,
      rating: item.averageRating || null,
    };
    return bookCardHTML(fakeEntry);
  }

  async function railHTML(items) {
    if (!items.length) return '';
    return `<div class="rail explore-rail">${(await Promise.all(items.map(cardHTML))).join('')}</div>`;
  }

  function sectionHTML(title, subtitle, innerHtml) {
    if (!innerHtml) return '';
    return `
      <section class="explore-section fade-in">
        <div class="explore-section-heading">
          <h2 class="serif">${escapeHtml(title)}</h2>
          <p>${escapeHtml(subtitle)}</p>
        </div>
        ${innerHtml}
      </section>`;
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

  function wireCards() {
    container.querySelectorAll('.book-card[data-book-id]').forEach((card) => {
      const item = shownItems.get(card.dataset.bookId);
      if (!item) return;
      card.addEventListener('click', () => BookPreviewFlow.open(item));
    });
  }

  async function render() {
    seen = new Set();
    shownItems.clear();
    container.innerHTML = genreChipRowHTML() + `<div class="empty-state"><p>Curating your shelf…</p></div>`;
    wireGenreChips();

    const genreLabel = GENRE_LABEL[selectedGenre];
    const subject = PRIMARY_SUBJECT[selectedGenre];

    const [trendingRaw, trendingGenreRaw, newRaw] = await Promise.all([
      BooksAPI.trending({ limit: 16 }).catch(() => []),
      BooksAPI.searchBySubject(subject, { limit: 16, sort: 'rating' }).catch(() => []),
      BooksAPI.searchBySubject(subject, { limit: 16, sort: 'new' }).catch(() => []),
    ]);

    const sections = [];
    sections.push(sectionHTML('Trending Now', 'What readers everywhere are picking up right now.', await railHTML(filterCandidates(trendingRaw, 12))));
    sections.push(sectionHTML(`Trending in ${genreLabel}`, `Popular right now in ${genreLabel.toLowerCase()}.`, await railHTML(filterCandidates(trendingGenreRaw, 12))));
    sections.push(sectionHTML('New & Noteworthy', `Recently released in ${genreLabel.toLowerCase()}.`, await railHTML(filterCandidates(newRaw, 12))));

    // ---- Recommended for You: your favourite authors + genres, blended ----
    if (finished.length >= 3) {
      const recommendedRaw = [];
      for (const [author] of authorsByRating.slice(0, 2)) {
        let results = [];
        try { results = await BooksAPI.search(author, { limit: 10 }); } catch (e) {}
        recommendedRaw.push(...results.filter((r) => (r.authors || []).some((a) => a.toLowerCase() === author.toLowerCase())));
      }
      for (const [bucketKey] of genreCounts.slice(0, 2)) {
        const subj = PRIMARY_SUBJECT[bucketKey];
        if (!subj) continue;
        let results = [];
        try { results = await BooksAPI.searchBySubject(subj, { limit: 12 }); } catch (e) {}
        recommendedRaw.push(...results);
      }
      sections.push(sectionHTML('Recommended for You', 'Based on your ratings, genres, and authors.', await railHTML(filterCandidates(recommendedRaw, 12))));
    }

    // ---- Because You Liked [Book] ----
    if (loved.length) {
      const anchor = loved[0];
      const bucketKey = bucketKeysFor(anchor.book)[0];
      const subj = bucketKey && PRIMARY_SUBJECT[bucketKey];
      if (subj) {
        let results = [];
        try { results = await BooksAPI.searchBySubject(subj, { limit: 16 }); } catch (e) {}
        const picks = filterCandidates(results, 12);
        if (picks.length) {
          sections.push(sectionHTML(`Because You Liked ${anchor.book.title}`, `More books in the spirit of ${anchor.book.title}.`, await railHTML(picks)));
        }
      }
    }

    const rendered = sections.filter(Boolean);
    container.innerHTML = genreChipRowHTML() + (rendered.length
      ? rendered.join('')
      : `<div class="explore-empty empty-state"><div class="icon">🔭</div><h3>Couldn't load anything right now</h3><p>This needs a working connection to Open Library or Google Books. Check your connection and try again.</p></div>`);
    wireGenreChips();
    wireCards();
  }

  render();
})();
