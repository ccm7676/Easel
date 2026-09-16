# Easel

A Chrome new-tab page that shows your Canvas assignments and classes.

Built from the Figma design
[`AuYFKOPNzKwZ9BERTh0L16`](https://www.figma.com/design/AuYFKOPNzKwZ9BERTh0L16/Easel?node-id=1-4)
(node `1:4`).

---

## Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. **Load unpacked** → select this folder.
4. Open a new tab. You'll be asked for your Canvas address and an access token.

### Getting a token

In Canvas: **Account → Settings → + New Access Token**. The setup screen links
straight to that page once you've typed your school's address.

There is no build step — edit a file, hit reload on `chrome://extensions`, done.

---

## How it works

```
manifest.json      MV3, overrides the new tab
newtab.html        one document, two views (setup / dashboard)
css/tokens.css     design values measured from Figma — change here, not in layout
css/newtab.css     layout and components
js/newtab.js       entry point, routing, rendering
js/canvas.js       Canvas REST client: pagination, typed errors
js/store.js        chrome.storage.local wrapper (settings + cache)
js/setup.js        onboarding and the runtime permission request
js/schedule.js     the week view, and which class is on now or next
js/search.js       search bar
js/bookmarks.js    the tile row and its add dialog
preview.dev.html   local design harness — see below. Not needed at runtime.
```

### Permissions

The manifest asks for **no host permissions up front**, so installing shows no
scary "read your data on all sites" warning. Canvas is self-hosted per school,
so the exact origin isn't known until you type it — `setup.js` then requests
just `https://your-school/*` at runtime via `chrome.permissions.request()`.
That call must happen inside a click handler, which is why it's the first thing
the submit handler touches, before any `await`.

Because the new tab is an *extension page* (not a content script), fetches to a
granted host are exempt from CORS. No background service worker is needed.

### Data loading

Stale-while-revalidate: cached data paints immediately, and anything older than
5 minutes is refetched in the background and patched in. With no cache, the
design's blank cards double as loading skeletons.

Assignments are fetched one request per active course with `Promise.allSettled`,
so a single unreadable course can't blank the panel.

### The schedule

Canvas can't be trusted for meeting times — they're inconsistently filled in, and
classes you take outside Canvas aren't there at all — so the week is user-authored
and stored locally, exactly as bookmarks are. Press **Schedule** in the Classes
panel and the two panels slide left to reveal it. Both survive Disconnect: they're
the user's own work, not Canvas data.

An entry is:

```js
{ id, day: 0..6, courseId: number|null, name, start: 'HH:MM', end: 'HH:MM' }
```

- **Day 0 is Monday**, matching the design's row order; JS weeks start on Sunday,
  so `weekday()` in `schedule.js` rotates.
- **Times are local wall-clock, 24-hour, with no date.** They sort as plain
  strings and can't drift across a timezone change or a DST boundary.
- **`name` is a snapshot, not a lookup.** It lets the week paint before courses
  have loaded and keeps an entry readable after its course disappears;
  `courseId` only says which Classes card to hoist, and may safely go stale.

All seven days render. The container is sized for the five the design draws, so
Saturday and Sunday sit below the fold — deliberate: it keeps every row at the
proportion drawn rather than squeezing two more into the same height.

`currentClass()` picks the entry to bracket: one in progress reads **Now**, else
the next one coming up reads **Next**, scanning forward through the week and
wrapping around. That card is hoisted to the top of the Classes list rather than
copied, so the panel never lists the same course twice, and its meta line gives
the hour instead of repeating the course code. A 30-second tick re-renders only
when the answer actually changes, so a pinned tab isn't rebuilding the panel
twice a minute.

New users land in the week view straight after connecting Canvas, with a one-time
line explaining what to add, why, and how to leave. An empty schedule is a fine
outcome — skipping is just pressing Done.

### The `bucket` gotcha

The Upcoming pill uses **`bucket=future`**, not `bucket=upcoming`.

Canvas defines them differently (`lib/sorts_assignments.rb`):

| bucket | meaning |
|---|---|
| `upcoming` | due **within the next 7 days only** |
| `future` | `due_at IS NULL OR due_at >= now` |
| `past` | `due_at < now` |

`upcoming` silently hides anything due more than a week out — wrong for a
dashboard. Don't "fix" this back.

---

## Design notes

- **`--ui-scale` in `css/tokens.css` resizes the entire interface.** Every metric
  is its Figma measurement times that one number (currently `0.78` — the Figma
  frame is a full 1512x982 display, so 1:1 reads oversized in a real window).
  Two things deliberately do *not* scale: `--container-h`, which is a viewport
  proportion that sets how far down the panels start, and the `--fs-meta` floor,
  which keeps small text readable.
- **Maname's vertical metrics are broken** — it declares ascent 1.2em and descent
  *zero*, so its whole line box sits above the baseline and anything the browser
  centres lands ~0.38em low. `tokens.css` corrects this with
  `ascent-override`/`descent-override` on the `@font-face`, which fixes centring
  everywhere at once. Don't remove them; the search bar and pill labels drift
  low immediately.
- **The ink block is background-dependent.** Glass surfaces are white-tinted, so
  over the current light photo they read near-white and the text is dark. Swap in
  a dark photo and you flip those four tokens back to white — the block says
  exactly which.

- **Maname ships Regular 400 only** — there is no bold. Hierarchy comes from size
  and opacity. The font is bundled (`assets/maname-latin.woff2`) so the page works
  offline and makes no request to Google.
- Small meta lines use the system UI face, since Maname gets hard to read at 13px.
  Set `--font-ui` to `var(--font-display)` in `tokens.css` to go all-Maname.
- Card text is dark on the light card fill, mirroring the design's own selected
  pill (`rgba(0,0,0,0.6)` on white). Panel text is white on the darker ground.
- The background (`assets/bg.png`) is portrait, and the window is landscape, so
  it is `object-fit: cover` centred — it crops rather than distorts at any window
  size. Swap in any photo you like; a landscape one keeps more of its
  composition.
- Panels deliberately bleed off the bottom of the window with square bottom
  corners. Stacked on narrow windows, only the lowest panel keeps that.
- **The Now/Next outline is a `<fieldset>`.** A `<legend>` natively cuts a gap in
  its parent's border, which is exactly the stroke Figma node `24:104` draws by
  hand — and unlike a pseudo-element painted in the background colour, it stays
  correct over whatever the photo happens to be behind it. Its one UA default
  worth overriding is `min-inline-size`, which defaults to `min-content` and
  would stop the bracket ever narrowing with the panel.
- **The container is a one-cell grid holding two faces**, the panels and the
  week, which slide past each other. `overflow: hidden` is what makes the
  outgoing one vanish at the glass edge instead of sliding out over the photo,
  and `inert` (set in `newtab.js`) keeps whichever is off to the side out of the
  tab order while it stays painted for the length of the transition.
- **The way out of the week view is ours, not the design's** — the Schedule
  screen draws none. It floats in the empty band above the container; inside the
  week it would land on Monday's row and collide with a fourth class.
- `--container-h` is set in the media queries rather than `.container { height }`
  so that the pill above the container, which derives its own `bottom` from it,
  stays glued to the container's top edge at every size.

---

## Local design preview

`preview.dev.html` renders the dashboard with stubbed `chrome.*` APIs and fake
Canvas responses, so you can iterate on the CSS in a plain browser with no
extension, no token and no network:

```sh
open preview.dev.html            # dashboard
open 'preview.dev.html?view=setup'
open 'preview.dev.html?view=past'
open 'preview.dev.html?view=schedule'   # the week view
open 'preview.dev.html?view=onboard'    # the one-time schedule prompt
```

It's a dev tool only. Delete it before packaging for the Web Store.

---

## Known limitations

- **The token is stored unencrypted** in `chrome.storage.local`. That's normal for
  an extension with no server, but anyone with access to your machine could read
  it. Revoke it from Canvas settings at any time; the Disconnect button (top
  right, on hover) clears everything locally.
- One request per course per refresh. The 5-minute cache keeps this well clear of
  Canvas rate limits, but a student with many courses makes proportionally more
  calls.
- Only active student enrollments are shown.
