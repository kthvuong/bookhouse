/* ============================================================
   auth-gate.js — a lightweight client-side 4-digit PIN lock.

   This is a deterrent for casual visitors to a hosted URL, not
   real security: the check happens entirely in the browser, so
   anyone reading the source could bypass it. It's meant to keep
   a personal reading journal from being browsable by strangers
   who stumble on the link, nothing stronger. Reading data itself
   lives in IndexedDB and is untouched by anything here.

   Note: the PIN hash is stored in this browser's localStorage,
   which is scoped per-origin — a different URL, port, or opening
   the file directly (file://) is a different origin with its own
   separate storage, so it will ask you to set a PIN again there.
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
        <div class="auth-gate-mark">
          <svg viewBox="0 0 32 32" width="34" height="34" aria-hidden="true" focusable="false">
            <path d="M4 16.5 L16 5.5 L28 16.5" fill="none" style="stroke:var(--accent)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
            <rect x="7.5" y="15.5" width="17" height="12" rx="3.5" style="fill:var(--accent-soft)"/>
            <rect x="13.2" y="20.5" width="5.6" height="7" rx="1.8" style="fill:var(--accent)"/>
            <circle cx="16" cy="11.2" r="2" style="fill:var(--gold)"/>
          </svg>
        </div>
        <h1 class="serif">${APP_NAME}</h1>
        ${mode === 'setup'
          ? `<p>Set a 4-digit PIN to lock this journal to just you.</p>
             <div class="pin-input-row" id="pin-row-1" style="margin-top:16px;"></div>`
          : `<p>This is a private reading journal.</p>
             <div class="pin-input-row" id="pin-row-1" style="margin-top:16px;"></div>`
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
    const err = overlay.querySelector('#auth-error');

    function showError(msg) {
      err.textContent = msg;
      err.hidden = false;
    }

    if (mode === 'setup') {
      const pin = mountPinInput(overlay.querySelector('#pin-row-1'), {
        onComplete: async (value) => {
          localStorage.setItem('mg_pw_hash', await sha256Hex(value));
          unlock();
        },
      });
      pin.focus();
    } else {
      const pin = mountPinInput(overlay.querySelector('#pin-row-1'), {
        onComplete: async (value) => {
          if ((await sha256Hex(value)) === storedHash) {
            unlock();
          } else {
            showError("That PIN doesn't match.");
            pin.shake();
            pin.clear();
          }
        },
      });
      pin.focus();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
