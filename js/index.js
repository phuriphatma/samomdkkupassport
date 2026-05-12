// js/index.js — Landing page auth logic
import { supabase } from './app.js';
import { getPendingScanUrl, clearPendingScanUrl, savePendingScanUrl } from './utils.js';

const loadingText = document.getElementById('loading-text');
const loginBtn = document.getElementById('google-login');
const loggedInSection = document.getElementById('logged-in-section');
const emailDisplay = document.getElementById('user-email-display');

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

async function initAuth() {
    try {
        const response = await Promise.race([
            supabase.auth.getSession(),
            new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 3000))
        ]);
        if (response.error) throw response.error;
        updateUI(response.data.session);
    } catch (err) {
        console.error("Session check error or timeout:", err);
        updateUI(null);
    }

    supabase.auth.onAuthStateChange((_event, session) => {
        updateUI(session);
    });
}

loginBtn.addEventListener('click', async () => {
    loadingText.style.display = 'block';
    loadingText.innerText = 'Redirecting to Google...';
    loginBtn.style.display = 'none';

    // FIX: If we have a pending scan URL, pass it to Google so we land right back on the scan!
    let redirectUrl = window.location.origin + '/dashboard.html';
    const pendingUrl = getPendingScanUrl();

    if (pendingUrl) {
        redirectUrl = pendingUrl;
    }

    await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
            redirectTo: redirectUrl,
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
        window.location.href = 'dashboard.html';
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
