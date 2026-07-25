# MISTAKES.md — pitfalls & gotchas

A running log of non-obvious traps in this codebase. Add to it when something bites
you. Each entry: the symptom, the cause, and the fix.

---

## Wrapping Thai correctly (no spaces → break at word boundaries, not mid-syllable)
**Context:** Thai has no spaces, so `/\s+/` splitting treats a whole phrase as one
"word" (then char-breaks mid-syllable when it overflows), while `word-break: keep-all`
doesn't stop Chrome's Thai breaking and `break-all` chops syllables. None give clean
word-boundary wraps.
**Fix (canvas, current):** the QR poster name is drawn on `<canvas>`, so `wrapLines()` in
`js/admin-page.js` segments with **`Intl.Segmenter('th', {granularity:'word'})`** (ICU
dictionary) to get real Thai words, wraps between them, and char-breaks a single segment
only if it alone is too wide. Falls back to space-splitting if `Intl.Segmenter` is absent.
**For DOM text (not canvas):** just let the browser do it — defaults + `lang="th"` +
`overflow-wrap: anywhere` as a safety net; the engine has the same ICU Thai breaker.

## Canvas postage-stamp: perforations bulge OUT instead of notching IN
**Symptom:** Re-creating the dashboard stamp on a `<canvas>` (for the QR poster download),
the edge perforation circles rendered as outward white bumps, not inward notches.
**Cause:** The CSS mask SVG has `viewBox="0 0 100 100"`; circles centred on the edges
extend past it and the **viewBox clips** the outer halves, leaving notches. A bare canvas
`fill(path,'evenodd')` doesn't clip, so the outer halves show.
**Fix:** Clip to `rect(0,0,100,100)` before filling/clipping the scallop path
(`renderStampCanvas` in `js/admin-page.js`). It's rendered to an offscreen canvas, then
drawn with a shadow so the shadow still traces the scalloped alpha. Grain/parchment/dashed-
frame are ported from `css/passport/_stamps.css`; the dashed frame is expressed as % of the
100-box (1.5px/7px on a 60px stamp → ~2.5%/11.7%) to match the on-screen proportions.

## OAuth redirects to production instead of localhost in dev
**Symptom:** Running `npm run dev` on `http://localhost:5173`, after Google login you
land on `https://samomdkkupassport.pages.dev/#` instead of localhost.
**Cause:** The code already passes `redirectTo: window.location.origin + ...` (correct).
But Supabase only honors a `redirectTo` that matches its **Redirect URLs allow-list**;
otherwise it falls back to the configured **Site URL** (production).
**Fix (Supabase dashboard, not code):** Authentication → URL Configuration → add
`http://localhost:5173/**` to **Redirect URLs**. Keep the production URL too. No code change.

## OAuth on a LAN IP (iPad testing) bounced to production even with the IP allow-listed
**Symptom:** Open the dev server at `http://192.168.1.233:5173`, sign in, land on
`https://samomdkkupassport.pages.dev/#` — even though `http://192.168.1.233:5173/**`
is in the Redirect URLs. The `/auth/v1/callback` response `location:` points at the
Site URL, i.e. Supabase rejected the `redirect_to` and fell back.
**Cause:** We were redirecting OAuth straight to the **deep path**
`/html/dashboard.html`, which only matches via the `/**` wildcard. That wildcard
wasn't being honored for the LAN entry, so Supabase substituted the Site URL.
**Fix (code):** `index.js` now redirects OAuth back to the **same page** it started
on (`window.location.origin + window.location.pathname`) and forwards to the
dashboard/pending-scan in JS (`forwardAfterLogin()`). A same-page redirect matches a
simple Redirect-URL entry, so local/LAN dev works. (Mirrors the sibling SPA project.)
Easiest alternative: test on the branch **preview URL** — it's covered by the existing
`https://*.samomdkkupassport.pages.dev/**` entry, no per-IP config.

## sendBeacon does NOT follow redirects — useless for GAS `/exec`
**Symptom:** A fire-and-forget cleanup/notify to the Apps Script web app never arrives.
**Cause:** GAS `/exec` URLs always 302-redirect to `script.googleusercontent.com`;
`navigator.sendBeacon` doesn't follow redirects.
**Fix:** Use `fetch(url, { keepalive: true, ... })` for GAS endpoints (see
`deleteFromDriveBeacon` in `js/upload.js`). Don't switch it back to sendBeacon.

