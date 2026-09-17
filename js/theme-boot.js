/* Sets the theme and background before first paint. A classic script in
 * <head>, not a module: chrome.storage is async and would land a frame late,
 * flashing the wrong theme (or the default photo) on every new tab. So it reads
 * synchronous localStorage copies of both, which js/settings.js keeps in step
 * and applies from then on. */
(() => {
  const root = document.documentElement;
  let pref = 'auto';
  let backdrop = null;
  try {
    pref = localStorage.getItem('easel:theme') || 'auto';
    backdrop = localStorage.getItem('easel:backdrop');
  } catch {
    // Storage blocked: Auto and the default photo are the right fallbacks.
  }
  const dark = pref === 'dark' ||
    (pref === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  root.dataset.theme = dark ? 'dark' : 'light';
  if (backdrop) root.style.setProperty('--backdrop-custom', `url("${backdrop}")`);
})();
