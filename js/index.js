// js/index.js — Landing page auth logic
import { supabase } from './app.js';
import { getPendingScanUrl, clearPendingScanUrl } from './utils.js';
import { ROUTES } from './routes.js';
import { getPassportAccess, renderAccessBlock } from './auth.js';

const loadingText = document.getElementById('loading-text');
const loginBtn = document.getElementById('google-login');
const loggedInSection = document.getElementById('logged-in-section');
const emailDisplay = document.getElementById('user-email-display');

// Did we just come back from the Google OAuth redirect? Capture this before the
// Supabase client strips the token from the URL hash. We land OAuth back on THIS
// page (origin + pathname) instead of jumping straight to /html/dashboard.html —
// a same-page redirect matches a simple Supabase Redirect-URL entry, so local /
// LAN dev works without allow-listing every deep path. We then forward in JS.
const RETURNING_FROM_OAUTH = window.location.hash.includes('access_token');

function forwardAfterLogin() {
    const pendingUrl = getPendingScanUrl();
    if (pendingUrl) {
        clearPendingScanUrl();
        window.location.replace(pendingUrl);
        return;
    }
    window.location.replace(ROUTES.DASHBOARD);
}

function updateUI(session) {
    loadingText.style.display = 'none';

    if (session && session.user) {
        loggedInSection.style.display = 'block';
        loginBtn.style.display = 'none';
        emailDisplay.innerText = session.user.email;
    } else {
        loggedInSection.style.display = 'none';
        loginBtn.style.display = 'block';
    }
}

// Gate the landing itself so a non-kkumail / migrated-away session doesn't see a
// misleading "Welcome back / Board Your Flight" only to hit the wall one click
// later on the dashboard. Returns true if the account was blocked (block shown).
async function gateBlockedAccount(session) {
    if (!session || !session.user) return false;
    const access = await getPassportAccess(session.user);
    if (access.status === 'moved' || access.status === 'blocked') {
        loggedInSection.style.display = 'none';
        loginBtn.style.display = 'none';
        loadingText.style.display = 'none';
        renderAccessBlock(access);   // its button routes through logout()
        return true;
    }
    return false;
}

async function initAuth() {
    try {
        const response = await Promise.race([
            supabase.auth.getSession(),
            new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 3000))
        ]);
        if (response.error) throw response.error;
        updateUI(response.data.session);
        if (RETURNING_FROM_OAUTH && response.data.session) { forwardAfterLogin(); return; }
        await gateBlockedAccount(response.data.session);
    } catch (err) {
        console.error("Session check error or timeout:", err);
        updateUI(null);
    }

    supabase.auth.onAuthStateChange((event, session) => {
        updateUI(session);
        // Right after OAuth returns to this page, forward to the dashboard /
        // pending scan once the session is established.
        if (RETURNING_FROM_OAUTH && session && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) {
            forwardAfterLogin();
            return;
        }
        gateBlockedAccount(session);
    });
}

loginBtn.addEventListener('click', async () => {
    loadingText.style.display = 'block';
    loadingText.innerText = 'Redirecting to Google...';
    loginBtn.style.display = 'none';

    // Always redirect to dashboard after OAuth.
    // If there's a pending scan URL, dashboard.js will pick it up from localStorage
    // and redirect there. This avoids OAuth stripping query params from scan URLs.
await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
        // Land back on THIS page; forwardAfterLogin() then routes onward.
        redirectTo: window.location.origin + window.location.pathname,
        // NB: do NOT set queryParams.hd = 'kkumail.com'. Forcing the hosted
        // domain makes Google redirect straight to kkumail.com's third-party
        // SAML IdP (ssonext-api.kku.ac.th), whose SSO URL is malformed →
        // ERR_ADDRESS_INVALID. The normal chooser routes kkumail logins through
        // Google's own working SSO handling; the app-side gate is the real
        // kkumail-only enforcement anyway.
    }
});
});

document.getElementById('continue-btn').addEventListener('click', () => {
    // FIX: Changed sessionStorage to localStorage
    const pendingUrl = getPendingScanUrl();
    if (pendingUrl) {
        clearPendingScanUrl();
    }

if (pendingUrl) {
    window.location.href = pendingUrl;
} else {
    window.location.href = ROUTES.DASHBOARD; // Updated
}
});

document.getElementById('logout-btn').addEventListener('click', async (e) => {
    e.preventDefault();
    loadingText.style.display = 'block';
    loadingText.innerText = 'Clearing device cache...';
    loggedInSection.style.display = 'none';

    try {
        // Manually clear localStorage in case Supabase hangs
        clearPendingScanUrl();
        // Use Promise.race to guarantee we don't get stuck if network drops during signout
        await Promise.race([
            supabase.auth.signOut(),
            new Promise(resolve => setTimeout(resolve, 2000))
        ]);
    } catch (err) {
        console.error("Logout error:", err);
    }
    // Use href instead of reload() to wipe any leftover URL hashes/tokens from the address bar
    window.location.href = window.location.pathname;
});

initAuth();
