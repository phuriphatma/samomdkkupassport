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