## Passport pages shift up/down when changing pages (desktop)
**Symptom:** Clicking ‹ / › moves the whole book and the nav row vertically.
**Cause:** `.passport-page` used `min-height: 480px; max-height: 90dvh`, so each page
sized to its own content; the book's height changed per page. (Mobile ≤480px was fine —
it pins height via `flex: 1` in a fixed-height container.)
**Fix:** In the `@media (min-width: 481px)` block, give every page one viewport-based
height (`height: min(620px, 82dvh)`) and let `.page-inner` scroll internally.

## Google Drive images taint the canvas (certificate/QR export fails)
**Symptom:** `canvas.toDataURL()` / `toBlob()` throws a SecurityError; download fails.
**Cause:** Drawing a cross-origin image without CORS headers taints the canvas.
**Fix:** Always run Drive links through `fixGoogleDriveUrl()` (→ `lh3.googleusercontent.com`,
which serves `Access-Control-Allow-Origin`) and set `img.crossOrigin = 'anonymous'`
before loading. See `js/certificate.js`. Errors are caught and surfaced as a toast.

## Certificate features look broken until the table exists
**Symptom:** Admin "Certificates" shows a load error; students see no certificate buttons.
**Cause:** The `certificates` table hasn't been created yet.
**Fix:** Run `db/0001_certificates.sql` in the Supabase SQL editor. The code is written to
degrade gracefully (cert fetch errors are ignored) so the rest of the app is unaffected.

## User memories/photos "disappear"
**Cause:** They live in `localStorage`, keyed by `user.id`, **per-device**. Clearing
browser data or switching devices loses them by design.
**Mitigation:** The dashboard has Export/Import (a JSON backup). This is intentional —
do not move it to Supabase storage without an explicit product decision (STATE.md).

## Negative or non-numeric km
**Cause:** Admin km is a free number input; a negative value was entered once in the DB.
**Mitigation:** Inputs now have `min="0"`; km is parsed with `parseInt`. Validate before
trusting `base_points_km` in aggregates.

## Permissive RLS / hardcoded admin
**Note:** `certificates` (and `activities`) RLS policies allow anon read/write because
the admin terminal uses the anon key with a hardcoded `admin/1234` localStorage flag —
there is no real admin auth. Treat the admin surface as trusted-network only and tighten
RLS if/when real auth is added.

## iPad: modal clips / page "locks up" when the keyboard opens
**Symptom:** Writing a memory on iPad, the keyboard pushes the modal so its top is
clipped and the Save button hides behind the keyboard; sometimes the page feels stuck.
**Cause:** iOS doesn't shrink the *layout* viewport for the keyboard, so a
bottom-anchored `position:fixed` modal sits partly under it. A leftover
`document.body.style.overflow='hidden'` could also strand the page.
**Fix:** `dashboard.js` sizes open `.memory-modal`s to `window.visualViewport`
(height + offsetTop) and re-syncs on its `resize`/`scroll`. Modal cards use
`max-height: 88%` (of that container), not `vh`. Body overflow is no longer toggled
in JS (the theme already sets `overflow:hidden`).

## iPad: blue background shows under the book on overscroll
**Cause:** The dashboard body was `height:100dvh; overflow:hidden` but the document
could still rubber-band, exposing the fixed `.sky-bg`.
**Fix:** `body.passport-page-theme` is `position:fixed; inset:0; overscroll-behavior:none`.

## Flight Log / Leaderboard list overlaps the barcode footer
**Symptom:** the last flight-log row renders *underneath* the decorative barcode footer
(they visually overlap at the bottom of the page).
**Cause:** `.fl-content`/`.lbp-content` are `flex:1` with NO internal scroll, while the
footer uses `margin-top:auto`. A long list overflows its flex box downward and lands on
top of the footer instead of scrolling.
**Fix:** the inner list (`.fl-list`/`.lbp-list`) takes the leftover space and scrolls:
`flex:1; min-height:0; overflow-y:auto`; the selectors/total/toggle/podium + header +
footer get `flex-shrink:0`. Lives in `css/passport.css`. (Pattern: in a fixed-height
flex-column page, the *scrolling region* must be a `flex:1; min-height:0; overflow:auto`
child — not the whole column.)

## Info page: only the flight log scrolls (don't make the whole page scroll)
**Note:** `#page-1` is `overflow:hidden`; `.info-flight-log`/`.activity-log-list`
are `flex:1; min-height:0; overflow-y:auto`. The flight log markup is a **sibling**
of `.info-section`, not inside it — keep it that way or the internal scroll breaks.

## Admin uploads are deleted if the activity/cert isn't saved
**Note:** `admin-page.js` tracks every Drive upload as uncommitted until a save uses
it (`commitUpload`), and cleans up orphans on cancel/replace and via `sendBeacon` on
`pagehide` (`deleteFromDriveBeacon`). Don't upload straight into a saved row without
committing, or real images may get beacon-deleted on tab close.

