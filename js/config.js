/* ============================================================
   config.js — single source of truth for the app's display name.
   Change APP_NAME here and it propagates everywhere: page titles,
   the header brand, the password gate, exported file names, etc.
   Runs synchronously in <head>, right after the <title> tag, so
   it can safely prefix whatever page-specific title is already set.
   ============================================================ */

const APP_NAME = 'Bookhouse';

(function () {
  if (document.title && !document.title.startsWith(APP_NAME)) {
    document.title = `${APP_NAME} — ${document.title}`;
  }
})();
