-- 0011 — passport authorization hardening, PART 2 of 2: THE LOCKDOWN.
--
-- ***********************************************************************
-- DO NOT APPLY THIS UNTIL THE APP IS DEPLOYED AGAINST 0010's RPCs.
-- Applying it first breaks student scanning and the admin panel instantly:
-- scanning.js still INSERTs into scans directly, and the legacy admin/1234
-- panel writes as `anon` with no JWT, so passport.is_admin() is false for it.
-- Order: 0010  ->  app deploy  ->  0011.
-- ***********************************************************************
--
-- Proof before committing: samoweb tools/pass-hardening.mjs applies this file
-- inside a transaction it rolls back, impersonating anon / a student / a
-- full admin / a dept-scoped admin, and asserts each of them can do exactly
-- what they should and nothing more.
--
-- Rollback: every statement here replaces a policy that was `:: true`. To revert,
-- re-create the permissive form, e.g.
--   drop policy if exists scans_update on passport.scans;
--   create policy scans_update on passport.scans for update to public
--     using (true) with check (true);
-- The pre-change policy dump is in SECURITY-HARDENING-PLAN.md §1 / §6.
--
-- Postgres has no `create or replace policy`, so every block is
-- `drop policy if exists` + `create policy` to stay re-runnable (samoweb
-- mistakes.md: a partial replay otherwise aborts at 42710 before the grants).

-- ===========================================================================
-- 1. scans — reads stay public (the leaderboard is public), writes close
-- ===========================================================================
-- INSERT gets NO policy at all: passport.stamp_scan() is SECURITY DEFINER and so
-- is unaffected by RLS, and it is now the only way a scan can be created. Leaving
-- no INSERT policy is what makes "the client cannot forge a scan" true, rather
-- than merely discouraged.
drop policy if exists scans_insert on passport.scans;

-- A student may still remove their OWN scan (dashboard.js:344 offers this).
-- Note this does NOT decrement profiles.total_km — pre-existing behaviour, left
-- alone deliberately so this migration changes authorization only.
drop policy if exists scans_delete on passport.scans;
create policy scans_delete on passport.scans for delete to public
  using (passport.is_admin() or (auth.uid() is not null and user_id = auth.uid()));

-- Nobody but an admin edits a scan after the fact.
drop policy if exists scans_update on passport.scans;
create policy scans_update on passport.scans for update to public
  using (passport.is_admin()) with check (passport.is_admin());

-- ===========================================================================
-- 2. profiles — own row + admin; email stops being world-readable
-- ===========================================================================
-- profiles_read_all (`using (true)`) is what lets anon dump 593 students' names
-- and emails. It also cannot be narrowed by ADDING a policy: permissive policies
-- are OR'd, so a `using (true)` branch swallows every narrower one — it has to be
-- dropped (samoweb: "a per-recipient SELECT policy is DEAD under using(true)").
--
-- The two readers that depended on the open policy are both re-homed by 0010:
--   * the dashboard's own-profile read goes through user_tiers, which 0010 put on
--     security_invoker — it now returns the caller's own row, which is all it ever
--     asked for (`.eq('id', user.id)`).
--   * the student-facing global leaderboard's names come from
--     passport.leaderboard_names() — a projection of id + full_name for
--     participants only, signed-in callers only, no email.
--   * the admin ranking comes from passport.admin_leaderboard(), scope-filtered.
-- If any of those three is not deployed in the app yet, DO NOT apply this file.
-- Drop BOTH names: the old one being replaced, and the new one so this file stays
-- re-runnable. Postgres has no `create or replace policy`, and a rename means the
-- usual same-name drop does not cover the replay — a second apply 42710s, which is
-- exactly how tools/pass-hardening.mjs (it applies this file inside a rolled-back
-- transaction) started failing once 0011 had been applied for real.
drop policy if exists profiles_read_all on passport.profiles;
drop policy if exists profiles_read_self_or_admin on passport.profiles;
create policy profiles_read_self_or_admin on passport.profiles for select to public
  using ((auth.uid() is not null and id = auth.uid()) or passport.is_admin());

-- Own-row UPDATE stays, still column-guarded by 0010's profiles_guard.
drop policy if exists profiles_update_own on passport.profiles;
create policy profiles_update_own on passport.profiles for update to public
  using (auth.uid() is not null and auth.uid() = id)
  with check (auth.uid() is not null and auth.uid() = id);
