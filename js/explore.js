/* ============================================================
   explore.js — "personalized bookstore table" recommendations.

   No ML, no embeddings, no AI calls: just simple, explainable
   scoring over your own reading data (favourite genres, authors
   you rate highly, books you loved, DNFs as a weak negative),
   fed into Open Library's subject/search endpoints, with anything
   already in your library filtered out.
   ============================================================ */

(async function () {
  initHeader('explore');
  const container = document.getElementById('explore-container');

  const ADJACENT_SUBJECT = {
    fantasy: 'mythology', scifi: 'fantasy', mythology: 'historical_fiction',
    romance: 'literary_fiction', mystery: 'horror', horror: 'mystery',
    historical: 'mythology', nonfiction: 'historical_fiction', classics: 'literary_fiction',
    ya: 'romance', poetry: 'literary_fiction', literary: 'historical_fiction',
    wanderer: 'classic_literature',
  };

  // Raw Open Library subjects are noisy ("Fiction" tops nearly every book's
  // list), so recommendations are seeded from the same genre *buckets* that
  // drive the Reading Personality read, mapped to a specific, searchable
  // Open Library subject — not the book's literal first subject string.
  const PRIMARY_SUBJECT = {
    fantasy: 'fantasy', scifi: 'science_fiction', mythology: 'mythology',
    romance: 'romance', mystery: 'mystery', horror: 'horror',
    historical: 'historical_fiction', nonfiction: 'biography', classics: 'classic_literature',
    ya: 'young_adult_fiction', poetry: 'poetry', literary: 'literary_fiction',
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

  const entries = (await Storage.ReadingEntries.allWithBooks()).filter((e) => e.book);
  const ownedExternalIds = new Set(entries.map((e) => e.book.externalId).filter(Boolean));
  const finished = entries.filter((e) => e.status === 'finished');
  const loved = finished.filter((e) => e.rating >= 4).sort((a, b) => (b.rating - a.rating) || (b.dateFinished || '').localeCompare(a.dateFinished || ''));
  const dnfAuthors = new Set(entries.filter((e) => e.status === 'dnf').flatMap((e) => e.book.authors || []));

  if (loved.length < 2) {
    container.innerHTML = `
      <div class="explore-empty empty-state">
        <div class="icon">🔭</div>
        <h3>Not quite enough to go on yet</h3>
        <p>Rate a few finished books 4 stars or higher and this page will start curating recommendations from your own taste.</p>
      </div>`;
    return;
  }

  container.innerHTML = `<div class="empty-state"><p>Curating your shelf…</p></div>`;

  const GENRE_LABEL = {
    fantasy: 'fantasy', scifi: 'science fiction', mythology: 'mythology', romance: 'romance',
    mystery: 'mystery', horror: 'horror', historical: 'historical fiction', nonfiction: 'nonfiction',
    classics: 'classics', ya: 'young adult', poetry: 'poetry', literary: 'literary fiction',
  };

  // ---- signals from your own data ----
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

  const archetype = deriveArchetype({ finished });

  // ---- dedupe across sections + exclusion rules ----
  const seen = new Set();
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

  const sections = [];

  // ---- Because You Liked… ----
  const becauseItems = [];
  for (const entry of loved.slice(0, 3)) {
    const bucketKey = bucketKeysFor(entry.book)[0];
    const subject = bucketKey && PRIMARY_SUBJECT[bucketKey];
    if (!subject) continue;
    let results = [];
    try { results = await BooksAPI.searchBySubject(subject, { limit: 12 }); } catch (e) {}
    const picks = filterCandidates(results, 4);
    picks.forEach((p) => becauseItems.push({ ...p, reason: `Because you loved ${entry.book.title}` }));
  }
  if (becauseItems.length) sections.push({ title: 'Because You Liked…', subtitle: 'More in the spirit of books you rated highly.', items: becauseItems });

  // ---- More From Authors You Love ----
  const authorItems = [];
  for (const [author] of authorsByRating.slice(0, 3)) {
    let results = [];
    try { results = await BooksAPI.search(author, { limit: 10 }); } catch (e) {}
    const byThisAuthor = results.filter((r) => (r.authors || []).some((a) => a.toLowerCase() === author.toLowerCase()));
    const picks = filterCandidates(byThisAuthor, 3);
    picks.forEach((p) => authorItems.push({ ...p, reason: `More by ${author}` }));
  }
  if (authorItems.length) sections.push({ title: 'More From Authors You Love', subtitle: "Other books by authors you've rated highly.", items: authorItems });

  // ---- Based on Your Favourite Genres ----
  const genreItems = [];
  for (const [bucketKey] of genreCounts.slice(0, 2)) {
    const subject = PRIMARY_SUBJECT[bucketKey];
    if (!subject) continue;
    let results = [];
    try { results = await BooksAPI.searchBySubject(subject, { limit: 12 }); } catch (e) {}
    const picks = filterCandidates(results, 4);
    picks.forEach((p) => genreItems.push({ ...p, reason: `Because you read a lot of ${GENRE_LABEL[bucketKey] || bucketKey}` }));
  }
  if (genreItems.length) sections.push({ title: 'Based on Your Favourite Genres', subtitle: 'The genres you keep coming back to.', items: genreItems });

  // ---- Try Something Different ----
  const adjacentSubject = ADJACENT_SUBJECT[archetype.key];
  if (adjacentSubject) {
    let results = [];
    try { results = await BooksAPI.searchBySubject(adjacentSubject, { limit: 12 }); } catch (e) {}
    const picks = filterCandidates(results, 4);
    if (picks.length) {
      const label = adjacentSubject.replace(/_/g, ' ');
      sections.push({
        title: 'Try Something Different',
        subtitle: `A little outside your usual shelf — adjacent to what you already enjoy.`,
        items: picks.map((p) => ({ ...p, reason: `A change of pace — ${label}` })),
      });
    }
  }

  if (!sections.length) {
    container.innerHTML = `
      <div class="explore-empty empty-state">
        <div class="icon">🔭</div>
        <h3>Couldn't curate anything right now</h3>
        <p>This needs a working connection to Open Library. Check your connection and try again.</p>
      </div>`;
    return;
  }

  container.innerHTML = (await Promise.all(sections.map(sectionHTML))).join('');
  wireCards();

  async function sectionHTML(section) {
    const cards = await Promise.all(section.items.map(cardHTML));
    return `
      <section class="explore-section fade-in">
        <div class="explore-section-heading">
          <h2 class="serif">${escapeHtml(section.title)}</h2>
          <p>${escapeHtml(section.subtitle)}</p>
        </div>
        <div class="rec-rail">${cards.join('')}</div>
      </section>`;
  }

  async function cardHTML(item) {
    const cover = item.coverUrl
      ? `<img src="${escapeHtml(item.coverUrl)}" alt="">`
      : coverFallbackHTML(item.title);
    return `
      <div class="rec-card" data-external-id="${escapeHtml(item.externalId)}">
        <div class="cover-wrap" data-open-preview>${cover}</div>
        <div class="rec-title" data-open-preview>${escapeHtml(item.title)}</div>
        <div class="rec-author">${escapeHtml(authorList(item.authors))}</div>
        <div class="rec-reason">${escapeHtml(item.reason)}</div>
        <button type="button" class="btn btn-ghost rec-add-btn" data-quick-add>+ Want to Read</button>
      </div>`;
  }

  function wireCards() {
    const byExternalId = new Map();
    sections.forEach((s) => s.items.forEach((it) => byExternalId.set(it.externalId, it)));

    container.querySelectorAll('.rec-card').forEach((card) => {
      const item = byExternalId.get(card.dataset.externalId);
      if (!item) return;
      card.querySelectorAll('[data-open-preview]').forEach((el) => {
        el.addEventListener('click', () => BookPreviewFlow.open(item));
      });
      const addBtn = card.querySelector('[data-quick-add]');
      addBtn.addEventListener('click', async () => {
        addBtn.disabled = true;
        addBtn.textContent = 'Adding…';
        await AddBookFlow.quickAdd(item, { status: 'want_to_read' });
        addBtn.textContent = '✓ Added';
        addBtn.classList.add('added');
        toast(`Added "${item.title}" to Want to Read`);
      });
    });
  }
})();
