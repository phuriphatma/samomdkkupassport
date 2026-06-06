-- db/profiles-name-policy.sql
-- Policies for profiles: let logged-in users update their OWN name, and keep
-- profiles readable (needed for leaderboards / names). Run in the Supabase SQL
-- editor. Safe to re-run.
--
-- IMPORTANT: enabling RLS without a SELECT policy hides ALL rows. This file adds
-- the SELECT policy so leaderboards don't show "unknown".

alter table public.profiles enable row level security;

-- Anyone can read profiles (names + points power the leaderboards).
drop policy if exists "profiles_read_all" on public.profiles;
create policy "profiles_read_all"
    on public.profiles
    for select
    using (true);

-- A logged-in user can update only their own row (used by "change my name").
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
    on public.profiles
    for update
    using (auth.uid() = id)
    with check (auth.uid() = id);

-- OPTIONAL backfill: create a profile row for every existing auth user so they
-- appear on the leaderboard with a name (run once; on-conflict keeps existing).
-- If your profiles table has extra NOT NULL columns, add them here.
insert into public.profiles (id, full_name, email)
select u.id,
       coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', split_part(u.email, '@', 1)),
       u.email
from auth.users u
on conflict (id) do nothing;
