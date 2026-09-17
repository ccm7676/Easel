/* Settings — the container's third face. Owns the user's preferences
 * (appearance, clock, search engine) and applies the theme itself; everything
 * else is handed back to newtab.js, which owns the modules a preference or a
 * reset reaches into. Opening and closing the face is newtab.js's too. */

import { getPrefs, savePrefs, DEFAULT_PREFS } from './store.js';
import { ENGINES } from './search.js';

/* The synchronous copy js/theme-boot.js reads before first paint. It is also
 * what applyTheme() reads, so the page and the boot script can never disagree. */
const THEME_MIRROR = 'easel:theme';
const darkQuery = matchMedia('(prefers-color-scheme: dark)');

const face = document.getElementById('face-settings');
const groups = [...face.querySelectorAll('.pills[data-pref]')];
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
