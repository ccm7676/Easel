/* Bookmarks — up to five tiles under the search bar. A set tile shows the
 * site's favicon; a single trailing tile with a plus opens the add dialog,
 * and disappears once the row is full. */

import { getBookmarks, saveBookmarks, MAX_BOOKMARKS } from './store.js';

const row = document.getElementById('bookmarks');

let list = [];
let popover = null;

export async function initBookmarks() {
  list = await getBookmarks();
  render();
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePopover();
  });
}

/** Re-reads the store, after the settings panel has cleared it. */
export async function reloadBookmarks() {
  closePopover();
  list = await getBookmarks();
  render();
}

/* ------------------------------------------------------------------ */
/*  Rendering                                                          */
/* ------------------------------------------------------------------ */

function render() {
  objectUrls.forEach(URL.revokeObjectURL);
  objectUrls = [];

  row.replaceChildren();
  list.forEach((bm, i) => row.append(tile(bm, i)));
  // One plus tile at most, and none once the row is full. Because .bookmarks
  // hugs its contents and is centred by a translate, dropping it re-centres
  // the row for free.
  if (list.length < MAX_BOOKMARKS) row.append(addTile());
}

function tile(bm, index) {
  const wrap = document.createElement('div');
  wrap.className = 'bookmark';

  const a = document.createElement('a');
  a.className = 'bookmark-link glass';
  a.href = bm.url;
  a.rel = 'noreferrer';
  a.title = bm.title;

  // An empty, correctly sized slot keeps the tile from flashing a letter it is
  // about to replace; the store is local, so the fill lands almost at once.
  const slot = document.createElement('span');
  slot.className = 'bookmark-slot';
  a.append(slot);
  paintIcon(slot, bm);

  const del = document.createElement('button');
  del.className = 'bookmark-remove';
  del.type = 'button';
  del.setAttribute('aria-label', `Remove ${bm.title}`);
  const img = document.createElement('img');
  img.src = 'assets/trash.svg';
  img.alt = '';
  del.append(img);
  del.addEventListener('click', () => remove(index));

  wrap.append(a, del);
  return wrap;
}

function addTile() {
  const btn = document.createElement('button');
  btn.className = 'bookmark-add glass';
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Add a bookmark');
  const img = document.createElement('img');
  img.src = 'assets/plus.svg';
  img.alt = '';
  btn.append(img);
  btn.addEventListener('click', () => (popover ? closePopover() : openPopover()));
  return btn;
}

/* ------------------------------------------------------------------ */
/*  Favicons                                                           */
/* ------------------------------------------------------------------ */

/* Chrome's favicon store, read over chrome-extension:// — no network request,
 * nothing leaves the machine.
 *
 * The catch is that it answers 200 for a page it has never seen, handing back
 * a generic grey placeholder instead of failing. An <img> onerror therefore
 * never fires, and every unvisited site would render as the same anonymous
 * glyph. So fetch the bytes rather than pointing an <img> at the URL, and
 * compare them against a probe for an address that cannot have an icon:
 * anything byte-identical to that probe is the placeholder, and reads better
 * as the site's initial. */

const FAVICON_SIZE = 64;
const PLACEHOLDER_PROBE = 'https://easel.invalid/';

let placeholder = null;        // bytes of the "no icon" response, learned once
let objectUrls = [];           // revoked wholesale on the next render
let warned = false;

function faviconUrl(pageUrl) {
  return `${chrome.runtime.getURL('/_favicon/')}`
    + `?pageUrl=${encodeURIComponent(pageUrl)}&size=${FAVICON_SIZE}`;
}

