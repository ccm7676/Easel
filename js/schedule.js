/* The week of classes — the one thing Canvas cannot tell us reliably, since
 * meeting times are inconsistently filled in and non-Canvas classes are not
 * there at all. So it is user-authored, stored locally, and owned here.
 *
 * This module renders the week view inside the container's second face and
 * answers "what class is on right now, or next?" for the Classes panel. The
 * dependency runs one way: newtab.js imports this, never the reverse.
 */

import {
  getSchedule, saveSchedule, MAX_CLASSES_PER_DAY,
} from './store.js';

/** Monday first, matching the row order the design draws. */
export const DAY_NAMES = [
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
];

const weekEl = document.getElementById('week');

let list = [];               // every entry, unsorted
let courses = [];            // Canvas courses, for the add dialog's picker
let notify = () => {};       // tells newtab.js the schedule changed
let dialog = null;

export async function initSchedule({ onChange } = {}) {
  notify = onChange ?? (() => {});
  list = await getSchedule();
  render();
}

/** The Classes panel learns the course list first and hands it over. */
export function setCourses(next) {
  courses = Array.isArray(next) ? next : [];
}

export function getEntries() {
  return list;
}

/* ------------------------------------------------------------------ */
/*  Now / Next                                                         */
/* ------------------------------------------------------------------ */

/**
 * The class to highlight in the Classes panel: the one in progress, or failing
 * that the next one coming up — scanning forward through the week and wrapping
 * around, so a single Monday-morning class is still "next" on Friday night.
 *
 * @returns {{entry: object, state: 'now'|'next'}|null}
 */
export function currentClass(now = new Date()) {
  if (!list.length) return null;

  const today = weekday(now);
  const minutes = now.getHours() * 60 + now.getMinutes();
  const todays = onDay(today);

  for (const entry of todays) {
    if (toMinutes(entry.start) <= minutes && minutes < toMinutes(entry.end)) {
      return { entry, state: 'now' };
    }
  }
  for (const entry of todays) {
    if (toMinutes(entry.start) > minutes) return { entry, state: 'next' };
  }
  // Seven, not six: the last step comes back round to today, which is what
  // makes a lone class earlier today read as next week's.
  for (let ahead = 1; ahead <= 7; ahead++) {
    const [first] = onDay((today + ahead) % 7);
    if (first) return { entry: first, state: 'next' };
  }
  return null;
}

/** JS weeks start on Sunday; ours start on Monday. */
function weekday(date) {
  return (date.getDay() + 6) % 7;
}

function onDay(day) {
  return list.filter((e) => e.day === day).sort(byStart);
}

function byStart(a, b) {
  return a.start.localeCompare(b.start) || a.name.localeCompare(b.name);
}

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/* ------------------------------------------------------------------ */
/*  Time display                                                       */
/* ------------------------------------------------------------------ */

const timeFmt = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric', minute: '2-digit',
});

/**
 * "10:00am–10:50am", the form the design uses: lower case, and no space in
 * front of the meridiem. A 24-hour locale has no meridiem to close up and
 * simply reads "10:00–10:50".
 */
export function formatRange(entry) {
  return `${formatTime(entry.start)}–${formatTime(entry.end)}`;
}

function formatTime(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  // Any date will do — only the clock face is being formatted.
  const text = timeFmt.format(new Date(2000, 0, 1, h, m));
  // \s covers the narrow no-break space Chrome puts before AM/PM.
  return text.replace(/\s+/g, '').toLowerCase();
}

/* ------------------------------------------------------------------ */
/*  Rendering                                                          */
/* ------------------------------------------------------------------ */

function render() {
  weekEl.replaceChildren();
  DAY_NAMES.forEach((_, day) => weekEl.append(dayRow(day)));
}

function dayRow(day) {
  const row = document.createElement('div');
  row.className = 'week-row glass-soft';

  const label = document.createElement('div');
  label.className = 'week-day';
  label.textContent = DAY_NAMES[day];

  const strip = document.createElement('div');
  strip.className = 'week-chips';

  const entries = onDay(day);
  for (const entry of entries) strip.append(chip(entry));
  if (entries.length < MAX_CLASSES_PER_DAY) strip.append(addButton(day));

  row.append(label, strip);
  return row;
}

