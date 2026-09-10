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
/**
 * Renders `length` single-digit boxes (a PIN-entry pattern) into `container`.
 * Auto-advances focus as digits are typed, auto-backspaces across boxes,
 * supports pasting a full code, and calls onComplete(value) as soon as
 * every box is filled. Returns { clear, shake, focus, value }.
 */
function mountPinInput(container, { length = 4, onComplete } = {}) {
  container.innerHTML = Array.from({ length }).map((_, i) =>
    `<input type="tel" inputmode="numeric" pattern="[0-9]*" maxlength="1" class="pin-box" data-pin-index="${i}" autocomplete="one-time-code">`
  ).join('');
  const inputs = [...container.querySelectorAll('.pin-box')];

  function value() { return inputs.map((i) => i.value).join(''); }
  function clear() { inputs.forEach((i) => (i.value = '')); inputs[0].focus(); }
  function focus() { inputs[0].focus(); }
  function shake() {
    container.classList.add('pin-shake');
    setTimeout(() => container.classList.remove('pin-shake'), 400);
  }

  inputs.forEach((input, idx) => {
    input.addEventListener('input', () => {
      input.value = input.value.replace(/[^0-9]/g, '').slice(0, 1);
      if (input.value && idx < inputs.length - 1) inputs[idx + 1].focus();
      if (value().length === length) onComplete && onComplete(value());
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !input.value && idx > 0) inputs[idx - 1].focus();
    });
    input.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = ((e.clipboardData && e.clipboardData.getData('text')) || '').replace(/[^0-9]/g, '').slice(0, length);
      text.split('').forEach((ch, i) => { if (inputs[i]) inputs[i].value = ch; });
      const last = Math.min(text.length, length) - 1;
      if (last >= 0) inputs[last].focus();
      if (text.length === length) onComplete && onComplete(text);
    });
  });

  return { clear, shake, focus, value };
}

function mountStarInput(container, opts) {
  let value = opts.value || 0;
  const size = opts.size || 'lg';

  // Build the star DOM exactly once. Hover/click only ever adjust the fill
  // widths of existing elements afterwards — never rebuild the hit-areas —
  // so a click can't land on a half-hit span that a preceding mousemove
  // already tore down and replaced out from under the cursor.
  let slots = '';
  for (let i = 0; i < 5; i++) {
    slots += `
      <span class="star-slot" data-index="${i}">
        ${svgStar('star-bg')}
        <span class="star-fg-wrap" style="position:absolute;inset:0;overflow:hidden;width:0%;">${svgStar('star-fg')}</span>
        <span class="half-hit" data-value="${i + 0.5}"></span>
        <span class="half-hit right" data-value="${i + 1}"></span>
      </span>`;
  }
  container.innerHTML = `
    <span class="star-input ${size}">${slots}</span>
    <span class="rating-label"></span>
  `;

  const fgWraps = container.querySelectorAll('.star-fg-wrap');
  const label = container.querySelector('.rating-label');

  function paintFill(r) {
    for (let i = 0; i < 5; i++) {
      const diff = r - i;
      const fillPct = diff >= 1 ? 100 : diff > 0 ? 50 : 0;
      fgWraps[i].style.width = `${fillPct}%`;
    }
  }
  function paintLabel() {
    label.textContent = value ? ratingText(value) : 'Tap to rate';
  }

  container.addEventListener('mousemove', (e) => {
    const hit = e.target.closest('.half-hit');
    if (!hit) return;
    paintFill(parseFloat(hit.dataset.value));
  });
  container.addEventListener('mouseleave', () => paintFill(value));
  container.addEventListener('click', (e) => {
    const hit = e.target.closest('.half-hit');
    if (!hit) return;
    value = parseFloat(hit.dataset.value);
    paintFill(value);
    paintLabel();
    opts.onChange && opts.onChange(value);
  });

  paintFill(value);
  paintLabel();
  return { setValue: (v) => { value = v; paintFill(value); paintLabel(); } };
}

/** Reading dates (dateStarted/dateFinished) may be day-precise ("YYYY-MM-DD")
 *  or, when the exact day isn't known, month-precise ("YYYY-MM"). This pads
 *  a month-only value to a real date string so Date math never breaks on it. */
function normalizeDateStr(str) {
  if (!str) return null;
  return str.length === 7 ? `${str}-01` : str;
}

