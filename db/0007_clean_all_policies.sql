-- db/0007_clean_all_policies.sql
-- Make the admin "🧹 Clean ALL data" button actually able to wipe everything.
--
-- The `scans` table predates the db/ migrations and was created with only
-- select/insert RLS policies (scans are normally append-only). Without a DELETE
-- policy, the clean-all delete silently affects 0 rows, so the customer Flight Log
-- (which reads straight from `scans`) keeps showing "old" activities forever.
--
-- This adds permissive DELETE policies (mirrors the existing admin model — RLS is
-- intentionally permissive here; see STATE.md "Admin auth"). Safe + idempotent.

-- ── scans ───────────────────────────────────────────────────────────────────
alter table public.scans enable row level security;
drop policy if exists "scans_delete" on public.scans;
create policy "scans_delete" on public.scans for delete using (true);

-- ── activities (re-affirm; single-delete already works, this is a safety net) ─
alter table public.activities enable row level security;
drop policy if exists "activities_delete" on public.activities;
create policy "activities_delete" on public.activities for delete using (true);