async function faviconBytes(pageUrl) {
  const res = await fetch(faviconUrl(pageUrl));
  if (!res.ok) throw new Error(`favicon store returned ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

function sameBytes(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  return a.every((byte, i) => byte === b[i]);
}

/** Upgrades a tile's empty slot to the real favicon, or leaves the monogram. */
async function paintIcon(slot, bm) {
  if (!chrome.runtime?.getURL) return slot.replaceWith(monogram(bm));

  try {
    if (placeholder === null) placeholder = await faviconBytes(PLACEHOLDER_PROBE);
    const bytes = await faviconBytes(bm.url);
    if (sameBytes(bytes, placeholder)) return slot.replaceWith(monogram(bm));

    const img = document.createElement('img');
    img.className = 'bookmark-icon';
    img.alt = '';
    img.src = URL.createObjectURL(new Blob([bytes]));
    objectUrls.push(img.src);
    slot.replaceWith(img);
  } catch {
    // Reaching the store at all failed — almost always the "favicon"
    // permission not being live yet. Say so once, then fall back quietly.
    warnMissingPermission();
    slot.replaceWith(monogram(bm));
  }
}

function warnMissingPermission() {
  if (warned) return;
  warned = true;
  console.warn(
    'Easel: could not read the browser\'s favicon store, so bookmarks are '
    + 'falling back to letters. If the extension was just updated, reload it '
    + 'from the extensions page — the "favicon" permission only takes effect '
    + 'once the extension itself is reloaded.'
  );
}

function monogram(bm) {
  const el = document.createElement('span');
  el.className = 'bookmark-mono';
  el.textContent = bm.title.charAt(0).toUpperCase();
  return el;
}

/* ------------------------------------------------------------------ */
/*  Add / remove                                                       */
/* ------------------------------------------------------------------ */

async function add(raw) {
  const url = normalizeUrl(raw);
  list = [...list, { url, title: labelFor(url) }];
  await saveBookmarks(list);
  render();
}

async function remove(index) {
  list = list.filter((_, i) => i !== index);
  await saveBookmarks(list);
  render();
}

/**
 * A sibling of normalizeOrigin() in canvas.js, which cannot be reused here:
 * that one throws away the path and rejects anything but https, both correct
 * for a Canvas host and wrong for an arbitrary bookmark.
 * @throws {Error} on anything that is not a usable web address
 */
function normalizeUrl(raw) {
  const text = raw.trim();
  if (!text) throw new Error('Enter a web address.');

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;

  let url;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error('That does not look like a web address.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Only http and https addresses work here.');
  }
  if (!url.hostname.includes('.')) {
    throw new Error('That address is missing a domain, like example.com.');
  }
  return url.href;
}

/** example.com/docs → "example.com"; used for the tooltip and the monogram. */
function labelFor(url) {
  return new URL(url).hostname.replace(/^www\./, '');
}

/* ------------------------------------------------------------------ */
/*  Add dialog                                                         */
/* ------------------------------------------------------------------ */

function openPopover() {
  const form = document.createElement('form');
  form.className = 'bm-dialog';
  form.noValidate = true;

  const title = document.createElement('div');
  title.className = 'bm-dialog-title';
  title.textContent = 'Add Bookmark';

  // The address field and the Add button share one capsule, as the search bar
  // does, so the button has to be a child of the bar rather than a sibling.
  const bar = document.createElement('div');
  bar.className = 'bm-dialog-bar';

  const input = document.createElement('input');
  input.className = 'bm-dialog-input';
  input.type = 'text';
  input.placeholder = 'www.example.com';
  input.spellcheck = false;
  input.autocomplete = 'off';
  input.setAttribute('aria-label', 'Bookmark web address');

  const save = document.createElement('button');
  save.className = 'bm-dialog-add';
  save.type = 'submit';
  save.textContent = 'Add';

  bar.append(input, save);

  const error = document.createElement('p');
  error.className = 'bm-dialog-error';
  error.hidden = true;

  form.append(title, bar, error);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await add(input.value);
      closePopover();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      input.focus();
    }
  });

  row.parentElement.append(form);
  popover = form;
  input.focus();

  // Deferred a tick so the click that opened the dialog does not close it.
  setTimeout(() => document.addEventListener('pointerdown', onOutside), 0);
}

function closePopover() {
  if (!popover) return;
  document.removeEventListener('pointerdown', onOutside);
  popover.remove();
  popover = null;
}

function onOutside(event) {
  if (!popover) return;
  if (popover.contains(event.target)) return;
  if (event.target.closest('.bookmark-add')) return;   // its own handler toggles
  closePopover();
}
