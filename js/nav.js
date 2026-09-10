/* ============================================================
   nav.js — shared header, global nav, theme toggle, global search.
   Every page calls initHeader('key') once on load.
   ============================================================ */

const NAV_ITEMS = [
  { key: 'home', href: 'index.html', label: 'Home' },
  { key: 'library', href: 'library.html', label: 'Library' },
  { key: 'stats', href: 'stats.html', label: 'Stats' },
  { key: 'wrapped', href: 'wrapped.html', label: 'Wrapped' },
  { key: 'settings', href: 'settings.html', label: 'Settings' },
];

/* These pages live under Library rather than in the main nav — this
   local strip keeps them all reachable in one click of each other. */
const LIBRARY_SUBNAV_ITEMS = [
  { key: 'library', href: 'library.html', label: 'All Books' },
  { key: 'currently-reading', href: 'currently-reading.html', label: 'Currently Reading' },
  { key: 'want-to-read', href: 'want-to-read.html', label: 'Want to Read' },
  { key: 'collections', href: 'collections.html', label: 'Collections' },
  { key: 'history', href: 'history.html', label: 'Reading History' },
];

function renderLibrarySubnav(activeKey) {
  return `
    <nav class="library-subnav">
      ${LIBRARY_SUBNAV_ITEMS.map((item) => `<a href="${item.href}" class="${item.key === activeKey ? 'active' : ''}">${item.label}</a>`).join('')}
    </nav>`;
}

const ICONS = {
  search: '<svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8L6 18M18 6l1.8-1.8"/></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 5v14M5 12h14"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};

function currentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem('theme', next); } catch (e) {}
  const btn = document.getElementById('theme-toggle-btn');
  if (btn) btn.innerHTML = next === 'dark' ? ICONS.sun : ICONS.moon;
}

function initHeader(activeKey) {
  const root = document.getElementById('header-root');
  if (!root) return;

  const navLinks = NAV_ITEMS.map(
    (item) => `<a href="${item.href}" class="${item.key === activeKey ? 'active' : ''}">${item.label}</a>`
  ).join('');

  root.innerHTML = `
    <header class="app-header">
      <a class="brand" href="index.html"><span class="brand-mark">&#9679;</span>${APP_NAME}</a>
      <nav class="main-nav" id="main-nav">${navLinks}</nav>
      <div class="header-actions">
        <div class="search-box">
          ${ICONS.search}
          <input type="text" id="global-search-input" placeholder="Search your library or add a book…" autocomplete="off">
          <div class="search-results-panel" id="global-search-panel" hidden></div>
        </div>
        <button class="btn btn-primary btn-sm" id="add-book-btn">${ICONS.plus}<span>Add Book</span></button>
        <button class="btn btn-ghost btn-icon" id="theme-toggle-btn" title="Toggle theme" aria-label="Toggle theme">${currentTheme() === 'dark' ? ICONS.sun : ICONS.moon}</button>
        <button class="nav-toggle" id="nav-toggle" aria-label="Menu">${ICONS.menu}</button>
      </div>
    </header>
  `;

  document.getElementById('theme-toggle-btn').addEventListener('click', toggleTheme);

  const navEl = document.getElementById('main-nav');
  const navToggle = document.getElementById('nav-toggle');
  navToggle.addEventListener('click', () => {
    const open = navEl.classList.toggle('open');
    navToggle.innerHTML = open ? ICONS.close : ICONS.menu;
  });
  navEl.querySelectorAll('a').forEach((a) =>
    a.addEventListener('click', () => {
      navEl.classList.remove('open');
      navToggle.innerHTML = ICONS.menu;
    })
  );

  document.getElementById('add-book-btn').addEventListener('click', () => {
    AddBookFlow.open();
  });

  initGlobalSearch();
}

function initGlobalSearch() {
  const input = document.getElementById('global-search-input');
  const panel = document.getElementById('global-search-panel');
  if (!input) return;

  let requestId = 0;

  const runSearch = debounce(async (query) => {
    const myRequest = ++requestId;
    if (!query || query.trim().length < 2) {
      panel.hidden = true;
      return;
    }

    const entries = await Storage.ReadingEntries.allWithBooks();
    const q = query.trim().toLowerCase();
    const personalMatches = entries
      .filter((e) => e.book && (
        e.book.title.toLowerCase().includes(q) ||
        (e.book.authors || []).some((a) => a.toLowerCase().includes(q))
      ))
      .slice(0, 6);

    panel.innerHTML = `<div class="search-empty">Searching…</div>`;
    panel.hidden = false;

    let externalResults = [];
    try {
      externalResults = await BooksAPI.search(query, { limit: 8 });
    } catch (e) {
      externalResults = [];
    }
    if (myRequest !== requestId) return;

    const ownedKeys = new Set(entries.map((e) => e.book && e.book.externalId).filter(Boolean));
    const newResults = externalResults.filter((r) => !ownedKeys.has(r.externalId)).slice(0, 6);

    let html = renderSearchGroup('In your library', personalMatches.map(personalRowHTML));
    html += renderSearchGroup('Add from Open Library', newResults.map(externalRowHTML));
    if (!personalMatches.length && !newResults.length) {
      html = `<div class="search-empty">No matches for "${escapeHtml(query)}"</div>`;
    }
    panel.innerHTML = html;
    panel.hidden = false;
    wireSearchPanelClicks(panel, personalMatches, newResults);
  }, 320);

  input.addEventListener('input', (e) => runSearch(e.target.value));
  input.addEventListener('focus', (e) => { if (e.target.value.trim().length >= 2) panel.hidden = false; });
  document.addEventListener('click', (e) => {
    if (!panel.contains(e.target) && e.target !== input) panel.hidden = true;
  });
}

function renderSearchGroup(label, rowsHtml) {
  if (!rowsHtml.length) return '';
  return `<div class="group-label">${label}</div>${rowsHtml.join('')}`;
}

function personalRowHTML(entry) {
  const cover = entry.book.coverUrl
    ? `<img class="thumb" src="${escapeHtml(entry.book.coverUrl)}" alt="">`
    : `<span class="thumb"></span>`;
  return `
    <div class="search-result-row" data-personal-id="${entry.bookId}">
      ${cover}
      <div class="meta">
        <div class="title">${escapeHtml(entry.book.title)}</div>
        <div class="sub">${escapeHtml(authorList(entry.book.authors))}</div>
      </div>
      <span class="in-library-badge">In library</span>
    </div>`;
}

function externalRowHTML(result, idx) {
  const cover = result.coverUrl ? `<img class="thumb" src="${escapeHtml(result.coverUrl)}" alt="">` : `<span class="thumb"></span>`;
  return `
    <div class="search-result-row" data-external-idx="${idx}">
      ${cover}
      <div class="meta">
        <div class="title">${escapeHtml(result.title)}</div>
        <div class="sub">${escapeHtml(authorList(result.authors))}${result.firstPublishYear ? ' · ' + result.firstPublishYear : ''}</div>
      </div>
    </div>`;
}

function wireSearchPanelClicks(panel, personalMatches, externalResults) {
  panel.querySelectorAll('[data-personal-id]').forEach((row) => {
    row.addEventListener('click', () => {
      window.location.href = `book.html?id=${row.dataset.personalId}`;
    });
  });
  panel.querySelectorAll('[data-external-idx]').forEach((row) => {
    row.addEventListener('click', () => {
      const result = externalResults[Number(row.dataset.externalIdx)];
      panel.hidden = true;
      AddBookFlow.openWithResult(result);
    });
  });
}
