-- 0010 — passport authorization hardening, PART 1 of 2: ADDITIVE ONLY.
--
-- Applying this file changes NO existing behaviour. It adds the server-side
-- authorization primitives that 0011 then switches the RLS over to. Split in two
-- deliberately: tightening RLS before the app is deployed against these RPCs
-- would break student scanning and the admin panel instantly.
--
--   0010 (this file) — helpers + stamp RPC + leaderboard RPC + profiles guard
--   app deploy       — scanning.js and admin-page.js start using them
--   0011             — the actual lockdown (drops the `:: true` write policies)
--
-- Apply with samoweb's tools/apply-migration.mjs (Management API, superuser).
-- Proof: samoweb tools/pass-hardening.mjs — it applies 0011 INSIDE a rolled-back
-- transaction, so the lockdown is proven before it is ever committed.
--
-- Context: every passport write policy is `:: true` for the public role today and
-- the bundled anon key reaches this schema, so with nothing but the key from the
-- JS bundle an anonymous visitor can award themselves arbitrary km, edit or wipe
-- anyone's scans, flip the current วาระ/season, and dump every student's name +
-- email. See SECURITY-HARDENING-PLAN.md §1.

-- ===========================================================================
-- 0. Read this before writing any `grant` below
-- ===========================================================================
-- This schema carries ALTER DEFAULT PRIVILEGES (granted by postgres):
--     functions -> anon=X, authenticated=X
--     tables    -> anon=arwdDxtm, authenticated=arwdDxtm
--     sequences -> anon=rwU, authenticated=rwU
-- Two consequences that bit during this migration:
--   1. Every function created here is EXECUTABLE BY anon the instant it exists,
--      and `revoke all ... from public` does NOT undo that — PUBLIC and anon are
--      different grantees, so the explicit `anon=X` survives the revoke. Any
--      function that must not be anon-callable needs `revoke ... from anon` BY
--      NAME. (Verify with `select proacl from pg_proc`, never by assuming.)
--   2. Every future TABLE in this schema is fully anon-writable unless its RLS
--      says otherwise, so RLS is not defence-in-depth here — it is the only
--      defence. A new passport table with RLS off, or on with a `:: true`
--      policy, is world-writable on creation.
-- The two policy helpers below KEEP their anon grant on purpose: RLS policy
-- expressions are evaluated with the querying role's privileges, so if anon
-- could not execute passport.is_admin() every policy calling it would fail with
-- "permission denied for function" instead of returning false.

-- ===========================================================================
-- 1. Admin identity — the ทีม SAMO org tree is the ONLY source of truth
-- ===========================================================================
-- There is deliberately NO passport.admins table. samoweb migration 0087 already
-- resolves passport admin-ness from the org tree into
-- public.passport_admin_context(): is_admin = the blanket `passport` permission
-- or role='dev' (=> all_departments true) OR any users.managed_passport_scopes
-- entry ('d:<id>' / 's:<id>'). A second admin table would be a competing grant
-- channel that the ทีม SAMO permission UI cannot see — the "two representations
-- of one grant" bug class in samoweb .claude/rules/mistakes.md.
--
-- passport_admin_context() already returns is_admin=false for a null auth.uid(),
-- so an anonymous caller is refused before any scope is considered.

create or replace function passport.is_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((public.passport_admin_context() -> 'is_admin')::boolean, false);
$$;
revoke all on function passport.is_admin() from public;
grant execute on function passport.is_admin() to anon, authenticated;

-- Scope-aware variant for per-ฝ่าย reads. all_departments short-circuits.
-- A department-scoped admin also covers their sub-departments, which is why the
-- sub_department branch resolves through passport.sub_departments.
create or replace function passport.admin_covers_dept(p_dept_id int, p_sub_dept_id int default null)
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_ctx jsonb := public.passport_admin_context();
begin
  if not coalesce((v_ctx -> 'is_admin')::boolean, false) then return false; end if;
  if coalesce((v_ctx -> 'all_departments')::boolean, false) then return true; end if;

  if p_dept_id is not null
     and coalesce((v_ctx -> 'departments') @> to_jsonb(p_dept_id), false) then
    return true;
  end if;

  if p_sub_dept_id is not null then
    if coalesce((v_ctx -> 'sub_departments') @> to_jsonb(p_sub_dept_id), false) then
      return true;
    end if;
    -- a dept-scoped admin covers that dept's sub-departments
    if exists (
      select 1 from passport.sub_departments sd
       where sd.id = p_sub_dept_id
         and coalesce((v_ctx -> 'departments') @> to_jsonb(sd.department_id), false)
    ) then
      return true;
    end if;
  end if;

  return false;
