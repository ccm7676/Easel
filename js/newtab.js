/* Entry point: route between setup and dashboard, then render Canvas data
 * using a stale-while-revalidate cache so the tab paints instantly. */

import {
  getSettings, clearAll, readCache, writeCache,
  isScheduleOnboarded, markScheduleOnboarded, clearScheduleAndBookmarks,
} from './store.js';
import {
  getCourses, getAssignments, sortByDue, originPattern, CanvasError,
} from './canvas.js';
import { initSetup } from './setup.js';
import { initSearch, setSearchEngine } from './search.js';
import { initBookmarks, reloadBookmarks, closeBookmarkDraft } from './bookmarks.js';
import {
  initSchedule, reloadSchedule, setHour12,
  setCourses, upcomingClasses, dayLabel, formatRange, closeClassDraft,
} from './schedule.js';
import {
  initTasks, setTaskCourses, tasksFor, removeTask, toggleTask, closeTaskDraft,
} from './tasks.js';
import { initSettings } from './settings.js';

const setupView = document.getElementById('setup');
const dashView = document.getElementById('dashboard');
const assignmentsList = document.getElementById('assignments-list');
const classesList = document.getElementById('classes-list');
// Only the Upcoming/Past pair: the settings panel has pills of its own.
const pills = [...document.querySelectorAll('.pill[data-bucket]')];

const container = document.getElementById('container');
const facePanels = document.getElementById('face-panels');
const faceWeek = document.getElementById('face-week');
const scheduleBtn = document.getElementById('schedule-btn');
const weekHint = document.getElementById('week-hint');
const weekClose = document.getElementById('week-close');
const faceSettings = document.getElementById('face-settings');
const settingsBtn = document.getElementById('settings-btn');
const settingsClose = document.getElementById('settings-close');

const dueFmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'short', month: 'short', day: 'numeric',
  hour: 'numeric', minute: '2-digit',
});

let settings = null;
let bucket = 'future';       // 'future' = Upcoming pill, 'past' = Past pill
let dashboardWired = false;
let loadToken = 0;           // guards against out-of-order responses

let lastCourses = [];        // whatever the Classes panel is showing
let classesReady = false;    // false while it holds skeletons or a notice
let nowKey = '';             // the upcoming classes shown, in order, and how labelled
let lastAssignments = null;  // the Canvas items on screen; null under skeletons or a notice
let lastRender = {};         // ...and the options they were rendered with
let onboarding = false;
let view = 'panels';         // which face is showing: 'panels' | 'week' | 'settings'

/* ------------------------------------------------------------------ */
/*  Routing                                                            */
/* ------------------------------------------------------------------ */

async function main() {
  const saved = await getSettings();
  if (!saved) return showSetup();

  // The user can revoke a host permission from chrome://extensions at any time.
  const stillAllowed = await chrome.permissions.contains({
    origins: [originPattern(saved.origin)],
  });
  if (!stillAllowed) {
    return showSetup({
      origin: saved.origin,
      message: 'Easel lost permission to reach your Canvas. Connect again to restore it.',
    });
  }

  settings = saved;
  showDashboard();
}

function showSetup(opts) {
  dashView.hidden = true;
  setupView.hidden = false;
  initSetup((saved) => {
    settings = saved;
    showDashboard();
  }, opts);
}

async function showDashboard() {
  setupView.hidden = true;
  dashView.hidden = false;

  if (!dashboardWired) {
    dashboardWired = true;
    // First, so the clock and engine are known before anything renders with them.
    const prefs = await initSettings({
      onClock: setHour12,
      onEngine: setSearchEngine,
      onDisconnect: disconnect,
      onReset: resetScheduleAndBookmarks,
    });
    initSearch({ engine: prefs.engine });
    initBookmarks();
    initSchedule({ onChange: refreshClasses, hour12: prefs.clock === '12h' });
    initTasks({ onChange: refreshAssignments });
    pills.forEach((p) => p.addEventListener('click', () => selectBucket(p.dataset.bucket)));
    wireFaces();
  }
  load();

  if (!(await isScheduleOnboarded())) startOnboarding();
}

