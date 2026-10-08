/* ============================================================
   books-api.js — external book metadata providers.

   Search merges Hardcover (via api/search.js) with Google Books,
   falling back to Open Library when Google's quota runs dry (see
   mergeSearchResults for who leads when); Explore's rails and trending
   come from Google / Open Library. Each provider exposes the same small
   interface, so no UI code has to care which one a result came from:

     provider.search(query)      -> [{ externalId, title, authors, ... }]
     provider.getDetails(id)     -> { description, genres }

   A cover is fetched the same way whichever catalog listed the book
   (BooksAPI.fetchCoverBlob — see "Cover images" below).

   Only BooksAPI.* should be called from the rest of the app.
   ============================================================ */

const BooksAPI = (() => {
  function classifyIsbns(isbns) {
    const list = isbns || [];
    return {
      isbn10: list.find((i) => i.length === 10) || '',
      isbn13: list.find((i) => i.length === 13) || '',
    };
  }

  /** A catalog's year, page count or edition count as a whole number, or
   *  null. These go onto the page as they are, so anything a catalog sends
   *  that isn't a plain number is dropped here rather than trusted there. */
  function wholeNumber(value) {
    const n = typeof value === 'number' ? value : (typeof value === 'string' && /^\d{1,6}$/.test(value.trim()) ? Number(value) : NaN);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  }

  function coverUrlFromId(coverId, size) {
    return coverId ? `https://covers.openlibrary.org/b/id/${coverId}-${size}.jpg` : '';
  }

  const OpenLibraryProvider = {
    name: 'openlibrary',

    async search(query, { limit = 20 } = {}) {
      const fields = 'key,title,subtitle,author_name,first_publish_year,isbn,cover_i,edition_key,number_of_pages_median';
      const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&fields=${fields}&limit=${limit}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Book search request failed');
      const data = await res.json();
      return (data.docs || []).map((doc) => {
        const { isbn10, isbn13 } = classifyIsbns(doc.isbn);
        return {
          externalId: doc.key,
          source: 'openlibrary',
          title: doc.title || 'Untitled',
          subtitle: doc.subtitle || '',
          authors: doc.author_name || [],
          firstPublishYear: wholeNumber(doc.first_publish_year),
          isbn10,
          isbn13,
          coverUrl: coverUrlFromId(doc.cover_i, 'M'),
          coverUrlLarge: coverUrlFromId(doc.cover_i, 'L'),
          pageCount: wholeNumber(doc.number_of_pages_median),
          editionCount: (doc.edition_key || []).length,
        };
      });
    },

    async searchBySubject(subject, { limit = 12, sort = 'rating', offset = 0 } = {}) {
      const slug = subject.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      if (!slug) return [];
      try {
        const res = await fetch(`https://openlibrary.org/subjects/${encodeURIComponent(slug)}.json?limit=${limit}&offset=${offset}&sort=${encodeURIComponent(sort)}`);
        if (!res.ok) return [];
        const data = await res.json();
        return (data.works || []).map((w) => ({
          externalId: w.key,
          source: 'openlibrary',
          title: w.title || 'Untitled',
          subtitle: '',
          authors: (w.authors || []).map((a) => a.name).filter(Boolean),
          firstPublishYear: wholeNumber(w.first_publish_year),
          isbn10: '',
          isbn13: '',
          coverUrl: coverUrlFromId(w.cover_id, 'M'),
          coverUrlLarge: coverUrlFromId(w.cover_id, 'L'),
          pageCount: null,
          editionCount: wholeNumber(w.edition_count),
        }));
      } catch {
        return [];
      }
    },

    async trending({ limit = 16 } = {}) {
      try {
        const res = await fetch(`https://openlibrary.org/trending/weekly.json?limit=${limit}`);
        if (!res.ok) return [];
        const data = await res.json();
        return (data.works || []).map((w) => ({
          externalId: w.key,
          source: 'openlibrary',
          title: w.title || 'Untitled',
          subtitle: '',
          authors: w.author_name || [],
          firstPublishYear: wholeNumber(w.first_publish_year),
          isbn10: '',
          isbn13: '',
          coverUrl: coverUrlFromId(w.cover_i, 'M'),
          coverUrlLarge: coverUrlFromId(w.cover_i, 'L'),
          pageCount: null,
          editionCount: wholeNumber(w.edition_count),
        }));
      } catch {
        return [];
      }
    },

    async getDetails(workKey) {
      try {
        const res = await fetch(`https://openlibrary.org${workKey}.json`);
        if (!res.ok) return { description: '', genres: [] };
        const data = await res.json();
        let description = '';
        if (typeof data.description === 'string') description = data.description;
        else if (data.description && data.description.value) description = data.description.value;
        const genres = (data.subjects || [])
          .filter((s) => s.length < 40)
          .slice(0, 8);
        return { description: descriptionToText(description), genres };
      } catch {
        return { description: '', genres: [] };
      }
    },
  };

  function googleApiKey() {
    try { return (localStorage.getItem('mg_google_books_key') || '').trim(); } catch { return ''; }
  }

  function withGoogleKey(url) {
    const key = googleApiKey();
    return key ? `${url}&key=${encodeURIComponent(key)}` : url;
  }

  function sanitizeGoogleCoverUrl(url) {
    if (!url) return '';
    return url.replace(/^http:/, 'https:').replace(/&edge=curl/, '');
  }

  function bestGoogleCoverUrl(imageLinks) {
    if (!imageLinks) return '';
    return sanitizeGoogleCoverUrl(
      imageLinks.extraLarge || imageLinks.large || imageLinks.medium ||
      imageLinks.small || imageLinks.thumbnail || imageLinks.smallThumbnail || ''
    );
  }

  function extractPublishYear(publishedDate) {
    const match = (publishedDate || '').match(/^\d{4}/);
    return match ? Number(match[0]) : null;
  }

  function extractGoogleGenres(categories) {
    return (categories || [])
      .flatMap((c) => c.split('/').map((s) => s.trim()))
      .filter(Boolean)
      .slice(0, 8);
  }

  function mapGoogleVolume(item) {
    const info = item.volumeInfo || {};
    const ids = info.industryIdentifiers || [];
    const isbn13 = (ids.find((i) => i.type === 'ISBN_13') || {}).identifier || '';
    const isbn10 = (ids.find((i) => i.type === 'ISBN_10') || {}).identifier || '';
    const cover = bestGoogleCoverUrl(info.imageLinks);
    return {
      externalId: item.id,
      source: 'googlebooks',
      title: info.title || 'Untitled',
      subtitle: info.subtitle || '',
      authors: info.authors || [],
      firstPublishYear: extractPublishYear(info.publishedDate),
      isbn10,
      isbn13,
      coverUrl: cover,
      coverUrlLarge: cover,
      pageCount: wholeNumber(info.pageCount),
      editionCount: null,
      description: descriptionToText(info.description || ''),
      genres: extractGoogleGenres(info.categories),
      averageRating: info.averageRating || null,
    };
  }

  /* Google Books generally has broader, more accurate coverage for
     mainstream books than Open Library's crowdsourced catalog — this
     is the active default. Switch back with BooksAPI.setProvider
     (see the OpenLibraryProvider object above) if you ever want to. */
  const GoogleBooksProvider = {
    name: 'googlebooks',

    async search(query, { limit = 20 } = {}) {
      const url = withGoogleKey(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=${Math.min(limit, 40)}&langRestrict=en`);
      const res = await fetch(url);
      if (!res.ok) throw new Error('Book search request failed');
      const data = await res.json();
      return (data.items || []).map(mapGoogleVolume);
    },

    async searchBySubject(subject, { limit = 12, sort = 'rating', offset = 0 } = {}) {
      const q = `subject:"${subject}"`;
      const orderBy = sort === 'new' ? 'newest' : 'relevance';
      const url = withGoogleKey(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=${Math.min(limit, 40)}&startIndex=${offset}&orderBy=${orderBy}&langRestrict=en`);
      const res = await fetch(url);
      if (!res.ok) throw new Error('Subject search request failed');
      const data = await res.json();
      return (data.items || []).map(mapGoogleVolume);
    },

    // Google Books has no trending endpoint — always defer to Open
    // Library's real trending data via withFallback below.
    async trending() {
      throw new Error('Trending not supported by Google Books');
    },

    async getDetails(volumeId) {
      // Search results already embed description/categories, but this
      // is used as a fallback (and for results fetched without them).
      try {
        const res = await fetch(withGoogleKey(`https://www.googleapis.com/books/v1/volumes/${encodeURIComponent(volumeId)}?fields=volumeInfo`));
        if (!res.ok) return { description: '', genres: [] };
        const data = await res.json();
        const info = data.volumeInfo || {};
        return { description: descriptionToText(info.description || ''), genres: extractGoogleGenres(info.categories) };
      } catch {
        return { description: '', genres: [] };
      }
    },
  };

  /* ---- Hardcover (search only), through our own api/search.js ----
     Hardcover's catalog is modern and community-curated: strong on new
     and popular books, with a consistent synopsis and genres on every
     result. Its API can't be called from a browser (the token would be
     exposed), so this goes through the same sync-token-gated backend as
     ratings; on a device without a sync token it's simply skipped. */
  const HARDCOVER_FETCH = 20; // one size for every caller, so the search bar and Add Book share a cached answer
  const hardcoverDetails = new Map(); // externalId -> { description, genres }
  const hardcoverSearchCache = new Map();

  function mapHardcoverResult(r) {
    const externalId = `hc:${r.id}`;
    const description = descriptionToText(r.description || '');
    const genres = r.genres || [];
    hardcoverDetails.set(externalId, { description, genres });
    // Hardcover's own cover when it has one, else Open Library's by ISBN
    // (default=false makes a missing cover a clean 404, not a blank image).
    const isbn = r.isbn13 || r.isbn10;
    const fallback = isbn ? `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false` : '';
    return {
      externalId,
      source: 'hardcover',
      title: r.title,
      subtitle: r.subtitle || '',
      authors: r.authors || [],
      firstPublishYear: wholeNumber(r.year),
      isbn10: r.isbn10 || '',
      isbn13: r.isbn13 || '',
      coverUrl: r.thumb || r.cover || fallback, // small, for lists
      coverUrlLarge: r.cover || fallback,
      pageCount: wholeNumber(r.pages),
      editionCount: null,
      description,
      genres,
      averageRating: r.rating || null,
      // What mergeSearchResults ranks on.
      ratingsCount: r.ratingsCount || 0,
      readers: r.users || 0,
      isCompilation: !!r.compilation,
      matchesQuery: r.matched,
    };
  }

  // Hardcover list thumbnails come from its image resizer. If that ever
  // stops answering, swap in the full-size original the URL wraps, so a
  // change on their side costs some bandwidth rather than every thumbnail.
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (!img || img.tagName !== 'IMG' || img.dataset.fullSizeTried) return;
    const wrapped = /^https:\/\/[a-z-]+\.hardcover\.app\/enlarge\?(?:.*&)?url=([^&]+)/.exec(img.src);
    if (!wrapped) return;
    img.dataset.fullSizeTried = '1';
    img.src = decodeURIComponent(wrapped[1]);
  }, true);

  async function searchHardcover(query) {
    if (typeof Sync === 'undefined' || !Sync.isConfigured()) return [];
    const key = query.trim().toLowerCase();
    if (hardcoverSearchCache.has(key)) return hardcoverSearchCache.get(key);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}&limit=${HARDCOVER_FETCH}`, {
        headers: { Authorization: `Bearer ${Sync.token()}` },
        signal: ctrl.signal,
      });
      if (!res.ok) return [];
      const data = await res.json();
      const results = (data.results || []).map(mapHardcoverResult);
      hardcoverSearchCache.set(key, results);
      return results;
    } catch (e) {
      return []; // slow or unreachable: fall back to the other catalogs alone
    } finally {
      clearTimeout(timer);
    }
  }

  /* ---- Cover images ----
     A page can show an image from any host, but it can only read one — to
     keep a copy on this device, or to sample its colours — if the host
     sends CORS headers. Open Library does. Hardcover's and Google Books'
     image hosts don't, so those covers come through our own api/cover.js
     (the same sync-token-gated backend as search), which keeps the matching
     list of hosts it will fetch from. */
  const GOOGLE_COVER_HOSTS = ['books.google.com', 'books.googleusercontent.com'];
  const COVER_HOSTS_VIA_API = ['assets.hardcover.app', 'production-img.hardcover.app', ...GOOGLE_COVER_HOSTS];
  const COVER_TIMEOUT_MS = 20000; // Open Library's covers come from archive.org, which can take its time

  function coverGoesViaApi(coverUrl) {
    try { return COVER_HOSTS_VIA_API.includes(new URL(coverUrl).hostname); } catch (e) { return false; }
  }

  /** The cover at `coverUrl` as a Blob, or null if it can't be had. */
  async function fetchCoverBlob(coverUrl) {
    if (!coverUrl) return null;
    const viaApi = coverGoesViaApi(coverUrl);
    // Without a sync token there's no reading these at all, and asking the
    // host directly would only put a CORS error in the console.
    if (viaApi && (typeof Sync === 'undefined' || !Sync.isConfigured())) return null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), COVER_TIMEOUT_MS);
    try {
      const res = viaApi
        ? await fetch(`/api/cover?url=${encodeURIComponent(coverUrl)}`, { headers: { Authorization: `Bearer ${Sync.token()}` }, signal: ctrl.signal })
        : await fetch(coverUrl, { signal: ctrl.signal });
      if (!res.ok) return null;
      const blob = await res.blob();
      if (blob.size < 200) return null; // OL serves a tiny 1x1 for missing covers
      return blob;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /* A Google Books cover address names a thumbnail about 128 pixels wide.
     Asking for a bigger one with zoom= isn't dependable (for most current
     books it answers with a grey "no image" card), but the same address
     with fife= added usually returns the same picture at up to the size
     asked for. Usually: for some books the bigger "cover" is the title
     page. js/sharper-covers.js checks before it believes it. */
  const SHARPER_COVER_FIT = 'w480-h720'; // twice the book page's 240px frame, for a high-density screen

  /** The address of a bigger copy of the picture at `coverUrl`, or '' if
   *  there's no such thing to ask for. */
  function sharperCoverUrl(coverUrl) {
    let url;
    try { url = new URL(coverUrl); } catch (e) { return ''; }
    if (!GOOGLE_COVER_HOSTS.includes(url.hostname) || url.searchParams.has('fife')) return '';
    return `${coverUrl}${url.search ? '&' : '?'}fife=${SHARPER_COVER_FIT}`;
  }

  let activeProvider = GoogleBooksProvider;

  // Without an API key Google now refuses every search (its key-less quota
  // is set to zero), and a key's own daily quota can still run out. Rather
  // than surface either as a broken search, fall back to Open Library
  // automatically whenever the active provider throws.
  async function withFallback(method, args) {
    try {
      return await activeProvider[method](...args);
    } catch (err) {
      if (activeProvider === OpenLibraryProvider) throw err;
      console.warn(`${activeProvider.name} ${method} failed, falling back to Open Library:`, err.message);
      return OpenLibraryProvider[method](...args);
    }
  }

  /* ---- Merging Hardcover with the other catalogs ----
     Hardcover is the better catalog but the weaker search engine: it
     ranks a finished title or author name well, and returns junk for a
     half-typed or misspelled one ("fourth wi"). Google is the reverse.
     So the merged list runs:
       1. Hardcover's well-known books that match the words typed;
       2. the other catalog's results and Hardcover's remaining matches,
          taking turns so neither can crowd the other out of a short list;
       3. Hardcover's box sets, if (1) found anything, and its records
          no reader has saved (bulk-imported stubs).
     A book both catalogs return is listed once, with Hardcover's details. */
  // "Well-known" is set from live searches: books that match a half-typed
  // query only by coincidence ("fourth wi" → Henry IV, "the hou" → The
  // Hourglass Throne) topped out at 57 ratings and 221 readers.
  const WELL_KNOWN_RATINGS = 100; // on Hardcover
  const WELL_KNOWN_READERS = 300; // …or saved by this many, for books too new to have ratings
  const NEAR_THE_TOP = 0.05;      // and within 1/20th of the best match, so "The Housemaid" isn't followed by every namesake

  function mergeSearchResults(hardcover, others) {
    // matchesQuery is decided in api/search.js: every word typed starts a
    // word of the title, authors, series or an alternative title.
    const matching = hardcover.filter((r) => r.matchesQuery);
    const topRatings = Math.max(0, ...matching.map((r) => r.ratingsCount));
    const topReaders = Math.max(0, ...matching.map((r) => r.readers));
    const wellKnown = (r) => (r.ratingsCount >= WELL_KNOWN_RATINGS && r.ratingsCount >= topRatings * NEAR_THE_TOP)
      || (r.readers >= WELL_KNOWN_READERS && r.readers >= topReaders * NEAR_THE_TOP);

    const merged = matching.filter(wellKnown);
    const listed = new Set(merged); // Hardcover results already in the list
    const twinOf = buildOwnedMatcher(hardcover); // same ISBN / title+author matching as "already in your library"
    const addHardcover = (r) => {
      if (listed.has(r)) return false;
      listed.add(r);
      merged.push(r);
      return true;
    };
    /** Adds another catalog's result — as Hardcover's record of the same
     *  book when it has a full one, and not at all if that's already listed. */
    const addOther = (r) => {
      const twin = twinOf(r);
      if (twin && listed.has(twin)) return false;
      if (twin) listed.add(twin);
      merged.push(twin && twin.coverUrl && twin.description ? twin : r);
      return true;
    };

    // A box set is clutter beside the books it collects, but with nothing
    // well-known above it, it may be exactly what was searched for.
    const boxSetsLast = merged.length > 0;
    const lanes = [
      { rows: others, add: addOther, next: 0 },
      {
        rows: matching.filter((r) => (r.readers > 0 || r.ratingsCount > 0) && !(boxSetsLast && r.isCompilation)),
        add: addHardcover,
        next: 0,
      },
    ];
    const takeTurn = (lane) => {
      while (lane.next < lane.rows.length) {
        if (lane.add(lane.rows[lane.next++])) return;
      }
    };
    while (lanes.some((lane) => lane.next < lane.rows.length)) lanes.forEach(takeTurn);

    matching.forEach(addHardcover);
    // Next to nothing to show: Hardcover's fuzzy guesses beat an empty list.
    if (merged.length < 3) hardcover.forEach(addHardcover);
    return merged;
  }

  /** Both searches run at once, so this is no slower than either alone. */
  async function searchWithHardcover(query, opts = {}) {
    const limit = opts.limit || 20;
    const [hardcover, others] = await Promise.all([
      searchHardcover(query),
      withFallback('search', [query, opts]).catch(() => []),
    ]);
    if (!hardcover.length) return others;
    return mergeSearchResults(hardcover, others).slice(0, limit);
  }

  return {
    setProvider(provider) {
      activeProvider = provider;
    },
    providerName: () => activeProvider.name,
    /** opts.includeHardcover merges in Hardcover's catalog (the search bar
     *  and Add Book use it; Explore's background lookups don't, to stay
     *  well inside Hardcover's rate limit). */
    search: (query, opts) => (opts && opts.includeHardcover
      ? searchWithHardcover(query, opts)
      : withFallback('search', [query, opts])),
    searchBySubject: (subject, opts) => withFallback('searchBySubject', [subject, opts]),
    trending: (opts) => withFallback('trending', [opts]),
    /** Routed by where the result came from, so a result from the Open
     *  Library fallback (or Hardcover) doesn't get looked up in Google. */
    getDetails: (externalId) => {
      const id = String(externalId || '');
      if (id.startsWith('hc:')) return Promise.resolve(hardcoverDetails.get(id) || { description: '', genres: [] });
      if (id.startsWith('/works/')) return OpenLibraryProvider.getDetails(id);
      return GoogleBooksProvider.getDetails(id);
    },
    fetchCoverBlob,
    sharperCoverUrl,
  };
})();
