// js/auth.js
import { supabase } from "./app.js";
import { ROUTES } from './routes.js';

export async function checkSession() {
  // 1. Catch OAuth errors from the URL before they get wiped
  if (window.location.hash.includes("error=")) {
    const urlParams = new URLSearchParams(window.location.hash.substring(1));
    const errorDesc = urlParams.get("error_description");
    console.error("OAuth Error from Supabase:", errorDesc);
    alert(
      "Login Error: " +
        (errorDesc || "Check console. Is your Redirect URL allowed?"),
    );

    // Clear the error hash so it doesn't persist forever
    window.history.replaceState(
      null,
      null,
      window.location.pathname + window.location.search,
    );
    return null;
  }

  // 2. Prevent Race Condition: Give Supabase a tiny window to parse the token
  // from the URL into LocalStorage before we request the session.
  if (window.location.hash.includes("access_token")) {
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  // 3. Ask Supabase for the session
  const { data, error } = await supabase.auth.getSession();

  if (error) {
    console.error("Auth error:", error.message);
    return null;
  }

  // 4. If a valid session exists
  if (data?.session) {
    // Wipe the ugly token string from the browser's URL bar
    if (window.location.hash.includes("access_token")) {
      window.history.replaceState(
        null,
        null,
        window.location.pathname + window.location.search,
      );
    }
    return data.session.user;
  }

  // 5. If no session exists, trigger the redirect back to login
  return null;
}

// Ensure this signed-in user has a passport profile row. Covers users who
// already had a samoweb (project A) account BEFORE the passport merge: the
// signup trigger only fires at signup, so they'd otherwise have no profile and
// their km wouldn't track / they'd be absent from the roster. Own-row INSERT is
// allowed by the profiles_insert_own RLS policy (with_check auth.uid()=id); a
// duplicate / already-linked row (23505) is a harmless no-op. Best-effort —
// never throws, so it can't block a scan or the dashboard from loading.
export async function ensureProfile(user) {
  if (!user?.id) return;
  try {
    const { data, error } = await supabase
      .from("profiles").select("id").eq("id", user.id).maybeSingle();
    if (error) { console.warn("ensureProfile check failed:", error.message); return; }
    if (data) return; // already has a profile
    const { error: insErr } = await supabase.from("profiles").insert({
      id: user.id,
      email: user.email,
      full_name: user.user_metadata?.full_name || user.user_metadata?.name || null,
      total_km: 0,
    });
    if (insErr && insErr.code !== "23505") console.warn("ensureProfile create failed:", insErr.message);
  } catch (e) { console.warn("ensureProfile error:", e); }
}

export async function logout() {
  try {
      await Promise.race([
          supabase.auth.signOut(),
          new Promise(resolve => setTimeout(resolve, 2000))
      ]);
  } catch (err) {
      console.error("Logout error:", err);
  }

  // CLEANUP: Simply redirect to the home route instead of string replacing
  window.location.href = ROUTES.HOME;
}

// ── kkumail-only access gate ──────────────────────────────────────────────
// SAMO Passport is for MDKKU students; only @kkumail.com Google accounts may
// earn points / scan. Non-kkumail accounts are blocked at runtime (the Google
// `hd` hint in signInWithOAuth only pre-filters the chooser — it is NOT a
// security boundary, so this app-side gate is the real enforcement).
//
// DEV_ALLOWLIST lets the developer test the student experience with a non-
// kkumail account. Keep it short; these emails bypass the domain check only.
const ALLOWED_DOMAINS = ['kkumail.com'];
const DEV_ALLOWLIST = ['pmphuriphat@gmail.com'];

export function isAllowedEmail(email) {
  const e = (email || '').toLowerCase().trim();
  if (!e) return false;
  if (DEV_ALLOWLIST.includes(e)) return true;
  return ALLOWED_DOMAINS.includes(e.split('@')[1] || '');
}

// Resolve what a signed-in user may do. Returns one of:
//   { status: 'ok' }                          — allowed kkumail (or dev) account
//   { status: 'ok', receivedFrom: '<email>' } — kkumail that received a migration
//   { status: 'moved', to: '<email>' }        — old account whose data was moved away
//   { status: 'blocked' }                      — non-kkumail, not migrated
// Best-effort: if the account_migrations lookup fails, fall back to the domain
// rule so the gate still works.
export async function getPassportAccess(user) {
  const email = (user?.email || '').toLowerCase().trim();
  if (!email) return { status: 'blocked' };

  // Use .eq (not .ilike): from_email/to_email are stored lowercased and `email`
  // is lowercased above, so an exact match is correct. .ilike would treat `_`
  // and `%` in the address (both legal in an email local-part) as wildcards.
  let movedTo = null, receivedFrom = null;
  try {
    const { data: fromRows } = await supabase
      .from('account_migrations').select('to_email').eq('from_email', email).limit(1);
    if (fromRows && fromRows.length) movedTo = fromRows[0].to_email;
    const { data: toRows } = await supabase
      .from('account_migrations').select('from_email').eq('to_email', email).limit(1);
    if (toRows && toRows.length) receivedFrom = toRows[0].from_email;
  } catch (e) { console.warn('getPassportAccess lookup failed:', e); }

  if (movedTo) return { status: 'moved', to: movedTo };
  if (isAllowedEmail(email)) return receivedFrom ? { status: 'ok', receivedFrom } : { status: 'ok' };
  return { status: 'blocked' };
}

function escAttr(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Full-screen overlay shown when a signed-in user may NOT use the passport:
// either their data was migrated away ('moved') or they are on a non-kkumail
// account ('blocked'). Self-contained (inline styles) so it works on any page.
export function renderAccessBlock(access) {
  const isMoved = access?.status === 'moved';
  const title = isMoved ? 'บัญชีนี้ถูกย้ายแล้ว' : 'ใช้ได้เฉพาะบัญชี @kkumail.com';
  const body = isMoved
    ? `คะแนน กิจกรรม แสตมป์ และเกียรติบัตรของบัญชีนี้<br>ถูกย้ายไปยัง<br>` +
      `<b style="word-break:break-all">${escAttr(access.to)}</b><br>เรียบร้อยแล้ว<br><br>` +
      `กรุณาเข้าสู่ระบบด้วยบัญชี @kkumail.com นั้นแทน<br><br>` +
      `<span style="opacity:.72;font-size:.92em">หากนี่ไม่ใช่คุณ กรุณาติดต่อ mdstuddata.beta@gmail.com</span>`
    : `SAMO Passport รองรับเฉพาะบัญชี <b>@kkumail.com</b> เท่านั้น<br><br>` +
      `กรุณาเข้าสู่ระบบด้วยอีเมล @kkumail.com ของคุณ`;

  document.getElementById('passport-access-block')?.remove();
  const el = document.createElement('div');
  el.id = 'passport-access-block';
  el.style.cssText =
    'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;' +
    'padding:24px;background:rgba(12,20,28,.92);backdrop-filter:blur(4px);' +
    'font-family:system-ui,-apple-system,"Noto Sans Thai",Segoe UI,sans-serif;color:#f3f6f9;';
  el.innerHTML =
    `<div style="max-width:420px;width:100%;background:#141d27;border:1px solid rgba(255,255,255,.09);` +
    `border-radius:18px;padding:30px 26px;text-align:center;box-shadow:0 18px 60px rgba(0,0,0,.5)">` +
    `<div style="font-size:34px;line-height:1;margin-bottom:14px">🛂</div>` +
    `<h2 style="margin:0 0 14px;font-size:20px;font-weight:700">${escAttr(title)}</h2>` +
    `<p style="margin:0 0 22px;font-size:15px;line-height:1.7">${body}</p>` +
    `<button id="pab-switch" style="width:100%;padding:13px 16px;border:0;border-radius:12px;` +
    `background:#2f9e78;color:#fff;font-size:15px;font-weight:600;cursor:pointer">` +
    `ออกจากระบบ / เปลี่ยนบัญชี</button></div>`;
  document.body.appendChild(el);
  el.querySelector('#pab-switch').onclick = () => logout();
}

// Dismissible top banner for a kkumail account that received a migration.
export function renderReceivedBanner(fromEmail) {
  const seenKey = 'passport.recvNoticeSeen';
  try { if (localStorage.getItem(seenKey) === fromEmail) return; } catch {}
  document.getElementById('passport-recv-banner')?.remove();
  const el = document.createElement('div');
  el.id = 'passport-recv-banner';
  el.style.cssText =
    'position:fixed;top:0;left:0;right:0;z-index:9998;padding:11px 44px 11px 16px;' +
    'background:#123a2c;color:#eafaf2;font-family:system-ui,-apple-system,"Noto Sans Thai",sans-serif;' +
    'font-size:13.5px;line-height:1.55;text-align:center;box-shadow:0 2px 12px rgba(0,0,0,.25)';
  el.innerHTML =
    `บัญชีนี้ได้รับคะแนน/กิจกรรม/แสตมป์ จาก <b style="word-break:break-all">${escAttr(fromEmail)}</b> เรียบร้อยแล้ว` +
    ` — หากไม่ถูกต้อง กรุณาติดต่อ mdstuddata.beta@gmail.com` +
    `<span id="prb-close" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);` +
    `cursor:pointer;font-size:18px;opacity:.8;padding:0 4px">×</span>`;
  document.body.appendChild(el);
  el.querySelector('#prb-close').onclick = () => {
    try { localStorage.setItem(seenKey, fromEmail); } catch {}
    el.remove();
  };
}