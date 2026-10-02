/* ============================================================
   home.js — dashboard: currently reading, the reading goal (a
   bookshelf that fills up as you finish books), a "your year so
   far" recap, this month, and up next.
   ============================================================ */

(async function () {
  initHeader('home');

  const now = new Date();
  document.getElementById('home-date').textContent = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  document.getElementById('home-greeting').textContent = USER_NAME ? `${greeting}, ${USER_NAME}` : greeting;

  const entries = await Storage.ReadingEntries.allWithBooks();
  const thisYear = now.getFullYear();
  const thisMonth = now.getMonth();

  const currentlyReading = entries.filter((e) => e.status === 'currently_reading' && e.book)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const finished = entries.filter((e) => e.status === 'finished' && e.book && e.dateFinished);
  const finishedThisYear = finished.filter((e) => new Date(`${normalizeDateStr(e.dateFinished)}T00:00:00`).getFullYear() === thisYear);
  const finishedThisMonth = finishedThisYear.filter((e) => new Date(`${normalizeDateStr(e.dateFinished)}T00:00:00`).getMonth() === thisMonth);

  const upNext = entries.filter((e) => e.status === 'want_to_read' && e.book)
    .sort((a, b) => {
      const pr = { high: 0, normal: 1, low: 2 };
      const pd = (pr[a.priority] ?? 1) - (pr[b.priority] ?? 1);
      return pd !== 0 ? pd : a.sortOrder - b.sortOrder;
    })
    .slice(0, 8);

  // ---- Currently reading rail ----
  const crRail = document.getElementById('currently-reading-rail');
  if (!currentlyReading.length) {
    crRail.innerHTML = emptyState('📖', 'Nothing in progress', 'Start a book from your Want to Read list, or add something new.');
  } else {
    const cards = await Promise.all(currentlyReading.map(currentlyReadingCardHTML));
    crRail.innerHTML = cards.join('');
    wireBookCardClicks(crRail);
  }

  // ---- This month ----
  document.getElementById('this-month-heading').textContent = `${MONTH_NAMES[thisMonth]} Reads`;
  document.getElementById('this-month-see-all').href = `history.html?year=${thisYear}&month=${thisMonth}`;
  const monthRail = document.getElementById('this-month-rail');
  if (!finishedThisMonth.length) {
    monthRail.innerHTML = emptyState('🗓️', 'No finishes yet this month', 'Books you complete this month will collect here.');
  } else {
    await renderCardList(monthRail, finishedThisMonth.sort((a,b)=>b.dateFinished.localeCompare(a.dateFinished)));
  }

  // ---- Up next ----
  const upNextRail = document.getElementById('up-next-rail');
  if (!upNext.length) {
    upNextRail.innerHTML = emptyState('📚', 'Your TBR is empty', 'Search for a book above to add it to Want to Read.');
  } else {
    await renderCardList(upNextRail, upNext);
  }

  const pagesThisYear = finishedThisYear.reduce((sum, e) => sum + (e.book?.pageCount || 0), 0);
  const yearStart = new Date(thisYear, 0, 1);
  const yearEnd = new Date(thisYear + 1, 0, 1);
  const yearFraction = (now - yearStart) / (yearEnd - yearStart);
  const daysLeft = Math.max(1, Math.ceil((yearEnd - now) / 86400000));
  const plural = (n, word) => `${n.toLocaleString()} ${n === 1 ? word : `${word}s`}`;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- Reading goal: a bookshelf that fills up as you finish books ----
  const goalPanel = document.getElementById('goal-panel');
  renderGoal(await Storage.Goals.get(thisYear));

  // ---- Your year so far ----
  const sessions = await Storage.ReadingSessions.getAll();
  renderRecap(computeReadingStreak(sessions));

  function renderGoal(goal) {
    const booksTarget = (goal && goal.targetBooks) || 0;
    const pagesTarget = (goal && goal.targetPages) || 0;
    goalPanel.classList.remove('goal-card--done');

    if (!booksTarget && !pagesTarget) {
      goalPanel.innerHTML = goalEmptyHTML();
      goalPanel.querySelectorAll('[data-quick-goal]').forEach((btn) => btn.addEventListener('click', async () => {
        await Storage.Goals.set(thisYear, { targetBooks: Number(btn.dataset.quickGoal) });
        renderGoal(await Storage.Goals.get(thisYear));
      }));
      return;
    }

    // A books goal is the headline (and gets the shelf); a pages-only goal
    // gets the same treatment with a progress bar instead.
    const unit = booksTarget ? 'book' : 'page';
    const done = booksTarget ? finishedThisYear.length : pagesThisYear;
    const target = booksTarget || pagesTarget;
    const pace = paceFor(done, target, unit);
    goalPanel.classList.toggle('goal-card--done', pace.state === 'done');
    goalPanel.innerHTML = `
      <div class="goal-card-head">
        <div class="eyebrow">${thisYear} Reading Goal</div>
        <a class="goal-edit" href="settings.html#goals">Edit goal</a>
      </div>
      <div class="goal-headline">
        <div class="goal-count">
          <span class="goal-num" data-count-to="${done}">${done.toLocaleString()}</span>
          <span class="goal-of">of ${plural(target, unit)}</span>
        </div>
        <span class="goal-pct">${Math.round((done / target) * 100)}%</span>
      </div>
      <div class="goal-pace goal-pace--${pace.state}"><span aria-hidden="true">${pace.icon}</span>${escapeHtml(pace.text)}</div>
      ${booksTarget
        ? shelfHTML(booksTarget)
        : `<div class="progress-track goal-meter"><span style="width:${clamp((done / target) * 100, 0, 100)}%"></span></div>`}
      <div class="goal-foot">${escapeHtml(pace.foot)}</div>
      ${booksTarget && pagesTarget ? `
        <div class="goal-pages">
          <div class="goal-pages-row"><span>Pages</span><span>${pagesThisYear.toLocaleString()} / ${pagesTarget.toLocaleString()}</span></div>
          <div class="progress-track"><span style="width:${clamp((pagesThisYear / pagesTarget) * 100, 0, 100)}%"></span></div>
        </div>` : ''}`;
    if (booksTarget) wireShelf();
    countUp(goalPanel);
  }

  function goalEmptyHTML() {
    const soFar = finishedThisYear.length
      ? `You've already finished ${plural(finishedThisYear.length, 'book')} this year. `
      : '';
    return `
      <div class="goal-card-head"><div class="eyebrow">${thisYear} Reading Goal</div></div>
      <div class="goal-empty-title">How many books this year?</div>
      <p class="goal-empty-text">${soFar}Pick a goal and watch your shelf fill up.</p>
      <div class="goal-quick">
        <button type="button" class="goal-quick-btn" data-quick-goal="12"><strong>12</strong><span>one a month</span></button>
        <button type="button" class="goal-quick-btn" data-quick-goal="24"><strong>24</strong><span>two a month</span></button>
        <button type="button" class="goal-quick-btn" data-quick-goal="52"><strong>52</strong><span>one a week</span></button>
      </div>
      <a class="goal-custom" href="settings.html#goals">Set a custom goal →</a>`;
  }

  /** Where you are against where an even pace through the year would put you. */
  function paceFor(done, target, unit) {
    const remaining = target - done;
    if (remaining <= 0) {
      const extra = -remaining;
      return {
        state: 'done',
        icon: '🎉',
        text: extra ? `Goal smashed, plus ${plural(extra, unit)} extra!` : 'Goal complete!',
        foot: `Every ${unit} from here on is a bonus.`,
      };
    }
    const diff = done - target * yearFraction;
    const slack = Math.max(1, target * 0.02);
    const foot = `${plural(remaining, unit)} to go · ${catchUpRate(remaining, unit)}`;
    if (diff >= slack) return { state: 'ahead', icon: '🚀', text: `${plural(Math.floor(diff), unit)} ahead of pace`, foot };
    if (diff <= -slack) return { state: 'behind', icon: '📖', text: `${plural(Math.floor(-diff), unit)} behind pace`, foot };
    return { state: 'on-track', icon: '✨', text: 'Right on pace', foot };
  }

  function catchUpRate(remaining, unit) {
    if (unit === 'page') return `about ${Math.ceil(remaining / daysLeft).toLocaleString()} a day to finish`;
    const everyDays = daysLeft / remaining;
    if (everyDays >= 1.5) return `about 1 every ${Math.round(everyDays)} days to finish`;
    return `about ${Math.ceil((remaining / daysLeft) * 7)} a week to finish`;
  }

  function shelfHTML(target) {
    const shelved = finishedThisYear.slice()
      .sort((a, b) => normalizeDateStr(a.dateFinished).localeCompare(normalizeDateStr(b.dateFinished)));
    const slots = Math.max(target, shelved.length);
    const size = slots > 60 ? 'sm' : slots > 30 ? 'md' : slots > 15 ? 'lg' : 'xl';
    const cached = readSpineColors();
    let spines = '';
    for (let i = 0; i < slots; i++) {
      const entry = shelved[i];
      const style = `--h:${72 + (hashInt(entry ? entry.book.id : `slot-${i}`) % 29)}%;--i:${i}`;
      if (!entry) {
        spines += `<span class="spine spine--empty" style="${style}"></span>`;
        continue;
      }
      const color = cached[spineKey(entry.book)] || spineColor(hashColor(entry.book.title || entry.book.id));
      spines += `<span class="spine${i >= target ? ' spine--bonus' : ''}" data-book-id="${entry.book.id}" style="${style};--spine:${color}"></span>`;
    }
    const label = `Bookshelf: ${plural(shelved.length, 'book')} finished out of a goal of ${target}`;
    return `<div class="goal-shelf goal-shelf--${size}" role="img" aria-label="${label}">${spines}</div>`;
  }

  /** Spine hover card, click-through to the book, and each spine painted in
   *  its cover's colors (remembered, so the next visit doesn't repaint). */
  function wireShelf() {
    const shelf = goalPanel.querySelector('.goal-shelf');
    const byId = new Map(finishedThisYear.map((e) => [e.book.id, e]));
    const tip = document.createElement('div');
    tip.className = 'spine-tip';
    tip.hidden = true;
    goalPanel.appendChild(tip);

    shelf.addEventListener('click', (e) => {
      const spine = e.target.closest('.spine[data-book-id]');
      if (spine) window.location.href = `book.html?id=${spine.dataset.bookId}`;
    });
    shelf.addEventListener('pointerover', (e) => {
      const spine = e.target.closest('.spine[data-book-id]');
      if (!spine) { tip.hidden = true; return; }
      const entry = byId.get(spine.dataset.bookId);
      const title = document.createElement('strong');
      title.textContent = entry.book.title;
      const meta = document.createElement('span');
      meta.textContent = [`Finished ${formatDate(entry.dateFinished, 'short')}`, entry.rating ? `★ ${entry.rating}` : '']
        .filter(Boolean).join(' · ');
      tip.replaceChildren(title, meta);
      tip.hidden = false;
      const card = goalPanel.getBoundingClientRect();
      const r = spine.getBoundingClientRect();
      tip.style.left = `${clamp(r.left + r.width / 2 - card.left - tip.offsetWidth / 2, 8, card.width - tip.offsetWidth - 8)}px`;
      tip.style.top = `${r.top - card.top - tip.offsetHeight - 8}px`;
    });
    shelf.addEventListener('pointerleave', () => { tip.hidden = true; });

    const cache = readSpineColors();
    shelf.querySelectorAll('.spine[data-book-id]').forEach(async (el) => {
      const book = byId.get(el.dataset.bookId).book;
      const key = spineKey(book);
      if (cache[key]) return;
      await cacheCover(book);
      const rgb = await coverColor(book, { vibrant: true });
      // No cover to sample (yet): the spine keeps the hashed colour it was
      // drawn with, and nothing is remembered, so a later visit tries again.
      if (!rgb) return;
      const color = spineColor(rgb);
      el.style.setProperty('--spine', color);
      cache[key] = color;
      writeSpineColors(cache);
    });
  }

  function renderRecap(streak) {
    document.getElementById('recap-heading').textContent = `Your ${thisYear} So Far`;
    const rated = finishedThisYear.filter((e) => e.rating);
    const avg = rated.length ? rated.reduce((s, e) => s + e.rating, 0) / rated.length : null;
    const fiveStars = rated.filter((e) => e.rating >= 5).length;
    const longest = finishedThisYear.reduce((best, e) => ((e.book.pageCount || 0) > ((best && best.book.pageCount) || 0) ? e : best), null);

    const tiles = [
      {
        key: 'books', icon: '📚', value: finishedThisYear.length,
        label: finishedThisYear.length === 1 ? 'Book finished' : 'Books finished',
        note: finishedThisMonth.length ? `${finishedThisMonth.length} so far in ${MONTH_NAMES[thisMonth]}` : `None yet in ${MONTH_NAMES[thisMonth]}`,
      },
      { key: 'pages', icon: '📄', value: pagesThisYear, label: 'Pages read', note: hobbitNote(pagesThisYear / 310) },
      {
        key: 'rating', icon: '⭐', value: avg, decimals: 1, label: 'Average rating',
        note: !rated.length ? 'Rate a finished book to see this'
          : fiveStars ? plural(fiveStars, 'five-star read') : `Across ${plural(rated.length, 'rated book')}`,
      },
      streak > 0
        ? { key: 'streak', icon: '🔥', value: streak, label: streak === 1 ? 'Day streak' : 'Day reading streak', note: streak === 1 ? 'Day one. Nice start!' : 'Keep it going!' }
        : longest && longest.book.pageCount
          ? { key: 'longest', icon: '🏔️', value: longest.book.pageCount, label: 'Pages in your longest read', note: longest.book.title }
          : { key: 'progress', icon: '⏳', value: currentlyReading.length, label: 'In progress', note: 'Log a reading session to start a streak' },
    ];

    const tileHTML = (t) => {
      const decimals = t.decimals || 0;
      const shown = t.value == null ? '—' : t.value.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
      return `
        <div class="recap-tile recap-tile--${t.key}">
          <span class="recap-watermark" aria-hidden="true">${t.icon}</span>
          <div class="recap-label">${escapeHtml(t.label)}</div>
          <div class="recap-value"${t.value != null ? ` data-count-to="${t.value}" data-decimals="${decimals}"` : ''}>${shown}</div>
          <div class="recap-note">${escapeHtml(t.note)}</div>
        </div>`;
    };

    const recap = document.getElementById('recap-content');
    recap.innerHTML = `
      <div class="recap-tiles">${tiles.map(tileHTML).join('')}</div>
      ${monthStripHTML()}`;
    countUp(recap);
  }

  function hobbitNote(hobbits) {
    if (hobbits <= 0) return 'Every page counts';
    if (hobbits < 1) return `${Math.round(hobbits * 100)}% of a copy of The Hobbit`;
    const n = hobbits >= 10 ? Math.round(hobbits) : Math.round(hobbits * 10) / 10;
    return `About ${n} ${n === 1 ? 'copy' : 'copies'} of The Hobbit`;
  }

  /** Books finished per month: one series, so one hue, with this month the
   *  darker step. Values are labelled on this month and the best month(s);
   *  every other month shows its count on hover/focus. */
  function monthStripHTML() {
    if (!finishedThisYear.length) {
      return `<div class="panel recap-months"><p class="recap-months-empty">Your months will fill in here as you finish books.</p></div>`;
    }
    const counts = new Array(12).fill(0);
    finishedThisYear.forEach((e) => { counts[new Date(`${normalizeDateStr(e.dateFinished)}T00:00:00`).getMonth()]++; });
    const most = Math.max(...counts);
    const bestMonths = counts.map((n, m) => (n === most ? m : -1)).filter((m) => m >= 0);
    // Ties are common (lots of 2- and 3-book months), so name every tied month —
    // unless there are so many that it stops meaning anything.
    const namedBest = bestMonths.length <= 3;
    const bestNames = bestMonths.map((m) => (bestMonths.length > 1 ? MONTH_SHORT[m] : MONTH_NAMES[m]));
    const bestText = !namedBest
      ? `Up to ${plural(most, 'book')} a month`
      : bestNames.length === 1
        ? `Best month: ${bestNames[0]} · ${plural(most, 'book')}`
        : `Best months: ${bestNames.slice(0, -1).join(', ')} & ${bestNames[bestNames.length - 1]} · ${plural(most, 'book')} each`;
    const cols = counts.map((n, m) => {
      const future = m > thisMonth;
      const current = m === thisMonth;
      const labelled = n > 0 && (current || (namedBest && n === most));
      const name = MONTH_NAMES[m];
      return `
        <div class="month-col${current ? ' is-current' : ''}${future ? ' is-future' : ''}" style="--v:${n / most}"${future ? '' : ` tabindex="0" aria-label="${name}: ${plural(n, 'book')}"`}>
          <div class="month-plot">
            ${labelled ? `<span class="month-val">${n}</span>` : ''}
            ${n ? '<span class="month-bar"></span>' : ''}
            ${future ? '' : `<span class="month-tip" aria-hidden="true">${plural(n, 'book')}</span>`}
          </div>
          <span class="month-label">${MONTH_SHORT[m]}</span>
        </div>`;
    }).join('');
    return `
      <div class="panel recap-months">
        <div class="recap-months-head">
          <span class="eyebrow">Month by month</span>
          <span class="recap-months-best">${bestText}</span>
        </div>
        <div class="month-strip" role="group" aria-label="Books finished each month in ${thisYear}">${cols}</div>
      </div>`;
  }

  /** Counts each [data-count-to] number up from zero — skipped when the
   *  reader has asked for reduced motion. */
  function countUp(root) {
    if (reduceMotion) return;
    root.querySelectorAll('[data-count-to]').forEach((el) => {
      const to = Number(el.dataset.countTo);
      const decimals = Number(el.dataset.decimals || 0);
      if (!(to > 1)) return;
      const format = (v) => v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
      const start = performance.now();
      const step = (t) => {
        const p = Math.min(1, (t - start) / 700);
        el.textContent = format(to * (1 - Math.pow(1 - p, 3)));
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  /** Normalises a sampled cover color into a spine color: colorful covers
   *  keep their hue within a pleasant saturation/lightness band, and
   *  black-and-white covers become a warm charcoal-to-cream spine. */
  function spineColor([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    const l = (max + min) / 2;
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    if (s < 0.12) return `hsl(30 8% ${Math.round(clamp(l, 0.22, 0.72) * 100)}%)`;
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = Math.round(h * 60 + 360) % 360;
    return `hsl(${h} ${Math.round(clamp(s, 0.3, 0.72) * 100)}% ${Math.round(clamp(l, 0.32, 0.6) * 100)}%)`;
  }

  function hashInt(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
    return hash;
  }

  // Keyed on the cover too, so changing a book's cover re-samples its spine.
  function spineKey(book) { return `${book.id}|${book.coverUrl || ''}`; }
  // Only colours sampled from a real cover are remembered. The first version
  // of this cache ('bh_spine_colors') also kept the hashed stand-in for every
  // cover that couldn't be read, so it's dropped rather than carried over.
  function readSpineColors() {
    try {
      localStorage.removeItem('bh_spine_colors');
      return JSON.parse(localStorage.getItem('bh_spine_colors_v2') || '{}');
    } catch (e) { return {}; }
  }
  function writeSpineColors(map) {
    try { localStorage.setItem('bh_spine_colors_v2', JSON.stringify(map)); } catch (e) {}
  }

  async function currentlyReadingCardHTML(entry) {
    const cover = await coverMarkup(entry.book);
    return `
      <div class="book-card cr-card fade-in" data-book-id="${entry.book.id}">
        <div class="cover-wrap">${cover}</div>
        <div class="title">${escapeHtml(truncate(entry.book.title, 50))}</div>
        <div class="author">${escapeHtml(authorList(entry.book.authors))}</div>
        <div class="progress-track"><span style="width:${entry.progressPercent || 0}%"></span></div>
        <div class="progress-caption"><span>${entry.progressPercent || 0}%</span><span>${entry.currentPage || 0}${entry.book.pageCount ? ' / ' + entry.book.pageCount : ''} pg</span></div>
      </div>`;
  }

  function emptyState(icon, title, text) {
    return `<div class="empty-state" style="width:100%;padding:36px 20px;"><div class="icon">${icon}</div><h3>${title}</h3><p>${text}</p></div>`;
  }

})();