## Scans are immutable snapshots — don't rewrite/delete past history
**Note (db/0006):** A scan stores its own `activity_name`, `department_id`,
`sub_department_id`, `points_awarded`, `samo_year_id`, `season_id` at scan time.
Aggregations (flight log, leaderboards) read those snapshot fields, **not** a live
join to `activities`. So:
- Editing an activity's km updates scans **only for the current season**
  (`submitEditActivity` filters `eq('season_id', currentSeason)`); past seasons/years
  must stay frozen.
- Deleting an activity keeps its **scans** (flight-log history; migration 0006 drops the
  `activity_id` FK so the snapshot rows survive). Its **certificates ARE deleted** with it
  (see below) — that's deliberate, not a bug.
- `scanning.js` stamps the snapshot on insert with a "retry minimal on missing column"
  fallback, so it works before 0006 is run. Don't remove that fallback.

## Certificates are NOT season-scoped (reverted 2026-06-07)
**Note:** Certificates belong to their activity and always reflect their **current**
settings — no season snapshot, no freezing. The student sees **every** cert template on
the activity (`populateCerts(activityId)` ignores `season_id`). Deleting the activity
deletes its certs too (`deleteActivity` runs `certificates.delete().eq('activity_id', id)`)
— "activity gone ⇒ cert gone; collect it while the activity is open." The `season_id`
column still exists but is unused (new certs insert it NULL). Don't reintroduce
season-matching on certs — it silently hid certs whenever a scan's `season_id` didn't
equal the cert's (the exact bug that prompted the revert).

