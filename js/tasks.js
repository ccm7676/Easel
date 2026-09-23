/* Assignments that are not on Canvas — a problem set handed out on paper, a
 * club deadline. User-authored and stored locally, like the schedule, and
 * merged into the Assignments panel by newtab.js, which renders them next to
 * Canvas's own. This module owns the list and the add dialog behind the
 * panel's plus button; the dependency runs one way, newtab.js imports this.
 */

import { getTasks, saveTasks } from './store.js';
import { anchorTo } from './anchor.js';

const addBtn = document.getElementById('add-task-btn');

let list = [];
let courses = [];            // Canvas courses, for the dialog's picker
let notify = () => {};       // tells newtab.js the list changed
let dialog = null;

export async function initTasks({ onChange } = {}) {
  notify = onChange ?? (() => {});
  list = await getTasks();
  addBtn.addEventListener('click', () => (dialog ? closeTaskDialog() : openDialog()));
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
/*  Add dialog                                                         */
/* ------------------------------------------------------------------ */

/* Built from the add-class dialog's parts (openDialog() in js/schedule.js):
 * the same card, capsules and white button, dropped from the plus button. */

const NO_CLASS = '';

function openDialog() {
  closeTaskDialog();

  const form = document.createElement('form');
  form.className = 'cd-dialog';
  form.noValidate = true;

  const title = document.createElement('div');
  title.className = 'cd-title';
  title.textContent = 'Add an assignment';

  /* --- what --- */
  const nameField = field();
  const name = document.createElement('input');
  name.type = 'text';
  name.placeholder = 'Assignment name';
  name.spellcheck = false;
  name.autocomplete = 'off';
  name.setAttribute('aria-label', 'Assignment name');
  nameField.append(name);

  /* --- for which class --- */
  const pickerField = field();
  const picker = document.createElement('select');
  picker.setAttribute('aria-label', 'Class');
  picker.append(new Option('No class', NO_CLASS));
  for (const course of courses) {
    picker.append(new Option(course.name, String(course.id)));
  }
  pickerField.append(picker);

  /* --- when --- */
  const dateField = field('cd-field--time');
  const date = document.createElement('input');
  date.type = 'date';
  date.value = isoDate(tomorrow());
  date.setAttribute('aria-label', 'Due date');
  dateField.append(date);

  const timeField = field('cd-field--time');
  const time = document.createElement('input');
  time.type = 'time';
  time.value = '23:59';
  time.setAttribute('aria-label', 'Due time');
  timeField.append(time);

  const save = document.createElement('button');
  save.className = 'cd-add';
  save.type = 'submit';
  save.textContent = 'Add';

  const when = document.createElement('div');
  when.className = 'cd-row';
  when.append(dateField, timeField, save);

  const error = document.createElement('p');
  error.className = 'cd-error';
  error.hidden = true;

  form.append(title, nameField, pickerField, when, error);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const problem = submit({ name, picker, date, time });
    if (!problem) return closeTaskDialog();
    error.textContent = problem;
    error.hidden = false;
  });

  document.body.append(form);
  dialog = form;
  addBtn.setAttribute('aria-expanded', 'true');
  anchorTo(form, addBtn);
  name.focus();

  // Deferred a tick so the click that opened the dialog does not close it.
  setTimeout(() => document.addEventListener('pointerdown', onOutside), 0);
  window.addEventListener('resize', closeTaskDialog);
}

/** @returns {string} a message to show, or '' when the task was added */
function submit({ name, picker, date, time }) {
  const label = name.value.trim();
  if (!label) return 'Give the assignment a name.';

  // No date means no due date; a date with no time means the end of that day.
  let dueAt = null;
  if (date.value) {
    const due = new Date(`${date.value}T${time.value || '23:59'}`);
    if (Number.isNaN(due.getTime())) return 'That due date does not look right.';
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
  return '';
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

function field(extra) {
  const el = document.createElement('div');
  el.className = extra ? `cd-field ${extra}` : 'cd-field';
  return el;
}

/**
 * The Escape handler's other half, alongside closeDialog() in js/schedule.js.
 * @returns {boolean} whether there was a dialog to close
 */
export function closeTaskDialog() {
  if (!dialog) return false;
  document.removeEventListener('pointerdown', onOutside);
  window.removeEventListener('resize', closeTaskDialog);
  dialog.remove();
  dialog = null;
  addBtn.setAttribute('aria-expanded', 'false');
  return true;
}

function onOutside(event) {
  if (!dialog) return;
  if (dialog.contains(event.target)) return;
  if (addBtn.contains(event.target)) return;   // its own handler toggles
  closeTaskDialog();
}
