/* ============================================================
   books-api.js — external book metadata provider.

   Exposes a small provider interface so Open Library could be
   swapped for another API later without touching any UI code:

     provider.search(query)      -> [{ externalId, title, authors, ... }]
     provider.getDetails(id)     -> { description, genres }
     provider.fetchCoverBlob(url)-> Blob | null

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
          firstPublishYear: doc.first_publish_year || null,
          isbn10,
          isbn13,
          coverUrl: coverUrlFromId(doc.cover_i, 'M'),
          coverUrlLarge: coverUrlFromId(doc.cover_i, 'L'),
          pageCount: doc.number_of_pages_median || null,
          editionCount: (doc.edition_key || []).length,
        };
      });
    },

    async searchBySubject(subject, { limit = 12 } = {}) {
      const slug = subject.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      if (!slug) return [];
      try {
        const res = await fetch(`https://openlibrary.org/subjects/${encodeURIComponent(slug)}.json?limit=${limit}&sort=rating`);
        if (!res.ok) return [];
        const data = await res.json();
        return (data.works || []).map((w) => ({
          externalId: w.key,
          source: 'openlibrary',
          title: w.title || 'Untitled',
          subtitle: '',
          authors: (w.authors || []).map((a) => a.name).filter(Boolean),
          firstPublishYear: w.first_publish_year || null,
          isbn10: '',
          isbn13: '',
          coverUrl: coverUrlFromId(w.cover_id, 'M'),
          coverUrlLarge: coverUrlFromId(w.cover_id, 'L'),
          pageCount: null,
          editionCount: w.edition_count || null,
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
        return { description, genres };
      } catch {
        return { description: '', genres: [] };
      }
    },

    async fetchCoverBlob(coverUrl) {
      if (!coverUrl) return null;
      try {
        const res = await fetch(coverUrl);
        if (!res.ok) return null;
        const blob = await res.blob();
        if (blob.size < 200) return null; // OL serves a tiny 1x1 for missing covers
        return blob;
      } catch {
        return null;
      }
    },
  };

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
      pageCount: info.pageCount || null,
      editionCount: null,
      description: stripMarkdown(info.description || ''),
      genres: extractGoogleGenres(info.categories),
    };
  }

  /* Google Books generally has broader, more accurate coverage for
     mainstream books than Open Library's crowdsourced catalog — this
     is the active default. Switch back with BooksAPI.setProvider
     (see the OpenLibraryProvider object above) if you ever want to. */
  const GoogleBooksProvider = {
    name: 'googlebooks',

    async search(query, { limit = 20 } = {}) {
      const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=${Math.min(limit, 40)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Book search request failed');
      const data = await res.json();
      return (data.items || []).map(mapGoogleVolume);
    },

    async searchBySubject(subject, { limit = 12 } = {}) {
      try {
        const q = `subject:"${subject}"`;
        const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=${Math.min(limit, 40)}&orderBy=relevance`;
        const res = await fetch(url);
        if (!res.ok) return [];
        const data = await res.json();
        return (data.items || []).map(mapGoogleVolume);
      } catch {
        return [];
      }
    },

    async getDetails(volumeId) {
      // Search results already embed description/categories, but this
      // is used as a fallback (and for results fetched without them).
      try {
        const res = await fetch(`https://www.googleapis.com/books/v1/volumes/${encodeURIComponent(volumeId)}`);
        if (!res.ok) return { description: '', genres: [] };
        const data = await res.json();
        const info = data.volumeInfo || {};
        return { description: stripMarkdown(info.description || ''), genres: extractGoogleGenres(info.categories) };
      } catch {
        return { description: '', genres: [] };
      }
    },

    async fetchCoverBlob(coverUrl) {
      if (!coverUrl) return null;
      try {
        const res = await fetch(coverUrl);
        if (!res.ok) return null;
        const blob = await res.blob();
        if (blob.size < 200) return null;
        return blob;
      } catch {
        return null;
      }
    },
  };

  let activeProvider = GoogleBooksProvider;

  // Google's key-less quota is a small pool shared by every unauthenticated
  // caller worldwide, so it can run dry with no warning even under light,
  // single-user traffic. Rather than surface that as a broken search, fall
  // back to Open Library automatically whenever the active provider throws.
  async function withFallback(method, args) {
    try {
      return await activeProvider[method](...args);
    } catch (err) {
      if (activeProvider === OpenLibraryProvider) throw err;
      console.warn(`${activeProvider.name} ${method} failed, falling back to Open Library:`, err.message);
      return OpenLibraryProvider[method](...args);
    }
  }

  return {
    setProvider(provider) {
      activeProvider = provider;
    },
    providerName: () => activeProvider.name,
    search: (query, opts) => withFallback('search', [query, opts]),
    searchBySubject: (subject, opts) => withFallback('searchBySubject', [subject, opts]),
    getDetails: (externalId) => activeProvider.getDetails(externalId),
    fetchCoverBlob: (url) => activeProvider.fetchCoverBlob(url),
  };
})();
