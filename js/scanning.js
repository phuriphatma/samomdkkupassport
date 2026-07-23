// js/scanning.js
import { supabase } from './app.js';
import { checkSession, ensureProfile, getPassportAccess, renderAccessBlock } from './auth.js';
import { fixGoogleDriveUrl, savePendingScanUrl, clearPendingScanUrl } from './utils.js';
import { ROUTES } from './routes.js';
import { getCurrentContext } from './samo.js';

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

    // --- STATIC MATCH CHECK ---
    const isStaticMatch = activity.static_token && token && activity.static_token === token;

    if (!isStaticMatch) {
        showStatus('QR Code Invalid', 'This QR code is invalid. Please scan the current authorized code.', 'error');
        return;
    }
    // ---------------------------------

    // 3. Verify User Session
    const user = await checkSession();

    // 3b. kkumail-only gate — a non-kkumail or migrated-away account may not stamp.
    if (user) {
        const access = await getPassportAccess(user);
        if (access.status === 'moved' || access.status === 'blocked') {
            spinner.style.display = 'none';
            renderAccessBlock(access);
            return;
        }
    }

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

        // Make sure the user has a profile row before the scan lands, or
        // on_new_scan would update 0 rows and this scan's km would be lost.
        await ensureProfile(user);

        // Stamp the scan with the current SamoYear + Season and a snapshot of the
        // activity, so the record is immutable history (survives activity edits/
        // deletes and past-season freezes).
        const { year, season } = await getCurrentContext().catch(() => ({ year: null, season: null }));
        const baseRow = {
            user_id: user.id,
            activity_id: activity.id,
            points_awarded: activity.base_points_km,
        };
        const snapshotRow = {
            ...baseRow,
            activity_name: activity.name,
            department_id: activity.department_id ?? null,
            sub_department_id: activity.sub_department_id ?? null,
            samo_year_id: year?.id ?? null,
            season_id: season?.id ?? null,
        };

        let { error: scanError } = await supabase.from('scans').insert([snapshotRow]);
        // If the snapshot columns don't exist yet (migration 0006 not run), retry
        // with just the original columns so scanning still works.
        if (scanError && scanError.code !== '23505' &&
            /column|does not exist|schema cache/i.test(scanError.message || '')) {
            ({ error: scanError } = await supabase.from('scans').insert([baseRow]));
        }

        if (scanError) {
            if (scanError.code === '23505') {
                showStatus('Already Stamped!', 'You have already claimed points for this activity.', 'error');
            } else {
                showStatus('System Error', 'Could not stamp passport: ' + scanError.message, 'error');
            }
            return;
        }

        // Success!
        showStampSuccess(activity);
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
        queryParams: { hd: 'kkumail.com' }, // pre-filter chooser to kkumail (UX hint)
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

    // Themed celebratory screen shown after a passport is stamped.
    function showStampSuccess(activity) {
        spinner.style.display = 'none';
        confirmSection.style.display = 'none';
        titleEl.style.display = 'none';
        msgEl.style.display = 'none';
        actions.style.display = 'none';

        document.getElementById('ss-activity').innerText = activity.name;
        document.getElementById('ss-km').innerText = `+${activity.base_points_km} km`;

        const stamp = document.getElementById('ss-stamp');
        const badge = document.getElementById('ss-badge');
        if (activity.badge_url) {
            badge.src = fixGoogleDriveUrl(activity.badge_url);
            badge.referrerPolicy = 'no-referrer';
            badge.onerror = () => { stamp.classList.remove('filled'); stamp.textContent = '✈️'; };
        } else {
            stamp.classList.remove('filled');
            stamp.textContent = '✈️';
        }

        document.getElementById('stamp-success').style.display = 'block';
    }
}