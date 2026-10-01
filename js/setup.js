/* Onboarding: collect the Canvas origin, request host permission, then either
 * log in through the browser's own Canvas session or verify a pasted access
 * token, and hand control back to the dashboard.
 *
 * The origin comes from a school search when the school directory checks out
 * (see schools.js), and from a typed address otherwise — including whenever
 * the directory stops answering partway through. */

import { normalizeOrigin, originPattern, getSelf, CanvasError } from './canvas.js';
import { searchSchools, schoolSearchWorks } from './schools.js';
import { saveSettings } from './store.js';

/** How often to look for a finished login while the login window is open. */
const LOGIN_POLL_MS = 1500;

/** How long to hold the form back for the directory check, so a working
 *  search appears at once instead of after a flash of the address box. */
const PROBE_GRACE_MS = 350;
const SEARCH_DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 2;

const form = document.getElementById('setup-form');
const urlInput = document.getElementById('canvas-url');
const addressField = document.getElementById('address-field');
const schoolField = document.getElementById('school-field');
const schoolInput = document.getElementById('school-search');
const schoolList = document.getElementById('school-list');
const schoolPicked = document.getElementById('school-picked');
const toSearchBtn = document.getElementById('to-search');
const toAddressBtn = document.getElementById('to-address');
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

let mode = 'address';        // 'address' | 'search': which field supplies the origin
let searchOffered = false;   // the directory passed its check this time round
let probeRun = 0;            // lets a newer initSetup() retire an older check
let picked = null;           // { name, origin } chosen from the list
let results = [];            // what the list is showing
let active = -1;             // index of the highlighted result
let searchTimer = 0;
let searchCall = null;       // AbortController of the lookup in flight

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
    wireSchoolSearch();
  }

  probeRun++;
  searchOffered = false;
  picked = null;
  schoolInput.value = '';
  showMode('address');

  if (origin) {
    // Logging back in to a known Canvas: the address is already right.
    urlInput.value = origin.replace(/^https:\/\//, '');
    syncTokenLink();
    setTimeout(() => connectBtn.focus(), 0);
    return;
  }
  syncTokenLink();
  offerSchoolSearch();
}

/* ------------------------------------------------------------------ */
/*  School search                                                      */
/* ------------------------------------------------------------------ */

/**
 * Checks the school directory and, only if it answers properly, offers the
 * search. Otherwise the address field — the original way in — simply stays.
 */
async function offerSchoolSearch() {
  const run = probeRun;
  addressField.style.visibility = 'hidden';
  const probe = schoolSearchWorks();
  let works = await Promise.race([
    probe,
    new Promise((resolve) => setTimeout(resolve, PROBE_GRACE_MS, null)),
  ]);
  if (run !== probeRun) return;
  addressField.style.visibility = '';
  if (works === false) urlInput.focus();   // hiding the field dropped the focus

  if (works === null) {
    // Slow check: let people start typing an address in the meantime.
    urlInput.focus();
    works = await probe;
    if (run !== probeRun) return;
  }
  if (!works) return;

  searchOffered = true;
  // Anyone already typing an address is left to finish; they can still switch.
  if (urlInput.value.trim()) toSearchBtn.hidden = false;
  else showMode('search');
}