async function disconnect() {
  showFace('panels');
  await clearAll();
  settings = null;
  showSetup();
}

async function resetScheduleAndBookmarks() {
  await clearScheduleAndBookmarks();
  await Promise.all([reloadBookmarks(), reloadSchedule()]);
}

/* ------------------------------------------------------------------ */
/*  The faces: panels, week view, settings                             */
/* ------------------------------------------------------------------ */

function wireFaces() {
  scheduleBtn.addEventListener('click', () => toggleFace('week'));
  weekClose.addEventListener('click', () => showFace('panels'));
  settingsBtn.addEventListener('click', () => toggleFace('settings'));
  settingsClose.addEventListener('click', () => showFace('panels'));
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    // An open draft swallows the first Escape; the face gets the next.
    if (closeClassDraft() || closeTaskDraft() || closeBookmarkDraft()) return;
    showFace('panels');
  });
}

function toggleFace(name) {
  showFace(view === name ? 'panels' : name);
}

/**
 * Slides one face in and the others out. `inert` rather than `hidden` on a
 * face that leaves: it has to stay painted for the length of the transition,
 * but must not be clickable or reachable by Tab while it is out of sight.
 * Settings replaces whatever was showing, the week included; closing it
 * always comes back to the panels.
 */
function showFace(next) {
  const prev = view;
  if (next === prev) return;
  view = next;

  container.classList.toggle('is-schedule', next === 'week');
  container.classList.toggle('is-settings', next === 'settings');
  facePanels.inert = next !== 'panels';
  faceWeek.inert = next !== 'week';
  faceSettings.inert = next !== 'settings';
  scheduleBtn.setAttribute('aria-expanded', String(next === 'week'));
  settingsBtn.setAttribute('aria-expanded', String(next === 'settings'));

  closeTaskDraft();
  if (prev === 'week') {
    closeClassDraft();
    if (onboarding) endOnboarding();
  }

  // Focus follows the face that just appeared, so the keyboard goes with it;
  // back on the panels, it returns to the button that left them.
  const target = next === 'week' ? weekClose
    : next === 'settings' ? settingsClose
    : prev === 'week' ? scheduleBtn : settingsBtn;
  target.focus({ preventScroll: true });
}

/* Onboarding: a new user lands here straight after connecting Canvas, so the
 * hint has to answer all three questions at once — what to do, why it is worth
 * doing, and how to get out. Shown once; skipping is just pressing Done. */
function startOnboarding() {
  onboarding = true;
  weekHint.hidden = false;
  weekClose.textContent = 'Done';
  showFace('week');
}

function endOnboarding() {
  onboarding = false;
  weekHint.hidden = true;
  weekClose.textContent = 'Back';
  markScheduleOnboarded();
}

function selectBucket(next) {
  if (next === bucket) return;
  bucket = next;
  pills.forEach((p) => {
    const on = p.dataset.bucket === bucket;
    p.classList.toggle('is-selected', on);
    p.setAttribute('aria-selected', String(on));
  });
  load();
}

/* ------------------------------------------------------------------ */
/*  Data — paint cache first, then revalidate                          */
/* ------------------------------------------------------------------ */

async function load() {
  const run = ++loadToken;
  const assignKey = `assignments:${bucket}`;

  const [cachedCourses, cachedAssignments] = await Promise.all([
    readCache('courses'),
    readCache(assignKey),
  ]);
  if (run !== loadToken) return;

  if (cachedCourses) renderClasses(cachedCourses.data);
  else renderSkeletons(classesList);

  if (cachedAssignments) renderAssignments(cachedAssignments.data);
  else renderSkeletons(assignmentsList);

  const needCourses = !cachedCourses?.fresh;
  const needAssignments = !cachedAssignments?.fresh;
  if (!needCourses && !needAssignments) return;

  try {
    let courses = cachedCourses?.data ?? [];
    if (needCourses) {
      courses = await getCourses(settings);
      if (run !== loadToken) return;
      await writeCache('courses', courses);
      renderClasses(courses);
    }

    if (!courses.length) {
      renderAssignments([], { noCourses: true });
      return;
    }

    const { items, failed } = await getAssignments(settings, courses, bucket);
    if (run !== loadToken) return;
    await writeCache(assignKey, items);
    renderAssignments(items, { failed });
  } catch (err) {
    if (run !== loadToken) return;
    handleLoadError(err, {
      hadAssignments: Boolean(cachedAssignments),
      hadCourses: Boolean(cachedCourses),
    });
  }
}

