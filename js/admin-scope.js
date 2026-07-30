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
// ── HOW MUCH OF THIS IS ENFORCED ─────────────────────────────────────────────
// db/0010 + 0011 make the server enforce admin-ness: every passport write policy
// reads passport.is_admin(), which wraps passport_admin_context() — the same rpc
// this module consumes — so the panel and the database now agree.
//
// ฝ่าย SCOPING, however, is still only enforced where a function re-applies it
// (passport.admin_leaderboard does; the write policies check is_admin, not the
// department). So a scoped admin editing another ฝ่าย's activity with DevTools is
// not blocked by RLS today. Narrowing the write policies per-ฝ่าย is the next
// step; it is also pointless while the all-departments admin/1234 door is open.
//
// FAIL CLOSED. Any error — no session, rpc rejected, malformed payload — yields
// `{ isAdmin: false }`. Never default to "probably an admin".

import {
    supabase, getLegacyAdminClient, useLegacyAdminDb, useNormalAdminDb,
} from './app.js';
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
// The pre-0087 admin/1234 login, kept because many people still use it.
//
// It used to be a pure client-side string compare with NO server identity, which
// made it incompatible with any real database authorization: the DB can only grant
// rights to an identity it can verify, and a password compared in JavaScript
// produces none. "The database rejects anonymous writes" and "admin/1234 has full
// admin" were the same sentence negated — so db/0011 could never land while this
// door existed in that form.
//
// It now signs into ONE SHARED Supabase account that holds the `passport`
// permission in ทีม SAMO, on its own client (own storageKey — see app.js) so it
// cannot disturb anybody's personal Google session. The prompt is unchanged; behind
// it there is a real JWT, so passport.is_admin() is true and every admin write
// passes the same policies a Google admin's writes pass.
//
// BE HONEST ABOUT WHAT THIS IS AND ISN'T:
//   * It does NOT make the door secure. The shared account's password ships in the
//     bundle, so anyone who reads the bundle gets full passport admin — exactly as
//     true when the literal was '1234'. It is not a secret; it is a speed bump.
//   * What it DOES buy is that everyone who does *not* go through this door loses
//     write access entirely (that is db/0011), and every admin write now carries a
//     uid instead of arriving as anonymous.
//   * It is ALL DEPARTMENTS, so while it is enabled ฝ่าย scoping stays opt-in for
//     anyone using it. The panel says so in a banner; that is deliberate.
//
// TO REMOVE (still one flag):
//   1. set LEGACY_PASSWORD_LOGIN = false, redeploy, confirm every admin has a
//      ทีม SAMO grant and can sign in with Google;
//   2. delete this block, `legacyScope`/`legacyLogin`/`clearLegacySession`/
//      `ensureLegacySession` below, and the #admin-legacy-* markup in
//      html/admin.html;
//   3. then disable the shared account:
//      `update public.users set permissions = array_remove(permissions,'passport')`
//      for passportadmin@samomdkku.app (needs the users_self_update_guard dance —
//      see samoweb mistakes.md), or delete the auth user outright.
export const LEGACY_PASSWORD_LOGIN = true;
const LEGACY_USER = 'admin';
const LEGACY_PASS = '1234';
const LEGACY_KEY = 'admin_logged_in';

// The shared account the door signs into. Injected at build time so the
// credential is not greppable in this PUBLIC repo — it still ends up in the
// bundle (it has to, to be usable), so this is about not publishing it twice,
// not about secrecy. Missing env => the door is simply unavailable, which is the
// correct failure: better a door that will not open than one that opens onto a
// panel where nothing saves.
const SHARED_EMAIL = import.meta.env?.VITE_PASSPORT_ADMIN_EMAIL || '';
const SHARED_PASSWORD = import.meta.env?.VITE_PASSPORT_ADMIN_PASSWORD || '';
export const LEGACY_LOGIN_CONFIGURED = Boolean(SHARED_EMAIL && SHARED_PASSWORD);

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

/**
 * Check the legacy credentials and, on success, establish a REAL session for the
 * shared admin account and persist the marker.
 * @returns {Promise<AdminScope|null>} null = wrong credentials or not configured.
 * @throws when the credentials are right but the shared sign-in fails, so the
 *         caller can say "password correct, sign-in failed" rather than silently
 *         behaving like a typo.
 */
export async function legacyLogin(user, pass, remember) {
    if (!LEGACY_PASSWORD_LOGIN) return null;
    if (user !== LEGACY_USER || pass !== LEGACY_PASS) return null;
    if (!LEGACY_LOGIN_CONFIGURED) {
        throw new Error('ยังไม่ได้ตั้งค่าบัญชีผู้ดูแลร่วม (VITE_PASSPORT_ADMIN_*) สำหรับการเข้าสู่ระบบด้วยรหัสนี้');
    }
    const { error } = await getLegacyAdminClient().auth.signInWithPassword({
        email: SHARED_EMAIL, password: SHARED_PASSWORD,
    });
    if (error) throw new Error(error.message);
    try {
        (remember ? localStorage : sessionStorage).setItem(LEGACY_KEY, 'true');
    } catch { /* private mode — the session still works for this page load */ }
    useLegacyAdminDb();
    return legacyScope();
}

export async function clearLegacySession() {
    try {
        localStorage.removeItem(LEGACY_KEY);
        sessionStorage.removeItem(LEGACY_KEY);
    } catch { /* nothing to clear */ }
    useNormalAdminDb();
    try { await getLegacyAdminClient().auth.signOut(); } catch { /* already gone */ }
}

/**
 * Re-establish the shared session for a REMEMBERED legacy login.
 *
 * The localStorage marker outlives the Supabase session (tokens expire, and
 * `remember` can put the marker in localStorage while the session sits in memory
 * after a reload). Without this a returning legacy admin would look signed in and
 * then have every write rejected — the exact failure mode this whole change exists
 * to prevent. Credentials are available, so recovery is silent.
 * @returns {Promise<boolean>} true when a usable shared session is in place.
 */
export async function ensureLegacySession() {
    if (!hasLegacySession()) return false;
    if (!LEGACY_LOGIN_CONFIGURED) return false;
    const client = getLegacyAdminClient();
    try {
        const { data } = await client.auth.getSession();
        if (data?.session) { useLegacyAdminDb(); return true; }
        const { error } = await client.auth.signInWithPassword({
            email: SHARED_EMAIL, password: SHARED_PASSWORD,
        });
        if (error) return false;
        useLegacyAdminDb();
        return true;
    } catch { return false; }
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
