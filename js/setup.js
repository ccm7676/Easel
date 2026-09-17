/* Onboarding: collect the Canvas origin, request host permission, then either
 * log in through the browser's own Canvas session or verify a pasted access
 * token, and hand control back to the dashboard. */

import { normalizeOrigin, originPattern, getSelf, CanvasError } from './canvas.js';
import { saveSettings } from './store.js';

/** How often to look for a finished login while the login window is open. */
const LOGIN_POLL_MS = 1500;

const form = document.getElementById('setup-form');
const urlInput = document.getElementById('canvas-url');
const tokenInput = document.getElementById('canvas-token');
const tokenLink = document.getElementById('token-link');
const errorBox = document.getElementById('setup-error');
const connectBtn = document.getElementById('connect-btn');
const tokenBtn = document.getElementById('token-btn');

const LABELS = new Map([
  [connectBtn, connectBtn.textContent],
  [tokenBtn, tokenBtn.textContent],
]);

let onDone = () => {};
let wired = false;

/**
 * @param {object} [opts]
 * @param {string} [opts.message] shown as an error on arrival
 * @param {string} [opts.origin] prefills the address, e.g. to log back in
 */
export function initSetup(callback, { message, origin } = {}) {
  onDone = callback;
  if (message) showError(message);
  else hideError();

  if (!wired) {
    wired = true;
    urlInput.addEventListener('input', syncTokenLink);
    form.addEventListener('submit', handleSubmit);
    // Enter in the token field means the token button, not the first one.
    tokenInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      form.requestSubmit(tokenBtn);
    });
  }
  if (origin) urlInput.value = origin.replace(/^https:\/\//, '');
  syncTokenLink();
  setTimeout(() => (origin ? connectBtn : urlInput).focus(), 0);
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
  const withToken = event.submitter === tokenBtn;

  let origin;
  try {
    origin = normalizeOrigin(urlInput.value);
  } catch (err) {
    showError(err.message);
    urlInput.focus();
    return;
  }

  const token = tokenInput.value.trim();
  if (withToken && !token) {
    showError('Paste an access token to continue.');
    tokenInput.focus();
    return;
  }

  // chrome.permissions.request() must be called inside the user gesture, so it
  // has to be the first async thing we touch — no awaits before this line.
  const granted = chrome.permissions.request({ origins: [originPattern(origin)] });
  if (withToken) connectWithToken(origin, token, granted);
  else logIn(origin, granted);
}

async function connectWithToken(origin, token, grantedPromise) {
  setBusy(tokenBtn, 'Connecting…');
  try {
    if (!(await ensureGranted(origin, grantedPromise))) return;
    const settings = { origin, token };
    const me = await getSelf(settings); // throws on a bad token
    tokenInput.value = '';
    await complete(settings, me);
  } catch (err) {
    showError(describe(err, origin));
  } finally {
    setBusy(null);
  }
}

/**
 * Uses the browser's Canvas login. If there isn't one yet, opens the school's
 * login page in a small window — which runs whatever sign-in the school uses,
 * SSO and two-factor included — and waits for the session to appear. Closing
 * that window cancels.
 */
async function logIn(origin, grantedPromise) {
  setBusy(connectBtn, 'Checking…');
  let loginWindow = null;
  try {
    if (!(await ensureGranted(origin, grantedPromise))) return;
    const settings = { origin };

    let me = await sessionUser(settings); // already logged in: nothing to open
    if (!me) {
      setBusy(connectBtn, 'Waiting for you to log in…');
      loginWindow = await chrome.windows.create({
        url: `${origin}/login`,
        type: 'popup',
        width: 520,
        height: 720,
      });
      me = await waitForLogin(settings, loginWindow.id);
      if (!me) {
        showError('The login window was closed before you finished logging in.');
        return;
      }
    }
    await complete(settings, me);
  } catch (err) {
    showError(describe(err, origin));
  } finally {
    if (loginWindow) chrome.windows.remove(loginWindow.id).catch(() => {});
    setBusy(null);
  }
}

/** The logged-in Canvas user, or null when there is no session. */
async function sessionUser(settings) {
  try {
    return await getSelf(settings);
  } catch (err) {
    if (err instanceof CanvasError && err.kind === 'auth') return null;
    throw err;
  }
}

/** Resolves with the user once logged in, or null if the window closes first. */
async function waitForLogin(settings, windowId) {
  let closed = false;
  const onRemoved = (id) => {
    if (id === windowId) closed = true;
  };
  chrome.windows.onRemoved.addListener(onRemoved);
  try {
    for (;;) {
      const wasClosed = closed;
      // A blip mid-login — a redirect through the school's sign-in page, a
      // flaky connection — is not a failure; just look again shortly.
      const me = await sessionUser(settings).catch(() => null);
      if (me) return me;
      // One last look after the window closes, since the user may have
      // finished logging in and closed it themselves.
      if (wasClosed) return null;
      await new Promise((resolve) => setTimeout(resolve, LOGIN_POLL_MS));
    }
  } finally {
    chrome.windows.onRemoved.removeListener(onRemoved);
  }
}

async function ensureGranted(origin, grantedPromise) {
  if (await grantedPromise) return true;
  showError(
    'Easel needs permission to talk to ' +
      origin.replace(/^https:\/\//, '') +
      '. Try again and choose Allow.'
  );
  return false;
}

async function complete(settings, me) {
  settings.userName = me?.short_name ?? me?.name ?? null;
  await saveSettings(settings);
  onDone(settings);
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

/** Disables both ways in while one is running; `null` restores them. */
function setBusy(button, label) {
  for (const [btn, idle] of LABELS) {
    btn.disabled = Boolean(button);
    btn.textContent = btn === button ? label : idle;
  }
}

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.hidden = false;
}

function hideError() {
  errorBox.hidden = true;
  errorBox.textContent = '';
}