end$$;
revoke all on function passport.admin_covers_dept(int, int) from public;
grant execute on function passport.admin_covers_dept(int, int) to anon, authenticated;

-- ===========================================================================
-- 2. stamp_scan — the ONLY way a scan may be created once 0011 lands
-- ===========================================================================
-- Moves three decisions the client currently makes onto the server:
--   * the QR token check (today `isStaticMatch` in scanning.js — client-side only,
--     so self-stamping without attending is a one-line DevTools edit);
--   * points_awarded (today sent by the client, and handle_new_scan trusts it —
--     so any km could be awarded); now read from activities.base_points_km;
--   * user_id (today sent by the client) — now always auth.uid().
--
-- It ALSO enforces the kkumail-only rule server-side. That gate lives in
-- js/auth.js getPassportAccess today and is therefore advisory: a signed-in
-- non-kkumail (or migrated-away) account can call the RPC directly. NOTE this is
-- a second implementation of that rule — if ALLOWED_DOMAINS / DEV_ALLOWLIST /
-- the account_migrations semantics change in js/auth.js, change it here too.
-- (samoweb mistakes.md: "two implementations of one rule drift silently".) The
-- server is the boundary; the client copy stays only for the friendlier UI.

create or replace function passport.stamp_scan(p_activity_id uuid, p_token text)
returns passport.scans
language plpgsql security definer set search_path = passport as $$
declare
  v_uid    uuid := auth.uid();
  v_email  text;
  v_moved  text;
  v_act    passport.activities;
  v_year   uuid;
  v_season uuid;
  v_row    passport.scans;
begin
  -- fail CLOSED on every missing input (samoweb mistakes.md: `null in (...)`
  -- makes a raise-guard fail OPEN, so each check is explicit)
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_activity_id is null or p_token is null or btrim(p_token) = '' then
    raise exception 'INVALID_TOKEN';
  end if;

  select lower(btrim(email)) into v_email from auth.users where id = v_uid;
  if v_email is null or v_email = '' then raise exception 'AUTH_REQUIRED'; end if;

  -- kkumail-only, mirroring js/auth.js getPassportAccess
  if not (v_email like '%@kkumail.com' or v_email = 'pmphuriphat@gmail.com') then
    raise exception 'NOT_KKUMAIL';
  end if;

  -- an account whose data was migrated AWAY may not stamp
  select to_email into v_moved
    from passport.account_migrations where lower(from_email) = v_email limit 1;
  if v_moved is not null then raise exception 'ACCOUNT_MOVED:%', v_moved; end if;

  select * into v_act from passport.activities where id = p_activity_id;
  if not found then raise exception 'ACTIVITY_NOT_FOUND'; end if;

  -- constant-time-ish compare is unnecessary here (the token is in the QR the
  -- user already holds) but the comparison MUST be `=`, never LIKE — samoweb
  -- 0101: an ILIKE lookup turns the secret into a pattern the caller controls.
  if v_act.static_token is null or v_act.static_token <> p_token then
    raise exception 'INVALID_TOKEN';
  end if;

  -- current วาระ / season (ended_at is null = current)
  select id into v_year   from passport.samo_years
    where ended_at is null order by started_at desc limit 1;
  select id into v_season from passport.samo_seasons
    where ended_at is null order by started_at desc limit 1;

  -- on_new_scan updates profiles by user_id; with no row its UPDATE hits 0 rows
  -- and the km is silently lost, so guarantee the row first.
  insert into passport.profiles (id, email, total_km)
       values (v_uid, v_email, 0)
    on conflict (id) do nothing;

  insert into passport.scans
    (user_id, activity_id, points_awarded, activity_name,
     department_id, sub_department_id, samo_year_id, season_id)
  values
    (v_uid, p_activity_id, v_act.base_points_km, v_act.name,
     v_act.department_id, v_act.sub_department_id, v_year, v_season)
  returning * into v_row;   -- on_new_scan doubles marketing-bonus km + adds total_km

  return v_row;