## "Delete all data" / bulk delete: filter type + RLS DELETE policy
**Symptom:** admin "🧹 Clean ALL data" left scans (→ customer Flight Log still showed
deleted activities) and samo_year/season rows behind.
**Causes (two):** (1) the wipe used `.neq('id', '<uuid>')`, but `scans.id` is a **bigint**
→ Postgres throws `invalid input syntax for type integer` on the first table and aborts
the whole loop. (2) `scans` has no DELETE **RLS policy** (it's append-only by design), so
even a valid delete affects 0 rows with **no error**.
**Fix:** use `.not('id', 'is', null)` (works for any PK type) + `.select('id')` to count
affected rows; if 0 deleted while rows exist, report "needs DELETE policy". Run
**db/0007_clean_all_policies.sql** to add the `scans`/`activities` DELETE policies. Lives
in `cleanAllData` (`js/admin-page.js`).

## Enabling RLS without ALL the policies locks a table (db/0007 → 0008 + 0009)
**Symptom:** after running db/0007, creating an activity failed with *"new row violates
row-level security policy for table activities"* (HTTP 401); then QR scanning failed the same
way for `scans`. Reads could also come back empty (a SELECT on an RLS table with no SELECT
policy returns **200 with `[]`**, not an error — so it looks like "no data," not "blocked").
**Cause:** db/0007 ran `enable row level security` on `scans` + `activities` but only added a
**DELETE** policy each. Postgres RLS denies by default — with RLS on and no SELECT/INSERT/UPDATE
policy, those ops are blocked. Both tables had been open (RLS off), so this was a regression.
**Fix:** db/0008 (activities) + db/0009 (scans) add the full set; db/0007 was rewritten to do
the same. **Rule: if you `enable row level security` on a table, add a policy for EVERY
operation the app uses (select/insert/update/delete), not just the one you came for.** And
when probing RLS, remember a blocked SELECT returns empty-200, not 4xx — test INSERT to be sure.

## "Current" SamoYear/Season = the open row (ended_at IS NULL)
**Note:** There's no `is_current` flag. `samo.js` finds the open year/season by
`ended_at IS NULL`. Starting a new one sets the previous open row's `ended_at=now()`
first. Keep that ordering or you'll briefly have two "current" rows.
**Invariant — a วาระสโม must never be open without an open season.** If it is, scans during
the gap get `season_id = NULL` and fall into the customer's "ไม่ระบุซีซั่น" (uncategorized)
bucket. So `startNewYear` (admin-page.js) REQUIRES a first-season name and inserts that season
immediately after creating the year. Don't add a path that opens a year without a season.

## Vite is multi-page
**Note:** Each HTML entry (`index.html`, `html/{dashboard,admin,scan}.html`) is a
separate Rollup input in `vite.config.js`. Add new pages there or they won't build.

## Dashboard inline onclick handlers must live on `window` (ES-module trap)
**Symptom:** A handler called from `onclick="..."` in `html/dashboard.html` silently does
nothing (or two copies of it drift apart).
**Cause:** `js/dashboard.js` loads as `<script type="module">`, so its top-level functions are
module-scoped, **not** global — inline `onclick` can't see them. The page also has a *classic*
`<script>` block whose functions *are* global. It's tempting to define a handler in both; they
then diverge (we had two `switchTab`s — the module copy missed panel-close + lazy render).
**Fix:** One definition. Pure-DOM handlers (`switchTab`, `togglePlane`, `toggleSettings`,
`setAppTheme`) live in the classic inline `<script>` (parse-time). Handlers that genuinely need
module state are exposed once via `window.fnName = fnName`. Don't define the same handler in both
places. **Update (2026-06-21):** `switchTab` **moved to the inline script** — see the next entry;
the module now exposes only `window.__dashRenderTab` for the data-heavy renders.

## Sidebar / bottom-nav buttons dead on a slow or cold load (esp. iPad)
**Symptom:** on iPad the nav buttons (My Passport / Stamps / Flight Log / Leaderboard) "sometimes
work, sometimes not" — tapping does nothing, then after a moment they work for the rest of the session.
**Cause:** `switchTab` was defined **only in `js/dashboard.js`**, a `<script type="module">` (deferred).
The nav buttons call it via inline `onclick="switchTab(...)"`, which resolves against **global** scope.
Between the page becoming interactive and the module finishing download+execute (its big Supabase import
included), `window.switchTab` doesn't exist yet → an early tap throws `switchTab is not defined` and does
nothing. iPad (slower CPU / cold cache / flaky wifi) widens that window; once loaded it always works — so
it looks intermittent. Every **other** inline handler (`toggleSettings`, `togglePlane`, `setAppTheme`) was
already defined in the parse-time inline `<script>`, so only `switchTab` was affected.
**Fix:** `switchTab` (the pure-DOM pane swap) now lives in the **inline classic `<script>`** in
`html/dashboard.html`, defined at parse time — available the instant the buttons are. It calls
`window.__dashRenderTab?.(id)` for the data-heavy renders; the module defines `renderTab` and assigns
`window.__dashRenderTab = renderTab` at top level, and `init()` calls `renderTab(window.__getActiveTab())`
once scans load (so a tab tapped *during* load still renders). **Don't move `switchTab` back into the
module** — it must exist before the module loads. (Also fixed here: `switchTab` now closes `settingsPanel`,
not just the stale `themePanel`/`profileMenu` ids, so the Settings popover closes on a tab change.)

## HTML partials & CSS @import indexes (modular build)
**How it works:** `html/dashboard.html` is a skeleton of `<include src="partials/…">` tags
expanded by `vite-plugin-html-includes.js` (a `transformIndexHtml` with `order:'pre'`, so any
`<link>`/`<script>` inside a partial is still bundled). `css/{main,passport,admin}.css` are
`@import` indexes; the rules live in `css/<name>/_*.css`.
**Traps:**
- **Edit the partial, not the bundle.** `dist/html/dashboard.html` is generated; so is the
  concatenated CSS. Hand-editing those is lost on next build.
- **Partials are fragments, not pages** — only entry HTML files are Vite `input`s. Don't add a
  partial to `vite.config.js`. `<include>` paths resolve **relative to the including file**.
- **`@import` must stay at the top** of the index (CSS spec) — the index is imports only.
- **Split CSS only at rule boundaries** (section-comment lines). Splitting mid-rule changes the
  cascade. Sanity check: total `{` across partials must equal the original (we verified 327/86/84).
- Dev HMR: a partial edit triggers a full reload via the plugin's `configureServer` watcher
  (Vite doesn't track partials as deps of the entry HTML on its own).

## Mobile dashboard: bottom nav hidden by iOS toolbar / top bar not at the edge
**Symptom (real iPhone):** the bottom nav pill sits behind Safari's bottom toolbar; the
top bar doesn't reach the top edge (a strip of page background shows above it) and/or the
shell isn't full-width.
**Cause:** two safe-area mistakes in the mobile shell (`css/passport/_shell.css`,
`@media (max-width:767px)`):
1. `env(safe-area-inset-*)` were used but the viewport `<meta>` lacked **`viewport-fit=cover`**,
   so the insets are all `0` and iOS *letterboxes* the notch / home-indicator areas — the page
   background shows around the shell and the bars never reach the edges.
2. The bottom nav was `position: fixed; bottom: 0`. On iOS a fixed `bottom:0` resolves against
   the layout viewport and renders **behind** the dynamic bottom toolbar.
**Fix:** add `viewport-fit=cover` to the viewport meta (`html/partials/head.html`); make the
shell a full-bleed `position:fixed; top:0; left:0; width:100%; height:100dvh` flex column with
**no transform/centering and no 480px cap**; make `.bottom-nav` an **in-flow flex child** (not
fixed) so it lives inside the `100dvh` box; and pad header/content/nav with the matching
`env(safe-area-inset-top/right/bottom/left)`. Verify on a real notched iPhone — desktop browsers
and most simulators report zero insets, so the bug is invisible there.

## Dashboard CSS silently overridden by main.css globals (specificity / inheritance)
**Symptom:** edits to a dashboard rule "do nothing" — padding/margin/font-size/color on
`.tnav-btn` or the flight-log `<select>`s wouldn't change no matter the value (e.g. shrinking
the dropdown `gap` had no effect; the real spacing was a stray 20px margin).
**Cause:** `css/main/*` is loaded **before** `css/passport.css` on the dashboard, and two of its
rules outrank or leak into dashboard elements:
1. `body.passport-page-theme button { padding:0; font-size:inherit; font-weight:inherit;
   color:inherit; … }` (in `_base.css`) — specificity `(0,1,2)` **beats a bare `.tnav-btn`**
   `(0,1,0)`, so the sidebar buttons ignored their own padding/font/color.
2. `input, select { margin-bottom:20px; padding:14px; width:100% }` (in `_utilities.css`,
   meant for the login/admin forms) applies to **every** dashboard `<select>`. A class that sets
   only `padding` still inherits the **20px `margin-bottom`** — that was the flight-log dropdown gap.
**Fix:** give dashboard rules enough specificity (`.tb-nav .tnav-btn { … }`) and **explicitly
reset what the global sets** (`.fl-…-select { margin:0 }`). When a style "won't apply," check
`main/_base.css` (button reset) and `main/_utilities.css` (`input, select`) for a winning rule
before touching values.
**Tell-tale symptom:** two elements with the **same class render differently** when one is a
`<button>` and the other an `<a>` — e.g. `.pm-item` rows in the settings/profile menu: the
`<a>` "Back to Home" kept its `10px 14px` padding + `700`/`16.1px`, but the `<button>` rows
(Edit Name, Export…) collapsed to `padding:0`/`400`/`16px` because only `<button>` matches the
`body.passport-page-theme button` reset (0,1,2) which beats a bare `.pm-item` (0,1,0). Fix was
scoping to `.profile-menu .pm-item` (0,2,0). Lives in `css/passport/_panels.css`.

## "Equal-height columns" / inflated gap from a row-spanning grid item
**Symptom (flight log):** the gap between the teal banner and the (short) flight list was huge,
and didn't shrink when the grid `row-gap` was lowered.
**Cause:** the side card (Filter+Totals) was a grid item **spanning both rows**
(`grid-template-areas:"banner side""list side"`). When that spanning item is taller than
banner+list, CSS grid **grows the auto rows** to fit it, pushing the list down — the visible
"gap" was inflated row height, not `row-gap`.
**Fix:** don't span. Lay it out as a 2×2 grid (`"banner filter" / "list totals"`) with the side
`<aside>` set to `display:contents` so its two cards become real grid cells; `align-self:stretch`
on row-1 items gives banner==filter equal height, and the banner→list / filter→totals gaps are
then both just `row-gap`. Lives in `css/passport/_responsive.css` + `_log.css`.

## Per-tab edge spacing differs on mobile (centred flex body shrink-to-fits .app-body)
**Symptom:** on mobile, the Flight Log tab's content sat at a different distance from the
screen edges than the Passport / Stamps tabs, even though all tabs share `.app-body` and its
left/right padding.
**Cause:** the global `body` rule (`css/main/_reset.css`) is `display:flex; align-items:center`.
The desktop dashboard escapes it via `body.passport-page-theme { display:block }`, but the
**mobile** shell (`@media (max-width:767px)`) switches back to `display:flex; flex-direction:column`
**without resetting `align-items`** — so it stayed `center`. Cross-axis centring makes `.app-body`
**shrink-to-fit its content** instead of filling the width. Since only the active tab is rendered
(`display:block`, others `display:none`), `.app-body`'s width tracked the active tab's intrinsic
content width → each tab got different edge spacing.
**Fix:** add `align-items: stretch` to the mobile `body.passport-page-theme` flex rule so
`.app-body` always fills the viewport width. Lives in `css/passport/_shell.css` (mobile block).

## Bottom nav covered by Safari's bottom toolbar (min-height beats svh height)
**Symptom:** on mobile, the floating bottom nav was sometimes hidden behind the browser's
bottom toolbar (only when the toolbar was visible).
**Cause:** the base `body.passport-page-theme` rule sets `min-height: 100vh`. The mobile shell
sets `height: 100svh` to size to the SMALL (toolbar-visible) viewport, but never resets
`min-height`. Because `100vh` (large viewport) > `100svh`, **`min-height` wins** and the shell is
actually sized to the large viewport — so its bottom edge (where the `position:absolute` nav is
anchored) sits *behind* the toolbar when the toolbar is shown. A secondary smell: the nav offset
used `bottom: 5dvh` (dynamic) while the shell used `svh` (static) — mismatched bases.
**Fix:** add `min-height: 0` to the mobile `body.passport-page-theme` rule so `height: 100svh`
takes effect, and change the nav to `bottom: 5svh` so its anchor matches the shell's unit (stable
through the toolbar animation). Lives in `css/passport/_shell.css` (mobile block).

