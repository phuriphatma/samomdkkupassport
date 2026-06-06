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

## Vite is multi-page
**Note:** Each HTML entry (`index.html`, `html/{dashboard,admin,scan}.html`) is a
separate Rollup input in `vite.config.js`. Add new pages there or they won't build.