function handleLoadError(err, { hadAssignments, hadCourses }) {
  const kind = err instanceof CanvasError ? err.kind : 'http';

  if (kind === 'auth') {
    // No token means Easel rides the browser's Canvas login, which has ended.
    const { origin, token } = settings;
    const act = token
      ? { label: 'Update token', run: () => showSetup({
          origin, message: 'Your Canvas token is no longer valid. Paste a new one.',
        }) }
      : { label: 'Log in', run: () => showSetup({
          origin, message: 'You were logged out of Canvas. Log in again to continue.',
        }) };
    const title = token ? 'Token expired' : 'Logged out';
    const body = token ? 'Canvas rejected the saved token.' : 'Your Canvas login has ended.';
    renderNotice(assignmentsList, title, body, act);
    if (!hadCourses) renderNotice(classesList, title, '', act);
    return;
  }

  const title = kind === 'ratelimit' ? 'Canvas is busy'
    : kind === 'network' ? 'Offline' : 'Could not load';
  const body = err?.message ?? 'Something went wrong.';
  const retry = { label: 'Retry', run: () => load() };

  // With a cache on screen, annotate it instead of throwing the data away.
  if (hadAssignments) markStale(assignmentsList, title);
  else renderNotice(assignmentsList, title, body, retry);

  if (!hadCourses) renderNotice(classesList, title, body, retry);
  else markStale(classesList, title);
}

/* ------------------------------------------------------------------ */
/*  Rendering                                                          */
/* ------------------------------------------------------------------ */

function renderSkeletons(target, count = 4) {
  if (target === assignmentsList) lastAssignments = null;
  target.replaceChildren();
  for (let i = 0; i < count; i++) {
    const el = document.createElement('div');
    el.className = 'card is-skeleton';
    target.append(el);
  }
}

/**
 * @param {Array} items the Canvas assignments; the user's own are merged in here
 * @param {{failed?: number, noCourses?: boolean}} [opts]
 */
function renderAssignments(items, opts = {}) {
  const { failed = 0, noCourses = false } = opts;
  assignmentsList.replaceChildren();

  const tasks = tasksFor(bucket).map((t) => ({ ...t, isTask: true }));
  const all = [...items, ...tasks];
  sortByDue(all, bucket === 'past' ? 'desc' : 'asc');

  if (!all.length) {
    if (noCourses) {
      renderNotice(assignmentsList, 'No active courses', 'Nothing to pull assignments from yet.');
    } else {
      renderNotice(
        assignmentsList,
        bucket === 'past' ? 'Nothing here yet' : 'All clear',
        bucket === 'past'
          ? 'No past assignments in your active courses.'
          : 'Nothing due. Enjoy it.'
      );
    }
  }
  // After renderNotice, which clears them: an empty list can still gain a task.
  lastAssignments = items;
  lastRender = opts;
  if (!all.length) return;

  for (const a of all) assignmentsList.append(a.isTask ? taskCard(a) : assignmentCard(a));

  if (failed > 0) {
    const note = document.createElement('p');
    note.className = 'stale-flag';
    note.textContent = `${failed} course${failed > 1 ? 's' : ''} could not be read.`;
    assignmentsList.append(note);
  }
}

