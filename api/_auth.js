/* ============================================================
   api/_auth.js — the token check shared by every function here.
   (The leading underscore keeps Vercel from serving it as a route.)

   One shared secret (env var SYNC_TOKEN) in the Authorization header
   gates the whole backend. Two things on top of a plain comparison:

   - The comparison takes the same time whether the first character is
     wrong or the last, so timing a reply says nothing about the token.
   - Wrong tokens are counted per address in Redis. After MAX_FAILS in
     WINDOW seconds that address is turned away, right token or not,
     until the window runs out. The token is long and random, so this
     isn't what keeps guessing from working; it keeps a script from
     hammering the functions (and Hardcover's quota behind them).
     If Redis can't be reached the count is skipped, not the check.
   ============================================================ */

const crypto = require('crypto');
const { Redis } = require('@upstash/redis');

const redis = process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN
  ? new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN })
  : null;

const MAX_FAILS = 30; // a device with an old token makes a few calls per page, so not too tight
const WINDOW = 10 * 60;

const digest = (s) => crypto.createHash('sha256').update(String(s)).digest();
const sameToken = (a, b) => crypto.timingSafeEqual(digest(a), digest(b));

function clientAddress(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return (req.headers['x-real-ip'] || forwarded || 'unknown').slice(0, 64);
}

/** True if the request carries the token. Otherwise the 401 (or 429) has
 *  already been sent and the caller just returns. */
async function authorize(req, res) {
  const header = req.headers.authorization || '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  const expected = process.env.SYNC_TOKEN;
  const key = `bookhouse:authfail:${clientAddress(req)}`;

  if (redis) {
    try {
      if (Number(await redis.get(key)) >= MAX_FAILS) {
        res.status(429).json({ error: 'Too many wrong tokens from this address. Try again in a few minutes.' });
        return false;
      }
    } catch (e) { /* the count is best-effort */ }
  }

  if (expected && provided && sameToken(provided, expected)) return true;

  if (redis) {
    try {
      if ((await redis.incr(key)) === 1) await redis.expire(key, WINDOW);
    } catch (e) { /* best-effort */ }
  }
  res.status(401).json({ error: 'Unauthorized' });
  return false;
}

module.exports = { authorize, clientAddress };
