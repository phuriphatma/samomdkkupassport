// js/dashboard.js — Student passport dashboard logic
import { supabase } from './app.js';
import { checkSession, logout } from './auth.js';
import { fixGoogleDriveUrl, getPendingScanUrl, clearPendingScanUrl } from './utils.js';
import { ROUTES } from './routes.js';

// Configure the appearance of your continent badges here
const continentThemes = {
    '1': { name: 'Novatopia', bg: 'rgba(52, 211, 153, 0.15)', border: 'rgba(52, 211, 153, 0.4)', text: '#34d399' }, // Green
    '2': { name: 'Empathia', bg: 'rgba(251, 113, 133, 0.15)', border: 'rgba(251, 113, 133, 0.4)', text: '#fb7185' }  // Red
};

async function init() {
    // 1. Attach logout listener FIRST
    document
        .getElementById('logout-btn')
        .addEventListener('click', async (e) => {
            e.preventDefault();
            await logout();
        });

const user = await checkSession();
if (!user) {
    window.location.href = ROUTES.HOME; // Updated from 'index.html'
    return;
}

    // === NEW FIX: Resume scan if they were redirected to login ===
    const pendingUrl = getPendingScanUrl();
    if (pendingUrl) {
        clearPendingScanUrl();
        window.location.href = pendingUrl;
        return;
    }

    // 2. Set Passenger Name
    let displayName = 'Traveler';
    if (user.user_metadata?.full_name) {
        displayName = user.user_metadata.full_name;
    } else if (user.user_metadata?.name) {
        displayName = user.user_metadata.name;
    } else if (user.email) {
        displayName = user.email.split('@')[0];
    }

    const pName = document.getElementById('p-name');
    pName.innerText = displayName;
    pName.classList.remove('skeleton'); // Remove shimmer once set

    // 3. Fetch Tier View
    const { data: profileTier, error: profileError } = await supabase
        .from('user_tiers')
        .select('*')
        .eq('id', user.id)
        .single();

    const pTier = document.getElementById('p-tier');
    if (!profileError && profileTier) {
        if (profileTier.full_name) {
            pName.innerText = profileTier.full_name;
        }
        pTier.innerText = profileTier.final_tier || 'Novice';
        if (profileTier.has_travel_visa) {
            document.getElementById('visa-visa').style.display = 'block';
        }
    } else {
        console.warn('Tier profile not found yet, using defaults.');
        pTier.innerText = 'Novice';
    }
    pTier.classList.remove('skeleton'); // Remove shimmer

    // 4. Activity Fetching
    const pKm = document.getElementById('p-km');
    try {
        const { data: scans, error: scansError } = await supabase
            .from('scans')
            .select('*')
            .eq('user_id', user.id);

        if (scansError) throw scansError;

        const { data: allActivities, error: actError } = await supabase
            .from('activities')
            .select('*');

        if (actError) throw actError;

        let totalKm = 0;
        const container = document.getElementById('stamps-container');
        const activityList = document.getElementById('activity-list');

        container.innerHTML = '';

        if (scans.length > 0) {
            activityList.innerHTML = '';
        } else {
            activityList.innerHTML = '<div style="opacity: 0.5">No flights yet.</div>';
        }

        scans.forEach((scan) => {
            const activityData = allActivities.find((a) => a.id === scan.activity_id) || {};
            const points = scan.points_awarded || activityData.base_points_km || 0;
            totalKm += points;

            const activityName = activityData.name || 'Unknown Flight';

            // Beautiful Continent Badge
            let badgeHTML = '';
            if (activityData.continent_id && continentThemes[activityData.continent_id]) {
                const theme = continentThemes[activityData.continent_id];
                badgeHTML = `<span class="continent-badge" style="background: ${theme.bg}; color: ${theme.text}; border: 1px solid ${theme.border};">${theme.name}</span>`;
            }

            const logItem = document.createElement('div');
            logItem.className = 'flight-log-item';

            // Using innerHTML so the badge renders nicely
            logItem.innerHTML = `<span>✈️ ${activityName} ${badgeHTML}</span> <span style="opacity:0.8;">+${points}km</span>`;

            activityList.appendChild(logItem);

            if (activityData.badge_url) {
                // Wrapper for stamp + label
                const stampWrapper = document.createElement('div');
                stampWrapper.className = 'stamp-wrapper';

                const img = document.createElement('img');
                img.src = fixGoogleDriveUrl(activityData.badge_url);
                img.className = 'city-stamp';
                img.title = activityName;

                const label = document.createElement('span');
                label.innerText = activityData.badge_name || activityData.name;
                label.className = 'stamp-label';

                stampWrapper.appendChild(img);
                stampWrapper.appendChild(label);
                container.appendChild(stampWrapper);
            }
        });

        // 5. Update Total KM
        const dbTotal = profileTier?.total_km || 0;
        pKm.innerText = Math.max(dbTotal, totalKm);

    } catch (err) {
        console.error('Failed to load activities:', err);
        document.getElementById('activity-list').innerHTML =
            `<div style="color:var(--accent-red); font-weight:bold;">Error loading flights</div>`;
        pKm.innerText = '0';
    }

    pKm.classList.remove('skeleton'); // Remove shimmer
}

init();
