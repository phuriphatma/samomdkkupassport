# MISTAKES.md — pitfalls & gotchas

A running log of non-obvious traps in this codebase. Add to it when something bites
you. Each entry: the symptom, the cause, and the fix.

---

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

## Vite is multi-page
**Note:** Each HTML entry (`index.html`, `html/{dashboard,admin,scan}.html`) is a
separate Rollup input in `vite.config.js`. Add new pages there or they won't build.
