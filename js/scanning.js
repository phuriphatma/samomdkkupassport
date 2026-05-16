// js/scanning.js
import { supabase } from './app.js';
import { checkSession } from './auth.js';
import { fixGoogleDriveUrl, savePendingScanUrl, clearPendingScanUrl } from './utils.js';
import { ROUTES } from './routes.js';

export async function processScan() {
    const titleEl = document.getElementById('scan-title');
    const msgEl = document.getElementById('scan-message');
    const spinner = document.getElementById('loading-spinner');
    const actions = document.getElementById('action-buttons');
    const confirmSection = document.getElementById('confirm-section');

    // 1. Parse URL Parameters First
    const urlParams = new URLSearchParams(window.location.search);
    const activityId = urlParams.get('aid');
    const token = urlParams.get('tk');

    if (!activityId || !token) {
        showStatus('Invalid QR Code', 'This boarding pass seems damaged or invalid.', 'error');
        return;
    }

    // 2. Verify Token against Database
    const { data: activity, error: actError } = await supabase
        .from('activities')
        .select('*')
        .eq('id', activityId)
        .single();

    if (actError || !activity) {
        showStatus('Activity Not Found', 'Could not locate this flight.', 'error');
        return;
    }

    // --- RESTORED ANTI-CHEAT CHECK ---
    const now = new Date();
    const expiresAt = new Date(activity.token_expires_at);

    const isDynamicMatch = activity.active_token === token && now <= expiresAt;
    const isStaticMatch = activity.static_token === token;

    if (!isDynamicMatch && !isStaticMatch) {
        showStatus('QR Code Expired or Invalid', 'This QR code is invalid or has expired to prevent cheating. Please scan the current code.', 'error');
        return;
    }
    // ---------------------------------

    // 3. Verify User Session
    const user = await checkSession();

    // 4. SHOW CONFIRMATION UI
    spinner.style.display = 'none';

    // Get display name or prompt login
    if (user) {
        // The pending URL has served its purpose (redirecting back here after login).
        // Clear it immediately so the dashboard doesn't redirect back here again.
        clearPendingScanUrl();

        let displayName = user.user_metadata?.full_name || user.user_metadata?.name || user.email;
        document.getElementById('confirm-user').innerText = displayName;
        document.getElementById('btn-confirm-add').innerText = '✈️ Confirm & Stamp Passport';
    } else {
        document.getElementById('confirm-user').innerText = 'Guest (Login Required)';
        document.getElementById('btn-confirm-add').innerText = '🔑 Login to Stamp Passport';
        document.getElementById('btn-change-account').style.display = 'none';
        
        savePendingScanUrl(window.location.href);
    }

    // Populate the confirmation card
    document.getElementById('confirm-activity').innerText = activity.name;
    document.getElementById('confirm-points').innerText = `+${activity.base_points_km} km`;
    
    if (activity.badge_url) {
        const badgeEl = document.getElementById('confirm-badge');
        badgeEl.src = fixGoogleDriveUrl(activity.badge_url);
        badgeEl.style.display = 'block';

        if (activity.badge_name) {
            const badgeNameEl = document.getElementById('confirm-badge-name');
            badgeNameEl.innerText = activity.badge_name;
            badgeNameEl.style.display = 'block';
        }
    }

    // Show the section
    confirmSection.style.display = 'block';

    // 5. Handle button clicks
    document.getElementById('btn-confirm-add').onclick = async () => {
if (!user) {
    window.location.href = ROUTES.HOME; // Updated
    return;
}

        confirmSection.style.display = 'none';
        spinner.style.display = 'block';
        document.querySelector('#loading-spinner h2').innerText = 'Stamping Passport...';

        // Perform the actual insert
        const { error: scanError } = await supabase
            .from('scans')
            .insert([{
                user_id: user.id,
                activity_id: activity.id,
                points_awarded: activity.base_points_km
            }]);

        if (scanError) {
            if (scanError.code === '23505') {
                showStatus('Already Stamped!', 'You have already claimed points for this activity.', 'error');
            } else {
                showStatus('System Error', 'Could not stamp passport: ' + scanError.message, 'error');
            }
            return;
        }

        // Success!
        showStatus('Passport Stamped! ✈️', `Successfully earned ${activity.base_points_km} km for ${activity.name}!`, 'success');
    };

    document.getElementById('btn-change-account').onclick = async () => {
        savePendingScanUrl(window.location.href);

        // Sign out, then immediately open Google account picker — no intermediate page.
        // Dashboard will pick up the pending scan URL and redirect back here.
        await supabase.auth.signOut();
await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
        redirectTo: window.location.origin + ROUTES.DASHBOARD, // Updated
    }
});
    };

    // Helper function to update status UI
    function showStatus(title, message, type) {
        spinner.style.display = 'none';
        confirmSection.style.display = 'none';
        titleEl.innerText = title;
        titleEl.className = type;
        msgEl.innerText = message;
        actions.style.display = 'block';
    }
}