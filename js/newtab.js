/* Entry point: route between setup and dashboard, then render Canvas data
 * using a stale-while-revalidate cache so the tab paints instantly. */

import { getSettings, clearAll, readCache, writeCache } from './store.js';
import {
  getCourses, getAssignments, originPattern, CanvasError,
} from './canvas.js';
import { initSetup } from './setup.js';
import { initSearch } from './search.js';
import { initBookmarks } from './bookmarks.js';

const setupView = document.getElementById('setup');
const dashView = document.getElementById('dashboard');
const assignmentsList = document.getElementById('assignments-list');
const classesList = document.getElementById('classes-list');
const resetBtn = document.getElementById('reset-btn');
const pills = [...document.querySelectorAll('.pill')];

const dueFmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'short', month: 'short', day: 'numeric',
  hour: 'numeric', minute: '2-digit',
});

let settings = null;
let bucket = 'future';       // 'future' = Upcoming pill, 'past' = Past pill
let dashboardWired = false;
let loadToken = 0;           // guards against out-of-order responses

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

function showDashboard() {
  setupView.hidden = true;
  dashView.hidden = false;

  if (!dashboardWired) {
    dashboardWired = true;
    initSearch();
    initBookmarks();
    pills.forEach((p) => p.addEventListener('click', () => selectBucket(p.dataset.bucket)));
    resetBtn.addEventListener('click', disconnect);
  }
  load();
}

async function disconnect() {
  await clearAll();
  settings = null;
  showSetup();
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
      renderNotice(assignmentsList, 'No active courses', 'Nothing to pull assignments from yet.');
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
    const act = { label: 'Update token', run: () => showSetup({
      message: 'Your Canvas token is no longer valid. Paste a new one.',
    }) };
    renderNotice(assignmentsList, 'Token expired', 'Canvas rejected the saved token.', act);
    if (!hadCourses) renderNotice(classesList, 'Token expired', '', act);
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
  target.replaceChildren();
  for (let i = 0; i < count; i++) {
    const el = document.createElement('div');
    el.className = 'card is-skeleton';
    target.append(el);
  }
}

function renderAssignments(items, { failed = 0 } = {}) {
  assignmentsList.replaceChildren();

  if (!items.length) {
    renderNotice(
      assignmentsList,
      bucket === 'past' ? 'Nothing here yet' : 'All clear',
      bucket === 'past'
        ? 'No past assignments in your active courses.'
        : 'Nothing due. Enjoy it.'
    );
    return;
  }

  for (const a of items) assignmentsList.append(assignmentCard(a));

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
  classesList.replaceChildren();

  if (!courses.length) {
    renderNotice(classesList, 'No active courses', 'Canvas shows no courses in progress.');
    return;
  }

  for (const c of courses) {
    const card = link(c.url, 'card');
    const row = div('card-row');
    const title = div('card-title', c.name);
    title.title = c.name;
    row.append(title);

    if (c.score !== null || c.grade) {
      const label = c.score !== null ? `${trimNum(c.score)}%` : c.grade;
      row.append(div('grade', label));
    }

    card.append(row, div('card-meta', c.code || 'Course'));
    classesList.append(card);
  }
}

function renderNotice(target, heading, body, action) {
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
