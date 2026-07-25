// js/admin-scope.js — WHO is a passport admin, and WHAT they may touch.
//
// Identity is NOT invented here. It comes from the ทีม SAMO org tree that lives
// in the samoweb `public` schema of the same Supabase project:
//
//     ทีม SAMO → จัดการสิทธิ์ → ☑ SAMO Passport → ขอบเขต
//         · ทุกฝ่าย            → permissions[] += 'passport'   (all_departments)
//         · ฝ่าย X             → passport_dept_id     = X
//         · ฝ่าย X / แผนกย่อย Y → passport_sub_dept_id = Y
//
// resolved by samoweb migration 0087 into `users.managed_passport_scopes` and
// handed to us by ONE rpc, `public.passport_admin_context()`. Never re-derive
// the rule from the tree tables — this app only consumes the answer.
//
// ── READ THIS BEFORE TRUSTING IT ─────────────────────────────────────────────
// This is the VISIBLE half of the boundary only. The `passport` schema's RLS is
// still wide open for anon (`using (true)` / `with check (true)`, migration
// 0056), so a scoped admin can still reach another department's rows over the
// wire with DevTools. Closing that is SECURITY-HARDENING-PLAN.md; when it lands
// its policies must read passport_admin_context() rather than inventing a
// second admin table. Until then: this stops accidents, not attackers.
//
// FAIL CLOSED. Any error — no session, rpc rejected, malformed payload — yields
// `{ isAdmin: false }`. Never default to "probably an admin".

import { supabase } from './app.js';
import { SUBDEPT_PARENT } from './constants.js';

/** @typedef {{isAdmin:boolean, allDepartments:boolean, departments:number[],
 *             subDepartments:number[], user:object|null, error:string|null}} AdminScope */

const DENIED = Object.freeze({
    isAdmin: false, allDepartments: false,
    departments: [], subDepartments: [], user: null, error: null,
});

const toIntList = (v) =>
    (Array.isArray(v) ? v : []).map((n) => parseInt(n, 10)).filter(Number.isInteger);

// ── LEGACY ESCAPE HATCH — TEMPORARY, DELETE ME ───────────────────────────────
// The pre-0087 admin/1234 login, kept so nobody is locked out mid-transition
// while ฝ่าย grants are still being handed out in ทีม SAMO.
//
// It grants ALL DEPARTMENTS: it is a client-side string compare with no server
// identity, so there is no uid to scope against and no way to make it narrower.
// While this is enabled, department scoping is opt-in — anyone with the password
// bypasses it entirely. The panel says so in a banner; that is deliberate.
//
// TO REMOVE (the whole point of this being one flag):
//   1. set LEGACY_PASSWORD_LOGIN = false, redeploy, confirm every admin has a
//      ทีม SAMO grant and can sign in with Google;
//   2. then delete this block, `legacyScope`/`legacyLogin`/`clearLegacySession`
//      below, and the #admin-legacy-* markup in html/admin.html.
export const LEGACY_PASSWORD_LOGIN = true;
const LEGACY_USER = 'admin';
const LEGACY_PASS = '1234';
const LEGACY_KEY = 'admin_logged_in';

/** The full-access scope a legacy password login stands in for. */
const legacyScope = () => ({
    isAdmin: true, allDepartments: true, departments: [], subDepartments: [],
    user: null, error: null, legacy: true,
});

/** True when a legacy password session is currently stored. */
export function hasLegacySession() {
    if (!LEGACY_PASSWORD_LOGIN) return false;
    try {
        return localStorage.getItem(LEGACY_KEY) === 'true'
            || sessionStorage.getItem(LEGACY_KEY) === 'true';
    } catch { return false; }
}

/** Check the legacy credentials and, on success, persist + return the scope. */
export function legacyLogin(user, pass, remember) {
    if (!LEGACY_PASSWORD_LOGIN) return null;
    if (user !== LEGACY_USER || pass !== LEGACY_PASS) return null;
    try {
        (remember ? localStorage : sessionStorage).setItem(LEGACY_KEY, 'true');
    } catch { /* private mode — the session still works for this page load */ }
    return legacyScope();
}

export function clearLegacySession() {
    try {
        localStorage.removeItem(LEGACY_KEY);
        sessionStorage.removeItem(LEGACY_KEY);
    } catch { /* nothing to clear */ }
}

/** Resolve a stored legacy session into a scope (null when there isn't one). */
export function getLegacyScope() {
    return hasLegacySession() ? legacyScope() : null;
}
// ── END LEGACY ESCAPE HATCH ──────────────────────────────────────────────────