function wireSchoolSearch() {
  toSearchBtn.addEventListener('click', () => showMode('search'));
  toAddressBtn.addEventListener('click', () => {
    if (picked && !urlInput.value.trim()) {
      urlInput.value = picked.origin.replace(/^https:\/\//, '');
    }
    showMode('address');
  });

  schoolInput.addEventListener('input', handleSchoolInput);
  schoolInput.addEventListener('keydown', handleSchoolKey);
  schoolInput.addEventListener('blur', closeList);

  // mousedown, not click: the input must not lose focus (and close the list)
  // before the choice lands.
  schoolList.addEventListener('mousedown', (event) => event.preventDefault());
  schoolList.addEventListener('click', (event) => {
    const option = event.target.closest('[role="option"]');
    if (option) pick(results[Number(option.dataset.index)]);
  });
}

/** Swaps which field supplies the origin. */
function showMode(next) {
  mode = next;
  schoolField.hidden = next !== 'search';
  addressField.hidden = next !== 'address';
  toSearchBtn.hidden = !(next === 'address' && searchOffered);
  clearTimeout(searchTimer);
  searchCall?.abort();
  closeList();
  syncTokenLink();
  setTimeout(() => (next === 'search' ? schoolInput : urlInput).focus(), 0);
}

function handleSchoolInput() {
  picked = null;
  schoolPicked.hidden = true;
  syncTokenLink();

  clearTimeout(searchTimer);
  searchCall?.abort();
  if (schoolInput.value.trim().length < MIN_QUERY_LENGTH) {
    closeList();
    return;
  }
  searchTimer = setTimeout(runSearch, SEARCH_DEBOUNCE_MS);
}

async function runSearch() {
  const call = (searchCall = new AbortController());
  try {
    const found = await searchSchools(schoolInput.value.trim(), call.signal);
    if (call.signal.aborted) return;
    renderResults(found);
  } catch {
    if (call.signal.aborted) return;
    // The directory failed after passing its check: back to typing the address.
    searchOffered = false;
    showMode('address');
    showError("School search isn't available right now. Enter your Canvas address instead.");
  }
}

function handleSchoolKey(event) {
  const open = isListOpen() && results.length > 0;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    if (!open) return;
    event.preventDefault();
    const step = event.key === 'ArrowDown' ? 1 : -1;
    setActive((active + step + results.length) % results.length);
  } else if (event.key === 'Enter' && open && active >= 0) {
    // Choosing is not submitting: the next Enter connects.
    event.preventDefault();
    pick(results[active]);
  } else if (event.key === 'Escape' && isListOpen()) {
    event.preventDefault();
    closeList();
  }
}

function renderResults(found) {
  results = found;
  active = -1;
  schoolList.replaceChildren();

  if (!found.length) {
    const none = document.createElement('li');
    none.className = 'combo-empty';
    none.setAttribute('role', 'presentation');
    none.textContent = 'No schools found. Check the spelling, or enter your address instead.';
    schoolList.append(none);
  }
  found.forEach((school, i) => {
    const li = document.createElement('li');
    li.id = `school-option-${i}`;
    li.className = 'combo-option';
    li.dataset.index = String(i);
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', 'false');
    li.textContent = school.name;
    const host = document.createElement('small');
    host.textContent = hostOf(school.origin);
    li.append(host);
    schoolList.append(li);
  });

  schoolList.togglePopover(true);
  schoolInput.setAttribute('aria-expanded', 'true');
  if (found.length) setActive(0);
}

function setActive(index) {
  active = index;
  schoolList.querySelectorAll('[role="option"]').forEach((li, i) => {
    li.setAttribute('aria-selected', String(i === index));
    if (i === index) li.scrollIntoView({ block: 'nearest' });
  });
  schoolInput.setAttribute('aria-activedescendant', `school-option-${index}`);
}

/* The list is a manual popover (see .combo-list in newtab.css): shown and
 * hidden only from here, never light-dismissed behind our back. */
function isListOpen() {
  return schoolList.matches(':popover-open');
}

function closeList() {
  schoolList.togglePopover(false);
  schoolInput.setAttribute('aria-expanded', 'false');
  schoolInput.removeAttribute('aria-activedescendant');
  results = [];
  active = -1;
}

function pick(school) {
  if (!school) return;
  clearTimeout(searchTimer);
  searchCall?.abort();
  picked = school;
  schoolInput.value = school.name;
  schoolPicked.textContent = hostOf(school.origin);
  schoolPicked.hidden = false;
  closeList();
  hideError();
  syncTokenLink();
  connectBtn.focus();
}

/** The origin the form currently stands for.
 *  @throws {Error} with a message fit to show, when there is none yet */
function currentOrigin() {
  if (mode === 'search') {
    if (!picked) throw new Error('Choose your school from the list.');
    return picked.origin;
  }
  return normalizeOrigin(urlInput.value);
}

function hostOf(origin) {
  return origin.replace(/^https:\/\//, '');
}

/** Offer a direct link to the token page once the address looks usable. */
function syncTokenLink() {
  try {
    const origin = currentOrigin();
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
    origin = currentOrigin();
  } catch (err) {
    showError(err.message);
    (mode === 'search' ? schoolInput : urlInput).focus();
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