exception
  when unique_violation then raise exception 'ALREADY_STAMPED';
end$$;
revoke all on function passport.stamp_scan(uuid, text) from public;
-- explicit: the schema's default ACL already granted anon EXECUTE (see §0)
revoke all on function passport.stamp_scan(uuid, text) from anon;
grant execute on function passport.stamp_scan(uuid, text) to authenticated;

-- ===========================================================================
-- 3. profiles column guard — total_km is server-managed
-- ===========================================================================
-- profiles_update_own is `using (auth.uid() = id)`, i.e. row-level with no column
-- policy, so one PATCH sets your own total_km to anything. This is the same class
-- as samoweb users (0028), vs_tickets (0096) and shop_orders (0100): a per-row
-- owner UPDATE policy is a row filter, never a column policy.
--
-- The exemption matters more than the guard. on_new_scan is SECURITY DEFINER, but
-- SECURITY DEFINER does NOT clear auth.uid() (it reads the request.jwt.claims GUC,
-- which is session-scoped), so during a legitimate stamp this trigger fires with
-- the student's own uid and a changed total_km — indistinguishable from the attack
-- by identity alone. It is distinguishable by DEPTH: on_new_scan runs at depth 1,
-- so the profiles UPDATE it issues fires this trigger at depth 2, while a client
-- PATCH arrives at depth 1. A client cannot manufacture depth > 1.
-- (samoweb 0041 is the cautionary twin: a guard that could not tell the server's
-- own sync trigger from a client write bricked every new signup.)

create or replace function passport.profiles_guard()
returns trigger
language plpgsql security definer set search_path = passport as $$
begin
  if pg_trigger_depth() > 1 then return new; end if;   -- server path (on_new_scan)
  if passport.is_admin() then return new; end if;      -- admin tools
  if new.total_km is distinct from old.total_km then
    raise exception 'total_km is server-managed';
  end if;
  if new.tier_override is distinct from old.tier_override then
    raise exception 'tier_override is admin-managed';
  end if;
  if new.id is distinct from old.id then
    raise exception 'id is immutable';
  end if;
  return new;
end$$;

drop trigger if exists profiles_guard on passport.profiles;
create trigger profiles_guard before update on passport.profiles
  for each row execute function passport.profiles_guard();

-- ===========================================================================
-- 4. admin_leaderboard — replaces "fetch every profile, filter in the browser"
-- ===========================================================================
-- The admin leaderboard is the only reader of profiles.email (admin-page.js
-- ensureLbScans). It currently selects EVERY profile (id, full_name, email) plus
-- every scan and does the department scoping client-side, so a ฝ่าย-scoped admin
-- holds the entire student roster in their tab — and once 0011 closes
-- profiles_read_all that read stops working anyway.
--
-- Decision (2026-07-30): KEEP email. Organizers use it to identify students and
-- to export the ranking. So the scoping moves server-side and the row set is
-- filtered to the caller's own departments before it leaves Postgres. A plain RLS
-- policy cannot express this: passport.profiles has no department column, so
-- "profiles referenced by in-scope scans" is only expressible in a function.
--
-- Ranking is computed here too, so what the browser receives is already the
-- answer rather than the raw material for it.

create or replace function passport.admin_leaderboard(
  p_samo_year_id uuid default null,
  p_season_id    uuid default null,
  p_dept_id      int  default null,
  p_sub_dept_id  int  default null
)
returns table (user_id uuid, full_name text, email text, points bigint)
language plpgsql stable security definer set search_path = passport as $$
declare
  v_ctx jsonb := public.passport_admin_context();
