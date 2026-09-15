/* Thin wrapper over chrome.storage.local for settings and the data cache. */

const SETTINGS_KEY = 'settings';
const CACHE_PREFIX = 'cache:';
const BOOKMARKS_KEY = 'bookmarks';

/** The design has room for five tiles and no more. */
export const MAX_BOOKMARKS = 5;

/** How long cached Canvas data is considered fresh. */
export const CACHE_TTL_MS = 5 * 60 * 1000;

/** @returns {Promise<{origin:string, token:string}|null>} */
export async function getSettings() {
  const bag = await chrome.storage.local.get(SETTINGS_KEY);
  return bag[SETTINGS_KEY] ?? null;
}

export async function saveSettings(settings) {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

/**
 * Drops the Canvas connection and everything derived from it. Bookmarks are
 * deliberately exempt: they are the user's own links, not Canvas data, so
 * disconnecting Canvas should not throw them away.
 */
export async function clearAll() {
  const all = await chrome.storage.local.get(null);
  const doomed = Object.keys(all).filter(
    (k) => k === SETTINGS_KEY || k.startsWith(CACHE_PREFIX)
  );
  await chrome.storage.local.remove(doomed);
}

/** @returns {Promise<Array<{url:string, title:string}>>} */
export async function getBookmarks() {
  const bag = await chrome.storage.local.get(BOOKMARKS_KEY);
  const list = bag[BOOKMARKS_KEY];
  return Array.isArray(list) ? list.slice(0, MAX_BOOKMARKS) : [];
}

export async function saveBookmarks(list) {
  await chrome.storage.local.set({
    [BOOKMARKS_KEY]: list.slice(0, MAX_BOOKMARKS),
  });
}

/**
 * @returns {Promise<{data:any, ts:number, age:number, fresh:boolean}|null>}
 */
export async function readCache(key) {
  const full = CACHE_PREFIX + key;
  const bag = await chrome.storage.local.get(full);
  const hit = bag[full];
  if (!hit || typeof hit.ts !== 'number') return null;
  const age = Date.now() - hit.ts;
  return { data: hit.data, ts: hit.ts, age, fresh: age < CACHE_TTL_MS };
}

export async function writeCache(key, data) {
  await chrome.storage.local.set({
    [CACHE_PREFIX + key]: { data, ts: Date.now() },
  });
}
