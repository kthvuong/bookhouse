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

/* A tiny cottage with a round window — keeps the "dot" the old plain
   circle mark had, just folded into an actual little house now. */
const BRAND_MARK_SVG = `
  <svg viewBox="0 0 32 32" width="24" height="24" aria-hidden="true" focusable="false">
    <path d="M4 16.5 L16 5.5 L28 16.5" fill="none" style="stroke:var(--accent)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="7.5" y="15.5" width="17" height="12" rx="3.5" style="fill:var(--accent-soft)"/>
    <rect x="13.2" y="20.5" width="5.6" height="7" rx="1.8" style="fill:var(--accent)"/>
    <circle cx="16" cy="11.2" r="2" style="fill:var(--gold)"/>
  </svg>`;

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

/* Phones get four destinations with Add in the middle, where a thumb rests.
   Settings is rarely needed day to day, so on phones it lives behind the
   gear in the header instead of taking a tab. */
const MOBILE_TAB_KEYS = ['home', 'library', 'explore', 'stats'];

function renderMobileTabBar(activeKey) {
  const tab = (key) => {
    const item = NAV_ITEMS.find((i) => i.key === key);
    const active = item.key === activeKey;
    return `
      <a href="${item.href}" class="tab-item ${active ? 'active' : ''}"${active ? ' aria-current="page"' : ''}>
        <span class="tab-icon">${TAB_ICONS[item.key] || ''}</span>
        <span class="tab-label">${item.label}</span>
      </a>`;
  };
  const [first, second, ...rest] = MOBILE_TAB_KEYS;
  return `
    <nav class="mobile-tab-bar" aria-label="Main">
      ${tab(first)}${tab(second)}
      <button type="button" class="tab-add" id="tab-add-btn" aria-label="Add a book">
        <span class="tab-add-circle">${ICONS.plus}</span>
      </button>
      ${rest.map(tab).join('')}
    </nav>`;
}

function currentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem('theme', next); } catch (e) {}
  if (typeof syncThemeColor === 'function') syncThemeColor(next);
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
      <a class="brand" href="index.html"><span class="brand-mark">${BRAND_MARK_SVG}</span>${APP_NAME}</a>
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
        <a class="btn btn-ghost btn-icon header-settings-link ${activeKey === 'settings' ? 'active' : ''}" href="settings.html" aria-label="Settings"${activeKey === 'settings' ? ' aria-current="page"' : ''}>${TAB_ICONS.settings}</a>
      </div>
    </header>
    ${renderMobileTabBar(activeKey)}
  `;

  document.getElementById('theme-toggle-btn').addEventListener('click', toggleTheme);

  const searchBox = document.getElementById('search-box');
  document.getElementById('search-toggle-btn').addEventListener('click', () => {
    searchBox.classList.toggle('mobile-open');
    if (searchBox.classList.contains('mobile-open')) {
      document.getElementById('global-search-input').focus();
    }
  });

  document.getElementById('tab-add-btn').addEventListener('click', () => {
    AddBookFlow.open();
  });

  document.getElementById('add-book-btn').addEventListener('click', () => {
    AddBookFlow.open();
  });

  initGlobalSearch();
  trackKeyboard();
  trackVisibleArea();
  enableSheetSwipe();
}

/* Adds body.keyboard-open while a text field has focus, so the phone tab
   bar can step aside (Android lifts fixed bars above the keyboard, right
   over whatever is being typed into). */
function trackKeyboard() {
  const NON_TEXT = ['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'file', 'color'];
  const isTextField = (el) => !!el && (
    el.matches('textarea, select, [contenteditable="true"]') ||
    (el.matches('input') && !NON_TEXT.includes(el.type))
  );
  const sync = () => document.body.classList.toggle('keyboard-open', isTextField(document.activeElement));
  document.addEventListener('focusin', sync);
  // Not straight away: moving from one field to the next is a focusout
  // followed by a focusin, and the bar shouldn't flicker in between.
  document.addEventListener('focusout', () => setTimeout(sync, 80));
  // A focused field that is taken off the page (a sheet closed with the
  // keyboard still up) loses focus without any focusout, which left the tab
  // bar hidden for good. So while the bar is hidden, every change to the
  // page checks that the field is still there.
  new MutationObserver(() => {
    if (document.body.classList.contains('keyboard-open')) sync();
  }).observe(document.body, { childList: true, subtree: true });
}

/* The on-screen keyboard covers the bottom of the screen without CSS
   hearing about it, and iOS slides the page up to keep the focused field
   in view. A sheet anchored to the bottom of the whole screen then sits
   partly under the keyboard or, once it has grown tall with search
   results, has its top (the search field itself) pushed off the top of the
   screen. So the part of the screen that can actually be seen is measured
   here and handed to CSS as --visible-top and --visible-height, which the
   phone sheets size themselves to (components.css). */
function trackVisibleArea() {
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement.style;
  let top = null, height = null;
  const update = () => {
    // Pinched in, "what can be seen" is a corner of the page: leave the
    // sheets full size (the CSS falls back to the whole screen).
    const zoomed = vv.scale > 1.01;
    const nextTop = zoomed ? null : vv.offsetTop;
    const nextHeight = zoomed ? null : vv.height;
    if (nextTop === top && nextHeight === height) return;
    top = nextTop; height = nextHeight;
    if (zoomed) {
      root.removeProperty('--visible-top');
      root.removeProperty('--visible-height');
    } else {
      root.setProperty('--visible-top', `${top}px`);
      root.setProperty('--visible-height', `${height}px`);
    }
  };
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  update();
}

/* Phones show modals as bottom sheets (components.css). Dragging a sheet
   down dismisses it, the way native sheets work: from anywhere on a sheet
   that has nothing to scroll, and by its top (the grab handle and title
   row) on one that does. It closes by "clicking" the backdrop, so each
   modal's own close/skip logic still runs. The non-passive touchmove
   listener is only attached for the duration of a drag, so ordinary page
   scrolling is never blocked. */
const SHEET_GRAB_ZONE = 72; // px from the sheet's top edge
function enableSheetSwipe() {
  const phone = window.matchMedia('(max-width: 640px)');
  let sheet = null, scroller = null, startY = 0, dy = 0, dragging = false;

  const onMove = (e) => {
    dy = e.touches[0].clientY - startY;
    if (!dragging) {
      if (dy > 10 && scroller.scrollTop <= 0) dragging = true;
      else if (dy < -4 || scroller.scrollTop > 0) { finish(); return; }
      else return;
    }
    e.preventDefault();
    sheet.style.transition = 'none';
    sheet.style.transform = `translateY(${Math.max(0, dy)}px)`;
  };

  const finish = () => {
    if (!sheet) return;
    const s = sheet;
    s.removeEventListener('touchmove', onMove);
    s.style.transition = '';
    s.style.transform = '';
    if (dragging && dy > 90) {
      // The keyboard goes with the sheet, rather than staying up over the page.
      if (s.contains(document.activeElement)) document.activeElement.blur();
      s.closest('.modal-overlay').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
    sheet = null; scroller = null; dragging = false;
  };

  document.addEventListener('touchstart', (e) => {
    if (!phone.matches || e.touches.length !== 1) return;
    const s = e.target.closest('.modal-overlay.open .modal');
    if (!s || e.target.closest('input, textarea, select, [contenteditable="true"], .rail, .star-input')) return;
    // Stepped modals scroll an inner body rather than the sheet itself.
    const sc = e.target.closest('.modal-scroll-body') || s;
    if (sc.scrollTop > 0) return;
    // On a sheet that scrolls, only its top strip is a handle. Further down,
    // a downward drag is someone scrolling back up a list (search results,
    // say), and at the top of the list it used to close the sheet under
    // their finger.
    const list = s.querySelector('.modal-scroll-body') || s;
    const scrolls = list.scrollHeight > list.clientHeight + 1;
    if (scrolls && e.touches[0].clientY - s.getBoundingClientRect().top > SHEET_GRAB_ZONE) return;
    sheet = s; scroller = sc; startY = e.touches[0].clientY; dy = 0; dragging = false;
    s.addEventListener('touchmove', onMove, { passive: false });
  }, { passive: true });
  document.addEventListener('touchend', finish);
  document.addEventListener('touchcancel', finish);
}

function closeMobileSearch() {
  const searchBox = document.getElementById('search-box');
  if (!searchBox || !searchBox.classList.contains('mobile-open')) return;
  searchBox.classList.remove('mobile-open');
  // Hiding a focused field doesn't always take the focus (or the keyboard)
  // off it, so that's done by hand.
  const input = document.getElementById('global-search-input');
  if (input) input.blur();
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
      externalResults = await BooksAPI.search(query, { limit: 8, includeHardcover: true });
    } catch (e) {
      externalResults = [];
    }
    if (myRequest !== requestId) return;

    const isOwned = buildOwnedMatcher(entries.map((e) => e.book));
    const newResults = externalResults.filter((r) => !isOwned(r)).slice(0, 6);

    let html = renderSearchGroup('In your library', personalMatches.map(personalRowHTML));
    html += renderSearchGroup('New to you', newResults.map(externalRowHTML));
    if (!personalMatches.length && !newResults.length) {
      html = `<div class="search-empty">No matches for "${escapeHtml(query)}"</div>`;
    } else if (newResults.length) {
      html += `<button type="button" class="search-show-all-btn" id="search-show-all">Show all results for "${escapeHtml(query.trim())}" →</button>`;
    }
    panel.innerHTML = html;
    panel.hidden = false;
    wireSearchPanelClicks(panel, personalMatches, newResults);
    const showAllBtn = panel.querySelector('#search-show-all');
    if (showAllBtn) {
      showAllBtn.addEventListener('click', () => {
        panel.hidden = true;
        closeMobileSearch();
        AddBookFlow.open(query.trim());
      });
    }
  }, 320);

  input.addEventListener('input', (e) => runSearch(e.target.value));
  input.addEventListener('focus', (e) => { if (e.target.value.trim().length >= 2) panel.hidden = false; });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMobileSearch(); });
  document.addEventListener('click', (e) => {
    if (!panel.contains(e.target) && e.target !== input) panel.hidden = true;
    const searchBox = document.getElementById('search-box');
    const toggleBtn = document.getElementById('search-toggle-btn');
    // contains(), not ===: a tap on the magnifier lands on the <svg> inside
    // the button, and would otherwise close the box the same tap just opened.
    if (searchBox && searchBox.classList.contains('mobile-open') && !searchBox.contains(e.target) && !(toggleBtn && toggleBtn.contains(e.target))) {
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
