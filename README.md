# Easel

<<<<<<< HEAD
=======
A Chrome new-tab page that shows your Canvas assignments and classes.

Built from the Figma design
[`AuYFKOPNzKwZ9BERTh0L16`](https://www.figma.com/design/AuYFKOPNzKwZ9BERTh0L16/Easel?node-id=1-4)
(node `1:4`).

---

## Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. **Load unpacked** → select this folder.
4. Open a new tab, type your school's Canvas address and press
   **Log in with Canvas**.

### Logging in

Easel uses the same Canvas login your browser already has. If you're logged in,
connecting is instant; if not, your school's own login page opens in a small
window — SSO and two-factor included — and closes itself once you're in. Close
it to cancel. Easel never sees your password and stores nothing secret.

The catch: Easel is connected only while you're logged in to Canvas in this
browser. Log out, or let the session expire, and the dashboard offers
**Log in** to reconnect.

### Using an access token instead

For a connection that survives logging out of Canvas, open **Use an access token
instead** on the setup screen. Tokens come from **Account → Settings → + New
Access Token** in Canvas; the setup screen links straight to that page once
you've typed your school's address.

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
js/setup.js        onboarding: permission request, login window, token fallback
js/schedule.js     the week view, and the order classes next meet in
js/tasks.js        the user's own assignments and their draft card
js/draft.js        parts shared by the three inline "add" drafts
js/search.js       search bar
js/bookmarks.js    the tile row and its add-bookmark draft
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

### Authentication

Stored settings are `{ origin, userName }`, plus `token` in token mode.
`request()` in `canvas.js` switches on that one field:

- **Session** (no token): `credentials: 'include'`, so the browser attaches its
  Canvas login cookie (`_normandy_session`, `SameSite=None`) — the same way
  Canvas's own UI calls `/api/v1`. Only GETs are made, so no CSRF token is
  needed. A `while(1);` prefix on the JSON is stripped if Canvas sends one.
- **Token**: `Authorization: Bearer`, with `credentials: 'omit'` so a different
  person's Canvas login in the same browser can't mix in.

Logging in opens `${origin}/login` with `chrome.windows.create` (no extra
permission needed) and polls `/users/self` every 1.5s until it stops returning
401, checking once more after the window closes in case the user finished and
closed it themselves.

Canvas's official OAuth isn't used: its developer keys are issued per school by
that school's admin, and the code exchange needs a client secret, which an
extension with no server can't keep.

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
- **Times are stored as local wall-clock, 24-hour, with no date.** They sort as
  plain strings and can't drift across a timezone change or a DST boundary. How
  they are *shown* — 12H or 24H — is a setting, applied only at display time.
- **`name` is a snapshot, not a lookup.** It lets the week paint before courses
  have loaded and keeps an entry readable after its course disappears;
  `courseId` only says which Classes card to hoist, and may safely go stale.

All seven days render. The container is sized for the five the design draws, so
Saturday and Sunday sit below the fold — deliberate: it keeps every row at the
proportion drawn rather than squeezing two more into the same height.

`upcomingClasses()` orders the Classes panel: every scheduled class once, at its
next meeting, scanning forward through the week and wrapping around. The first
is bracketed — **Now** if it is in progress, **Next** if later today, otherwise
**Tomorrow** or the weekday's name — and the rest follow with the same day
prefix on their meta line (`Tomorrow · 10:00–10:50`). Canvas courses with no
scheduled meeting come last, under an **Other Classes** heading. Scheduled
cards are moved up rather than copied, so the panel never lists the same course
twice. A 30-second tick re-renders only when the order or a label actually
changes, so a pinned tab isn't rebuilding the panel twice a minute.

### Your own assignments

The **+** at the end of the Upcoming/Past pill adds an assignment Canvas doesn't know about —
name, an optional class, and a due date and time (blank date = no due date).
They're stored locally under `tasks`, merged into the list by due date, and
follow Canvas's bucket rule: past once the due time has gone by. Their cards
aren't links; the status (**To do** / **Overdue** / **Done**) is a button that
ticks them off, and a trash button appears on hover. Like the schedule, they
survive Disconnect, and Reset leaves them alone.

New users land in the week view straight after connecting Canvas, with a one-time
line explaining what to add, why, and how to leave. An empty schedule is a fine
outcome — skipping is just pressing Done.

### Settings

The gear in the bottom-right corner raises a third face into the container
(`js/settings.js`), replacing the panels or the week. It holds:

- **Appearance** — Auto / Light / Dark. The dark theme is a single
  `:root[data-theme='dark']` block in `tokens.css` that overrides colour tokens
  only. `js/theme-boot.js`, a classic script in `<head>`, sets `data-theme`
  before first paint from a `localStorage` copy of the preference, because
  `chrome.storage` is async and would flash the wrong theme. Auto follows
  `prefers-color-scheme` live.
- **Time** — 12H (`10:00am–10:50am`) or 24H (`10:00–10:50`) for every time Easel
  draws, the add drafts' time chips included. The native pickers those chips
  open follow the browser locale regardless.
- **Search** — the browser's default engine via `chrome.search`, or a fixed one
  (Google, Bing, DuckDuckGo, Brave, Ecosia) from `ENGINES` in `search.js`.
- **Disconnect** from Canvas, and **Reset** the schedule and bookmarks (asks for
  a second press).

Prefs live under `prefs` in `chrome.storage.local` and survive Disconnect.

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
  exactly which. (The dark theme is separate: it darkens the glass itself.)

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

- **Session login lasts only as long as your Canvas login.** Schools that expire
  sessions aggressively will ask you to log in again often; use a token there.
- **A token, if you use one, is stored unencrypted** in `chrome.storage.local`.
  That's normal for an extension with no server, but anyone with access to your
  machine could read it. Revoke it from Canvas settings at any time; Disconnect,
  in Easel's settings panel, clears it and the Canvas cache locally. Disconnect
  does not log you out of Canvas itself.
- One request per course per refresh. The 5-minute cache keeps this well clear of
  Canvas rate limits, but a student with many courses makes proportionally more
  calls.
- Only active student enrollments are shown.
>>>>>>> e418cdc (improved ui for adding classes, bookmarks, and assignments)
