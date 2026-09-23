/* Placement shared by the dialogs that drop from a button — add class and add
 * assignment. The add-bookmark dialog is fixed under its row and needs none. */

/**
 * Anchored under the button that opened it, flipped above when the window has
 * no room below — the usual case in the week view, which sits against the
 * bottom edge of the screen.
 */
export function anchorTo(form, anchor) {
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
