# STATE.md — project state

Snapshot of what's built, what's pending, and required config. Update as things land.
Last updated: 2026-07-25. **Tagged release: v1.0.0.**
**Deployed to the KKU VM (`/var/www/passport`): `ffec467`** — admin ฝ่าย scope + the
temporary `admin`/`1234` fallback. Deploy = push `main`, then on the VM
`cd ~/samo-projects/samomdkkupassport && git pull && npm ci && PASSPORT_BASE=/passport/ npm run build`
→ `rsync -a --delete dist/ /var/www/passport/` (samoweb `server/deploy.sh` does both apps).

## Working

- **Auth** — Google OAuth via Supabase; session handled in `auth.js` / `index.js`.
- **Admin identity + department scope (2026-07-25)** — the `admin`/`1234` +
  `localStorage.admin_logged_in` gate is **gone**. `html/admin.html` now signs in with
  Google and asks `public.passport_admin_context()` (samoweb migration 0087) who the
  caller is; `js/admin-scope.js` turns that into `{allDepartments, departments[],
  subDepartments[]}`. Grants are issued in samoweb → **ทีม SAMO → จัดการสิทธิ์ → SAMO
  Passport → ขอบเขต** (ทุกฝ่าย / ฝ่าย X / แผนกย่อย Y); `getAdminScope()` calls
  `sync_my_team_permissions()` first so a fresh grant self-heals. A scoped admin sees only
  their ฝ่าย's activities, certificates, QR codes and leaderboard, their dept pickers are
  pruned to what they own, and วาระสโม/Season/`cleanAllData` are all-departments-only.
  **Fails closed** — no session, rpc error, or no grant all land on the gate.
  ⚠️ This is the VISIBLE boundary only; `passport` schema RLS is still open for anon
  (db/0056), so it stops accidents, not attackers — see SECURITY-HARDENING-PLAN.md.
- **⏳ TEMPORARY: `admin`/`1234` still works** — kept as an escape hatch so nobody is locked
  out while ฝ่าย grants are handed out. It grants **ทุกฝ่าย** (a client-side string compare
  has no uid to scope against), so **while it is on, department scoping is opt-in, not
  enforced**. A real ทีม SAMO session always takes precedence over a stored legacy one, and
  the panel shows a red banner in legacy mode. **To retire it:** flip
  `LEGACY_PASSWORD_LOGIN = false` in `js/admin-scope.js`, redeploy, confirm every admin can
  sign in with Google, then delete the marked block there, `handleLegacyLogin` in
  `admin-page.js`, and the `#admin-legacy-box` markup.
- **Student dashboard** — "MDKKU Passport" redesign (Nunito, 5 themes via
  `[data-theme]` + `wp-theme` localStorage). Brand/flavour is MDKKU Air — flight code
  `MD-`, passport no. `MP-`, IATA `MDK`; the boarding-pass/leaderboard **seat** is a
  stable per-user code whose cabin (First/Business/Economy) follows the Status tier
  (`seatCode`/`cabinLayout` in `dashboard.js`). **Desktop:** fixed topbar (brand +
  breadcrumb) + left sidebar (Menu nav + pinned user card) + wide content; the
  Passport tab shows the passport book and boarding pass **side-by-side** (`.pp-cols`).
  **Mobile:** static header + floating bottom nav. Four tabs (`switchTab`): My Passport,
  Stamps, Flight Log, Leaderboard — each with a `.page-head` (title + subtitle). `switchTab`
  is defined in the **parse-time inline `<script>`** (not the deferred module) so the nav
  works before `dashboard.js` loads; the module exposes only the data-render dispatch
  (`window.__dashRenderTab`). See MISTAKES.md.
- **Stamps tab** — a flat `.stamps-grid` of cards (earned = badge image; locked = greyed) with
  a stats strip + search + department filter chips; tapping a stamp opens its memory modal.
