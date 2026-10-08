/* ============================================================
   api/sync.js — Vercel serverless function.

   One key in an Upstash Redis store (provisioned via the Vercel
   Marketplace — Vercel's own first-party KV product was retired, see
   https://vercel.com/docs/redis) holds the latest full library
   snapshot from js/storage.js's Storage.exportAll() (minus covers,
   which stay device-local). GET returns it, POST overwrites it. This
   is whole-snapshot, last-write-wins sync for a single user — not a
   per-record API, and not a multi-user system.

   Because a POST replaces everything, the snapshot it is about to
   replace is first put aside, once a day: the library as it stood
   before that day's first change, kept for BACKUP_DAYS. A bad push
   (a bug, an empty device, a leaked token) can then be undone.
     GET ?backups=1          the days there is a copy for
     GET ?backup=YYYY-MM-DD  that day's copy, same shape as a plain GET

   Protected by one shared secret (env var SYNC_TOKEN) checked against
   the Authorization header (api/_auth.js). Without this check, this
   URL would be a public read/write endpoint for the whole library.
   ============================================================ */

const { Redis } = require('@upstash/redis');
const { authorize } = require('./_auth');

// Built explicitly (not Redis.fromEnv()) since the env var names an
// integration injects can vary — the Upstash-for-Redis Marketplace
// integration currently uses KV_REST_API_URL/KV_REST_API_TOKEN.
const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const SNAPSHOT_KEY = 'bookhouse:snapshot';
const BACKUP_INDEX_KEY = 'bookhouse:backups'; // the days there is a copy for, newest first
const backupKey = (day) => `bookhouse:backup:${day}`;
const BACKUP_DAYS = 14;
const DAY_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

/** A snapshot from js/storage.js always carries these two lists. Anything
 *  else isn't a library and mustn't replace one. */
function looksLikeSnapshot(body) {
  return !!body && typeof body === 'object' && !Array.isArray(body)
    && Array.isArray(body.books) && Array.isArray(body.readingEntries);
}

/** Puts the current snapshot aside if today has no copy yet. Never stands
 *  in the way of the save itself. */
async function keepBackup(now) {
  try {
    const day = now.slice(0, 10);
    const days = (await redis.get(BACKUP_INDEX_KEY)) || [];
    if (!Array.isArray(days) || days.includes(day)) return;
    const current = await redis.get(SNAPSHOT_KEY);
    if (!current || !current.data) return;
    await redis.set(backupKey(day), current, { ex: (BACKUP_DAYS + 1) * 24 * 3600 });
    await redis.set(BACKUP_INDEX_KEY, [day, ...days].slice(0, BACKUP_DAYS));
  } catch (e) {
    console.error('sync backup failed:', e);
  }
}

module.exports = async function handler(req, res) {
  if (!(await authorize(req, res))) return;

  if (req.method === 'GET') {
    const query = req.query || {};
    if (query.backups) {
      const days = (await redis.get(BACKUP_INDEX_KEY)) || [];
      res.status(200).json({ backups: Array.isArray(days) ? days : [] });
      return;
    }
    if (query.backup) {
      const stored = typeof query.backup === 'string' && DAY_FORMAT.test(query.backup)
        ? await redis.get(backupKey(query.backup))
        : null;
      if (!stored) {
        res.status(404).json({ error: 'No backup for that day' });
        return;
      }
      res.status(200).json(stored);
      return;
    }
    const stored = await redis.get(SNAPSHOT_KEY);
    res.status(200).json(stored || { data: null, updatedAt: null });
    return;
  }

  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) { body = null; }
    }
    if (!looksLikeSnapshot(body)) {
      res.status(400).json({ error: 'Invalid body' });
      return;
    }
    const updatedAt = new Date().toISOString();
    await keepBackup(updatedAt);
    await redis.set(SNAPSHOT_KEY, { data: body, updatedAt });
    res.status(200).json({ ok: true, updatedAt });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
};
