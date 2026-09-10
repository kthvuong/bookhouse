/* ============================================================
   home.js — dashboard: currently reading, goal, recent, up next,
   this month, and a few quiet stats.
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
  const finishedThisYear = finished.filter((e) => new Date(e.dateFinished + 'T00:00:00').getFullYear() === thisYear);
  const finishedThisMonth = finishedThisYear.filter((e) => new Date(e.dateFinished + 'T00:00:00').getMonth() === thisMonth);

  const recent = finished.slice().sort((a, b) => b.dateFinished.localeCompare(a.dateFinished)).slice(0, 8);

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
  document.getElementById('this-month-heading').textContent = `${MONTH_NAMES[thisMonth]}`;
  const monthRail = document.getElementById('this-month-rail');
  if (!finishedThisMonth.length) {
    monthRail.innerHTML = emptyState('🗓️', 'No finishes yet this month', 'Books you complete this month will collect here.');
  } else {
    await renderCardList(monthRail, finishedThisMonth.sort((a,b)=>b.dateFinished.localeCompare(a.dateFinished)));
  }

  // ---- Recent reads ----
  const recentRail = document.getElementById('recent-rail');
  if (!recent.length) {
    recentRail.innerHTML = emptyState('✨', 'No finished books yet', 'Your finished books will show up here.');
  } else {
    await renderCardList(recentRail, recent);
  }

  // ---- Up next ----
  const upNextRail = document.getElementById('up-next-rail');
  if (!upNext.length) {
    upNextRail.innerHTML = emptyState('📚', 'Your TBR is empty', 'Search for a book above to add it to Want to Read.');
  } else {
    await renderCardList(upNextRail, upNext);
  }

  // ---- Goal panel ----
  const goal = await Storage.Goals.get(thisYear);
  const goalContent = document.getElementById('goal-content');
  const pagesThisYear = finishedThisYear.reduce((sum, e) => sum + (e.book?.pageCount || 0), 0);

  if (!goal || (!goal.targetBooks && !goal.targetPages)) {
    goalContent.innerHTML = `<p class="goal-empty text-secondary">No goal set for ${thisYear}. <a href="settings.html#goals">Set one →</a></p>`;
  } else {
    let rows = '';
    if (goal.targetBooks) {
      const pct = clamp((finishedThisYear.length / goal.targetBooks) * 100, 0, 100);
      rows += `
        <div class="goal-row">
          ${ringChartSVG({ percent: pct, size: 92, label: finishedThisYear.length + '', sublabel: 'of ' + goal.targetBooks })}
          <div>
            <div class="goal-figure">${finishedThisYear.length} <small>/ ${goal.targetBooks} books</small></div>
            <div class="progress-track" style="margin-top:8px;width:150px;"><span style="width:${pct}%"></span></div>
          </div>
        </div>`;
    }
    if (goal.targetPages) {
      const pct = clamp((pagesThisYear / goal.targetPages) * 100, 0, 100);
      rows += `
        <div style="margin-top:16px;">
          <div class="kv"><span class="k">Pages</span><span class="v">${pagesThisYear.toLocaleString()} / ${goal.targetPages.toLocaleString()}</span></div>
          <div class="progress-track" style="margin-top:6px;"><span style="width:${pct}%"></span></div>
        </div>`;
    }
    goalContent.innerHTML = rows;
  }

  // ---- Mini stats ----
  const ratedThisYear = finishedThisYear.filter((e) => e.rating);
  const avgRating = ratedThisYear.length
    ? (ratedThisYear.reduce((s, e) => s + e.rating, 0) / ratedThisYear.length)
    : null;

  const sessions = await Storage.ReadingSessions.getAll();
  const streak = computeReadingStreak(sessions);

  document.getElementById('mini-stats').innerHTML = `
    <div class="mini-stats-grid">
      <div class="mini-stat"><div class="figure">${finishedThisYear.length}</div><div class="caption">Books read</div></div>
      <div class="mini-stat"><div class="figure">${pagesThisYear.toLocaleString()}</div><div class="caption">Pages read</div></div>
      <div class="mini-stat"><div class="figure">${avgRating ? avgRating.toFixed(1) : '—'}</div><div class="caption">Average rating</div></div>
      <div class="mini-stat"><div class="figure">${currentlyReading.length}</div><div class="caption">In progress</div></div>
    </div>
    ${streak > 0 ? `<div class="streak-line">🔥 <strong>${streak}-day</strong>&nbsp;reading streak</div>` : ''}
  `;

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
