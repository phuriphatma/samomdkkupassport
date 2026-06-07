# STATE.md — project state

Snapshot of what's built, what's pending, and required config. Update as things land.
Last updated: 2026-06-06.

## Working

- **Auth** — Google OAuth via Supabase; session handled in `auth.js` / `index.js`.
- **Student dashboard** — passport "ebook": cover, personal info, stamp pages
  (earned + locked), future page, back cover; page navigation with dots.
- **Stamps & flight log** — only **earned** stamps are shown (scanned activities);
  tapping one opens its memory modal. Stamp search flips to the stamp's page and
  highlights it (no popup). The info page is fixed; only the flight log scrolls.
- **SamoYear/Season model (db/0006)** — admin declares the current วาระสโม + Season
  (`samo_years`/`samo_seasons`, "current" = `ended_at IS NULL`). Scans are **immutable
  snapshots** stamped with year/season + activity name/dept/sub-dept/points. Editing an
  activity touches only **current-season** scans; deleting an activity keeps its scans
  (FKs dropped) but DELETES its certificates. Admin: วาระสโม/Season control + period
  leaderboard (year→season + dept/sub-dept, CSV). Customer: swipeable **Flight Log** +
  **Leaderboard** pages (topbar 📜 / 🏆). The old date-window seasons + archive UI are retired.
- **Certificates (NOT season-scoped, 2026-06-07)** — a cert belongs to its activity and
  always reflects its current settings; the student sees **every** cert template on an
  activity (no `season_id` matching). Stamps with a cert show a 🎓 ribbon. Deleting an
  activity deletes its certs ("activity gone ⇒ cert gone"). Scans/flight-log stay immutable.
- **Admin activity filter by วาระสโม/Season (2026-06-07)** — dropdowns filter the activity
  list by the time window each activity was **created** in (`created_at` vs the year/season
  `started_at..ended_at`).
- **Memory modal** — per-activity note + photos, stored in `localStorage` (per device).
- **Profile photo** — `localStorage`, per device.
- **Data backup** — Export/Import all on-device user content as a JSON file.
- **Admin** — create/edit/delete activities; department + sub-department filters;
  **search by name**; static-QR generation + download.
- **Scan flow** — static token validated in `scanning.js`; records a scan.
- **Certificates** — admin manages templates per activity (label + background +
  name placement) with live preview; students generate + download a PNG with their
  name drawn on the background. **Needs DB migration (below).**

## Recently added (2026-06)

- User: change name (`profiles.full_name`), search stamps, leaderboard, history.
- Admin: leaderboard (total + per dept/sub-dept, + per season), season management,
  drag-drop image upload to the SAMO Drive (via GAS), certificate font + drag-to-place.
- Seasons/history: named dated windows per scope; user history shows points per
  season + yearly วาระสโม totals (computed from scans — no snapshots).

## Pending / required config

Run these in the Supabase SQL editor (safe, idempotent):
- [ ] `db/0001_certificates.sql` — certificates table (if not already run).
- [ ] `db/0002_certificates_font.sql` — adds `font_family` (cert font picker).
- [ ] `db/0003_profiles_name_policy.sql` — lets a user update their own name.
- [ ] `db/0004_seasons.sql` — seasons + history.
- [ ] `db/0005_season_results.sql` — archived season standings (frozen snapshots).
- [x] **`db/0006_samo_years.sql` — RUN (2026-06-07).** SamoYear/Season model:
      `samo_years` + `samo_seasons`, scan snapshot columns, `certificates.season_id`,
      and dropped activity FKs on scans/certificates (history survives deletion).
      Verified live: control page, scan stamping, leaderboard period filter, season-scoped
      certs. Admin season-control has a guarded **🧹 Clean ALL data** button (danger zone).
- [x] **`db/0007_clean_all_policies.sql` — RUN (2026-06-07).** Adds DELETE RLS policies on
      `scans` + `activities` so "🧹 Clean ALL data" can wipe scans (also deletes the
      badge/cert Drive images). ⚠️ It enabled RLS on `activities` with only a DELETE
      policy → broke create/list (see 0008).
- [ ] **`db/0008_activities_policies.sql` — RUN THIS.** Restores the full permissive
      policy set on `activities` (select/insert/update/delete). Fixes "new row violates
      row-level security policy for table activities" on create, regression from 0007.

Other:
- [ ] **Local OAuth:** add `http://localhost:5173/**` to Supabase Redirect URLs.
- [ ] **Drive uploads (optional):** deploy `gas/Upload.gs` as a web app, set
      `VITE_GAS_UPLOAD_URL` in `.env` + Cloudflare. Until then, paste image links.
- [ ] Cert backgrounds: upload to SAMO Drive (or drag-drop once GAS is set), public link.

## Known limitations / decisions

- User content (profile photo, memories, photos) is **localStorage only** by choice —
  SAMO storage is reserved for important data. Backup/restore covers cross-device.
- Admin auth is a hardcoded `admin/1234` flag; RLS is permissive. Not production-grade.
- Dead DB columns remain (`continent_id`, `is_marketing_bonus`, `active_token`,
  `token_expires_at`) — safe to drop later.

## Ideas / roadmap (not started)

- Real admin authentication + tightened RLS.
- Optional certificate "organizer (ผู้จัดทำ)" gating — currently any earner of an
  activity can generate any of its certificate templates.
- Linting/formatting (ESLint + Prettier) if the team wants enforced style.
