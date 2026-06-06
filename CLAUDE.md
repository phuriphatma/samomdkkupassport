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
- `scans` — `user_id`, `activity_id`, `scanned_at`, `points_awarded`.
- `user_tiers` — `full_name`, `total_km`, `final_tier`, `has_travel_visa`.
- `certificates` — multiple per activity (`label`, `background_url`, name placement).
  **Requires `db/certificates.sql` to be run.** See STATE.md.

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