/**
 * Resolve the signed-in user's passport admin scope.
 *
 * NOTE the `.schema('public')` hop: `app.js` pins the client to the `passport`
 * schema, but this rpc lives in `public` alongside the org tree. Without the hop
 * PostgREST looks for `passport.passport_admin_context()` and 404s.
 *
 * @returns {Promise<AdminScope>}
 */
export async function getAdminScope() {
    let user = null;
    try {
        const { data, error } = await supabase.auth.getSession();
        if (error) return { ...DENIED, error: error.message };
        user = data?.session?.user || null;
        if (!user) return { ...DENIED };
    } catch (e) {
        return { ...DENIED, error: String(e?.message || e) };
    }

    const pub = supabase.schema('public');

    // Re-resolve this account against the org tree before reading the answer.
    // The team_nodes/team_members triggers recompute `managed_passport_scopes`
    // for users who ALREADY have a public.users row — someone added to the tree
    // before they ever signed in has a stale (empty) row until this runs. Same
    // self-heal samoweb does on login (auth.js buildCurrentUser). Best-effort:
    // a failure just means we read whatever the triggers last wrote.
    try {
        await pub.rpc('sync_my_team_permissions');
    } catch (e) {
        console.warn('[admin-scope] sync_my_team_permissions failed:', e);
    }

    try {
        const { data, error } = await pub.rpc('passport_admin_context');
        if (error) {
            console.warn('[admin-scope] passport_admin_context failed:', error.message);
            return { ...DENIED, user, error: error.message };
        }
        const ctx = data || {};
        const all = ctx.all_departments === true;
        const departments = toIntList(ctx.departments);
        const subDepartments = toIntList(ctx.sub_departments);
        // Trust `is_admin` only when something actually backs it, so a future
        // change to the rpc can't hand out an empty-but-true grant.
        const isAdmin = ctx.is_admin === true && (all || departments.length > 0 || subDepartments.length > 0);
        return { isAdmin, allDepartments: all, departments, subDepartments, user, error: null };
    } catch (e) {
        console.warn('[admin-scope] passport_admin_context threw:', e);
        return { ...DENIED, user, error: String(e?.message || e) };
    }
}

/**
 * May this scope see / edit / delete an activity (or any dept-tagged row)?
 *
 * An activity with NO department is visible only to an all-departments admin —
 * an untagged row belongs to nobody, so the narrow grant must not claim it.
 * A sub-department grant matches ONLY on the sub id: `s:3` does not cover a
 * dept-5 activity that has no sub_department_id.
 */
export function scopeCoversActivity(scope, act) {
    if (!scope?.isAdmin) return false;
    if (scope.allDepartments) return true;
    const dept = act?.department_id ?? null;
    const sub = act?.sub_department_id ?? null;
    if (sub != null && scope.subDepartments.includes(sub)) return true;
    if (dept != null && scope.departments.includes(dept)) return true;
    return false;
}

/**
 * Department ids this scope may pick in the create / edit forms. A sub-department
 * grant implies its PARENT department (you cannot file a `จิตอาสา` activity
 * without also saying `กิจการมหาวิทยาลัย`), so the parent is offered — but
 * `allowedSubIdsForDept` then pins the sub, and `scopeCoversActivity` is what
 * actually decides. Returns null for an all-departments admin (= no restriction).
 */
export function allowedDeptIds(scope) {
    if (!scope?.isAdmin || scope.allDepartments) return null;
    const ids = new Set(scope.departments);
    scope.subDepartments.forEach((s) => {
        const parent = SUBDEPT_PARENT[s];
        if (parent) ids.add(parent);
    });
    return [...ids].sort((a, b) => a - b);
}

/**
 * Sub-department ids selectable under `deptId`. Returns null when unrestricted
 * (all-departments admin, or a whole-department grant that owns every sub).
 */
export function allowedSubIdsForDept(scope, deptId) {
    if (!scope?.isAdmin || scope.allDepartments) return null;
    const dept = parseInt(deptId, 10);
    if (scope.departments.includes(dept)) return null; // owns the whole dept
    const subs = scope.subDepartments.filter((s) => SUBDEPT_PARENT[s] === dept);
    return subs.length ? subs : [];
}

/** Human-readable scope, for the admin topbar. `names` = { departments, subDepartments } label maps. */
export function scopeLabel(scope, names) {
    if (!scope?.isAdmin) return '';
    if (scope.allDepartments) return 'ทุกฝ่าย';
    const parts = [
        ...scope.departments.map((d) => names.departments[d] || `ฝ่าย ${d}`),
        ...scope.subDepartments.map((s) => names.subDepartments[s] || `แผนกย่อย ${s}`),
    ];
    return parts.join(' · ') || '—';
}