function chip(entry) {
  const wrap = document.createElement('div');
  wrap.className = 'week-chip';

  const face = document.createElement('div');
  face.className = 'week-chip-face';

  const name = document.createElement('div');
  name.className = 'week-chip-name';
  name.textContent = entry.name;
  name.title = entry.name;

  const time = document.createElement('div');
  time.className = 'week-chip-time';
  time.textContent = formatRange(entry);

  face.append(name, time);

  const del = document.createElement('button');
  del.className = 'week-chip-remove';
  del.type = 'button';
  del.setAttribute('aria-label', `Remove ${entry.name}`);
  const img = document.createElement('img');
  img.src = 'assets/trash.svg';
  img.alt = '';
  del.append(img);
  del.addEventListener('click', () => remove(entry.id));

  wrap.append(face, del);
  return wrap;
}

function addButton(day) {
  const btn = document.createElement('button');
  btn.className = 'week-add';
  btn.type = 'button';
  btn.setAttribute('aria-label', `Add a class on ${DAY_NAMES[day]}`);
  const img = document.createElement('img');
  img.src = 'assets/plus-24.svg';
  img.alt = '';
  btn.append(img);
  btn.addEventListener('click', () => {
    if (dialog?.day === day) closeDialog();
    else openDialog(day, btn);
  });
  return btn;
}

/* ------------------------------------------------------------------ */
/*  Add / remove                                                       */
/* ------------------------------------------------------------------ */

async function add(entry) {
  list = [...list, entry];
  await saveSchedule(list);
  render();
  notify();
}

async function remove(id) {
  list = list.filter((e) => e.id !== id);
  await saveSchedule(list);
  render();
  notify();
}

/** randomUUID needs a secure context; file:// previews do not always get one. */
function newId() {
  return crypto.randomUUID?.() ?? `c${Date.now()}${Math.random().toString(36).slice(2)}`;
}

/* ------------------------------------------------------------------ */
/*  Add dialog                                                         */
/* ------------------------------------------------------------------ */

/* The design never draws this, so it is assembled from the add-bookmark
 * dialog's parts — same card, same capsule fields, same white button, same
 * dismiss behaviour. See openPopover() in js/bookmarks.js, which this follows
 * closely enough to be worth reading alongside. */

const CUSTOM = 'custom';

function openDialog(day, anchor) {
  closeDialog();

  const form = document.createElement('form');
  form.className = 'cd-dialog';
  form.noValidate = true;

  const title = document.createElement('div');
  title.className = 'cd-title';
  title.textContent = `Add a class on ${DAY_NAMES[day]}`;

  /* --- which class --- */
  const pickerField = field();
  const picker = document.createElement('select');
  picker.setAttribute('aria-label', 'Class');
  for (const course of courses) {
    picker.append(new Option(course.name, String(course.id)));
  }
  picker.append(new Option(
    courses.length ? 'Something else…' : 'Type a class name…', CUSTOM
  ));
  pickerField.append(picker);

  /* --- ...or a name of your own --- */
  const nameField = field();
  const name = document.createElement('input');
  name.type = 'text';
  name.placeholder = 'Class name';
  name.spellcheck = false;
  name.autocomplete = 'off';
  name.setAttribute('aria-label', 'Class name');
  nameField.append(name);
  nameField.hidden = courses.length > 0;

  picker.addEventListener('change', () => {
    nameField.hidden = picker.value !== CUSTOM;
    if (!nameField.hidden) name.focus();
  });

  /* --- when --- */
  const [startFrom, endFrom] = defaultTimes(day);
  const startField = field('cd-field--time');
  const start = timeInput('Start time', startFrom);
  startField.append(start);

  const to = document.createElement('span');
  to.className = 'cd-to';
  to.textContent = 'to';

  const endField = field('cd-field--time');
  const end = timeInput('End time', endFrom);
  endField.append(end);

  const save = document.createElement('button');
  save.className = 'cd-add';
  save.type = 'submit';
  save.textContent = 'Add';

  const when = document.createElement('div');
  when.className = 'cd-row';
  when.append(startField, to, endField, save);

  const error = document.createElement('p');
  error.className = 'cd-error';
  error.hidden = true;

  form.append(title, pickerField, nameField, when, error);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const problem = submit(day, { picker, name, start, end });
    if (!problem) return closeDialog();
    error.textContent = problem;
    error.hidden = false;
  });

  document.body.append(form);
  dialog = { form, day };
  position(form, anchor);
  (nameField.hidden ? picker : name).focus();

  // Deferred a tick so the click that opened the dialog does not close it.
  setTimeout(() => document.addEventListener('pointerdown', onOutside), 0);
  window.addEventListener('resize', reposition);
}

