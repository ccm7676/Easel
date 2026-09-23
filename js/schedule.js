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
import {
  pickerChip, selectField, saveButton, discardButton, flag, dismissWhenUntouched, leave,
} from './draft.js';

/** Monday first, matching the row order the design draws. */
export const DAY_NAMES = [
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
];

const weekEl = document.getElementById('week');

let list = [];               // every entry, unsorted
let courses = [];            // Canvas courses, for the draft's picker
let notify = () => {};       // tells newtab.js the schedule changed
let draft = null;            // { day, form, release } while a day has a draft chip

export async function initSchedule({ onChange, hour12 = false } = {}) {
  notify = onChange ?? (() => {});
  timeFmt = makeTimeFmt(hour12);
  list = await getSchedule();
  render();
}

/** Re-reads the store, after the settings panel has cleared it. */
export async function reloadSchedule() {
  closeClassDraft({ animate: false });
  list = await getSchedule();
  render();
  notify();
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
 * Every scheduled class in the order it next meets: the one in progress first,
 * then forward through the week, wrapping around so a single Monday-morning
 * class is still coming up on Friday night. A class that meets several times a
 * week appears once, at its nearest meeting — the Classes panel lists courses,
 * not sessions. The first item is the one the panel brackets.
 *
 * `ahead` is how many days away the meeting is: 0 today, 7 for a class that
 * met earlier today and next meets a week from now.
 *
 * @returns {Array<{entry: object, state: 'now'|'next', ahead: number}>}
 */
export function upcomingClasses(now = new Date()) {
  const today = weekday(now);
  const minutes = now.getHours() * 60 + now.getMinutes();
  const out = [];
  const seen = new Set();
  const push = (entry, state, ahead) => {
    const key = classKey(entry);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ entry, state, ahead });
  };

  const todays = onDay(today);
  for (const entry of todays) {
    if (toMinutes(entry.start) <= minutes && minutes < toMinutes(entry.end)) {
      push(entry, 'now', 0);
    }
  }
  for (const entry of todays) {
    if (toMinutes(entry.start) > minutes) push(entry, 'next', 0);
  }
  // Seven, not six: the last step comes back round to today, which is what
  // makes a class earlier today read as next week's.
  for (let ahead = 1; ahead <= 7; ahead++) {
    for (const entry of onDay((today + ahead) % 7)) push(entry, 'next', ahead);
  }
  return out;
}

/** The class an entry is a meeting of: its Canvas course, else its name. */
function classKey(entry) {
  return entry.courseId != null
    ? `course:${entry.courseId}`
    : `name:${entry.name.trim().toLowerCase()}`;
}

