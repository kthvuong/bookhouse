/* Runs synchronously in <head>, before paint, so a locked app never flashes its content. */
(function () {
  try {
    if (localStorage.getItem('mg_authed') !== '1') {
      document.documentElement.setAttribute('data-locked', '1');
    }
  } catch (e) {}
})();