/** @returns {string} a message to show, or '' when the entry was added */
function submit(day, { picker, name, start, end }) {
  if (onDay(day).length >= MAX_CLASSES_PER_DAY) {
    return `${DAY_NAMES[day]} is full.`;
  }

  const custom = picker.value === CUSTOM;
  const course = custom ? null : courses.find((c) => String(c.id) === picker.value);
  const label = custom ? name.value.trim() : course?.name ?? '';
  if (!label) return 'Pick a class, or type a name for it.';

  if (!start.value || !end.value) return 'Set a start and an end time.';
  if (toMinutes(end.value) <= toMinutes(start.value)) {
    return 'The end time has to be after the start.';
  }

  add({
    id: newId(),
    day,
    courseId: course ? course.id : null,
    name: label,
    start: start.value,
    end: end.value,
  });
  return '';
}

/** Picks up where the day's last class left off, or a plausible morning. */
function defaultTimes(day) {
  const entries = onDay(day);
  const last = entries[entries.length - 1];
  if (!last) return ['09:00', '09:50'];
  const from = Math.min(toMinutes(last.end) + 10, 22 * 60);
  return [fromMinutes(from), fromMinutes(Math.min(from + 50, 23 * 60 + 59))];
}

function fromMinutes(total) {
  const h = String(Math.floor(total / 60)).padStart(2, '0');
  const m = String(total % 60).padStart(2, '0');
  return `${h}:${m}`;
}

function field(extra) {
  const el = document.createElement('div');
  el.className = extra ? `cd-field ${extra}` : 'cd-field';
  return el;
}

function timeInput(label, value) {
  const el = document.createElement('input');
  el.type = 'time';
  el.value = value;
  el.setAttribute('aria-label', label);
  return el;
}

/**
 * Anchored under the button that opened it, flipped above when the window has
 * no room below — which is the usual case, since the week view sits against
 * the bottom edge of the screen.
 */
function position(form, anchor) {
  const margin = 12;
  const box = form.getBoundingClientRect();
  const at = anchor.getBoundingClientRect();

  const left = clamp(
    at.left + at.width / 2 - box.width / 2,
    margin,
    Math.max(margin, window.innerWidth - box.width - margin)
  );
  const below = at.bottom + margin;
  const top = below + box.height > window.innerHeight - margin
    ? Math.max(margin, at.top - margin - box.height)
    : below;

  form.style.left = `${Math.round(left)}px`;
  form.style.top = `${Math.round(top)}px`;
}

function clamp(value, low, high) {
  return Math.min(Math.max(value, low), high);
}

function reposition() {
  if (dialog) closeDialog();   // the anchor has moved; simpler to start over
}

/**
 * Also the Escape handler for the whole week view, which is why it reports
 * whether it had anything to close: newtab.js closes the week view only when
 * this did not swallow the key.
 * @returns {boolean}
 */
export function closeDialog() {
  if (!dialog) return false;
  document.removeEventListener('pointerdown', onOutside);
  window.removeEventListener('resize', reposition);
  dialog.form.remove();
  dialog = null;
  return true;
}

function onOutside(event) {
  if (!dialog) return;
  if (dialog.form.contains(event.target)) return;
  if (event.target.closest('.week-add')) return;   // its own handler toggles
  closeDialog();
}
