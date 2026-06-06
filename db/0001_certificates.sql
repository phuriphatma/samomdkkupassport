-- db/certificates.sql
-- Certificate templates for activities.
-- An activity can have MANY certificates (e.g. one for ผู้เข้าร่วม, one for ผู้จัดทำ).
-- The certificate image is generated client-side: the student's name is drawn
-- onto `background_url` at the configured position. Nothing is stored per-user.
--
-- Run this once in the Supabase SQL editor.

create table if not exists public.certificates (
    id              uuid primary key default gen_random_uuid(),
    activity_id     uuid not null references public.activities(id) on delete cascade,
    label           text not null,                         -- e.g. 'ผู้เข้าร่วม' / 'ผู้จัดทำ'
    background_url  text not null,                         -- public image link (SAMO Google Drive)
    name_x          numeric not null default 50,           -- name center X, % of image width
    name_y          numeric not null default 55,           -- name baseline Y, % of image height
    font_size       numeric not null default 6,            -- font size, % of image width
    font_color      text not null default '#1f2d3d',
    created_at      timestamptz not null default now()
);

create index if not exists certificates_activity_id_idx
    on public.certificates (activity_id);

-- Access model mirrors the existing `activities` table: the admin terminal and
-- the student dashboard both use the anon key. Adjust these policies if/when you
-- introduce real admin auth.
alter table public.certificates enable row level security;

create policy "certificates_read"   on public.certificates for select using (true);
create policy "certificates_insert" on public.certificates for insert with check (true);
create policy "certificates_update" on public.certificates for update using (true) with check (true);
create policy "certificates_delete" on public.certificates for delete using (true);