## drop-shadow on a masked element gets clipped away (stamp tiles)
**Symptom:** the scalloped stamp tiles (`.stamp-emoji`, Stamps tab) had `filter: drop-shadow(...)`
but showed **no shadow**.
**Cause:** the same element carries a `mask` (the scalloped postage-stamp shape). In the CSS
rendering order **mask is applied AFTER filter**, so the mask clips the freshly-generated
drop-shadow — and the mask only covers the tile's own outline, so everything outside (i.e. the
shadow) is erased.
**Fix:** put the shadow on a **wrapper** that is *not* masked. `js/dashboard.js` wraps each
`.stamp-emoji` in a `.stamp-wrap`, and `css/passport/_stamps.css` puts the `drop-shadow` on
`.stamp-wrap` (its alpha = the masked child's scalloped shape, so the shadow traces the notches).

## se-* colour classes are shared by stamps AND flight-log icons
**Symptom:** restyling stamp fills by editing `.se-teal { background: … }` also changed the
flight-log row icons (`.fl-item-icon`), which reuse the same `STAMP_COLORS` classes.
**Cause:** `STAMP_COLORS` (`js/dashboard.js`) is applied to both `.stamp-emoji` and
`.fl-item-icon`; the `se-*` classes set the icon's coloured disc background.
**Fix:** keep `se-*` setting `background` + `color` (for the log icons) and override the stamp
fill with a **grid-scoped** selector `.stamps-grid .stamp-emoji { background: … }` (higher
specificity, stamps-only). Lives in `css/passport/_stamps.css`.

## Passport `button` reset silently strips single-class button styles (specificity)
**Symptom:** styled buttons in the dashboard (memory-modal Save/View/Download/Edit) rendered as
bare dark text — no background, padding, or white colour — even though their `.modal-save-btn` /
`.cert-*-btn` rules set all of that.
**Cause:** `css/passport/_base.css` has a reset `body.passport-page-theme button { background:
transparent; padding:0; color:inherit; … }` to stop main.css's orange button style leaking in.
Its specificity is **(0,1,2)** — higher than a single class like `.modal-save-btn` **(0,1,0)** — so
the reset's `background`/`padding`/`color` win and the button looks unstyled. (Only props the reset
doesn't set, or ones marked `!important`, survive — which is why `.cert-view-btn`'s `!important`
border showed but its fill didn't.)
**Fix:** scope button rules under the same ancestor so they outrank the reset, e.g.
`body.passport-page-theme .modal-save-btn { … }` (0,1,1+class). Lives in `css/passport/_modal.css`.

## Certificate name "misaligned" on some devices but not others
**Symptom:** the admin places the name dead-centre and it looks right on the admin's own
phone/iPad/desktop, but some students report the name off-position / wrong-size; other students
see it fine. Device-dependent, not reproducible on the admin's hardware.
**Cause:** the canvas renderer (`certificate.js`) uses `textAlign:center` + `textBaseline:middle`
and **percentage** coords, so position is mathematically device-independent — *as long as the
chosen font is actually used*. If the cert's web font isn't downloaded when `ctx.fillText` runs,
the canvas silently falls back to a **system** font; whether that fallback exists, and its
metrics, varies per device, so the name's width/ascent — and thus its placement — differs. The
dashboard's slim `head.html` (only Nunito + Noto Sans Thai) made this guaranteed for any *other*
cert font.
**Fix:** `renderCertificate` loads the chosen family **on demand** before drawing —
`ensureCertFonts()` injects that family's Google-Fonts stylesheet once, runs
`document.fonts.load(px "Family", text)` for the exact glyphs, **and** awaits
`document.fonts.ready`. Don't make certs depend on a static font `<link>`; the renderer is
self-sufficient. Lives in `js/certificate.js`.
**Follow-up (2026-06-21) — the first fix still failed on slow links / Thai:** `injectFontStylesheet`
resolved on a **blind 3s timeout**, then `ensureCertFonts` called `document.fonts.load` regardless.
`document.fonts.load(px "Family")` is a **silent no-op** until that family's `@font-face` has actually
been parsed/registered — so when the stylesheet lost the 3s race (Thai stylesheets/fonts are larger ⇒
slower ⇒ lost it most often), it loaded nothing, the canvas drew a **system fallback**, and
`textBaseline:'middle'` placed the name at a font-metric-dependent offset. (Admin never saw it:
`admin.html` preloads **all** ~60 cert fonts, so its preview always has the real font — that's why
"works for me, misaligned for some students.") **Fix:** `injectFontStylesheet` now resolves
true-on-load / false-on-error+10s-safety (no early blind timeout); `ensureCertFonts` then waits
(bounded) for `faceRegistered(family)` — scans `document.fonts` for the `@font-face` — **before**
calling `document.fonts.load`. Also `renderCertificate` now defaults `font_size/name_x/name_y`
(`?? 6 / ?? 50 / ?? 52`) so a cert row with null fields can't render at 0px or in the corner.

## Letting a user delete their OWN scan is allowed (mis-scan recovery)
**Note:** "Scans are immutable" means we don't *rewrite* history on activity edits and never
touch *other* users' scans — but a student removing their **own** mis-scan is a deliberate
exception. `removeOwnScan` (`js/dashboard.js`, from the memory modal) runs
`scans.delete().eq('id', scan.id).eq('user_id', currentUserId)` then `location.reload()` (so km /
stamps / flight log / leaderboard / boarding pass all re-derive cleanly — no partial cache
fixups). RLS already permits it (`scans_delete using(true)`, db/0009); the `user_id` filter is
the real guard. The modal's `#modal-danger` block is shown only when a real `scan.id` is present.

## QR poster is now a template image with hard-coded slot coordinates
**Note:** `buildQrPoster` (`js/admin-page.js`) no longer draws the poster from scratch — it
composites the live QR + activity name + badge stamp onto a **designed background**,
`public/qr-poster-template.png` (1086×1448). The QR box, name band, and stamp position are
fixed pixel coordinates (`QR_CX/CY/SIZE`, `NAME_TOP/BOTTOM`, `STAMP_CX/CY/SIZE`) **measured
from that specific PNG**. **Trap:** if the template art is re-exported at a different size or
layout, those constants silently drift — the QR lands off the box, the name overlaps the map,
etc. **Fix/where:** re-measure against the new PNG (a quick PIL pixel-scan for the box outline
edges + the band's colour change works) and update the constants. Keep the template at 1086×1448
to avoid re-measuring. The asset must live in `public/` so Vite serves it as a root asset; if
it 404s, the whole QR-generate flow throws. **Reference it BASE_URL-relative, never
root-absolute** — see the subpath entry below.

## A root-absolute `public/` asset path (`'/foo.png'`) 404s on the `/passport/` VM subpath
**Symptom:** the QR poster renders on pages.dev / localhost but throws on the KKU VM — the
designed template never loads.
**Cause:** `POSTER_TEMPLATE` was `'/qr-poster-template.png'` (root-absolute). On the root
build (`base: '/'`, pages.dev) that resolves correctly, but the VM builds with
`PASSPORT_BASE=/passport/`, so the asset is emitted at `/passport/qr-poster-template.png` while
the code still requests `/qr-poster-template.png` → 404 (and, on the VM, it falls through to
the samoweb catch-all, not even passport). Exactly the same class as the routes.js base bug —
any hardcoded leading-slash path breaks on the subpath.
**Fix:** build `public/` asset URLs from `import.meta.env.BASE_URL`, e.g.
`import.meta.env.BASE_URL + 'qr-poster-template.png'` — `/` on pages.dev, `/passport/` on the
VM. Verified in both builds (`grep qr-poster-template dist/assets/admin-*.js`).
**Where:** `js/admin-page.js` `POSTER_TEMPLATE`. **Rule:** never hardcode a root-absolute
`/asset` in passport code — mirror `routes.js` and go through `BASE_URL`. This feature (QR
poster, PRs #28/#30) was authored on a branch forked *before* the subpath cutover, so it
carried the pre-cutover root-absolute assumption; it was caught and fixed on incorporation.

## Poster stamp / cert bg intermittently missing = lh3 rate-limiting (HTTP 429), NOT a bad link
**Symptom:** an activity has a valid badge image, but its **stamp is missing from the poster**
— intermittently, "some of the time", different activities on different tries.
**Real cause (confirmed 2026-07-13 via headless Chrome):** canvas images load via `loadCertImage`
with `img.crossOrigin='anonymous'` (required so `canvas.toDataURL` can export — else the canvas is
tainted). The images ARE valid and CORS-correct (`lh3.googleusercontent.com/d/ID`, `acao: *`), but
**lh3 rate-limits under load and returns HTTP 429**, which surfaces as a plain `onerror` → the
stamp is silently dropped (`catch { badgeImg = null }`). It's volume/timing-dependent, hence
"sometimes / some activities". `curl` won't reproduce it (no `Origin`, low volume); a real browser
firing several badge loads (admin list thumbnails + a crossOrigin poster fetch, which is a
*separate* cache entry) will. **Beware when debugging: running many automated image loads yourself
triggers the 429**, making everything look broken when it's your own load.
**Fix:** `loadCertImage` (`js/certificate.js`) now (a) sets `img.referrerPolicy='no-referrer'`
(lh3 throttles partly on `Referer`; mirrors the badge `<img>` in `scanning.js`) and (b) **retries
3× with backoff + a cache-busting `_r=` param** since 429 is transient. Verified: after the self-
inflicted throttle cooled, loads return 200 and export cleanly.
**Also hardened (separate, latent):** `fixGoogleDriveUrl` (`js/utils.js`) now matches `/\/d\/(ID)/`
**or** `/[?&]id=(ID)/` so a *pasted* `?id=`/`open?id=`/`uc?id=` Drive link is normalised to the
CORS-safe lh3 host too (previously only `/file/d/ID` was). Current prod badges all already used the
working `/file/d/ID` form — this wasn't the cause, just belt-and-suspenders.
**Non-bug reminder:** no-stamp can also just mean **no `badge_url`** — "has a badge *name*" ≠ "has
a badge *image*" (`badge_name` defaults to the activity name even with no image uploaded).

## A permission granted in ANOTHER repo's admin console is decorative until this app calls the RPC that reads it
**Symptom:** SAMO Passport was granted to an account in samoweb (**ทีม SAMO → จัดการสิทธิ์ →
SAMO Passport → ขอบเขต → ฝ่ายบริหารองค์กร**). Signing into `/passport/html/admin.html`, the
admin panel showed **every** department's activities, leaderboard and QR codes. Looks like the
grant didn't apply, or like the scope resolver is broken.
**Cause:** the grant was perfect. Verified live: the tree node carried
`passport_dept_id = 1` with no blanket `passport` key (the mutual-exclusion rule held),
`users.managed_passport_scopes` resolved to `{d:1}`, and `public.passport_admin_context()`
returned `{is_admin:true, all_departments:false, departments:[1]}` for that uid. **Nothing in
the passport repo ever called it** — `grep -rn "\.rpc(" js/*.js` returned zero hits. Migration
0087 deliberately built only the identity+scope half in samoweb and said so in its header; the
consuming half here was still the pre-0087 client-side `admin`/`1234` + `localStorage` gate,
which shows everything to anyone who types the password. The `filter-department` dropdown that
*looks* like a scope is a view filter the admin picks by hand, defaulting to "all".
**Fix:** `js/admin-scope.js` + the rewired `js/admin-page.js` — Google sign-in, then
`passport_admin_context()`, then hard-filter at the `activitiesCache` boundary and re-check
`scopeCoversActivity()` on every write.
**Where it lives now:** `js/admin-scope.js`, `js/admin-page.js` (`bootAdminAuth`,
`applyScopeToUi`, `assertInScope`, `assertOrgWide`). **Rules:**
1. When a permission model spans two repos, "granted" means **the consumer reads it**. Before
   debugging a scope that "doesn't apply", grep the consuming app for the RPC/column name — if
   there are no hits, the feature was never wired, and no amount of re-granting will help.
2. The `public` schema hop is load-bearing. `app.js` pins the client to `db.schema:'passport'`,
   so `supabase.rpc('passport_admin_context')` 404s (`PGRST202`, searched
   `passport.passport_admin_context`). It must be `supabase.schema('public').rpc(...)`.
   Confirmed both branches against the live project.
3. A UI-only scope is not a boundary. `passport`-schema RLS is still `using (true)` for anon
   (db/0056), so this stops accidents, not attackers — SECURITY-HARDENING-PLAN.md is what makes
   it real, and its policies must read `passport_admin_context()` rather than invent a second
   admin table.
