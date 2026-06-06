# CLAUDE.md — SAMO Passport

Guide for working in this repo (for Claude and humans). Keep it accurate: update it
when structure, conventions, or workflows change.

> Companion docs: [STATE.md](STATE.md) (what's done / pending / config) and
> [MISTAKES.md](MISTAKES.md) (pitfalls — **read before touching auth, the passport
> layout, storage, or RLS**).

## What this is

A "wellness passport" web app for medical students. Students log in with Google,
scan QR codes at activities to earn km/stamps, and view a passport-style dashboard.
Admins create activities, show QR codes, and manage certificate templates.

## Tech stack

- **Vanilla JS (ES modules)** — no framework. DOM is manipulated directly.
- **Vite 5** — dev server + multi-page build (`vite.config.js`).
- **Supabase** — Google OAuth + Postgres (tables queried with the anon key from the browser).
- **QRCode.js** — loaded from a CDN in `html/admin.html` (global `QRCode`).
- **Cloudflare Pages** — hosting; auto-deploys from git, one preview URL per branch.

## Project structure

```
index.html            Landing / login page
html/dashboard.html   Student passport (the "ebook")
html/admin.html       Admin terminal
html/scan.html        QR scan landing
js/
  app.js              Creates the Supabase client (reads VITE_SUPABASE_* env)
  auth.js             checkSession() / logout()
  index.js            Landing page auth + Google sign-in
  dashboard.js        Passport book, stamps, memory modal, backup, certificates
  admin-page.js       Admin: activities CRUD, QR, department filter/search, certificates
  scanning.js         Validates a scanned QR (static token) and records a scan
  certificate.js      Shared canvas renderer (draws a name onto a background)
  utils.js            fixGoogleDriveUrl(), generateUUID(), pending-scan helpers
  routes.js           Central route paths (ROUTES.HOME/DASHBOARD/ADMIN/SCAN)
css/                  main.css (global+landing), passport.css (dashboard), admin.css
db/                   SQL migrations to run manually in the Supabase SQL editor
```

## Run / build / deploy

```bash
npm install
npm run dev      # vite dev server at http://localhost:5173
npm run build    # outputs to dist/ (gitignored)
npm run preview  # serve the production build locally
```

- Requires a `.env` (copy `.env.example`) with `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_ANON_KEY`. Vite only exposes vars prefixed `VITE_`.
- **Local OAuth login needs the dev URL allow-listed in Supabase** — see MISTAKES.md.
- Deploy: push to a branch → Cloudflare Pages builds (`npm run build`) and publishes.
  `main` is production; other branches get a preview URL.

## Database (Supabase, queried with the anon key)

- `activities` — name, `base_points_km`, `badge_url`/`badge_name`, `department_id`,
  `sub_department_id`, `static_token`, `created_at`. (`continent_id`,
  `is_marketing_bonus`, `active_token`, `token_expires_at` exist but are **unused**.)
- `scans` — `user_id`, `activity_id`, `scanned_at`, `points_awarded`. **Immutable
  snapshot (db/0006):** also stores `activity_name`, `department_id`, `sub_department_id`,
  `samo_year_id`, `season_id` stamped at scan time. Aggregations read these, not a live
  activities join, so history survives activity edits/deletes.
- `samo_years` / `samo_seasons` (db/0006) — admin-declared วาระสโม + seasons; "current"
  = the open row (`ended_at IS NULL`). See `js/samo.js` for the helpers.
- `user_tiers` — `full_name`, `total_km`, `final_tier`, `has_travel_visa`.
- `certificates` — multiple per activity (`label`, `background_url`, name placement,
  `font_family`). **Season-scoped (db/0006):** `season_id` ties a template to a season;
  `NULL` = seasonless default/fallback. Run `db/0001_certificates.sql` +
  `db/0002_certificates_font.sql` (+ `db/0006`).
- `profiles` — `full_name`, `email`, `total_km`. Source of truth for the name;
  leaderboards read from here. `db/0003_profiles_name_policy.sql` allows own-name edits.
- `seasons` — named, scoped (overall/department/subdepartment), dated windows for
  leaderboards/history. Run `db/0004_seasons.sql`. Standings are computed by filtering
  scans to the window (no snapshots), so a finished season is naturally frozen.

Image uploads: admin drag-drop posts to a Google Apps Script web app (`gas/Upload.gs`)
that saves to the SAMO Drive *as the SAMO account* (uses its 2TB). Set the endpoint in
`VITE_GAS_UPLOAD_URL`; without it, paste public links.

To apply a migration: open the Supabase SQL editor and run the file in `db/`.
DDL cannot be run from the app (anon key has no schema privileges).

## Conventions

- Central paths live in `routes.js` — don't hardcode `/html/...` in new code.
- Google Drive image links go through `fixGoogleDriveUrl()` (→ `lh3.googleusercontent.com`,
  which is CORS-correct — important for `<canvas>` export).
- User-generated content (profile photo, memories, photos) is **localStorage only**,
  keyed by Supabase `user.id`; there's an Export/Import backup. Do not silently move
  this to Supabase storage — it's a deliberate product decision (see STATE.md).
- Keep the existing style: ES module imports, `window.fnName = ...` for inline
  `onclick` handlers in admin, small focused functions.
- After any change, run `npm run build` — it's the closest thing to a test here.

## End-of-turn loop (MANDATORY)

Before sending the final response on **any task that modified files**, run this loop. Each step
is conditional — do it only if that category actually changed. This is a side-effect of meaningful
change, **not a tax on every commit** (internal-only refactors/typos can skip 1–5):

1. **`STATE.md`** — update if real state changed (what's working / pending, required config, latest
   migration, in-flight work, blockers). Don't append a session narrative — `git log` is the archive.
   Keep it tight (~150 lines); prune stale sections if it bloats.
2. **`MISTAKES.md`** — if a new bug class or non-obvious trap was discovered, append it
   (**symptom → cause → fix → where it lives now**). This is what saves cold-start agents from
   re-walking bugs we already paid for.
3. **`CLAUDE.md`** (this file) — if structure, conventions, the DB schema, or a workflow changed,
   update the relevant section.
4. **Persistent memory** (`~/.claude/projects/-Users-xeno-development-samodevmdkku69-passport/memory/`)
   — if a **durable** fact changed (user preference, architecture decision, external resource, a
   blocker resolved or discovered), update the matching memory file **and** the `MEMORY.md` index.
   Don't duplicate what the repo already records (code, git history, this file).
5. **Skills** — if a repeatable multi-step workflow appeared, capture it (global skill or a `skills/`
   note) so it isn't re-derived next time.
6. **Say what you updated** in the user-facing response (e.g. "Updated STATE.md + MISTAKES.md +
   memory."). If nothing needed updating, no need to mention it.

> Philosophy (from the sibling repo `refactorsamoweb/samomdkkuweb`): keep this file a **slim router**
> — most detail is read on demand (`STATE.md`, `MISTAKES.md`, the `db/` migrations, the persistent
> memory). The loop keeps those honest without bloating context.

## Authority model

- **Pre-authorized:** commit + push directly to `main` (Cloudflare auto-deploys); `npm run build`;
  read-only Supabase queries with the anon key; branch-and-push for previews.
- **Ask first:** destructive DB ops beyond the current feature's scope (mass row deletes, dropping
  tables), prod GAS redeploys, force-push, anything irreversible and outward-facing.
- **The user runs all DDL** in the Supabase SQL editor (the anon key can't). Hand over the exact
  `db/*.sql` to run + any Supabase/GAS config step, and make code **degrade gracefully** if a
  migration hasn't run yet.
- **Console tests hit production** — localhost and the deployed app share one Supabase project, so
  any insert/delete you run in the browser console writes to prod. Clean up test rows; never attach
  fake scans to real `profiles`.
