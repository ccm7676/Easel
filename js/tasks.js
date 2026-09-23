/* Assignments that are not on Canvas — a problem set handed out on paper, a
 * club deadline. User-authored and stored locally, like the schedule, and
 * merged into the Assignments panel by newtab.js, which renders them next to
 * Canvas's own. This module owns the list and the draft card behind the
 * panel's plus button; the dependency runs one way, newtab.js imports this.
 */

import { getTasks, saveTasks } from './store.js';
import { formatTime } from './schedule.js';
import {
  pickerChip, selectField, saveButton, discardButton, flag, dismissWhenUntouched, leave,
} from './draft.js';

const addBtn = document.getElementById('add-task-btn');
const listEl = document.getElementById('assignments-list');

let list = [];
let courses = [];            // Canvas courses, for the draft's picker
let notify = () => {};       // tells newtab.js the list changed
let draft = null;            // { form, release } while the draft card is open

export async function initTasks({ onChange } = {}) {
  notify = onChange ?? (() => {});
  list = await getTasks();
  addBtn.addEventListener('click', () => (draft ? closeTaskDraft() : openDraft()));
}

/** The Classes panel learns the course list first and hands it over. */
export function setTaskCourses(next) {
  courses = Array.isArray(next) ? next : [];
}

/**
 * The tasks that belong under one pill, using Canvas's own rule: past is
 * "due before now", and anything undated counts as still to come.
 * @param {'future'|'past'} bucket
 */
export function tasksFor(bucket, now = Date.now()) {
  return list.filter((t) => {
    const past = t.dueAt !== null && new Date(t.dueAt).getTime() < now;
    return bucket === 'past' ? past : !past;
  });
}

export async function removeTask(id) {
  list = list.filter((t) => t.id !== id);
  await saveTasks(list);
  notify();
}

/** Ticks a task off, or back on. */
export async function toggleTask(id) {
  list = list.map((t) => (t.id === id ? { ...t, done: !t.done } : t));
  await saveTasks(list);
  notify();
}

async function add(task) {
  list = [...list, task];
  await saveTasks(list);
  notify();
}

/** randomUUID needs a secure context; file:// previews do not always get one. */
function newId() {
  return crypto.randomUUID?.() ?? `t${Date.now()}${Math.random().toString(36).slice(2)}`;
}


/* ------------------------------------------------------------------ */
/*  Draft                                                              */
/* ------------------------------------------------------------------ */

/* The plus button's answer: a card at the top of the panel shaped like the
 * one it will become, in the Now/Next bracket so it reads as not yet saved.
 * It sits above the list rather than in it, so the list can re-render under
 * it — a Canvas refresh, a switch to Past — without losing what was typed. */

const NO_CLASS = '';

function openDraft() {
  closeTaskDraft();

  const form = document.createElement('form');
  form.className = 'draft draft--task';
  form.noValidate = true;
  form.setAttribute('aria-label', 'New assignment');

  const bracket = document.createElement('fieldset');
  bracket.className = 'draft-bracket';
  const legend = document.createElement('legend');
  legend.className = 'now-legend';
  legend.textContent = 'New';

  const card = document.createElement('div');
  card.className = 'card draft-card';

  /* --- what --- */
  const name = document.createElement('input');
  name.className = 'draft-text';
  name.type = 'text';
  name.placeholder = 'Assignment name';
  name.spellcheck = false;
  name.autocomplete = 'off';
  name.setAttribute('aria-label', 'Assignment name');

  /* --- for which class --- */
  const picker = document.createElement('select');
  picker.setAttribute('aria-label', 'Class');
  picker.append(new Option('No class', NO_CLASS));
  for (const course of courses) {
    picker.append(new Option(course.name, String(course.id)));
  }

  /* --- when --- */
  const date = document.createElement('input');
  date.type = 'date';
  date.value = isoDate(tomorrow());
  date.setAttribute('aria-label', 'Due date');

  const time = document.createElement('input');
  time.type = 'time';
  time.value = '23:59';
  time.setAttribute('aria-label', 'Due time');

  // Undated is allowed — the picker's Clear empties the date — and a time on
  // no date means nothing, so its chip goes with it.
  const timeChip = pickerChip(time, formatTime);
  const dateChip = pickerChip(date, dayText);
  date.addEventListener('input', () => { timeChip.hidden = !date.value; });

  const chips = document.createElement('div');
  chips.className = 'draft-chips';
  chips.append(selectField(picker, 'draft-chip'), dateChip, timeChip);

  /* --- save or discard --- */
  const hint = document.createElement('span');
  hint.className = 'draft-hint';
  hint.textContent = 'Enter to add · Esc to cancel';

  const actions = document.createElement('span');
  actions.className = 'draft-actions';
  actions.append(
    discardButton('task-remove', 'Discard new assignment', () => closeTaskDraft()),
    saveButton('Add assignment')
  );

  const foot = document.createElement('div');
  foot.className = 'draft-foot';
  foot.append(hint, actions);

  card.append(name, chips, foot);
  bracket.append(legend, card);
  form.append(bracket);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const invalid = submit({ name, picker, date, time });
    if (invalid) return flag(invalid);
    closeTaskDraft();
    addBtn.focus({ preventScroll: true });
  });

  listEl.before(form);
  draft = {
    form,
    release: dismissWhenUntouched(form, closeTaskDraft, (t) => addBtn.contains(t)),
  };
  addBtn.setAttribute('aria-expanded', 'true');
  name.focus();
}

/** @returns {HTMLElement|null} the field to point at, or null once added */
function submit({ name, picker, date, time }) {
  const label = name.value.trim();
  if (!label) return name;

  // No date means no due date; a date with no time means the end of that day.
  let dueAt = null;
  if (date.value) {
    const due = new Date(`${date.value}T${time.value || '23:59'}`);
    if (Number.isNaN(due.getTime())) return date;
    dueAt = due.toISOString();
  }

  const course = courses.find((c) => String(c.id) === picker.value) ?? null;
  add({
    id: newId(),
    title: label,
    courseId: course ? course.id : null,
    courseName: course?.name ?? '',
    courseCode: course?.code ?? '',
    dueAt,
    done: false,
  });
  return null;
}

const dayFmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'short', month: 'short', day: 'numeric',
});

/** "Today", "Tomorrow", else "Thu, Sep 24" — the date chip's text. */
function dayText(value) {
  if (!value) return 'No due date';
  const [y, m, d] = value.split('-').map(Number);
  const day = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const ahead = Math.round((day - today) / 86_400_000);
  if (ahead === 0) return 'Today';
  if (ahead === 1) return 'Tomorrow';
  return dayFmt.format(day);
}

function tomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d;
}

/** Local YYYY-MM-DD — toISOString() would give the UTC date instead. */
function isoDate(d) {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * The Escape handler's other half, alongside closeClassDraft() in js/schedule.js.
 * @returns {boolean} whether there was a draft to close
 */
export function closeTaskDraft() {
  if (!draft) return false;
  const { form, release } = draft;
  release();
  draft = null;
  addBtn.setAttribute('aria-expanded', 'false');

  // Folds away rather than vanishing, so the list slides up to close the gap.
  // Height cannot transition from auto: pin it to its measure first, and
  // commit that before asking for zero.
  form.style.height = `${form.offsetHeight}px`;
  void form.offsetHeight;
  leave(form, 'height', () => form.remove());
  form.style.height = '0px';
  return true;
}
