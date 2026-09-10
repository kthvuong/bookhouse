/* ============================================================
   auth-gate.js — a lightweight client-side password lock.

   This is a deterrent for casual visitors to a hosted URL, not
   real security: the check happens entirely in the browser, so
   anyone reading the source could bypass it. It's meant to keep
   a personal reading journal from being browsable by strangers
   who stumble on the link, nothing stronger. Reading data itself
   lives in IndexedDB and is untouched by anything here.
   ============================================================ */

(function () {
  async function sha256Hex(str) {
    const enc = new TextEncoder().encode(str);
    const buf = await crypto.subtle.digest('SHA-256', enc);
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  function buildOverlay(mode) {
    const overlay = document.createElement('div');
    overlay.className = 'auth-gate';
    overlay.innerHTML = `
      <div class="auth-gate-card">
        <div class="auth-gate-mark">&#9679;</div>
        <h1 class="serif">${APP_NAME}</h1>
        ${mode === 'setup'
          ? `<p>Set a password to lock this journal to just you.</p>
             <input type="password" id="auth-pw1" class="input" placeholder="Choose a password" autocomplete="new-password">
             <input type="password" id="auth-pw2" class="input" placeholder="Confirm password" autocomplete="new-password" style="margin-top:10px;">
             <button class="btn btn-primary" id="auth-submit" style="margin-top:16px;width:100%;">Set Password &amp; Enter</button>`
          : `<p>This is a private reading journal.</p>
             <input type="password" id="auth-pw1" class="input" placeholder="Password" autocomplete="current-password">
             <button class="btn btn-primary" id="auth-submit" style="margin-top:16px;width:100%;">Unlock</button>`
        }
        <p class="auth-gate-error" id="auth-error" hidden></p>
      </div>`;
    document.body.appendChild(overlay);
    return overlay;
  }

  function unlock() {
    localStorage.setItem('mg_authed', '1');
    document.documentElement.removeAttribute('data-locked');
    const overlay = document.querySelector('.auth-gate');
    if (overlay) overlay.remove();
  }

  async function init() {
    if (localStorage.getItem('mg_authed') === '1') return;

    const storedHash = localStorage.getItem('mg_pw_hash');
    const mode = storedHash ? 'locked' : 'setup';
    const overlay = buildOverlay(mode);
    const pw1 = overlay.querySelector('#auth-pw1');
    const pw2 = overlay.querySelector('#auth-pw2');
    const err = overlay.querySelector('#auth-error');
    const submit = overlay.querySelector('#auth-submit');

    pw1.focus();

    function showError(msg) {
      err.textContent = msg;
      err.hidden = false;
    }

    async function handleSubmit() {
      if (mode === 'setup') {
        if (!pw1.value || pw1.value.length < 4) { showError('Choose at least 4 characters.'); return; }
        if (pw1.value !== pw2.value) { showError("Passwords don't match."); return; }
        localStorage.setItem('mg_pw_hash', await sha256Hex(pw1.value));
        unlock();
      } else {
        if ((await sha256Hex(pw1.value)) === storedHash) {
          unlock();
        } else {
          showError("That password doesn't match.");
          pw1.value = '';
          pw1.focus();
        }
      }
    }

    submit.addEventListener('click', handleSubmit);
    [pw1, pw2].forEach((el) => el && el.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleSubmit(); }));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
