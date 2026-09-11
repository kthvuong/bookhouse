/* ============================================================
   settings.js — goals, theme, backup/export/restore
   ============================================================ */

(async function () {
  initHeader('settings');
  document.getElementById('about-text').textContent = `${APP_NAME} is a private, single-user reading journal. Book search and cover art come from Open Library; everything you add is stored locally and stays yours.`;

  // ---- goals ----
  const yearInput = document.getElementById('goal-year');
  const booksInput = document.getElementById('goal-books');
  const pagesInput = document.getElementById('goal-pages');
  yearInput.value = new Date().getFullYear();

  async function loadGoalIntoForm() {
    const g = await Storage.Goals.get(Number(yearInput.value));
    booksInput.value = g?.targetBooks || '';
    pagesInput.value = g?.targetPages || '';
  }
  yearInput.addEventListener('change', loadGoalIntoForm);
  await loadGoalIntoForm();

  document.getElementById('save-goal-btn').addEventListener('click', async () => {
    const year = Number(yearInput.value);
    if (!year) { toast('Enter a year'); return; }
    await Storage.Goals.set(year, {
      targetBooks: booksInput.value ? Number(booksInput.value) : null,
      targetPages: pagesInput.value ? Number(pagesInput.value) : null,
    });
    toast(`Goal saved for ${year}`);
    renderGoalHistory();
  });

  async function renderGoalHistory() {
    const goals = await Storage.Goals.getAll();
    const list = document.getElementById('goal-history');
    if (!goals.length) { list.innerHTML = `<p class="text-muted" style="font-size:13.5px;">No goals set yet.</p>`; return; }
    list.innerHTML = goals.map((g) => `
      <div class="goal-history-row">
        <span class="year">${g.year}</span>
        <span>${g.targetBooks ? g.targetBooks + ' books' : '—'}</span>
        <span>${g.targetPages ? g.targetPages.toLocaleString() + ' pages' : '—'}</span>
      </div>`).join('');
  }
  renderGoalHistory();

  // ---- PIN lock ----
  async function sha256Hex(str) {
    const enc = new TextEncoder().encode(str);
    const buf = await crypto.subtle.digest('SHA-256', enc);
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  const pinHint = document.getElementById('pin-set-hint');
  pinHint.textContent = localStorage.getItem('mg_pw_hash') ? 'A PIN is currently set on this device.' : 'No PIN set on this device yet.';

  const newPin = mountPinInput(document.getElementById('new-pin-row'), {
    onComplete: async (value) => {
      localStorage.setItem('mg_pw_hash', await sha256Hex(value));
      localStorage.setItem('mg_authed', '1');
      newPin.clear();
      pinHint.textContent = 'A PIN is currently set on this device.';
      toast('PIN set');
    },
  });

  document.getElementById('lock-now-btn').addEventListener('click', () => {
    if (!localStorage.getItem('mg_pw_hash')) { toast('Set a PIN first'); return; }
    localStorage.removeItem('mg_authed');
    window.location.href = 'index.html';
  });

  document.getElementById('remove-password-btn').addEventListener('click', () => {
    if (!confirm('Remove PIN protection? Anyone with a link to this app will be able to open it.')) return;
    localStorage.removeItem('mg_pw_hash');
    localStorage.removeItem('mg_authed');
    pinHint.textContent = 'No PIN set on this device yet.';
    toast('PIN protection removed');
  });

  // ---- Google Books API key ----
  const googleKeyInput = document.getElementById('google-key-input');
  const googleKeyHint = document.getElementById('google-key-hint');
  function refreshGoogleKeyHint() {
    googleKeyHint.textContent = localStorage.getItem('mg_google_books_key')
      ? 'Using your personal API key for book search.'
      : 'No key set — using the shared free quota (may occasionally hit limits).';
  }
  googleKeyInput.value = localStorage.getItem('mg_google_books_key') || '';
  refreshGoogleKeyHint();
  document.getElementById('save-google-key-btn').addEventListener('click', () => {
    const key = googleKeyInput.value.trim();
    if (key) localStorage.setItem('mg_google_books_key', key);
    else localStorage.removeItem('mg_google_books_key');
    refreshGoogleKeyHint();
    toast(key ? 'API key saved' : 'API key removed');
  });

  // ---- sync ----
  const syncTokenInput = document.getElementById('sync-token-input');
  const syncHint = document.getElementById('sync-hint');
  const syncNowBtn = document.getElementById('sync-now-btn');

  function formatSyncedAt() {
    const iso = Sync.getLastSyncedAt();
    if (!iso) return 'Never synced on this device.';
    return `Last synced ${new Date(iso).toLocaleString()}.`;
  }
  function refreshSyncHint() {
    syncHint.textContent = Sync.isConfigured()
      ? formatSyncedAt()
      : 'No sync token set — this device only has its own local library.';
  }
  syncTokenInput.value = Sync.token();
  refreshSyncHint();

  document.getElementById('save-sync-token-btn').addEventListener('click', () => {
    Sync.setToken(syncTokenInput.value);
    refreshSyncHint();
    toast(Sync.isConfigured() ? 'Sync token saved' : 'Sync token removed');
  });

  syncNowBtn.addEventListener('click', async () => {
    if (!Sync.isConfigured()) { toast('Set a sync token first'); return; }
    syncNowBtn.disabled = true;
    syncNowBtn.textContent = 'Syncing…';
    try {
      await Sync.syncNow();
      toast('Synced');
    } catch (e) {
      toast('Sync failed — check your token and connection');
    }
    syncNowBtn.disabled = false;
    syncNowBtn.textContent = 'Sync Now';
    refreshSyncHint();
  });

  // ---- theme ----
  const themeBtn = document.getElementById('settings-theme-toggle');
  function refreshThemeLabel() {
    themeBtn.textContent = currentTheme() === 'dark' ? '☀️ Switch to Light' : '🌙 Switch to Dark';
  }
  refreshThemeLabel();
  themeBtn.addEventListener('click', () => { toggleTheme(); refreshThemeLabel(); });

  // ---- backup / export ----
  const appSlug = APP_NAME.toLowerCase().replace(/\s+/g, '-');

  function downloadFile(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function toCSV(rows, columns) {
    const esc = (v) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = columns.map((c) => esc(c.label)).join(',');
    const lines = rows.map((row) => columns.map((c) => esc(c.get(row))).join(','));
    return [header, ...lines].join('\n');
  }

  document.getElementById('export-backup-btn').addEventListener('click', async () => {
    const data = await Storage.exportAll();
    downloadFile(`${appSlug}-backup-${todayStr()}.json`, JSON.stringify(data), 'application/json');
    toast('Backup downloaded');
  });

  document.getElementById('export-json-btn').addEventListener('click', async () => {
    const data = await Storage.exportAll();
    delete data.covers;
    downloadFile(`${appSlug}-data-${todayStr()}.json`, JSON.stringify(data, null, 2), 'application/json');
    toast('Data exported');
  });

  document.getElementById('restore-file-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!confirm('This will REPLACE everything currently in your library with the contents of this backup. Continue?')) { e.target.value = ''; return; }
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await Storage.importAll(data, { replace: true });
      toast('Backup restored — reloading…');
      setTimeout(() => window.location.href = 'index.html', 1200);
    } catch (err) {
      toast('Could not read that backup file');
    }
  });

  document.getElementById('export-library-csv-btn').addEventListener('click', async () => {
    const entries = (await Storage.ReadingEntries.allWithBooks()).filter((e) => e.book);
    const csv = toCSV(entries, [
      { label: 'Title', get: (e) => e.book.title },
      { label: 'Author', get: (e) => authorList(e.book.authors) },
      { label: 'Status', get: (e) => STATUS_LABELS[e.status] },
      { label: 'Rating', get: (e) => e.rating || '' },
      { label: 'Format', get: (e) => FORMAT_LABELS[e.format] },
      { label: 'Pages', get: (e) => e.book.pageCount || '' },
      { label: 'Publication Year', get: (e) => e.book.firstPublishYear || '' },
      { label: 'ISBN', get: (e) => e.book.isbn13 || e.book.isbn10 || '' },
      { label: 'Genres', get: (e) => (e.book.genres || []).filter((g) => !g.includes(':')).join('; ') },
      { label: 'Date Added', get: (e) => e.addedAt.slice(0, 10) },
      { label: 'Date Started', get: (e) => e.dateStarted || '' },
      { label: 'Date Finished', get: (e) => e.dateFinished || '' },
      { label: 'Tags', get: (e) => (e.tags || []).join('; ') },
    ]);
    downloadFile(`${appSlug}-library-${todayStr()}.csv`, csv, 'text/csv');
    toast('Library exported');
  });

  document.getElementById('export-history-csv-btn').addEventListener('click', async () => {
    const entries = (await Storage.ReadingEntries.allWithBooks())
      .filter((e) => e.book && e.status === 'finished' && e.dateFinished)
      .sort((a, b) => a.dateFinished.localeCompare(b.dateFinished));
    const csv = toCSV(entries, [
      { label: 'Date Finished', get: (e) => e.dateFinished },
      { label: 'Title', get: (e) => e.book.title },
      { label: 'Author', get: (e) => authorList(e.book.authors) },
      { label: 'Rating', get: (e) => e.rating || '' },
      { label: 'Pages', get: (e) => e.book.pageCount || '' },
      { label: 'Format', get: (e) => FORMAT_LABELS[e.format] },
      { label: 'Date Started', get: (e) => e.dateStarted || '' },
    ]);
    downloadFile(`${appSlug}-reading-history-${todayStr()}.csv`, csv, 'text/csv');
    toast('Reading history exported');
  });
})();
