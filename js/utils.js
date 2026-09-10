/* ============================================================
   utils.js — shared helpers: formatting, stars, toasts, DOM bits
   ============================================================ */

const STATUS_LABELS = {
  want_to_read: 'Want to Read',
  currently_reading: 'Currently Reading',
  finished: 'Finished',
  dnf: 'Did Not Finish',
  paused: 'Paused',
};

const FORMAT_LABELS = {
  physical: 'Physical',
  ebook: 'Kindle / eBook',
  audiobook: 'Audiobook',
};

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const STAR_PATH = 'M12 2.5l2.9 6.4 6.98.7-5.27 4.73 1.53 6.87L12 17.9l-6.14 3.3 1.53-6.87L2.12 9.6l6.98-.7z';

function svgStar(cls) {
  return `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path class="${cls}" d="${STAR_PATH}"/></svg>`;
}

function starsDisplayHTML(rating, size = '') {
  const r = rating || 0;
  let slots = '';
  for (let i = 0; i < 5; i++) {
    const diff = r - i;
    const fillPct = diff >= 1 ? 100 : diff > 0 ? 50 : 0;
    slots += `<span class="star-slot">${svgStar('star-bg')}<span style="position:absolute;inset:0;overflow:hidden;width:${fillPct}%;">${svgStar('star-fg')}</span></span>`;
  }
  return `<span class="star-rating ${size}"><span class="stars-display">${slots}</span></span>`;
}

function ratingText(rating) {
  if (!rating) return 'Not rated';
  return `${rating.toFixed(1).replace(/\.0$/, '')} / 5`;
}

/**
 * Renders an interactive half-star input into `container`.
 * opts: { value, size ('sm'|''|'lg'), onChange(value) }
 */
function mountStarInput(container, opts) {
  let value = opts.value || 0;
  const size = opts.size || 'lg';

  function render(previewValue) {
    const r = previewValue != null ? previewValue : value;
    let slots = '';
    for (let i = 0; i < 5; i++) {
      const diff = r - i;
      const fillPct = diff >= 1 ? 100 : diff > 0 ? 50 : 0;
      slots += `
        <span class="star-slot" data-index="${i}">
          ${svgStar('star-bg')}
          <span style="position:absolute;inset:0;overflow:hidden;width:${fillPct}%;">${svgStar('star-fg')}</span>
          <span class="half-hit" data-value="${i + 0.5}"></span>
          <span class="half-hit right" data-value="${i + 1}"></span>
        </span>`;
    }
    container.innerHTML = `
      <span class="star-input ${size}">${slots}</span>
      <span class="rating-label">${value ? ratingText(value) : 'Tap to rate'}</span>
    `;
  }

  container.addEventListener('mousemove', (e) => {
    const hit = e.target.closest('.half-hit');
    if (!hit) return;
    render(parseFloat(hit.dataset.value));
  });
  container.addEventListener('mouseleave', () => render());
  container.addEventListener('click', (e) => {
    const hit = e.target.closest('.half-hit');
    if (!hit) return;
    value = parseFloat(hit.dataset.value);
    render();
    opts.onChange && opts.onChange(value);
  });

  render();
  return { setValue: (v) => { value = v; render(); } };
}