- **Flight Log tab** — a **2×2 grid** (`css/passport/_responsive.css`): teal stat banner +
  flight list on the left, a **Filter card** (วาระสโม / Season / Department dropdowns) and a
  **Totals card** (วาระสโม · Quartile · Total km) on the right. Banner ↔ filter card are
  equal height (row-1 `align-self:stretch`); the side `<aside id="flightlog-side">` uses
  `display:contents` so its two cards are real grid cells. `renderFlightLogPage()` fills
  `#flightlog-list` + `#flightlog-side` separately. Each flight row shows the activity's stamp
  **icon**, name, and a meta line (**date · ฝ่ายอุปนายก · sub-dept** from the scan snapshot).
  The banner's progress bar + Stamps mini-stat are **earned/total** stamps (e.g. 14/24).
- **Container radius** is a single knob: `--rl` (14px) in `css/main/_base.css` — all dashboard
  cards/menus point at it. Boarding-pass **Group** mirrors the Status tier (first
  5 letters, uppercase, e.g. `EXPLO`); names render uppercase on the Passport tab.
- **SamoYear/Season model (db/0006)** — admin declares the current วาระสโม + Season
  (`samo_years`/`samo_seasons`, "current" = `ended_at IS NULL`). Scans are **immutable
  snapshots** stamped with year/season + activity name/dept/sub-dept/points. Editing an
  activity touches only **current-season** scans; deleting an activity keeps its scans
  (FKs dropped) but DELETES its certificates. Admin: วาระสโม/Season control + period
  leaderboard (year→season + dept/sub-dept, CSV). Customer: **Flight Log** +
  **Leaderboard** tabs. The old date-window seasons + archive UI are retired.
