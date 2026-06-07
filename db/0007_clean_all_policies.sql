-- db/0007_clean_all_policies.sql
-- Make the admin "🧹 Clean ALL data" button able to wipe everything, and ensure
-- `scans`/`activities` have the FULL permissive policy set under RLS.
--
-- ⚠️ The original version of this file only added DELETE policies. But it also runs
-- `enable row level security` on both tables — and if a table had NO other policies,
-- enabling RLS with only DELETE silently denies select/insert/update (RLS denies by
-- default). That broke activity-create + QR scanning. This version (and db/0008,
-- db/0009) restores all four ops. RLS is intentionally permissive here; see STATE.md.
-- Safe + idempotent.

-- ── scans ───────────────────────────────────────────────────────────────────
alter table public.scans enable row level security;
drop policy if exists "scans_read"   on public.scans;
drop policy if exists "scans_insert" on public.scans;
drop policy if exists "scans_update" on public.scans;
drop policy if exists "scans_delete" on public.scans;
create policy "scans_read"   on public.scans for select using (true);
create policy "scans_insert" on public.scans for insert with check (true);
create policy "scans_update" on public.scans for update using (true) with check (true);
create policy "scans_delete" on public.scans for delete using (true);

-- ── activities ──────────────────────────────────────────────────────────────
alter table public.activities enable row level security;
drop policy if exists "activities_read"   on public.activities;
drop policy if exists "activities_insert" on public.activities;
drop policy if exists "activities_update" on public.activities;
drop policy if exists "activities_delete" on public.activities;
create policy "activities_read"   on public.activities for select using (true);
create policy "activities_insert" on public.activities for insert with check (true);
create policy "activities_update" on public.activities for update using (true) with check (true);
create policy "activities_delete" on public.activities for delete using (true);
