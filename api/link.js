/* ============================================================
   api/link.js — Vercel serverless function.

   Links a new device without anyone typing the sync token. A device
   that already has the token asks for a 6-digit code (shown in
   Settings, also as a QR code); the new device hands the code in and
   gets the token back.

     POST { action: "create" }        needs the token → { code, expiresIn }
     POST { action: "redeem", code }  no token        → { token }

   A code works once, for CODE_TTL seconds, and asking for a new one
   cancels the one before. Six digits would be guessable given enough
   tries, so wrong codes are counted, per address and overall, and
   past the limit nobody can redeem until the window runs out. A
   handful of guesses at one in a million is all a stranger gets.
   ============================================================ */

const crypto = require('crypto');
const { Redis } = require('@upstash/redis');
const { authorize, clientAddress } = require('./_auth');

const redis = process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN
  ? new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN })
  : null;

const CODE_TTL = 10 * 60;
const WINDOW = 10 * 60;
const MAX_WRONG_PER_ADDRESS = 8;
const MAX_WRONG_OVERALL = 30;

const CURRENT_KEY = 'bookhouse:link:current';
const codeKey = (code) => `bookhouse:link:code:${code}`;
const WRONG_ALL_KEY = 'bookhouse:link:wrong:all';
const wrongKey = (address) => `bookhouse:link:wrong:${address}`;

async function countWrong(key) {
  if ((await redis.incr(key)) === 1) await redis.expire(key, WINDOW);
}

async function create(req, res) {
  if (!(await authorize(req, res))) return;
  const previous = await redis.get(CURRENT_KEY);
  if (previous) await redis.del(codeKey(String(previous).padStart(6, '0')));
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  await redis.set(codeKey(code), 1, { ex: CODE_TTL });
  await redis.set(CURRENT_KEY, code, { ex: CODE_TTL });
  res.status(200).json({ code, expiresIn: CODE_TTL });
}

async function redeem(req, res, body) {
  const code = String(body.code || '');
  if (!/^\d{6}$/.test(code)) {
    res.status(400).json({ error: 'A link code is six digits.' });
    return;
  }
  const mine = wrongKey(clientAddress(req));
  const [wrongHere, wrongAll] = await redis.mget(mine, WRONG_ALL_KEY);
  if (Number(wrongHere) >= MAX_WRONG_PER_ADDRESS || Number(wrongAll) >= MAX_WRONG_OVERALL) {
    res.status(429).json({ error: 'Too many wrong codes. Try again in a few minutes.' });
    return;
  }
  // Read and removed in one step, so a code can't be used twice.
  if (!(await redis.getdel(codeKey(code)))) {
    await Promise.all([countWrong(mine), countWrong(WRONG_ALL_KEY)]);
    res.status(404).json({ error: 'That code is wrong or has run out.' });
    return;
  }
  res.status(200).json({ token: process.env.SYNC_TOKEN });
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!redis || !process.env.SYNC_TOKEN) {
    res.status(503).json({ error: 'Linking is not set up on the server.' });
    return;
  }
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  body = body && typeof body === 'object' ? body : {};
  try {
    if (body.action === 'create') await create(req, res);
    else if (body.action === 'redeem') await redeem(req, res, body);
    else res.status(400).json({ error: 'Expected action "create" or "redeem"' });
  } catch (e) {
    console.error('Device link failed:', e);
    res.status(500).json({ error: 'Linking failed. Try again.' });
  }
};