function formatDate(isoOrDateStr, style = 'medium') {
  if (!isoOrDateStr) return '';
  const monthOnly = isoOrDateStr.length === 7;
  const d = new Date(monthOnly ? `${isoOrDateStr}-01T00:00:00` : isoOrDateStr.length === 10 ? `${isoOrDateStr}T00:00:00` : isoOrDateStr);
  if (isNaN(d)) return '';
  if (monthOnly || style === 'monthYear') return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
  if (style === 'short') return `${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`;
  if (style === 'year') return `${d.getFullYear()}`;
  return `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/** Splits a possibly-partial date string into parts for the month/day/year fields below. */
function parseDateParts(value) {
  if (!value) return { year: '', month: '', day: '' };
  const [year, month, day] = value.split('-');
  return { year: year || '', month: month ? String(Number(month)) : '', day: day ? String(Number(day)) : '' };
}

/** Renders a compact Month / Day (optional) / Year date field with a "Today" shortcut.
 *  Leaving Day blank stores a month-precision date ("YYYY-MM") instead of a full one. */
function partialDateFieldHTML(idPrefix, label, value) {
  const { year, month, day } = parseDateParts(value);
  return `
    <div class="field">
      <label>${label}</label>
      <div class="partial-date-field">
        <select class="input" id="${idPrefix}-month">
          <option value="">Month</option>
          ${MONTH_NAMES.map((m, i) => `<option value="${i + 1}" ${Number(month) === i + 1 ? 'selected' : ''}>${m}</option>`).join('')}
        </select>
        <input type="number" class="input" id="${idPrefix}-day" placeholder="Day" min="1" max="31" value="${escapeHtml(day)}">
        <input type="number" class="input" id="${idPrefix}-year" placeholder="Year" min="1000" max="9999" value="${escapeHtml(year)}">
        <button type="button" class="btn btn-ghost btn-sm" data-today-for-partial="${idPrefix}">Today</button>
      </div>
    </div>`;
}

/** Reads a partialDateFieldHTML's three inputs back into '' | 'YYYY-MM' | 'YYYY-MM-DD'. */
function readPartialDateField(root, idPrefix) {
  const month = root.querySelector(`#${idPrefix}-month`).value;
  const day = root.querySelector(`#${idPrefix}-day`).value;
  const year = root.querySelector(`#${idPrefix}-year`).value;
  if (!year || !month) return '';
  const mm = String(month).padStart(2, '0');
  return day ? `${year}-${mm}-${String(day).padStart(2, '0')}` : `${year}-${mm}`;
}

/** Wires a partialDateFieldHTML's inputs + Today button; calls onChange with the combined value. */
function wirePartialDateField(root, idPrefix, onChange) {
  ['month', 'day', 'year'].forEach((part) => {
    root.querySelector(`#${idPrefix}-${part}`).addEventListener('change', () => onChange(readPartialDateField(root, idPrefix)));
  });
  const todayBtn = root.querySelector(`[data-today-for-partial="${idPrefix}"]`);
  if (todayBtn) {
    todayBtn.addEventListener('click', () => {
      const d = new Date();
      root.querySelector(`#${idPrefix}-month`).value = d.getMonth() + 1;
      root.querySelector(`#${idPrefix}-day`).value = d.getDate();
      root.querySelector(`#${idPrefix}-year`).value = d.getFullYear();
      onChange(readPartialDateField(root, idPrefix));
    });
  }
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

/**
 * Small celebratory popup shown when a book is marked Finished — lets the
 * reader drop in a star rating right away, or skip it entirely. Resolves
 * with the chosen rating (or null if skipped/dismissed). Never invents a
 * date; that stays the reader's call elsewhere.
 */
function promptFinishedRating(book) {
  return new Promise(async (resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const cover = await coverMarkup(book);
    overlay.innerHTML = `
      <div class="modal" style="max-width:380px;" role="dialog" aria-modal="true">
        <div class="modal-body finished-popup">
          <div class="finished-popup-cover">${cover}</div>
          <div class="eyebrow" style="margin-top:14px;">Marked as Finished</div>
          <h3 class="serif" style="margin-top:4px;">${escapeHtml(book.title)}</h3>
          <p class="text-muted" style="font-size:13.5px;margin-top:4px;">Want to rate it now?</p>
          <div id="finished-rating-mount" style="display:flex;justify-content:center;margin-top:14px;"></div>
        </div>
        <div class="modal-footer" style="justify-content:center;gap:12px;">
          <button class="btn btn-ghost" id="finished-skip-btn">Skip</button>
          <button class="btn btn-primary" id="finished-save-btn">Save Rating</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));

    let rating = 0;
    mountStarInput(overlay.querySelector('#finished-rating-mount'), { size: 'lg', onChange: (v) => (rating = v) });

    function finish(value) {
      overlay.classList.remove('open');
      setTimeout(() => overlay.remove(), 200);
      resolve(value);
    }
    overlay.querySelector('#finished-skip-btn').addEventListener('click', () => finish(null));
    overlay.querySelector('#finished-save-btn').addEventListener('click', () => finish(rating || null));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(null); });
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
