-- db/profiles-name-policy.sql
-- Allow a logged-in user to update their OWN profile name (feature: user can
-- change their name). Run in the Supabase SQL editor if the name update errors
-- with a permissions/RLS message. Safe to re-run.
-- (Reading profiles is already permitted, so leaderboards work without changes.)

alter table public.profiles enable row level security;

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
    on public.profiles
    for update
    using (auth.uid() = id)
    with check (auth.uid() = id);
