-- db/0009_scans_policies.sql
-- Same regression as db/0008, but for `scans`. db/0007 ran
--   alter table public.scans enable row level security;
-- and added only a DELETE policy. With RLS on and no INSERT/SELECT/UPDATE policy,
-- those ops are denied by default, so:
--   • scanning a QR fails: "new row violates row-level security policy for table scans"
--   • the customer Flight Log / Leaderboard read back EMPTY (select filtered to nothing)
--   • editing an activity can't re-sync current-season scan snapshots (update blocked)
--
-- This restores the full permissive policy set (RLS is intentionally permissive here;
-- see STATE.md). Safe + idempotent. Run in the Supabase SQL editor.

alter table public.scans enable row level security;

drop policy if exists "scans_read"   on public.scans;
drop policy if exists "scans_insert" on public.scans;
drop policy if exists "scans_update" on public.scans;
drop policy if exists "scans_delete" on public.scans;

create policy "scans_read"   on public.scans for select using (true);
create policy "scans_insert" on public.scans for insert with check (true);
create policy "scans_update" on public.scans for update using (true) with check (true);
create policy "scans_delete" on public.scans for delete using (true);
