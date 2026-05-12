// js/scanning.js
import { supabase } from './app.js';
import { checkSession, logout } from './auth.js';

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
        let displayName = user.user_metadata?.full_name || user.user_metadata?.name || user.email;
        document.getElementById('confirm-user').innerText = displayName;
        document.getElementById('btn-confirm-add').innerText = '✈️ Confirm & Stamp Passport';
    } else {
        document.getElementById('confirm-user').innerText = 'Guest (Login Required)';
        document.getElementById('btn-confirm-add').innerText = '🔑 Login to Stamp Passport';
        document.getElementById('btn-change-account').style.display = 'none';
        
        try {
            localStorage.setItem('pendingScanUrl', window.location.href);
        } catch (e) {
            console.warn("Could not save pending scan URL", e);
        }
    }

    // Populate the confirmation card
    document.getElementById('confirm-activity').innerText = activity.badge_name || activity.name;
    document.getElementById('confirm-points').innerText = `+${activity.base_points_km} km`;
    
    if (activity.badge_url) {
        const badgeEl = document.getElementById('confirm-badge');
        let finalUrl = activity.badge_url;
        // Fix Google Drive URLs
        const gdriveMatch = finalUrl.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
        if (gdriveMatch) {
            finalUrl = `https://lh3.googleusercontent.com/d/${gdriveMatch[1]}`;
        }
        badgeEl.src = finalUrl;
        badgeEl.style.display = 'block';
    }

    // Show the section
    confirmSection.style.display = 'block';

    // 5. Handle button clicks
    document.getElementById('btn-confirm-add').onclick = async () => {
        if (!user) {
            // Not logged in? Redirect to login
            window.location.href = 'index.html';
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

        // Clear the pending scan so it doesn't trigger again later
        localStorage.removeItem('pendingScanUrl');

        // Success!
        showStatus('Passport Stamped! ✈️', `Successfully earned ${activity.base_points_km} km for ${activity.name}!`, 'success');
    };

    document.getElementById('btn-change-account').onclick = async () => {
        try {
            localStorage.setItem('pendingScanUrl', window.location.href);
        } catch (e) {
            console.warn("Could not save pending scan URL", e);
        }
        await logout();
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