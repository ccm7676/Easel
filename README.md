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
js/search.js       search bar
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

---

## Local design preview

`preview.dev.html` renders the dashboard with stubbed `chrome.*` APIs and fake
Canvas responses, so you can iterate on the CSS in a plain browser with no
extension, no token and no network:

```sh
open preview.dev.html            # dashboard
open 'preview.dev.html?view=setup'
open 'preview.dev.html?view=past'
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