/** '' for today, then "Tomorrow", then the weekday's name. */
export function dayLabel({ entry, ahead }) {
  if (ahead === 0) return '';
  if (ahead === 1) return 'Tomorrow';
  return DAY_NAMES[entry.day];
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

let timeFmt = makeTimeFmt(false);

/** The clock is the user's choice in settings, not the locale's. */
function makeTimeFmt(hour12) {
  return new Intl.DateTimeFormat(undefined, hour12
    ? { hour: 'numeric', minute: '2-digit', hour12: true }
    : { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

/** Called by the settings panel; redraws the week and the Classes panel. */
export function setHour12(on) {
  timeFmt = makeTimeFmt(on);
  render();
  notify();
}

/**
 * On a 12-hour clock, "10:00am–10:50am", the form the design uses: lower case,
 * and no space in front of the meridiem. On a 24-hour clock there is no
 * meridiem to close up, and it simply reads "10:00–10:50".
 */
export function formatRange(entry) {
  return `${formatTime(entry.start)}–${formatTime(entry.end)}`;
}

/** Also the draft chips' text, here and in js/tasks.js. */
export function formatTime(hhmm) {
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
  // The draft stands in for the plus button, so it cannot open on a full day.
  if (draft?.day === day) strip.append(draft.form);
  else if (entries.length < MAX_CLASSES_PER_DAY) strip.append(addButton(day));

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
  btn.addEventListener('click', () => openDraft(day, btn));
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
/*  Draft                                                              */
/* ------------------------------------------------------------------ */

/* The day's plus button turns into a chip shaped like the one it will add,
 * outlined in the Now/Next bracket's stroke: the class on the first line, its
 * times on the second, a tick to save. The same idea as the assignment and
 * bookmark drafts — see js/draft.js. It is kept across render(), so removing a
 * neighbouring chip does not throw away what was typed. */

const CUSTOM = 'custom';

function openDraft(day, btn) {
  closeClassDraft();

  const form = document.createElement('form');
  form.className = 'week-chip draft--class';
  form.noValidate = true;
  form.setAttribute('aria-label', `New class on ${DAY_NAMES[day]}`);

  const face = document.createElement('div');
  face.className = 'week-chip-face';

  const lines = document.createElement('div');
  lines.className = 'draft-lines';

  /* --- which class --- */
  const picker = document.createElement('select');
  picker.setAttribute('aria-label', 'Class');
  for (const course of courses) {
    picker.append(new Option(course.name, String(course.id)));
  }
  picker.append(new Option('Something else…', CUSTOM));
  const pickerField = selectField(picker, 'draft-select');

  /* --- ...or a name of your own --- */
  const name = document.createElement('input');
  name.className = 'draft-text';
  name.type = 'text';
  name.placeholder = 'Class name';
  name.spellcheck = false;
  name.autocomplete = 'off';
  name.setAttribute('aria-label', 'Class name');

  // With no Canvas courses there is nothing to pick, so it starts as a name.
  if (!courses.length) picker.value = CUSTOM;
  pickerField.hidden = picker.value === CUSTOM;
  name.hidden = !pickerField.hidden;
  picker.addEventListener('change', () => {
    if (picker.value !== CUSTOM) return;
    pickerField.hidden = true;
    name.hidden = false;
    name.focus();
  });

  /* --- when --- */
  const [startFrom, endFrom] = defaultTimes(day);
  const start = timeInput('Start time', startFrom);
  const end = timeInput('End time', endFrom);

  // The end follows the start at a class-length gap, and is pulled back after
  // the start if it is ever left before it.
  const setEnd = (value) => {
    end.value = value;
    end.dispatchEvent(new Event('input'));   // repaints its chip
  };
  start.addEventListener('input', () => {
    if (start.value) setEnd(endAfter(start.value));
  });
  end.addEventListener('blur', () => {
    if (!start.value) return;
    if (!end.value || toMinutes(end.value) <= toMinutes(start.value)) {
      setEnd(endAfter(start.value));
    }
  });

  const times = document.createElement('div');
  times.className = 'draft-chips';
  const dash = document.createElement('span');
  dash.className = 'draft-dash';
  dash.textContent = '–';
  times.append(pickerChip(start, formatTime), dash, pickerChip(end, formatTime));

  lines.append(pickerField, name, times);
  face.append(lines, saveButton(`Add class on ${DAY_NAMES[day]}`));
  form.append(
    face,
    discardButton('week-chip-remove', 'Discard new class', () => closeClassDraft())
  );

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const result = read(day, { picker, name, start, end });
    if (result.invalid) return flag(result.invalid);
    // No exit here: the new chip takes the draft's place as the week redraws.
    closeClassDraft({ animate: false });
    add(result.entry).then(() => focusAdd(day));
  });

  draft = { day, form, release: dismissWhenUntouched(form, closeClassDraft) };
  btn.replaceWith(form);
  form.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  (name.hidden ? picker : name).focus({ preventScroll: true });
}

/**
 * @returns {{entry: object}|{invalid: HTMLElement}} the class to add, or the
 *   field that is stopping it
 */
function read(day, { picker, name, start, end }) {
  const custom = picker.value === CUSTOM;
  const course = custom ? null : courses.find((c) => String(c.id) === picker.value);
  const label = custom ? name.value.trim() : course?.name ?? '';
  if (!label) return { invalid: custom ? name : picker };

  if (!start.value) return { invalid: start };
  if (!end.value || toMinutes(end.value) <= toMinutes(start.value)) {
    return { invalid: end };
  }

  return {
    entry: {
      id: newId(),
      day,
      courseId: course ? course.id : null,
      name: label,
      start: start.value,
      end: end.value,
    },
  };
}

/** Picks up where the day's last class left off, or a plausible morning. */
function defaultTimes(day) {
  const entries = onDay(day);
  const last = entries[entries.length - 1];
  if (!last) return ['09:00', '10:00'];
  const from = fromMinutes(Math.min(toMinutes(last.end) + 10, 22 * 60));
  return [from, endAfter(from)];
}

const CLASS_MINUTES = 60;

/** An hour after `start`, held to the same day. */
function endAfter(start) {
  return fromMinutes(Math.min(toMinutes(start) + CLASS_MINUTES, 23 * 60 + 59));
}

function fromMinutes(total) {
  const h = String(Math.floor(total / 60)).padStart(2, '0');
  const m = String(total % 60).padStart(2, '0');
  return `${h}:${m}`;
}

function timeInput(label, value) {
  const el = document.createElement('input');
  el.type = 'time';
  el.value = value;
  el.setAttribute('aria-label', label);
  return el;
}

/** Back on the day's plus button, so the next class is one Enter away. */
function focusAdd(day) {
  weekEl.children[day]?.querySelector('.week-add')?.focus({ preventScroll: true });
}

/**
 * Also the Escape handler for the whole week view, which is why it reports
 * whether it had anything to close: newtab.js closes the week view only when
 * this did not swallow the key.
 *
 * The chip shrinks back to the plus button's size and fill, and the button is
 * put back in its place — not a re-render of the week, which would pull every
 * other chip and button out from under a click.
 * @param {{animate?: boolean}} [opts]
 * @returns {boolean}
 */
export function closeClassDraft({ animate = true } = {}) {
  if (!draft) return false;
  const { day, form, release } = draft;
  const hadFocus = form.contains(document.activeElement);
  release();
  draft = null;

  const restore = () => {
    if (form.isConnected) form.replaceWith(addButton(day));
    if (hadFocus) focusAdd(day);
  };
  if (animate) leave(form, 'width', restore);
  else restore();
  return true;
}
