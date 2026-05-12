// js/student.js
import { supabase } from './app.js';
import { checkSession, logout } from './auth.js';

export async function initStudentDashboard() {
    const user = await checkSession();
    if (!user) {
        window.location.href = 'index.html';
        return;
    }

    // 1. Fetch Tier and KM Profile
    const { data: profileTier, error: profileError } = await supabase
        .from('user_tiers')
        .select('*')
        .eq('id', user.id)
        .single();

    if (profileError) {
        console.error("Profile load error:", profileError);
        return;
    }

    // Map data to UI
    document.getElementById('p-name').innerText = profileTier.full_name || user.email.split('@')[0];
    document.getElementById('p-km').innerText = profileTier.total_km;
    document.getElementById('p-tier').innerText = profileTier.final_tier;

    if (profileTier.has_travel_visa) {
        document.getElementById('visa-visa').style.display = 'block';
    }

    // 2. Fetch Badges
    const { data: scans, error: scansError } = await supabase
        .from('scans')
        .select(`activity_id, activities ( badge_url, name )`)
        .eq('user_id', user.id);

    if (scansError) return;

    const container = document.getElementById('stamps-container');
    container.innerHTML = '';

    scans.forEach(scan => {
        if (scan.activities.badge_url) {
            const img = document.createElement('img');
            img.src = scan.activities.badge_url;
            img.className = 'city-stamp';
            img.title = scan.activities.name;
            container.appendChild(img);
        }
    });

    document.getElementById('logout-btn').addEventListener('click', (e) => {
        e.preventDefault();
        logout();
    });
}