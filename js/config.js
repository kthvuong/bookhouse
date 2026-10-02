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

  // Same cottage-with-a-window mark as the header brand (js/nav.js), baked
  // as a favicon so the browser tab and bookmarks match. It has no backing
  // tile: on a tab or bookmarks bar that showed as a pale square behind
  // the house. Colors are hardcoded (not the theme's CSS vars) since a
  // favicon renders as its own tiny document; the roof and window lighten
  // when the browser is in dark mode, so they hold up on a dark tab bar.
  const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
    <style>
      .roof { fill: none; stroke: #b1583a; }
      .lamp { fill: #c08a2e; }
      @media (prefers-color-scheme: dark) {
        .roof { stroke: #dd9163; }
        .lamp { fill: #e0b563; }
      }
    </style>
    <path class="roof" d="M4 16.5 L16 5.5 L28 16.5" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="7.5" y="15.5" width="17" height="12" rx="3.5" fill="#e5bfa3"/>
    <rect x="13.2" y="20.5" width="5.6" height="7" rx="1.8" fill="#b1583a"/>
    <circle class="lamp" cx="16" cy="11.2" r="2"/>
  </svg>`;
  const link = document.createElement('link');
  link.rel = 'icon';
  link.type = 'image/svg+xml';
  link.href = `data:image/svg+xml,${encodeURIComponent(faviconSvg)}`;
  document.head.appendChild(link);
})();
