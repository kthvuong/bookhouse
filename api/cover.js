/* ============================================================
   api/cover.js — Vercel serverless function.

   Hands a book cover back from our own origin. A page can show an
   image from any host, but it can only read one — to keep a copy on
   the device, or to sample the cover's colours — if that host sends
   CORS headers. Open Library does; Hardcover's and Google Books'
   image hosts don't. So for those covers js/books-api.js asks this
   instead, and gets the same bytes from an origin it is allowed to
   read.

   Deliberately not a general-purpose proxy: GET only, behind the same
   shared SYNC_TOKEN as api/search.js, https only, and only the image
   hosts listed below — a redirect is followed only to another of them.
   What comes back has to be an ordinary picture under MAX_BYTES.
   ============================================================ */

// Hardcover's originals and its resized copies, and Google Books' covers.
// js/books-api.js keeps the matching list of hosts to send here.
const ALLOWED_HOSTS = new Set([
  'assets.hardcover.app',
  'production-img.hardcover.app',
  'books.google.com',
  'books.googleusercontent.com',
]);

// No SVG, though Hardcover's asset host serves some: it's the one image
// format that can carry script, and this is served from our own origin.
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);

const MAX_BYTES = 3 * 1024 * 1024; // Vercel refuses a response over 4.5 MB; covers run 10 KB – 1 MB
const MAX_URL_LENGTH = 2000;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 8000; // so a slow host gets a clean 504 from us, not Vercel's own timeout

/** The URL to fetch, or null if it isn't one this endpoint serves. */
function allowedUrl(raw) {
  let url;
  try { url = new URL(raw); } catch (e) { return null; }
  if (url.protocol !== 'https:' || url.port || url.username || url.password) return null;
  return ALLOWED_HOSTS.has(url.hostname) ? url : null;
}

/** Frees the connection of a response whose body isn't going to be read. */
function discard(response) {
  if (response.body) response.body.cancel().catch(() => {});
}

/** Fetches `url`, following redirects by hand so that every hop is checked
 *  against the allow-list (an allowed host can redirect anywhere it likes).
 *  Resolves to the final response, or null if a hop leads off the list. */
async function fetchAllowed(url, signal) {
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await fetch(url, { redirect: 'manual', signal, headers: { Accept: 'image/*' } });
    if (response.status < 300 || response.status >= 400) return response;
    discard(response);
    const location = response.headers.get('location');
    url = location ? allowedUrl(new URL(location, url).href) : null;
    if (!url) return null;
  }
  return null;
}

/** The body as one Buffer, or null if it runs past `max`. The declared
 *  length is only a shortcut: it can be missing, so the bytes are counted. */
async function readUpTo(response, max) {
  if (!response.body) return null;
  if (Number(response.headers.get('content-length')) > max) {
    discard(response);
    return null;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return Buffer.concat(chunks, size);
    size += value.length;
    if (size > max) {
      reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
}

module.exports = async function handler(req, res) {
  const authHeader = req.headers.authorization || '';
  const providedToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!process.env.SYNC_TOKEN || providedToken !== process.env.SYNC_TOKEN) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const raw = req.query.url;
  const url = typeof raw === 'string' && raw.length <= MAX_URL_LENGTH ? allowedUrl(raw) : null;
  if (!url) {
    res.status(400).json({ error: 'Expected ?url= with an https cover address on Hardcover or Google Books' });
    return;
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const upstream = await fetchAllowed(url, ctrl.signal);
    if (!upstream) {
      res.status(502).json({ error: 'Cover redirects somewhere this endpoint does not serve' });
      return;
    }
    if (!upstream.ok) {
      discard(upstream);
      const gone = upstream.status === 404 || upstream.status === 410;
      res.status(gone ? 404 : 502).json({ error: `Cover host returned ${upstream.status}` });
      return;
    }
    const type = (upstream.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!IMAGE_TYPES.has(type)) {
      discard(upstream);
      res.status(415).json({ error: 'Not an image this endpoint serves' });
      return;
    }
    const body = await readUpTo(upstream, MAX_BYTES);
    if (!body) {
      res.status(413).json({ error: 'Cover is larger than this endpoint serves' });
      return;
    }

    res.setHeader('Content-Type', type);
    // A cover's address names one image, so the browser can keep it. `private`
    // keeps it out of Vercel's shared cache, which would answer without the
    // token check above.
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.status(200).end(body);
  } catch (e) {
    const timedOut = ctrl.signal.aborted;
    res.status(timedOut ? 504 : 502).json({ error: timedOut ? 'Cover host took too long' : 'Could not reach the cover host' });
  } finally {
    clearTimeout(timer);
  }
};
