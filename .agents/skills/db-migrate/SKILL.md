---
name: db-migrate
description: Apply or author a Supabase schema change for SAMO Passport. Use when adding a table/column, when a feature needs new DB structure, or when a "table not found" / missing-column error appears.
---

# Supabase schema changes

The app talks to Supabase with the **anon key**, which has **no schema (DDL) privileges**.
You cannot create tables/columns or policies from the app or with the anon key. DDL must
be run by a human in the Supabase SQL editor.

## Workflow for a schema change
1. Write the SQL as a file in `db/` (e.g. `db/0001_certificates.sql`). Use
   `create table if not exists` / `add column if not exists` so it's re-runnable.
2. Include RLS: `alter table … enable row level security;` plus policies. Mirror the
   existing permissive `activities` access (anon read/write) unless real auth exists —
   keep it consistent, and note the security caveat.
3. Tell the user to open **Supabase → SQL editor**, paste the file, and run it.
4. Write the consuming code to **degrade gracefully** if the migration hasn't run yet
   (ignore the fetch error, hide the feature) so deploys aren't blocked on the DB step.
5. Record the pending migration in `STATE.md`.

## Verify a table/columns exist (read-only, anon key)
```bash
set -a; source .env; set +a
curl -s "$VITE_SUPABASE_URL/rest/v1/<table>?select=*&limit=1" \
  -H "apikey: $VITE_SUPABASE_ANON_KEY" -H "Authorization: Bearer $VITE_SUPABASE_ANON_KEY"
```
A `PGRST205` error means the table doesn't exist yet (migration not run).

## Current known tables
`activities`, `scans`, `user_tiers`, `profiles`, and `certificates` (needs
`db/0001_certificates.sql`). See AGENTS.md for columns.
