-- 0012 — scans may only be created by passport.stamp_scan().
--
-- The one part of db/0011 that is safe to apply while the temporary admin/1234
-- door is still in use, because no admin flow creates scans: the only writer
-- anywhere (app, GAS, samoweb) is passport.stamp_scan(), which db/0010 added and
-- the deployed js/scanning.js now calls. Every other `from('scans')` call in the
-- codebase is a read, plus a self-delete on the dashboard and an admin re-sync
-- UPDATE — none of which this touches.
--
-- stamp_scan() is SECURITY DEFINER, so it is unaffected by the absence of an
-- INSERT policy; dropping the policy is what makes "the server decides the points,
-- the activity token and the user" an enforced property rather than a convention.
--
-- The rest of db/0011 stays UNAPPLIED: it requires the admin panel to carry a real
-- session, which a client-side password compare cannot provide. See samoweb
-- STATE.md NEXT #3.
--
-- Rollback:
--   create policy scans_insert on passport.scans for insert to public
--     with check (true);

drop policy if exists scans_insert on passport.scans;

-- Deliberately no replacement policy: SECURITY DEFINER is the only inserter.
