/* Onboarding: collect the Canvas origin + token, request host permission,
 * verify the token works, then hand control back to the dashboard. */

import { normalizeOrigin, originPattern, getSelf, CanvasError } from './canvas.js';
import { saveSettings } from './store.js';

const form = document.getElementById('setup-form');
const urlInput = document.getElementById('canvas-url');
const tokenInput = document.getElementById('canvas-token');
const tokenLink = document.getElementById('token-link');
const errorBox = document.getElementById('setup-error');
const connectBtn = document.getElementById('connect-btn');

let onDone = () => {};
let wired = false;

export function initSetup(callback, { message } = {}) {
  onDone = callback;
  if (message) showError(message);
  else hideError();

  if (!wired) {
    wired = true;
    urlInput.addEventListener('input', syncTokenLink);
    form.addEventListener('submit', handleSubmit);
  }
  syncTokenLink();
  setTimeout(() => urlInput.focus(), 0);
}

/** Offer a direct link to the token page once the address looks usable. */
function syncTokenLink() {
  try {
    const origin = normalizeOrigin(urlInput.value);
    tokenLink.href = `${origin}/profile/settings#access_tokens`;
    tokenLink.hidden = false;
  } catch {
    tokenLink.hidden = true;
  }
}

function handleSubmit(event) {
  event.preventDefault();
  hideError();

  let origin;
  try {
    origin = normalizeOrigin(urlInput.value);
  } catch (err) {
    showError(err.message);
    urlInput.focus();
    return;
  }

  const token = tokenInput.value.trim();
  if (!token) {
    showError('Paste an access token to continue.');
    tokenInput.focus();
    return;
  }

  // chrome.permissions.request() must be called inside the user gesture, so it
  // has to be the first async thing we touch — no awaits before this line.
  const granted = chrome.permissions.request({ origins: [originPattern(origin)] });
  finish(origin, token, granted);
}

async function finish(origin, token, grantedPromise) {
  setBusy(true);
  try {
    const granted = await grantedPromise;
    if (!granted) {
      showError(
        'Easel needs permission to talk to ' +
          origin.replace(/^https:\/\//, '') +
          '. Press Connect and choose Allow.'
      );
      return;
    }

    const settings = { origin, token };
    const me = await getSelf(settings); // throws on a bad token
    settings.userName = me?.short_name ?? me?.name ?? null;

    await saveSettings(settings);
    tokenInput.value = '';
    onDone(settings);
  } catch (err) {
    showError(describe(err, origin));
  } finally {
    setBusy(false);
  }
}

function describe(err, origin) {
  const host = origin.replace(/^https:\/\//, '');
  if (err instanceof CanvasError) {
    switch (err.kind) {
      case 'auth':
        return 'That token was rejected. Generate a new one in Canvas and paste it again.';
      case 'network':
        return `Could not reach ${host}. Check the address and your connection.`;
      case 'ratelimit':
        return 'Canvas is rate limiting right now. Wait a moment and try again.';
      default:
        return err.message;
    }
  }
  return err?.message || 'Something went wrong. Try again.';
}

function setBusy(busy) {
  connectBtn.disabled = busy;
  connectBtn.textContent = busy ? 'Connecting…' : 'Connect';
}

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.hidden = false;
}

function hideError() {
  errorBox.hidden = true;
  errorBox.textContent = '';
}
