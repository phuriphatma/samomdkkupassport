// js/scanning.js
import { supabase } from './app.js';
import { checkSession } from './auth.js';

export async function processScan() {
    const titleEl = document.getElementById('scan-title');
    const msgEl = document.getElementById('scan-message');
    const spinner = document.getElementById('loading-spinner');
    const actions = document.getElementById('action-buttons');

    // 1. Verify User Session
    const user = await checkSession();
    if (!user) {
        // Not logged in? Save intent and redirect to login
        sessionStorage.setItem('pendingScanUrl', window.location.href);
        window.location.href = 'index.html';
        return;
    }

    // 2. Parse URL Parameters
    const urlParams = new URLSearchParams(window.location.search);
    const activityId = urlParams.get('aid');
    const token = urlParams.get('tk');

    if (!activityId || !token) {
        showStatus('Invalid QR Code', 'This boarding pass seems damaged or invalid.', 'error');
        return;
    }

    // 3. Verify Token against Database
    const { data: activity, error: actError } = await supabase
        .from('activities')
        .select('*')
        .eq('id', activityId)
        .single();

    if (actError || !activity) {
        showStatus('Activity Not Found', 'Could not locate this flight.', 'error');
        return;
    }

    // Anti-Cheat Check: Does the token match and is it unexpired?
    const now = new Date();
    const expiresAt = new Date(activity.token_expires_at);

    if (activity.active_token !== token || now > expiresAt) {
        showStatus('QR Code Expired', 'This QR code has expired to prevent cheating. Please scan the current code on the screen.', 'error');
        return;
    }

    // 4. Insert Scan Record
    const { error: scanError } = await supabase
        .from('scans')
        .insert([{
            user_id: user.id,
            activity_id: activity.id,
            points_awarded: activity.base_points_km
        }]);

    if (scanError) {
        // Postgres unique constraint error code is usually 23505
        if (scanError.code === '23505') {
            showStatus('Already Stamped!', 'You have already claimed points for this activity.', 'error');
        } else {
            showStatus('System Error', 'Could not stamp passport: ' + scanError.message, 'error');
        }
        return;
    }

    // Success!
    showStatus('Passport Stamped! ✈️', `Successfully earned ${activity.base_points_km} km for ${activity.name}!`, 'success');

    function showStatus(title, message, type) {
        spinner.style.display = 'none';
        titleEl.innerText = title;
        titleEl.className = type;
        msgEl.innerText = message;
        actions.style.display = 'block';
    }
}