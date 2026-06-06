-- db/seasons.sql
-- Named, scoped, dated leaderboard seasons (e.g. "Quarter 2 / 2026").
-- Standings are computed by filtering scans to [start_date, end_date] for the
-- season's scope, so a finished season is naturally frozen (its window is past)
-- and always reconciles with the underlying scans. Run in the Supabase SQL editor.

create table if not exists public.seasons (
    id          uuid primary key default gen_random_uuid(),
    name        text not null,                          -- e.g. 'Quarter 2 / 2026'
    scope       text not null check (scope in ('overall','department','subdepartment')),
    scope_id    int,                                    -- department/sub-department id; null for 'overall'
    start_date  date not null,
    end_date    date not null,
    year        int  not null,                          -- the วาระสโม year this belongs to
    created_at  timestamptz not null default now()
);

create index if not exists seasons_scope_idx on public.seasons (scope, scope_id);

-- Access mirrors the existing admin model (anon read/write). Tighten with real auth.
alter table public.seasons enable row level security;
create policy "seasons_read"   on public.seasons for select using (true);
create policy "seasons_insert" on public.seasons for insert with check (true);
create policy "seasons_update" on public.seasons for update using (true) with check (true);
create policy "seasons_delete" on public.seasons for delete using (true);
