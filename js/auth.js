// js/auth.js
import { supabase } from "./app.js";

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

export async function logout() {
  try {
      await Promise.race([
          supabase.auth.signOut(),
          new Promise(resolve => setTimeout(resolve, 2000))
      ]);
  } catch (err) {
      console.error("Logout error:", err);
  }
  // Clear any hashed tokens from URL just in case
  window.location.href = window.location.pathname.replace("dashboard.html", "index.html").replace("scan.html", "index.html");
}