drop policy if exists profiles_update_admin on passport.profiles;
create policy profiles_update_admin on passport.profiles for update to public
  using (passport.is_admin()) with check (passport.is_admin());

-- INSERT own row only (unchanged in spirit; restated for the null-uid guard).
drop policy if exists profiles_insert_own on passport.profiles;
create policy profiles_insert_own on passport.profiles for insert to authenticated
  with check (auth.uid() is not null and auth.uid() = id);

-- ===========================================================================
-- 3. Catalog / seasons / certificates / season_results — admin-only writes
-- ===========================================================================
-- Reads stay public: the scan page must resolve an activity before the user is
-- signed in, and badges/certificate art are public assets.
--
-- activities.static_token is the exception worth naming: it is readable by anon
-- today because scanning.js compares it in the browser. Once the app uses
-- stamp_scan() the client no longer needs it, but a column cannot be hidden by
-- RLS — that needs a view or a projection RPC, and is left as follow-up rather
-- than smuggled into a lockdown migration. Until then the token is discoverable
-- by anyone who reads /rest/v1/activities, so treat it as "not a secret from a
-- determined reader": it stops casual forgery, and stamp_scan still pins the
-- scan to auth.uid() and the server's own points, which is where the real
-- protection now lives.
do $$
declare t text;
begin
  foreach t in array array['activities','samo_years','samo_seasons','seasons',
                           'certificates','season_results']
  loop
    execute format('drop policy if exists %I_insert on passport.%I', t, t);
    execute format('drop policy if exists %I_update on passport.%I', t, t);
    execute format('drop policy if exists %I_delete on passport.%I', t, t);
    execute format(
      'create policy %I_insert on passport.%I for insert to public
         with check (passport.is_admin())', t, t);
    execute format(
      'create policy %I_update on passport.%I for update to public
         using (passport.is_admin()) with check (passport.is_admin())', t, t);
    execute format(
      'create policy %I_delete on passport.%I for delete to public
         using (passport.is_admin())', t, t);
  end loop;
end $$;

-- season_results also carries name + email per student. Its read policy was
-- `using (true)`; narrow it the same way profiles was. The dashboard shows a
-- student their own past-season result; admins see everything.
drop policy if exists season_results_read on passport.season_results;
create policy season_results_read on passport.season_results for select to public
  using ((auth.uid() is not null and user_id = auth.uid()) or passport.is_admin());

-- ===========================================================================
-- 4. account_migrations — read stays public, writes close
-- ===========================================================================
-- js/auth.js getPassportAccess reads this BEFORE the user is fully resolved, and
-- for a 'moved' account it must be readable to show where the data went, so the
-- read stays open (it holds email pairs only, for 5 rows). It had no write
-- policies and RLS is on, so writes were already closed — stated explicitly so a
-- future `:: true` cannot creep back in unnoticed.
drop policy if exists account_migrations_insert on passport.account_migrations;
create policy account_migrations_insert on passport.account_migrations
  for insert to public with check (passport.is_admin());
drop policy if exists account_migrations_update on passport.account_migrations;
create policy account_migrations_update on passport.account_migrations
  for update to public using (passport.is_admin()) with check (passport.is_admin());
drop policy if exists account_migrations_delete on passport.account_migrations;
create policy account_migrations_delete on passport.account_migrations
  for delete to public using (passport.is_admin());

-- ===========================================================================
-- 5. What this migration deliberately does NOT do
-- ===========================================================================
-- * continents / departments / sub_departments: RLS is already ON with NO
--   policies, i.e. anon reads 0 rows and writes nothing. Left exactly as-is —
--   adding a read policy here would OPEN something that is currently closed.
--   (samoweb reads these through public.list_passport_departments(), a definer.)
-- * TRUNCATE remains granted to anon on every table (the Supabase default, same
--   as the public schema) and TRUNCATE is NOT gated by RLS. It is unreachable
--   over PostgREST, so it is not a live vector, but it is the reason a direct
--   Postgres connection must never be handed the anon role.
-- * total_km is not reconciled against sum(scans.points_awarded). They can drift
--   (a self-delete of a scan does not decrement the cache). Pre-existing; fixing
--   it is a data question, not an authorization one.
