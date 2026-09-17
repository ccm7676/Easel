/* Sets the theme before first paint. A classic script in <head>, not a module:
 * chrome.storage is async and would land a frame late, flashing the wrong
 * theme on every new tab. So it reads a synchronous localStorage copy of the
 * preference, which js/settings.js keeps in step and applies from then on. */
(() => {
  let pref = 'auto';
  try {
    pref = localStorage.getItem('easel:theme') || 'auto';
  } catch {
    // Storage blocked: Auto is the right thing to fall back to.
  }
  const dark = pref === 'dark' ||
    (pref === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
})();
