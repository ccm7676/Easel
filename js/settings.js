/* Settings — the container's third face. Owns the user's preferences
 * (appearance, background, clock, search engine) and applies the theme and
 * background itself; everything
 * else is handed back to newtab.js, which owns the modules a preference or a
 * reset reaches into. Opening and closing the face is newtab.js's too. */

import { getPrefs, savePrefs, DEFAULT_PREFS, getBackdrop, saveBackdrop } from './store.js';
import { ENGINES } from './search.js';

/* The synchronous copy js/theme-boot.js reads before first paint. It is also
 * what applyTheme() reads, so the page and the boot script can never disagree. */
const THEME_MIRROR = 'easel:theme';
const BACKDROP_MIRROR = 'easel:backdrop';
const darkQuery = matchMedia('(prefers-color-scheme: dark)');

const face = document.getElementById('face-settings');
const groups = [...face.querySelectorAll('.pills[data-pref]')];
const backdropPills = document.getElementById('backdrop-pills');
const backdropFile = document.getElementById('backdrop-file');
const engineSelect = document.getElementById('engine-select');
const disconnectBtn = document.getElementById('disconnect-btn');
const resetBtn = document.getElementById('reset-btn');

let prefs = { ...DEFAULT_PREFS };
let on = {};

// At import rather than in initSettings, so Auto follows the system on the
// setup screen as well.
darkQuery.addEventListener('change', applyTheme);

/**
 * @param {object} handlers
 * @param {(hour12: boolean) => void} handlers.onClock
 * @param {(engine: string) => void} handlers.onEngine
 * @param {() => void} handlers.onDisconnect
 * @param {() => Promise<void>} handlers.onReset
 * @returns {Promise<object>} the prefs, for the modules that start from them
 */
export async function initSettings(handlers) {
  on = handlers;
  prefs = await getPrefs();
  if (!Object.hasOwn(ENGINES, prefs.engine)) prefs.engine = DEFAULT_PREFS.engine;

  // The mirror can be lost on its own (site data cleared); storage wins.
  writeMirror(prefs.theme);
  applyTheme();

  for (const group of groups) {
    group.addEventListener('click', (event) => {
      const pill = event.target.closest('.pill');
      if (pill) choose(group.dataset.pref, pill.dataset.value);
    });
  }
  syncPills();

  // Storage wins here too, for the same reason as the theme.
  const backdrop = await getBackdrop();
  writeBackdropMirror(backdrop);
  applyBackdrop(backdrop);
  backdropPills.addEventListener('click', (event) => {
    const pill = event.target.closest('.pill');
    if (!pill) return;
    // Custom always opens the picker, even when already selected, so it is
    // also how a custom picture gets replaced.
    if (pill.dataset.value === 'custom') backdropFile.click();
    else setBackdrop(null);
  });
  backdropFile.addEventListener('change', async () => {
    const [file] = backdropFile.files;
    backdropFile.value = ''; // so picking the same file again still fires
    if (!file) return;
    try {
      await setBackdrop(await shrinkImage(file));
    } catch {
      // Not an image the browser can decode; keep whatever was showing.
    }
  });

  for (const [id, { label }] of Object.entries(ENGINES)) {
    engineSelect.append(new Option(label, id));
  }
  engineSelect.value = prefs.engine;
  engineSelect.addEventListener('change', () => choose('engine', engineSelect.value));

  disconnectBtn.addEventListener('click', () => on.onDisconnect());
  confirmFirst(resetBtn, () => on.onReset());

  return prefs;
}

function choose(key, value) {
  if (prefs[key] === value) return;
  prefs = { ...prefs, [key]: value };
  savePrefs(prefs);

  if (key === 'theme') {
    writeMirror(value);
    applyTheme();
  } else if (key === 'clock') {
    on.onClock(value === '12h');
  } else if (key === 'engine') {
    on.onEngine(value);
  }
  syncPills();
}

function syncPills() {
  for (const group of groups) {
    for (const pill of group.querySelectorAll('.pill')) {
      const selected = prefs[group.dataset.pref] === pill.dataset.value;
      pill.classList.toggle('is-selected', selected);
      pill.setAttribute('aria-checked', String(selected));
    }
  }
}

/* ---------- Theme ---------- */

function applyTheme() {
  const pref = readMirror();
  const dark = pref === 'dark' || (pref === 'auto' && darkQuery.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

function readMirror() {
  try {
    return localStorage.getItem(THEME_MIRROR) || DEFAULT_PREFS.theme;
  } catch {
    return prefs.theme;
  }
}

function writeMirror(theme) {
  try {
    localStorage.setItem(THEME_MIRROR, theme);
  } catch {
    // Blocked storage only costs a flash of the default theme on load.
  }
}

/* ---------- Background ---------- */

/* Bounds the stored copy. The photo sits behind blurred glass, so a
 * phone-camera original is wasted bytes — and it has to fit, as a data: URL,
 * in the localStorage mirror (~5 MB) that theme-boot.js paints from. */
const BACKDROP_MAX_PX = 2560;
const BACKDROP_QUALITY = 0.85;

async function setBackdrop(dataUrl) {
  await saveBackdrop(dataUrl);
  writeBackdropMirror(dataUrl);
  applyBackdrop(dataUrl);
}

function applyBackdrop(dataUrl) {
  const { style } = document.documentElement;
  if (dataUrl) style.setProperty('--backdrop-custom', `url("${dataUrl}")`);
  else style.removeProperty('--backdrop-custom');

  for (const pill of backdropPills.querySelectorAll('.pill')) {
    const selected = (pill.dataset.value === 'custom') === Boolean(dataUrl);
    pill.classList.toggle('is-selected', selected);
    pill.setAttribute('aria-checked', String(selected));
  }
}

function writeBackdropMirror(dataUrl) {
  try {
    if (dataUrl) localStorage.setItem(BACKDROP_MIRROR, dataUrl);
    else localStorage.removeItem(BACKDROP_MIRROR);
  } catch {
    // Blocked or full: the default photo flashes before storage catches up.
    // A stale picture must not outlive a failed write, though.
    try { localStorage.removeItem(BACKDROP_MIRROR); } catch {}
  }
}

/** Downscales to BACKDROP_MAX_PX on the long side and re-encodes as JPEG. */
async function shrinkImage(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, BACKDROP_MAX_PX / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  // JPEG has no alpha: fill transparent areas with the page's own backing colour.
  ctx.fillStyle = '#2b2b33';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', BACKDROP_QUALITY);
}

/* ---------- Two-step confirm ---------- */

const ARM_MS = 3000;
const DONE_MS = 1500;

/**
 * The first press arms the button and relabels it; only a second press within
 * ARM_MS runs the action. Moving focus away disarms it, so a stray click
 * after closing the panel cannot land on an armed button.
 */
function confirmFirst(btn, action) {
  const label = btn.textContent;
  let timer = 0;

  const restore = () => {
    clearTimeout(timer);
    timer = 0;
    btn.classList.remove('is-armed');
    btn.textContent = label;
  };

  btn.addEventListener('click', async () => {
    if (!btn.classList.contains('is-armed')) {
      restore();
      btn.classList.add('is-armed');
      btn.textContent = 'Confirm?';
      timer = setTimeout(restore, ARM_MS);
      return;
    }
    restore();
    btn.disabled = true;
    try {
      await action();
      btn.textContent = 'Cleared';
      timer = setTimeout(restore, DONE_MS);
    } finally {
      btn.disabled = false;
    }
  });
  btn.addEventListener('blur', () => {
    if (btn.classList.contains('is-armed')) restore();
  });
}
