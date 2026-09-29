/* Runs before paint (loaded synchronously in <head>) to avoid a light/dark flash. */
(function () {
  try {
    const saved = localStorage.getItem('theme');
    const theme = saved || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
    syncThemeColor(theme);
  } catch (e) {}
})();

/* Keeps the browser's toolbar / status-bar tint (the theme-color meta tag)
   matching the app's own light/dark choice rather than the system's.
   Colors mirror --bg in css/base.css. */
function syncThemeColor(theme) {
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.content = theme === 'dark' ? '#211c17' : '#f6f1e7';
}
