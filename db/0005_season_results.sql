-- db/0005_season_results.sql
-- Archived season standings. When an admin archives a season, each participant's
-- points for that window+scope are snapshotted here, so they survive even if the
-- underlying activities/scans are later deleted. Run in the Supabase SQL editor.

alter table public.seasons
    add column if not exists archived_at timestamptz;

create table if not exists public.season_results (
    id          uuid primary key default gen_random_uuid(),
    season_id   uuid not null references public.seasons(id) on delete cascade,
    user_id     uuid,
    full_name   text,
    email       text,
    points      int  not null default 0,
    created_at  timestamptz not null default now()
);

create index if not exists season_results_season_idx on public.season_results (season_id);
create index if not exists season_results_user_idx   on public.season_results (user_id);

alter table public.season_results enable row level security;
create policy "season_results_read"   on public.season_results for select using (true);
create policy "season_results_insert" on public.season_results for insert with check (true);
create policy "season_results_delete" on public.season_results for delete using (true);
