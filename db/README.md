# Database migrations

Run these in the **Supabase SQL editor**, in numeric order. Each file is
idempotent (safe to re-run). New migrations get the next number.

| #    | File                          | What it does |
|------|-------------------------------|--------------|
| 0001 | `0001_certificates.sql`       | `certificates` table (templates per activity) |
| 0002 | `0002_certificates_font.sql`  | adds `certificates.font_family` |
| 0003 | `0003_profiles_name_policy.sql` | profiles RLS: public read + own-row name update (+ backfill) |
| 0004 | `0004_seasons.sql`            | `seasons` (named, scoped, dated leaderboard windows) |
| 0005 | `0005_season_results.sql`     | `season_results` + `seasons.archived_at` (archived standings) |

The app uses the anon key, which has no DDL privileges — these must be run by a
human here. Consuming code degrades gracefully until a migration is run.
