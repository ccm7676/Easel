/* Thin wrapper over chrome.storage.local for settings and the data cache. */

const SETTINGS_KEY = 'settings';
const CACHE_PREFIX = 'cache:';
const BOOKMARKS_KEY = 'bookmarks';
const SCHEDULE_KEY = 'schedule';
const ONBOARDED_KEY = 'scheduleOnboarded';

/** The design has room for five tiles and no more. */
export const MAX_BOOKMARKS = 5;

/** A guard against a runaway row, not a design constraint — the chip strip
 *  scrolls, so more than three in a day is merely unusual. */
export const MAX_CLASSES_PER_DAY = 8;

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
 * Drops the Canvas connection and everything derived from it. Bookmarks and
 * the schedule are deliberately exempt: they are the user's own work, not
 * Canvas data, so disconnecting Canvas should not throw them away. A schedule
 * entry survives a change of school too — it carries its own class name, and
 * only its courseId goes stale.
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
 * The user's week of classes. Each entry is
 *   { id, day: 0..6, courseId: number|null, name, start: 'HH:MM', end: 'HH:MM' }
 * where day 0 is Monday, times are local wall-clock in 24h — sortable as
 * strings, and immune to timezone drift because no date is stored — and
 * courseId is null for a class that does not exist in Canvas.
 *
 * `name` is a snapshot rather than a lookup: it lets the week view paint
 * before courses have loaded, and keeps an entry readable if its course later
 * disappears. courseId is only used to find the card to hoist.
 *
 * @returns {Promise<Array<object>>}
 */
export async function getSchedule() {
  const bag = await chrome.storage.local.get(SCHEDULE_KEY);
  const list = bag[SCHEDULE_KEY];
  return Array.isArray(list) ? list : [];
}

export async function saveSchedule(list) {
  await chrome.storage.local.set({ [SCHEDULE_KEY]: list });
}

/** Whether the one-time "build your week" prompt has been dismissed. */
export async function isScheduleOnboarded() {
  const bag = await chrome.storage.local.get(ONBOARDED_KEY);
  return bag[ONBOARDED_KEY] === true;
}

export async function markScheduleOnboarded() {
  await chrome.storage.local.set({ [ONBOARDED_KEY]: true });
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
