-- db/certificates-font.sql
-- Adds a font choice to certificate templates. Run in the Supabase SQL editor.
-- Safe to re-run.

alter table public.certificates
    add column if not exists font_family text not null default 'Prompt';