function assignmentCard(a) {
  const card = link(a.url, 'card');

  const title = div('card-title', a.title);
  title.title = a.title;

  const course = a.courseCode || a.courseName;
  const due = a.dueAt ? `Due ${dueFmt.format(new Date(a.dueAt))}` : 'No due date';
  const meta = div('card-meta', `${course} · ${due}`);
  meta.title = `${a.courseName} · ${due}`;

  const foot = div('card-foot');
  const st = statusOf(a);
  const status = document.createElement('span');
  status.className = st.cls ? `status status--${st.cls}` : 'status';
  const dot = document.createElement('i');
  dot.className = 'dot';
  status.append(dot, document.createTextNode(st.label));
  foot.append(status);

  if (a.points !== null) {
    foot.append(div('card-pts', `${trimNum(a.points)} pts`));
  }

  card.append(title, meta, foot);
  return card;
}

/**
 * One the user added by hand. There is nothing on Canvas to link to, so the
 * card is not a link; instead its status is a button that ticks it off, and a
 * trash button — revealed on hover, as on bookmarks — deletes it.
 */
function taskCard(t) {
  const card = div('card card--task');

  const title = div('card-title', t.title);
  title.title = t.title;

  const due = t.dueAt ? `Due ${dueFmt.format(new Date(t.dueAt))}` : 'No due date';
  const course = t.courseCode || t.courseName;
  const meta = div('card-meta', course ? `${course} · ${due}` : due);
  meta.title = t.courseName ? `${t.courseName} · ${due}` : due;

  const foot = div('card-foot');
  const st = t.done ? { cls: 'done', label: 'Done' }
    : t.dueAt && new Date(t.dueAt) < new Date() ? { cls: 'late', label: 'Overdue' }
    : { cls: 'due', label: 'To do' };
  const status = document.createElement('button');
  status.type = 'button';
  status.className = `status status--${st.cls} status-toggle`;
  status.setAttribute('aria-pressed', String(Boolean(t.done)));
  status.title = t.done ? 'Mark as not done' : 'Mark as done';
  const dot = document.createElement('i');
  dot.className = 'dot';
  status.append(dot, document.createTextNode(st.label));
  status.addEventListener('click', () => toggleTask(t.id));

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'task-remove';
  del.setAttribute('aria-label', `Remove ${t.title}`);
  const img = document.createElement('img');
  img.src = 'assets/trash.svg';
  img.alt = '';
  del.append(img);
  del.addEventListener('click', () => removeTask(t.id));

  foot.append(status, del);
  card.append(title, meta, foot);
  return card;
}

/** Called when the user adds, ticks off or removes one of their own. */
function refreshAssignments() {
  if (lastAssignments) renderAssignments(lastAssignments, lastRender);
}

/** Maps Canvas submission state onto the three dot colours. */
function statusOf(a) {
  const types = a.submissionTypes;
  const nothingToSubmit =
    types.length === 0 ||
    types.every((t) => t === 'none' || t === 'on_paper' || t === 'not_graded');

  if (a.submissionState === 'graded') {
    return {
      cls: 'done',
      label: a.score !== null ? `Graded · ${trimNum(a.score)}` : 'Graded',
    };
  }
  if (a.submittedAt || a.submissionState === 'submitted' || a.submissionState === 'pending_review') {
    return { cls: 'done', label: 'Submitted' };
  }
  if (nothingToSubmit) return { cls: '', label: 'No submission needed' };
  if (a.dueAt && new Date(a.dueAt) < new Date()) return { cls: 'late', label: 'Overdue' };
  return { cls: 'due', label: 'Not submitted' };
}

function renderClasses(courses) {
  lastCourses = courses;
  setCourses(courses);          // the drafts pick their options from these
  setTaskCourses(courses);
  classesList.replaceChildren();

  const upcoming = upcomingClasses();
  nowKey = keyOf(upcoming);
  classesReady = true;

  if (!courses.length && !upcoming.length) {
    renderNotice(classesList, 'No active courses', 'Canvas shows no courses in progress.');
    return;
  }

  // Scheduled classes come first, in the order they next meet, with the
  // nearest in the Now/Next outline. Each one's Canvas card is moved up rather
  // than copied, so the panel never lists the same course twice.
  let rest = courses;
  upcoming.forEach((item, i) => {
    const course = courses.find((c) => c.id === item.entry.courseId);
    if (course) rest = rest.filter((c) => c !== course);
    const when = i === 0 ? formatRange(item.entry) : whenLabel(item);
    const card = course ? classCard(course, when) : customClassCard(item.entry, when);
    classesList.append(i === 0 ? bracket(item, card) : card);
  });

  if (!rest.length) return;
  // Only a heading when there is something above to set the rest apart from.
  if (upcoming.length) classesList.append(div('cards-heading', 'Other Classes'));
  for (const c of rest) classesList.append(classCard(c));
}

