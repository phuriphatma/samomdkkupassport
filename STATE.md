# STATE.md — project state

Snapshot of what's built, what's pending, and required config. Update as things land.
Last updated: 2026-06-06.

## Working

- **Auth** — Google OAuth via Supabase; session handled in `auth.js` / `index.js`.
- **Student dashboard** — passport "ebook": cover, personal info, stamp pages
  (earned + locked), future page, back cover; page navigation with dots.
- **Stamps & flight log** — all activities shown; earned ones open a memory modal.
  Flight log shows all scans, newest first (ordered by `scanned_at`).
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
