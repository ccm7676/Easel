/* Thin wrapper over chrome.storage.local for settings and the data cache. */

const SETTINGS_KEY = 'settings';
const CACHE_PREFIX = 'cache:';
const BOOKMARKS_KEY = 'bookmarks';
const SCHEDULE_KEY = 'schedule';
const TASKS_KEY = 'tasks';
const CHECKED_KEY = 'checked';
const ONBOARDED_KEY = 'scheduleOnboarded';
const PREFS_KEY = 'prefs';
const BACKDROP_KEY = 'backdrop';

/**
 * theme: 'auto' | 'light' | 'dark'
 * clock: '12h' | '24h'
 * engine: a key of ENGINES in js/search.js; 'default' is the browser's own
 */
export const DEFAULT_PREFS = { theme: 'auto', clock: '24h', engine: 'default' };

/** The design has room for five tiles and no more. */
export const MAX_BOOKMARKS = 5;

/** A guard against a runaway row, not a design constraint — the chip strip
 *  scrolls, so more than three in a day is merely unusual. */
export const MAX_CLASSES_PER_DAY = 8;

/** How long cached Canvas data is considered fresh. */
export const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * `token` is absent when Easel uses the browser's Canvas login instead.
 * @returns {Promise<{origin:string, token?:string, userId?:number|null, userName?:string|null}|null>}
 */
export async function getSettings() {
  const bag = await chrome.storage.local.get(SETTINGS_KEY);
  return bag[SETTINGS_KEY] ?? null;
}

/**
 * Connecting a different account — another school, or another student at the
 * same one — also drops the cached Canvas data, which belongs to the old one.
 * The same account logging back in keeps it, so the dashboard still paints at
 * once. Settings saved before userId was recorded count as different, once.
 */
export async function saveSettings(settings) {
  const prev = await getSettings();
  if (prev?.origin !== settings.origin || prev?.userId !== settings.userId) {
    await removeWhere((k) => k.startsWith(CACHE_PREFIX));
  }
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

/**
 * Drops the Canvas connection and everything derived from it. Bookmarks, the
 * schedule and prefs are deliberately exempt: they are the user's own work, not
 * Canvas data, so disconnecting Canvas should not throw them away. A schedule
 * entry survives a change of school too — it carries its own class name, and
 * only its courseId goes stale.
 */
export async function clearAll() {
  await removeWhere((k) => k === SETTINGS_KEY || k.startsWith(CACHE_PREFIX));
}

async function removeWhere(test) {
  const all = await chrome.storage.local.get(null);
  await chrome.storage.local.remove(Object.keys(all).filter(test));
}

/* ------------------------------------------------------------------ */
/*  The user's lists: bookmarks, schedule, tasks                       */
/* ------------------------------------------------------------------ */

/* Several new tabs can be open at once, each holding its own copy of these
 * lists. Saving that copy whole would put back whatever another tab had
 * removed, and drop whatever it had added. So every change is made to the
 * list as stored right now, and every tab watches for changes made by the
 * others. */

let pending = Promise.resolve();

/**
 * Applies `change` to the stored list and saves the result. Queued, so two
 * quick changes in one tab cannot both start from the same list. Across tabs
 * the gap is a single storage round trip, not the life of a tab.
 * @returns {Promise<Array>} the list as saved
 */
function updateList(key, change, limit = Infinity) {
  const run = pending.then(async () => {
    const bag = await chrome.storage.local.get(key);
    const next = change(asList(bag[key])).slice(0, limit);
    await chrome.storage.local.set({ [key]: next });
    return next;
  });
  pending = run.catch(() => {});
  return run;
}

/** Calls back with the list whenever it is saved or cleared — by any tab, this one included. */
function watchList(key, callback, limit = Infinity) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !Object.hasOwn(changes, key)) return;
    callback(asList(changes[key].newValue).slice(0, limit));
  });
}

function asList(value) {
  return Array.isArray(value) ? value : [];
}

/** Whether two lists hold the same entries — how a tab spots its own change coming back. */
export function sameList(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** @returns {Promise<Array<{url:string, title:string}>>} */
export async function getBookmarks() {
  const bag = await chrome.storage.local.get(BOOKMARKS_KEY);
  return asList(bag[BOOKMARKS_KEY]).slice(0, MAX_BOOKMARKS);
}

export function updateBookmarks(change) {
  return updateList(BOOKMARKS_KEY, change, MAX_BOOKMARKS);
}

export function watchBookmarks(callback) {
  watchList(BOOKMARKS_KEY, callback, MAX_BOOKMARKS);
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
  return asList(bag[SCHEDULE_KEY]);
}

export function updateSchedule(change) {
  return updateList(SCHEDULE_KEY, change);
}

export function watchSchedule(callback) {
  watchList(SCHEDULE_KEY, callback);
}

/**
 * Assignments the user added by hand — work Canvas does not know about. Each is
 *   { id, title, courseId: number|null, courseName, courseCode, dueAt: ISO|null, done }
 * Like schedule entries, the course fields are a snapshot so the card reads the same
 * before courses load or after the course is gone. Survives Disconnect.
 * @returns {Promise<Array<object>>}
 */
export async function getTasks() {
  const bag = await chrome.storage.local.get(TASKS_KEY);
  return asList(bag[TASKS_KEY]);
}

export function updateTasks(change) {
  return updateList(TASKS_KEY, change);
}

export function watchTasks(callback) {
  watchList(TASKS_KEY, callback);
}

/**
 * Canvas assignments the user ticked off by hand — the ones with nothing to
 * submit, so Canvas itself never learns they are finished. Their ids, as
 * js/canvas.js builds them ("courseId-assignmentId"). Survives Disconnect.
 * @returns {Promise<string[]>}
 */
export async function getChecked() {
  const bag = await chrome.storage.local.get(CHECKED_KEY);
  return asList(bag[CHECKED_KEY]);
}

export function updateChecked(change) {
  return updateList(CHECKED_KEY, change);
}

export function watchChecked(callback) {
  watchList(CHECKED_KEY, callback);
}

/** The settings panel's Reset. Leaves the onboarding flag alone: the user
 *  already knows where the week lives. */
export async function clearScheduleAndBookmarks() {
  await chrome.storage.local.remove([SCHEDULE_KEY, BOOKMARKS_KEY]);
}

/** Stored values over the defaults, so a pref added later reads as its default. */
export async function getPrefs() {
  const bag = await chrome.storage.local.get(PREFS_KEY);
  return { ...DEFAULT_PREFS, ...bag[PREFS_KEY] };
}

export async function savePrefs(prefs) {
  await chrome.storage.local.set({ [PREFS_KEY]: prefs });
}

/**
 * The user's own background, as a JPEG data: URL, or null for the default
 * photo. Kept out of prefs: it runs to hundreds of kilobytes, and prefs are
 * read whole on every tab.
 * @returns {Promise<string|null>}
 */
export async function getBackdrop() {
  const bag = await chrome.storage.local.get(BACKDROP_KEY);
  return typeof bag[BACKDROP_KEY] === 'string' ? bag[BACKDROP_KEY] : null;
}

export async function saveBackdrop(dataUrl) {
  if (dataUrl) await chrome.storage.local.set({ [BACKDROP_KEY]: dataUrl });
  else await chrome.storage.local.remove(BACKDROP_KEY);
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
