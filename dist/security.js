// Shared by the customer and admin pages: Cloudflare Turnstile bot check and the change-password window.
// Production uses the site's Turnstile key; anywhere else (local preview) uses Cloudflare's test key.
const TURNSTILE_KEY = /(^|\.)rootedrising\.pages\.dev$/.test(location.hostname)
  ? '0x4AAAAAAGQUdqIVJdcruu6U'
  : '1x00000000000000000000AA';
let turnstileScript = null;

function loadTurnstile() {
  turnstileScript ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onload = () => resolve(window.turnstile);
    script.onerror = () => { turnstileScript = null; reject(new Error('Couldn’t load the security check. Check your connection and reload the page.')); };
    document.head.append(script);
  });
  return turnstileScript;
}

// Puts an invisible bot check in `container`. It only shows itself if Cloudflare needs the visitor to click.
function botCheck(container, action) {
  let token = '';
  let widget = null;
  const waiting = [];
  const settle = value => { token = value; waiting.splice(0).forEach(resolve => resolve(value)); };
  const ready = loadTurnstile().then(turnstile => {
    if (!container.isConnected) return;
    widget = turnstile.render(container, {
      sitekey: TURNSTILE_KEY, action, appearance: 'interaction-only',
      callback: settle,
      'expired-callback': () => { token = ''; turnstile.reset(widget); },
      'error-callback': () => { token = ''; }
    });
  });
  ready.catch(() => {});
  return {
    async token() {
      if (token) return token;
      await ready;
      if (token) return token;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('The security check is taking a while. Please try again.')), 20000);
        waiting.push(value => { clearTimeout(timer); resolve(value); });
      });
    },
    reset() {
      token = '';
      if (widget !== null) window.turnstile.reset(widget);
    }
  };
}

// Change-password window. `portal` is 'customer' or 'admin'; `say` shows a message.
function setupPasswordDialog(portal, say) {
  const dialog = document.createElement('dialog');
  dialog.id = 'password-dialog';
  dialog.innerHTML =
    '<form id="password-form" novalidate><header class="dialog-head"><h2>Change password</h2><button class="close-password" type="button" aria-label="Close">×</button></header>' +
    '<div class="field"><label for="pw-current">Current password</label><input id="pw-current" name="current" type="password" autocomplete="current-password" required maxlength="200"></div>' +
    '<div class="field"><label for="pw-next">New password</label><input id="pw-next" name="next" type="password" autocomplete="new-password" required minlength="10" maxlength="200">' +
    '<p class="hint">At least 10 characters. You’ll stay logged in here, and be logged out on your other devices.</p></div>' +
    '<div class="field"><label for="pw-confirm">Type the new password again</label><input id="pw-confirm" name="confirm" type="password" autocomplete="new-password" required maxlength="200"></div>' +
    '<p class="form-error" id="pw-error" role="alert"></p>' +
    '<div class="actions"><button type="button" class="secondary close-password">Cancel</button><button class="primary" type="submit">Change password</button></div></form>';
  document.body.append(dialog);
  const form = dialog.querySelector('form');
  const error = dialog.querySelector('#pw-error');
  dialog.addEventListener('click', event => { if (event.target.closest('.close-password')) dialog.close(); });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const { current, next, confirm } = Object.fromEntries(new FormData(form));
    error.textContent = '';
    if (!current || !next) { error.textContent = 'Fill in your current and new password.'; return; }
    if (next.length < 10) { error.textContent = 'Use at least 10 characters for your new password.'; return; }
    if (next !== confirm) { error.textContent = 'The two new passwords don’t match.'; return; }
    const submit = form.querySelector('[type=submit]');
    submit.disabled = true;
    try {
      const response = await fetch('/api/password', {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ current, next, portal })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Something went wrong. Please try again.');
      dialog.close();
      say('Password changed. Your other devices have been logged out.');
    } catch (err) {
      error.textContent = err.message;
    } finally {
      submit.disabled = false;
    }
  });
  return () => { form.reset(); error.textContent = ''; dialog.showModal(); dialog.querySelector('#pw-current').focus(); };
}