/**
 * The outline the design draws around the class that is on now, or is next.
 * A next class on another day says which, rather than a bare "Next".
 */
function bracket(item, card) {
  const box = document.createElement('fieldset');
  box.className = 'now';
  const legend = document.createElement('legend');
  legend.className = 'now-legend';
  legend.textContent = item.state === 'now' ? 'Now' : dayLabel(item) || 'Next';
  box.append(legend, card);
  return box;
}

/** "10:00–10:50" today, "Tomorrow · 10:00–10:50" or "Friday · …" after. */
function whenLabel(item) {
  const day = dayLabel(item);
  const range = formatRange(item.entry);
  return day ? `${day} · ${range}` : range;
}

/** @param {string} [when] the meeting time, for a scheduled class's card */
function classCard(c, when) {
  const card = link(c.url, 'card');
  const row = div('card-row');
  const title = div('card-title', c.name);
  title.title = c.name;
  row.append(title);

  if (c.score !== null || c.grade) {
    const label = c.score !== null ? `${trimNum(c.score)}%` : c.grade;
    row.append(div('grade', label));
  }

  // A scheduled class's card exists to answer "when", so its meta line gives
  // the meeting rather than repeating the course code.
  card.append(row, div('card-meta', when || c.code || 'Course'));
  return card;
}

/** A class typed in by hand has no Canvas course behind it, so nothing to link. */
function customClassCard(entry, when) {
  const card = div('card');
  const row = div('card-row');
  const title = div('card-title', entry.name);
  title.title = entry.name;
  row.append(title);
  card.append(row, div('card-meta', when));
  return card;
}

/* The list has to move on its own as the day goes by — a pinned new tab can
 * outlive several classes, and midnight turns "Tomorrow" into today. Re-render
 * only when the answer actually changes, so a tab left open all afternoon is
 * not rebuilding the panel twice a minute. */
const NOW_TICK_MS = 30_000;

function keyOf(upcoming) {
  return upcoming.map((u) => `${u.entry.id}:${u.state}:${u.ahead}`).join(',');
}

function tickNow() {
  if (!classesReady || keyOf(upcomingClasses()) === nowKey) return;
  renderClasses(lastCourses);
}

/** Called when the user edits the schedule, where the answer always changes. */
function refreshClasses() {
  if (classesReady) renderClasses(lastCourses);
}

setInterval(tickNow, NOW_TICK_MS);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) tickNow();
});

function renderNotice(target, heading, body, action) {
  if (target === assignmentsList) lastAssignments = null;
  target.replaceChildren();
  const box = div('notice');
  const h = document.createElement('strong');
  h.textContent = heading;
  box.append(h);
  if (body) box.append(document.createTextNode(body));
  if (action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = action.label;
    btn.addEventListener('click', action.run);
    box.append(document.createElement('br'), btn);
  }
  target.append(box);
}

/** Prepends a "showing cached data" strip above an already-rendered list. */
function markStale(target, reason) {
  if (target.querySelector('.stale-flag')) return;
  const flag = div('stale-flag', `${reason} — showing saved data.`);
  target.prepend(flag);
}

/* ---------- tiny DOM helpers ---------- */

function div(className, text) {
  const el = document.createElement('div');
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function link(href, className) {
  const el = document.createElement('a');
  el.className = className;
  el.href = href;
  el.rel = 'noreferrer';
  return el;
}

/** 92.4 → "92.4", 92.0 → "92" */
function trimNum(n) {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}

main();
