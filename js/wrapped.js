/* ============================================================
   wrapped.js — list of yearly Wrapped retrospectives
   ============================================================ */

(async function () {
  initHeader('wrapped');

  const entries = (await Storage.ReadingEntries.allWithBooks()).filter((e) => e.book);
  const finishedYears = [...new Set(entries.filter((e) => e.status === 'finished' && e.dateFinished).map((e) => new Date(`${normalizeDateStr(e.dateFinished)}T00:00:00`).getFullYear()))].sort((a, b) => b - a);

  const existingWrapped = await Storage.Wrapped.getAll();
  const existingYears = new Set(existingWrapped.map((w) => w.year));

  const existingContainer = document.getElementById('existing-years');
  const candidateContainer = document.getElementById('candidate-years');
  const generateSection = document.getElementById('generate-section');

  if (!existingWrapped.length) {
    existingContainer.innerHTML = `<div class="empty-state" style="width:100%;"><p>No Wrapped generated yet — pick a year below to create your first one.</p></div>`;
  } else {
    existingContainer.innerHTML = existingWrapped.map((w) => `
      <div class="wrapped-year-card" data-year="${w.year}">
        <div class="year-num serif">${w.year}</div>
        <div class="year-sub">${w.stats.booksFinished} books · ${w.stats.pagesRead.toLocaleString()} pages</div>
      </div>`).join('');
  }

  const candidateYears = finishedYears.filter((y) => !existingYears.has(y));
  if (!candidateYears.length) {
    generateSection.hidden = true;
  } else {
    candidateContainer.innerHTML = candidateYears.map((y) => `
      <div class="wrapped-year-card" data-year="${y}" style="border-style:dashed;">
        <div class="year-num serif">${y}</div>
        <div class="year-sub">Not generated yet →</div>
      </div>`).join('');
  }

  document.querySelectorAll('[data-year]').forEach((card) => {
    card.addEventListener('click', () => { window.location.href = `wrapped-year.html?year=${card.dataset.year}`; });
  });
})();
