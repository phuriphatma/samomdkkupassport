---
name: run-local
description: Run SAMO Passport locally with Vite and verify a change in the browser. Use when asked to start, serve, or test the app on localhost, or to reproduce a dashboard/admin/scan/login issue locally.
---

# Run SAMO Passport locally

## Prerequisites
- Node 22 (see `.nvmrc`). `npm install` once.
- A `.env` (copy `.env.example`) with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.

## Start the dev server
```bash
npm run dev   # http://localhost:5173
```
Routes: `/` (login), `/html/dashboard.html`, `/html/admin.html`, `/html/scan.html`.
Admin login is `admin` / `1234` (a localStorage flag — there is no real admin auth).

## Login won't work locally until Supabase allow-lists the dev URL
Google OAuth will bounce you to the **production** site (`…pages.dev/#`) unless
`http://localhost:5173/**` is in Supabase → Authentication → URL Configuration →
**Redirect URLs**. This is a dashboard setting, not a code change. (See MISTAKES.md.)

## Verify a change
- Always run `npm run build` after edits — it's the de-facto test (catches import/syntax errors).
- For UI changes, open the affected route and check the browser console for errors.
- Certificate generation and the passport page-flip are the parts most worth eyeballing
  in a real browser (canvas/CORS, per-page height).
