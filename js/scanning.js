// js/scanning.js
import { supabase } from './app.js';
import { checkSession, logout } from './auth.js'; // Make sure logout is imported!

export async function processScan() {
    const titleEl = document.getElementById('scan-title');
    const msgEl = document.getElementById('scan-message');
    const spinner = document.getElementById('loading-spinner');
    const actions = document.getElementById('action-buttons');
    const confirmSection = document.getElementById('confirm-section'); // New UI element

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

    // Anti-Cheat Check
    const now = new Date();
    const expiresAt = new Date(activity.token_expires_at);

    if (activity.active_token !== token || now > expiresAt) {
        showStatus('QR Code Expired', 'This QR code has expired to prevent cheating. Please scan the current code on the screen.', 'error');
        return;
    }

    // 4. SHOW CONFIRMATION UI INSTEAD OF AUTO-INSERTING
    spinner.style.display = 'none';

    // Get display name
    let displayName = user.user_metadata?.full_name || user.user_metadata?.name || user.email;

    // Populate the confirmation card
    document.getElementById('confirm-user').innerText = displayName;
    document.getElementById('confirm-activity').innerText = activity.name;
    document.getElementById('confirm-points').innerText = `+${activity.base_points_km} km`;

    // Show the section
    confirmSection.style.display = 'block';

    // 5. Handle button clicks
    document.getElementById('btn-confirm-add').onclick = async () => {
        // Hide confirm UI, show spinner again
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
        // Logs out the user and sends them back to the login page
        await logout();
    };

    // Helper function to update status UI
    function showStatus(title, message, type) {
        spinner.style.display = 'none';
        confirmSection.style.display = 'none'; // Ensure confirm section hides if error occurs
        titleEl.innerText = title;
        titleEl.className = type;
        msgEl.innerText = message;
        actions.style.display = 'block';
    }
}