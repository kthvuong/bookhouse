/* ============================================================
   nav.js — shared header, global nav, theme toggle, global search.
   Every page calls initHeader('key') once on load.
   ============================================================ */

const NAV_ITEMS = [
  { key: 'home', href: 'index.html', label: 'Home' },
  { key: 'library', href: 'library.html', label: 'Library' },
  { key: 'explore', href: 'explore.html', label: 'Explore' },
  { key: 'stats', href: 'stats.html', label: 'Stats' },
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

/* Icons for the mobile bottom tab bar, keyed to NAV_ITEMS' keys. */
const TAB_ICONS = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>',
  library: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5C4 4.67 4.67 4 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5v-13Z"/><path d="M20 5.5c0-.83-.67-1.5-1.5-1.5H13v16h5.5c.83 0 1.5-.67 1.5-1.5v-13Z"/></svg>',
  explore: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M14.8 9.2l-2.1 5.5-5.5 2.1 2.1-5.5 5.5-2.1Z"/></svg>',
  stats: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M12 20V4M20 20v-7"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15 1.65 1.65 0 0 0 3.17 14H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg>',
};

function renderMobileTabBar(activeKey) {
  return `
    <nav class="mobile-tab-bar">
      ${NAV_ITEMS.map((item) => `
        <a href="${item.href}" class="tab-item ${item.key === activeKey ? 'active' : ''}">
          ${TAB_ICONS[item.key] || ''}
          <span>${item.label}</span>
        </a>`).join('')}
    </nav>`;
}

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
        <div class="search-box" id="search-box">
          ${ICONS.search}
          <input type="text" id="global-search-input" placeholder="Search books…" autocomplete="off">
          <div class="search-results-panel" id="global-search-panel" hidden></div>
        </div>
        <button class="btn btn-ghost btn-icon search-toggle-btn" id="search-toggle-btn" aria-label="Search">${ICONS.search}</button>
        <button class="btn btn-primary btn-sm" id="add-book-btn">${ICONS.plus}<span>Add Book</span></button>
        <button class="btn btn-ghost btn-icon" id="theme-toggle-btn" title="Toggle theme" aria-label="Toggle theme">${currentTheme() === 'dark' ? ICONS.sun : ICONS.moon}</button>
      </div>
    </header>
    ${renderMobileTabBar(activeKey)}
    <button class="btn-fab" id="add-book-fab" aria-label="Add Book">${ICONS.plus}</button>
  `;

  document.getElementById('theme-toggle-btn').addEventListener('click', toggleTheme);

  const searchBox = document.getElementById('search-box');
  document.getElementById('search-toggle-btn').addEventListener('click', () => {
    searchBox.classList.toggle('mobile-open');
    if (searchBox.classList.contains('mobile-open')) {
      document.getElementById('global-search-input').focus();
    }
  });

  document.getElementById('add-book-fab').addEventListener('click', () => {
    AddBookFlow.open();
  });

  document.getElementById('add-book-btn').addEventListener('click', () => {
    AddBookFlow.open();
  });

  initGlobalSearch();
}

function closeMobileSearch() {
  const searchBox = document.getElementById('search-box');
  if (searchBox) searchBox.classList.remove('mobile-open');
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
    html += renderSearchGroup('From Open Library', newResults.map(externalRowHTML));
    if (!personalMatches.length && !newResults.length) {
      html = `<div class="search-empty">No matches for "${escapeHtml(query)}"</div>`;
    }
    panel.innerHTML = html;
    panel.hidden = false;
    wireSearchPanelClicks(panel, personalMatches, newResults);
  }, 320);

  input.addEventListener('input', (e) => runSearch(e.target.value));
  input.addEventListener('focus', (e) => { if (e.target.value.trim().length >= 2) panel.hidden = false; });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMobileSearch(); });
  document.addEventListener('click', (e) => {
    if (!panel.contains(e.target) && e.target !== input) panel.hidden = true;
    const searchBox = document.getElementById('search-box');
    const toggleBtn = document.getElementById('search-toggle-btn');
    if (searchBox && searchBox.classList.contains('mobile-open') && !searchBox.contains(e.target) && e.target !== toggleBtn) {
      closeMobileSearch();
    }
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
      <span class="chevron">›</span>
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
      closeMobileSearch();
      BookPreviewFlow.open(result);
    });
  });
}
