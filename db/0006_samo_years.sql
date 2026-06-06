-- db/0006_samo_years.sql
-- Admin-controlled SamoYear (วาระสโม) + Season lifecycle with immutable history.
--
-- Model: the admin DECLARES the current SamoYear and the current Season. Every
-- scan from then on is stamped with that year+season and a snapshot of the
-- activity (name, dept, sub-dept, points). "Current" = the one open row where
-- ended_at IS NULL. Past seasons/years are frozen; deleting/editing an activity
-- never rewrites past scans, and certificates are scoped to the season they were
-- made in (so a reused activity/QR can carry a different cert per season).
--
-- Safe + idempotent. Run in the Supabase SQL editor.

-- ── SamoYears ────────────────────────────────────────────────────────────────
create table if not exists public.samo_years (
    id          uuid primary key default gen_random_uuid(),
    name        text not null,                      -- e.g. "วาระสโม'69"
    started_at  timestamptz not null default now(),
    ended_at    timestamptz,                        -- NULL = current
    created_at  timestamptz not null default now()
);

-- ── Seasons within a SamoYear ───────────────────────────────────────────────
create table if not exists public.samo_seasons (
    id            uuid primary key default gen_random_uuid(),
    samo_year_id  uuid not null references public.samo_years(id) on delete cascade,
    name          text not null,                    -- e.g. "Q1"
    started_at    timestamptz not null default now(),
    ended_at      timestamptz,                      -- NULL = current
    created_at    timestamptz not null default now()
);
create index if not exists samo_seasons_year_idx on public.samo_seasons (samo_year_id);

-- ── Scans become immutable snapshots ────────────────────────────────────────
alter table public.scans add column if not exists samo_year_id     uuid;
alter table public.scans add column if not exists season_id         uuid;
alter table public.scans add column if not exists activity_name     text;
alter table public.scans add column if not exists department_id     int;
alter table public.scans add column if not exists sub_department_id int;

-- Backfill the denormalised fields from activities for existing scans.
update public.scans s set
    activity_name     = a.name,
    department_id     = a.department_id,
    sub_department_id = a.sub_department_id
from public.activities a
where s.activity_id = a.id and s.activity_name is null;

create index if not exists scans_year_idx   on public.scans (samo_year_id);
create index if not exists scans_season_idx on public.scans (season_id);

-- ── Certificates: season-scoped ─────────────────────────────────────────────
-- season_id = the season this template belongs to. NULL = seasonless default
-- (used as a fallback when a season has no specific cert; existing rows stay NULL).
alter table public.certificates add column if not exists season_id uuid;
create index if not exists certificates_season_idx on public.certificates (season_id);

-- ── Keep history when an activity is deleted: drop the activity FKs ──────────
-- Scans + certificate templates must survive a hard delete of the activity, so a
-- past earner keeps their flight log AND the certificate they earned. We drop the
-- activity_id foreign keys on both tables (certificates' is ON DELETE CASCADE
-- today) and keep activity_id as a plain uuid used only for matching.
do $$
declare r record;
begin
    for r in
        select c.conname, t.relname
        from pg_constraint c
        join pg_class t      on t.oid = c.conrelid
        join pg_namespace n  on n.oid = t.relnamespace
        where n.nspname = 'public'
          and t.relname in ('scans', 'certificates')
          and c.contype = 'f'
          and c.confrelid = 'public.activities'::regclass
    loop
        execute format('alter table public.%I drop constraint %I', r.relname, r.conname);
    end loop;
end $$;

-- ── RLS (permissive, mirrors the existing admin model in db/0004) ───────────
alter table public.samo_years   enable row level security;
alter table public.samo_seasons enable row level security;

drop policy if exists "samo_years_read"   on public.samo_years;
drop policy if exists "samo_years_insert" on public.samo_years;
drop policy if exists "samo_years_update" on public.samo_years;
drop policy if exists "samo_years_delete" on public.samo_years;
create policy "samo_years_read"   on public.samo_years for select using (true);
create policy "samo_years_insert" on public.samo_years for insert with check (true);
create policy "samo_years_update" on public.samo_years for update using (true) with check (true);
create policy "samo_years_delete" on public.samo_years for delete using (true);

drop policy if exists "samo_seasons_read"   on public.samo_seasons;
drop policy if exists "samo_seasons_insert" on public.samo_seasons;
drop policy if exists "samo_seasons_update" on public.samo_seasons;
drop policy if exists "samo_seasons_delete" on public.samo_seasons;
create policy "samo_seasons_read"   on public.samo_seasons for select using (true);
create policy "samo_seasons_insert" on public.samo_seasons for insert with check (true);
create policy "samo_seasons_update" on public.samo_seasons for update using (true) with check (true);
create policy "samo_seasons_delete" on public.samo_seasons for delete using (true);
