/* ============================================================
   api/sync.js — Vercel serverless function.

   One key in an Upstash Redis store (provisioned via the Vercel
   Marketplace — Vercel's own first-party KV product was retired, see
   https://vercel.com/docs/redis) holds the latest full library
   snapshot from js/storage.js's Storage.exportAll() (minus covers,
   which stay device-local). GET returns it, POST overwrites it. This
   is whole-snapshot, last-write-wins sync for a single user — not a
   per-record API, and not a multi-user system.

   Protected by one shared secret (env var SYNC_TOKEN) checked against
   the Authorization header. Without this check, this URL would be a
   public read/write endpoint for the whole library.
   ============================================================ */

const { Redis } = require('@upstash/redis');

// Built explicitly (not Redis.fromEnv()) since the env var names an
// integration injects can vary — the Upstash-for-Redis Marketplace
// integration currently uses KV_REST_API_URL/KV_REST_API_TOKEN.
const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const SNAPSHOT_KEY = 'bookhouse:snapshot';

module.exports = async function handler(req, res) {
  const authHeader = req.headers.authorization || '';
  const providedToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  if (!process.env.SYNC_TOKEN || providedToken !== process.env.SYNC_TOKEN) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  if (req.method === 'GET') {
    const stored = await redis.get(SNAPSHOT_KEY);
    res.status(200).json(stored || { data: null, updatedAt: null });
    return;
  }

  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) { body = null; }
    }
    if (!body || typeof body !== 'object') {
      res.status(400).json({ error: 'Invalid body' });
      return;
    }
    const updatedAt = new Date().toISOString();
    await redis.set(SNAPSHOT_KEY, { data: body, updatedAt });
    res.status(200).json({ ok: true, updatedAt });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
};
