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

## Pending / required config

- [ ] **Run `db/certificates.sql`** in the Supabase SQL editor to enable certificates.
- [ ] **Add `http://localhost:5173/**` to Supabase Redirect URLs** for local OAuth
      login (see MISTAKES.md). Production URL stays.
- [ ] Certificate backgrounds: upload to SAMO Google Drive (organized folders),
      make public, paste the link into the admin certificate form.

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
