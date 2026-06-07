-- db/0008_activities_policies.sql
-- FIX for a regression introduced by db/0007: that migration ran
--   alter table public.activities enable row level security;
-- but only added a DELETE policy. If `activities` had no other policies (it was
-- previously open), enabling RLS then BLOCKS insert/select/update — so creating an
-- activity fails with "new row violates row-level security policy for table
-- activities" and the list can come back empty.
--
-- This restores the full permissive policy set (mirrors the admin model used across
-- db/0001/0004/0006 — RLS is intentionally permissive here; see STATE.md). Safe +
-- idempotent. Run in the Supabase SQL editor.

alter table public.activities enable row level security;

drop policy if exists "activities_read"   on public.activities;
drop policy if exists "activities_insert" on public.activities;
drop policy if exists "activities_update" on public.activities;
drop policy if exists "activities_delete" on public.activities;

create policy "activities_read"   on public.activities for select using (true);
create policy "activities_insert" on public.activities for insert with check (true);
create policy "activities_update" on public.activities for update using (true) with check (true);
create policy "activities_delete" on public.activities for delete using (true);