- **Leaderboard tab redesign (2026-06-09)** — "Top Passengers" top-10 list (main) +
  side column: Flight-Log-style **filter card** (วาระสโม / quartile / dept dropdowns,
  global scope), **Your Stats** (rank #N of M, total km, stamps, tier), and a
  **Top 3 Podium** bar chart. Per-row Status (and Your Stats) is derived from the
  **selected-period km** (the row's pts); `ensureLbPageData()` no longer loads `user_tiers`.
  Two-column grid ≥1024px, stacks on mobile (`_leaderboard.css` + `_responsive.css`).
  Replaced the old season/year `seg-toggle` + podium-row.
- **Status ladder (km-derived, 2026-06-10)** — the Status/tier is computed from km, not
  `user_tiers.final_tier` (now unused for display). The **passport + sidebar** use
  **lifetime km**; the **leaderboard** rows/Your Stats use the **selected-period km**.
  One named tier per 2,000 km: **Explorer** 0–1999 ·
  **Adventurer** 2000–3999 · **Pathfinder** 4000–5999 · **Voyager** 6000–7999 ·
  **Pioneer** 8000+. `STATUS_TIERS` + `statusTierName()` in `js/dashboard.js`; the goal
  (`KM_STATUS_GOAL`, drives the progress bar / "km to next") is derived from the list
  `(STATUS_TIERS.length-1)×2000` so names and goal can't drift.
- **Certificates (NOT season-scoped, 2026-06-07)** — a cert belongs to its activity and
  always reflects its current settings; the student sees **every** cert template on an
  activity (no `season_id` matching). Stamps with a cert show a 🎓 ribbon. Deleting an
  activity deletes its certs ("activity gone ⇒ cert gone"). Scans/flight-log stay immutable.
- **Admin activity filter by วาระสโม/Season (2026-06-07)** — dropdowns filter the activity
  list by the time window each activity was **created** in (`created_at` vs the year/season
  `started_at..ended_at`).
- **Admin themed to match the dashboard (2026-06-09)** — admin.html now applies the user's
  saved `wp-theme` (`data-theme` from localStorage) and `css/admin/_theme.css` remaps the
  legacy sky/orange aliases → the theme palette + overrides bg/buttons/headings/inputs to the
  themed, Nunito look. Edit/delete keep semantic colors (`--accent-danger` untouched).
- **Memory modal** — per-activity note + photos, stored in `localStorage` (per device).
  Also offers **"Remove from passport"** for an earned activity: a student who scanned the
  wrong QR can delete their **own** scan (`removeOwnScan`, scoped by `id`+`user_id`, then a
  reload). See MISTAKES.md ("delete your own scan").
- **Profile photo** — `localStorage`, per device.
- **Data backup** — Export/Import all on-device user content as a JSON file.
- **Admin** — create/edit/delete activities; department + sub-department filters;
  **search by name**; static-QR generation + download.
- **Scan flow** — static token validated in `scanning.js`; records a scan.
- **Certificates** — admin manages templates per activity (label + background +
  name placement) with live preview; students generate + download a PNG with their
  name drawn on the background. The chosen font is loaded **on demand** at render time
  (`certificate.js` `ensureCertFonts`) so the name never falls back to a system font on
  devices that lack it — fixes the device-dependent "misaligned name" reports. The loader
  now **waits for the @font-face to actually register** (no blind 3s timeout that drew a
  fallback when a slow link — Thai fonts especially — lost the race). **Needs DB migration
  (below).**

## Recently added (2026-06)

- Build/structure: dashboard is now `html/dashboard.html` (skeleton) + `html/partials/*`,
  stitched by the in-repo `vite-plugin-html-includes.js` (`<include src="…">`). CSS
  `css/{main,passport,admin}.css` became `@import` indexes over `css/<name>/_*.css` partials.
  Verified byte-identical bundles (brace counts + unchanged dist hashes). Edit partials, not the
  index/bundle — see CLAUDE.md + MISTAKES.md. (admin.html itself not yet split into partials.)
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
- [x] **`db/0007_clean_all_policies.sql` — RUN (2026-06-07, old delete-only version).**
      Enabled RLS on `scans` + `activities`; the original file added only DELETE policies,
      which (with RLS now on) silently broke select/insert/update → activity-create and QR
      scanning failed. **The file has since been rewritten to add all four ops** — re-running
      it is equivalent to 0008+0009. Clean-all also deletes the badge/cert Drive images.
- [x] **`db/0008_activities_policies.sql` — RUN (2026-06-07).** Full permissive policy set
      on `activities`. Fixed "new row violates RLS policy for table activities" on create.
- [ ] **`db/0009_scans_policies.sql` — RUN THIS.** Full permissive policy set on `scans`
      (select/insert/update/delete). Fixes "new row violates RLS policy for table scans" on
      QR scan, plus empty Flight Log/Leaderboard reads. Same regression as 0008, for scans.

Other:
- [ ] **Local OAuth:** add `http://localhost:5173/**` to Supabase Redirect URLs.
- [ ] **Drive uploads (optional):** deploy `gas/Upload.gs` as a web app, set
      `VITE_GAS_UPLOAD_URL` in `.env` + Cloudflare. Until then, paste image links.
- [ ] Cert backgrounds: upload to SAMO Drive (or drag-drop once GAS is set), public link.

## Known limitations / decisions

- User content (profile photo, memories, photos) is **localStorage only** by choice —
  SAMO storage is reserved for important data. Backup/restore covers cross-device.
- The `admin`/`1234` fallback is still enabled (see Working) — until it is retired, the ฝ่าย
  scope is a convenience, not a boundary, for anyone who knows the password.
- Admin **identity** is now real (ทีม SAMO tree, see Working), but **enforcement is not**:
  the `passport` schema's RLS is still `using (true)` for anon, so the department scope is
  a UI boundary a determined admin can step around with DevTools. Closing it is
  SECURITY-HARDENING-PLAN.md — its policies must read `passport_admin_context()`, not
  invent a second admin table.
- Dead DB columns remain (`continent_id`, `is_marketing_bonus`, `active_token`,
  `token_expires_at`) — safe to drop later.

## Ideas / roadmap (not started)

- Tightened `passport`-schema RLS keyed off `passport_admin_context()` (admin *identity* landed
  2026-07-25; enforcement has not).
- Optional certificate "organizer (ผู้จัดทำ)" gating — currently any earner of an
  activity can generate any of its certificate templates.
- Linting/formatting (ESLint + Prettier) if the team wants enforced style.
