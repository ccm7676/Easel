/* The parts shared by the three drafts — the new assignment card, the new
 * class chip and the new bookmark tile. None of them is a dialog: each plus
 * button puts an editable copy of the thing it adds exactly where that thing
 * will appear, and the owning module (tasks.js, schedule.js, bookmarks.js)
 * builds it from the pieces below. */

/**
 * A date or time field drawn as a small chip that reads like the card's own
 * meta line ("Tomorrow", "11:59pm") instead of the browser's segmented box.
 * The real <input> is stretched over the chip, invisible, so it keeps focus,
 * arrow-key editing and its label; a click opens its native picker.
 * Callers that set the value from code dispatch an `input` event to repaint.
 * @param {HTMLInputElement} input carries its own aria-label
 * @param {(value: string) => string} format the chip's text for a value
 */
export function pickerChip(input, format) {
  const chip = document.createElement('span');
  chip.className = 'draft-chip';
  const text = document.createElement('span');
  const paint = () => { text.textContent = format(input.value); };
  input.addEventListener('input', paint);
  input.addEventListener('change', paint);
  input.addEventListener('click', () => {
    try { input.showPicker(); } catch { /* already open, or unsupported */ }
  });
  paint();
  chip.append(text, input);
  return chip;
}

/**
 * A <select> drawn as text with a chevron after it, for the card or the chip
 * it sits in to style. The native popup still does the choosing.
 */
export function selectField(select, className) {
  const wrap = document.createElement('span');
  wrap.className = className;
  const chev = document.createElement('span');
  chev.className = 'draft-chev';
  chev.setAttribute('aria-hidden', 'true');
  wrap.append(select, chev);
  return wrap;
}

/** The round white tick that saves a draft; Enter does the same. */
export function saveButton(label) {
  const btn = document.createElement('button');
  btn.type = 'submit';
  btn.className = 'draft-save';
  btn.setAttribute('aria-label', label);
  return btn;
}

/** The trash button every saved tile, chip and card already has, here meaning "discard". */
export function discardButton(className, label, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.setAttribute('aria-label', label);
  const img = document.createElement('img');
  img.src = 'assets/trash.svg';
  img.alt = '';
  btn.append(img);
  btn.addEventListener('click', onClick);
  return btn;
}

/**
 * Marks the field that stopped a save and puts the cursor in it; the draft's
 * CSS turns it red until it is next edited. A draft has no room for an error
 * line, and every check it makes is answered by pointing at the field.
 */
export function flag(field) {
  field.setAttribute('aria-invalid', 'true');
  field.focus();
  const clear = () => field.removeAttribute('aria-invalid');
  field.addEventListener('input', clear, { once: true });
  field.addEventListener('change', clear, { once: true });
}

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

/**
 * Plays a draft's way out — its `.is-leaving` rule in newtab.css — then calls
 * `done` to remove it, or to put back the button it grew from. Inert in the
 * meantime, so nothing can land on a draft that is already going.
 * @param {HTMLElement} el
 * @param {string} property the transitioning property whose end marks the finish
 * @param {() => void} done
 */
export function leave(el, property, done) {
  el.inert = true;
  el.classList.add('is-leaving');
  if (reducedMotion.matches) return done();

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    el.removeEventListener('transitionend', onEnd);
    done();
  };
  const onEnd = (event) => {
    if (event.propertyName === property) finish();
  };
  el.addEventListener('transitionend', onEnd);
  // A draft pulled out of the page mid-way never fires transitionend.
  setTimeout(finish, 500);
}

/**
 * Discards a draft the user clicks away from without having changed anything.
 * Once they have, it stays until saved or discarded, so a stray click cannot
 * throw typing away.
 *
 * `click` rather than `pointerdown`: the draft collapsing re-centres the
 * bookmark row, and doing that between press and release would move the tile
 * the user was clicking out from under the pointer.
 *
 * @param {HTMLElement} el the draft
 * @param {() => void} close
 * @param {(target: Element) => boolean} [ignore] a click its own handler deals with
 * @returns {() => void} stops listening
 */
export function dismissWhenUntouched(el, close, ignore) {
  let touched = false;
  const touch = () => { touched = true; };
  el.addEventListener('input', touch);
  el.addEventListener('change', touch);

  const onClick = (event) => {
    if (touched || el.contains(event.target) || ignore?.(event.target)) return;
    close();
  };
  // Deferred a tick so the click that opened the draft does not close it.
  const timer = setTimeout(() => document.addEventListener('click', onClick), 0);
  return () => {
    clearTimeout(timer);
    document.removeEventListener('click', onClick);
  };
}
