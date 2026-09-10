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

  let activeProvider = OpenLibraryProvider;

  return {
    setProvider(provider) {
      activeProvider = provider;
    },
    providerName: () => activeProvider.name,
    search: (query, opts) => activeProvider.search(query, opts),
    searchBySubject: (subject, opts) => activeProvider.searchBySubject(subject, opts),
    getDetails: (externalId) => activeProvider.getDetails(externalId),
    fetchCoverBlob: (url) => activeProvider.fetchCoverBlob(url),
  };
})();