function formatDate(isoOrDateStr, style = 'medium') {
  if (!isoOrDateStr) return '';
  const d = new Date(isoOrDateStr.length === 10 ? isoOrDateStr + 'T00:00:00' : isoOrDateStr);
  if (isNaN(d)) return '';
  if (style === 'short') return `${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`;
  if (style === 'monthYear') return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
  if (style === 'year') return `${d.getFullYear()}`;
  return `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function todayStr() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function percentFromPages(current, total) {
  if (!total || total <= 0) return 0;
  return clamp(Math.round((current / total) * 100), 0, 100);
}

function escapeHtml(str) {
  return (str || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Open Library descriptions sometimes carry light markdown; strip it for clean prose display. */
function stripMarkdown(str) {
  if (!str) return '';
  return str
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/_{1,2}(.*?)_{1,2}/g, '$1')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1');
}

function truncate(str, n) {
  if (!str) return '';
  return str.length > n ? str.slice(0, n - 1).trim() + '…' : str;
}

function debounce(fn, wait) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

function getQueryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function toast(message) {
  let wrap = document.querySelector('.toast-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'toast-wrap';
    document.body.appendChild(wrap);
  }
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

function authorList(authors) {
  if (!authors || !authors.length) return 'Unknown author';
  return authors.join(', ');
}

function bookInitialLetterGradientLabel(title) {
  return truncate(title || '', 40);
}

// ---- reading pace / progress stats ----
function computeProgressStats(entry, progressUpdates, book) {
  const totalPages = (book && book.pageCount) || null;
  const currentPage = entry.currentPage || 0;
  const percent = entry.progressPercent || (totalPages ? percentFromPages(currentPage, totalPages) : 0);
  const pagesRemaining = totalPages ? Math.max(totalPages - currentPage, 0) : null;

  let avgPagesPerDay = null;
  let estCompletionDate = null;

  const sorted = (progressUpdates || []).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  if (sorted.length >= 2) {
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const days = Math.max(1, (new Date(last.date) - new Date(first.date)) / 86400000);
    const pagesDelta = (last.currentPage || 0) - (first.currentPage || 0);
    if (pagesDelta > 0) {
      avgPagesPerDay = pagesDelta / days;
      if (totalPages && pagesRemaining > 0) {
        const daysLeft = pagesRemaining / avgPagesPerDay;
        const d = new Date();
        d.setDate(d.getDate() + Math.ceil(daysLeft));
        estCompletionDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      }
    }
  }

  return {
    percent,
    pagesRead: currentPage,
    pagesRemaining,
    totalPages,
    avgPagesPerDay,
    estCompletionDate,
  };
}

/** Logs a progress update and updates the reading entry's current position. Shared by the book detail and Currently Reading pages. */
async function logProgressUpdate(entry, book, { currentPage, percent, date }) {
  date = date || todayStr();
  let cp = currentPage != null && currentPage !== '' ? Number(currentPage) : null;
  let pct = percent != null && percent !== '' ? Number(percent) : null;
  if (cp != null && book && book.pageCount) pct = percentFromPages(cp, book.pageCount);
  else if (pct != null && book && book.pageCount && cp == null) cp = Math.round((pct / 100) * book.pageCount);
  await Storage.ProgressUpdates.add(entry.id, { date, currentPage: cp, percent: pct });
  return Storage.ReadingEntries.update(entry.id, {
    currentPage: cp ?? entry.currentPage,
    progressPercent: pct ?? entry.progressPercent,
  });
}

/** Current consecutive-day reading streak from session dates (today may be "not yet logged" without breaking it). */
function computeReadingStreak(sessionList) {
  const days = new Set(sessionList.map((s) => s.date));
  if (!days.size) return 0;
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  let streak = 0;
  let cursor = new Date();
  if (!days.has(fmt(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (days.has(fmt(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function groupBy(array, keyFn) {
  const map = new Map();
  for (const item of array) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

function tallyCounts(items) {
  const map = new Map();
  for (const item of items) map.set(item, (map.get(item) || 0) + 1);
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

function coverFallbackHTML(title) {
  return `<div class="cover-fallback"><span>${escapeHtml(truncate(title, 60))}</span></div>`;
}

/** Resolves the best available <img> src / fallback markup for a book's cover. */
async function coverMarkup(book, className = '') {
  if (!book) return coverFallbackHTML('');
  if (book.hasCachedCover) {
    const url = await Storage.Covers.getObjectUrl(book.id);
    if (url) return `<img class="${className}" src="${url}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">${coverFallbackHiddenHTML(book.title)}`;
  }
  if (book.coverUrl) {
    return `<img class="${className}" src="${escapeHtml(book.coverUrl)}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">${coverFallbackHiddenHTML(book.title)}`;
  }
  return coverFallbackHTML(book.title);
}

const STATUS_COLOR = {
  want_to_read: 'var(--gold)',
  currently_reading: 'var(--accent)',
  finished: 'var(--sage)',
  dnf: 'var(--danger)',
  paused: 'var(--text-muted)',
};

/** Renders a cover-grid book card for a { ...readingEntry, book } record. */
async function bookCardHTML(entry, { showProgress = false } = {}) {
  const book = entry.book;
  if (!book) return '';
  const cover = await coverMarkup(book);
  const showSliver = showProgress && entry.status === 'currently_reading';
  return `
    <div class="book-card fade-in" data-book-id="${book.id}">
      <div class="cover-wrap">
        ${cover}
        <span class="status-dot" style="background:${STATUS_COLOR[entry.status] || 'var(--text-muted)'}"></span>
        ${showSliver ? `<span class="progress-sliver"><span style="width:${entry.progressPercent || 0}%"></span></span>` : ''}
      </div>
      <div class="title">${escapeHtml(truncate(book.title, 60))}</div>
      <div class="author">${escapeHtml(authorList(book.authors))}</div>
      ${entry.rating ? `<div class="rating-mini">${starsDisplayHTML(entry.rating, 'sm')}</div>` : ''}
    </div>`;
}

/** Delegated click handler that navigates to a book's detail page. */
function wireBookCardClicks(container) {
  container.addEventListener('click', (e) => {
    const card = e.target.closest('[data-book-id]');
    if (card) window.location.href = `book.html?id=${card.dataset.bookId}`;
  });
}

async function renderCardList(container, entries, opts) {
  const html = await Promise.all(entries.map((e) => bookCardHTML(e, opts)));
  container.innerHTML = html.join('') || '';
  wireBookCardClicks(container);
}

function coverFallbackHiddenHTML(title) {
  return `<div class="cover-fallback" style="display:none;position:absolute;inset:0;"><span>${escapeHtml(truncate(title, 60))}</span></div>`;
}
