/* ============================================================
   sync.js — cross-device sync transport.

   Bookhouse's data lives in each browser's local IndexedDB
   (storage.js). This is the thin wire layer that lets that data
   round-trip through one small serverless endpoint (api/sync.js) so
   opening the app on a different device sees the same library.

   This file only knows how to talk to the server and remember the
   sync token/watermark — the decision of *when* to pull or push, and
   how to apply what comes back, lives in storage.js (open()/put()/
   remove()/clearStore()) so every existing Storage.* method gets sync
   for free. The one exception is syncNow() below, used by the manual
   "Sync Now" button in Settings — by the time that runs, storage.js
   is already past its own first open(), so it's safe for it to go
   through the normal Storage.exportAll()/importAll() instead.

   This is whole-library, last-write-wins sync, not per-field merging:
   if you edit on two devices before either has synced, whichever
   pushes last wins entirely. Fine for one person on one device at a
   time; not a real-time multi-editor system.
   ============================================================ */

const Sync = (() => {
  const TOKEN_KEY = 'mg_sync_token';
  const WATERMARK_KEY = 'mg_sync_watermark';

  function token() {
    try { return (localStorage.getItem(TOKEN_KEY) || '').trim(); } catch (e) { return ''; }
  }

  function isConfigured() {
    return !!token();
  }

  function setToken(value) {
    try {
      const trimmed = (value || '').trim();
      if (trimmed) localStorage.setItem(TOKEN_KEY, trimmed);
      else localStorage.removeItem(TOKEN_KEY);
    } catch (e) {}
  }

  function getLastSyncedAt() {
    try { return localStorage.getItem(WATERMARK_KEY) || null; } catch (e) { return null; }
  }

  function recordSyncedAt(iso) {
    try { localStorage.setItem(WATERMARK_KEY, iso); } catch (e) {}
  }

  /** GET the latest snapshot from the server. Returns { data, updatedAt } or null if the server has nothing yet. */
  async function fetchRemote() {
    const res = await fetch('/api/sync', { headers: { Authorization: `Bearer ${token()}` } });
    if (!res.ok) throw new Error(`Sync pull failed (${res.status})`);
    const body = await res.json();
    return body && body.data ? body : null;
  }

  /** POST a full snapshot (the shape from Storage.exportAll(), minus covers) to the server. */
  async function pushSnapshot(snapshot) {
    const res = await fetch('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify(snapshot),
    });
    if (!res.ok) throw new Error(`Sync push failed (${res.status})`);
    return res.json();
  }

  /** Manual "Sync Now" button: pull whatever's newer, then push this device's current state. */
  async function syncNow() {
    if (!isConfigured()) throw new Error('Set a sync token first.');
    try {
      const remote = await fetchRemote();
      const localWatermark = getLastSyncedAt();
      if (remote && (!localWatermark || remote.updatedAt > localWatermark)) {
        await Storage.importAll(remote.data, { replace: true });
        recordSyncedAt(remote.updatedAt);
      }
    } catch (e) {
      console.warn('Sync Now: pull step failed, pushing local data anyway:', e.message);
    }
    const snapshot = await Storage.exportAll();
    delete snapshot.covers;
    const { updatedAt } = await pushSnapshot(snapshot);
    recordSyncedAt(updatedAt);
  }

  return { isConfigured, token, setToken, getLastSyncedAt, recordSyncedAt, fetchRemote, pushSnapshot, syncNow };
})();