begin
  if not coalesce((v_ctx -> 'is_admin')::boolean, false) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  return query
  with in_scope as (
    select s.user_id, s.points_awarded
      from passport.scans s
     where (p_samo_year_id is null or s.samo_year_id = p_samo_year_id)
       and (p_season_id    is null or s.season_id    = p_season_id)
       and (p_dept_id      is null or s.department_id = p_dept_id)
       and (p_sub_dept_id  is null or s.sub_department_id = p_sub_dept_id)
       -- the caller's own grant, re-applied server-side. A SECURITY DEFINER
       -- function bypasses RLS entirely, so the scope must be re-stated here or
       -- it does not exist (samoweb 0069 learned this the expensive way).
       and passport.admin_covers_dept(s.department_id, s.sub_department_id)
  )
  select p.id,
         coalesce(p.full_name, '(unknown)')::text,
         p.email::text,
         sum(i.points_awarded)::bigint
    from in_scope i
    join passport.profiles p on p.id = i.user_id
   group by p.id, p.full_name, p.email
   order by 4 desc, 2 asc;   -- by position: `points` is also an OUT param name,
                             -- and `order by points` would bind to the NULL
                             -- variable, not the column (samoweb 0068).
end$$;
revoke all on function passport.admin_leaderboard(uuid, uuid, int, int) from public;
revoke all on function passport.admin_leaderboard(uuid, uuid, int, int) from anon;
grant execute on function passport.admin_leaderboard(uuid, uuid, int, int) to authenticated;

-- ===========================================================================
-- 4b. leaderboard_names — the PUBLIC leaderboard's names, without the roster
-- ===========================================================================
-- js/dashboard.js ensureLbPageData powers the student-facing global leaderboard by
-- reading ALL scans plus `profiles(id, full_name)`. The scans half stays legal
-- (scans_read is public and the ranking is the point of the feature); the profiles
-- half stops working the moment 0011 closes profiles_read_all, which would leave
-- every rival's name blank.
--
-- So publish a PROJECTION rather than re-opening the table — samoweb's org-chart
-- rule (0086): a visibility flag filters ROWS, and rows carry every column, so the
-- only safe publisher is a function with an explicit column list. Here that list
-- is id + full_name and nothing else: no email (the PII this whole migration
-- exists to close), no total_km, no tier.
--
-- Narrower than today in two further ways: it requires a signed-in caller
-- (the leaderboard lives behind the dashboard login, and anon can read the whole
-- table right now), and it returns only participants — someone who has never
-- scanned anything is not on a leaderboard and so is not disclosed at all.
create or replace function passport.leaderboard_names()
returns table (id uuid, full_name text)
language sql stable security definer set search_path = passport as $$
  select p.id, p.full_name
    from passport.profiles p
   where auth.uid() is not null
     and exists (select 1 from passport.scans s where s.user_id = p.id);
$$;
revoke all on function passport.leaderboard_names() from public;
revoke all on function passport.leaderboard_names() from anon;
grant execute on function passport.leaderboard_names() to authenticated;

-- ===========================================================================
-- 5. user_tiers — stop the view from bypassing profiles RLS
-- ===========================================================================
-- passport.user_tiers is a plain view over passport.profiles, owned by postgres,
-- WITHOUT security_invoker — so it reads profiles with the view owner's rights and
-- ignores profiles RLS completely. anon holds SELECT on it. Closing
-- profiles_read_all in 0011 would therefore leak the whole roster anyway
-- (id, full_name, total_km, tier, travel-visa flag) straight through the view:
-- exactly the "sanitizing ONE read path leaves the parallel path leaking" class
-- from samoweb mistakes.md. SECURITY-HARDENING-PLAN.md §3.5 missed this entirely.
--
-- security_invoker = on (PG15+; this project is PG17.6) makes the view respect the
-- caller's RLS. Applied HERE rather than in 0011 because while profiles_read_all
-- is still `using (true)` it is a no-op — the dashboard keeps working either way —
-- and that makes it safe to land early and verify.

alter view passport.user_tiers set (security_invoker = on);

-- ===========================================================================
-- 6. Verification (run as a real user, not as the superuser applying this)
-- ===========================================================================
-- Nothing above is provable from this session: apply-migration.mjs runs as the
-- Postgres superuser, where auth.uid() is null and RLS is bypassed, so every
-- policy and guard here would appear to do nothing. See samoweb
-- tools/pass-hardening.mjs, which impersonates a student / an admin / anon inside
-- rolled-back transactions and additionally applies 0011 in-transaction so the
-- lockdown is proven before it is committed.
