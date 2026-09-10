/* ============================================================
   config.js — single source of truth for the app's display name.
   Change APP_NAME here and it propagates everywhere: page titles,
   the header brand, the password gate, exported file names, etc.
   Runs synchronously in <head>, right after the <title> tag, so
   it can safely prefix whatever page-specific title is already set.
   ============================================================ */

const APP_NAME = 'Bookhouse';
const USER_NAME = 'Kathy';

(function () {
  if (document.title && !document.title.startsWith(APP_NAME)) {
    document.title = `${APP_NAME} — ${document.title}`;
  }

  // Same cottage-with-a-window mark as the header brand, baked as a
  // favicon so the browser tab matches. Colors are hardcoded (not the
  // theme's CSS vars) since a favicon renders as its own tiny document.
  const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
    <rect width="32" height="32" rx="7" fill="#f6f1e7"/>
    <path d="M5 17 L16 6.5 L27 17" fill="none" stroke="#b1583a" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="8" y="16" width="16" height="11.5" rx="3" fill="#ecd3bf"/>
    <rect x="13.3" y="20.8" width="5.4" height="6.7" rx="1.6" fill="#b1583a"/>
    <circle cx="16" cy="12" r="1.9" fill="#c08a2e"/>
  </svg>`;
  const link = document.createElement('link');
  link.rel = 'icon';
  link.type = 'image/svg+xml';
  link.href = `data:image/svg+xml,${encodeURIComponent(faviconSvg)}`;
  document.head.appendChild(link);
})();
