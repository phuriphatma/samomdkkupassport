// js/admin-page.js — Admin terminal logic
import { supabase } from './app.js';
import { generateUUID } from './utils.js';
import { ROUTES } from './routes.js';

let currentActivityId = null;
let editingActivityId = null;
let qrGenerator = null;
let rotationInterval = null;
let timerInterval = null;
let qrType = 'dynamic';

// --- QR GENERATION ---
let qrDynamicGenerator = null;
let qrStaticGenerator = null;

async function init() {
    if (
        localStorage.getItem('admin_logged_in') === 'true' ||
        sessionStorage.getItem('admin_logged_in') === 'true'
    ) {
        showAdminPanel();
    }

    document
        .getElementById('admin-login-form')
        .addEventListener('submit', handleLogin);
    document
        .getElementById('activity-form')
        .addEventListener('submit', createActivity);
    document
        .getElementById('edit-activity-form')
        .addEventListener('submit', submitEditActivity);
    document
        .getElementById('admin-logout')
        .addEventListener('click', () => {
            localStorage.removeItem('admin_logged_in');
            sessionStorage.removeItem('admin_logged_in');
            window.location.reload();
        });

    const downloadBtn = document.getElementById('download-qr-btn');
    if (downloadBtn) {
        downloadBtn.addEventListener('click', () => {
            const qrContainer = document.getElementById('qrcode-static');
            const img = qrContainer.querySelector('img');
            const canvas = qrContainer.querySelector('canvas');

            let dataUrl = '';
            // Attempt to get base64 source from either img src or canvas toDataURL
            if (img && img.src && img.src.startsWith('data:image')) {
                dataUrl = img.src;
            } else if (canvas) {
                dataUrl = canvas.toDataURL('image/png');
            }

            if (dataUrl) {
                const link = document.createElement('a');
                link.href = dataUrl;
                link.download = `static-qr-${currentActivityId || 'code'}.png`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            } else {
                alert('QR Code is still rendering. Please try again in a moment.');
            }
        });
    }
}

function showAdminPanel() {
    document.getElementById('admin-login-section').style.display = 'none';
    document.getElementById('admin-content').style.display = 'block';
    document.getElementById('admin-logout').style.display = 'inline-block';
    loadActivities();
}

function handleLogin(e) {
    e.preventDefault();
    const user = document.getElementById('admin-user').value;
    const pass = document.getElementById('admin-pass').value;
    const remember = document.getElementById('admin-remember').checked;

    if (user === 'admin' && pass === '1234') {
        if (remember) {
            localStorage.setItem('admin_logged_in', 'true');
        } else {
            sessionStorage.setItem('admin_logged_in', 'true');
        }
        showAdminPanel();
    } else {
        alert('Invalid credentials!');
    }
}

// --- ACTIVITY LIST & MANAGEMENT ---
async function loadActivities() {
    const { data, error } = await supabase
        .from('activities')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        console.error(error);
        return;
    }

    const list = document.getElementById('activities-list');
    list.innerHTML = '';

    if (data.length === 0) {
        list.innerHTML =
            '<p style="font-size: 0.9rem;">No activities created yet.</p>';
        return;
    }

    data.forEach((act) => {
        list.innerHTML += `
          <div class="activity-card">
            <div class="activity-card-header">
              <strong class="activity-card-name">${act.name}</strong>
              <span class="activity-card-km">${act.base_points_km} km</span>
            </div>
            <div class="activity-card-actions">
              <button onclick="startScannerFor('${act.id}')" class="btn-action">Generate QR</button>
              <button onclick="editActivity('${act.id}')" class="btn-action btn-edit">Edit</button>
              <button onclick="deleteActivity('${act.id}')" class="btn-action btn-delete">Delete</button>
            </div>
          </div>
        `;
    });
}

window.startScannerFor = (id) => {
    currentActivityId = id;
    qrType = 'dynamic'; // Defaulting to dynamic when resuming from list
    startRotatingQR();
};

window.editActivity = async (id) => {
    editingActivityId = id;
    const { data, error } = await supabase
        .from('activities')
        .select('*')
        .eq('id', id)
        .single();
    if (error) {
        alert('Could not load activity.');
        return;
    }

    document.getElementById('edit-name').value = data.name;
    document.getElementById('edit-km').value = data.base_points_km;
    document.getElementById('edit-badge-name').value = data.badge_name || '';
    document.getElementById('edit-badge-url').value = data.badge_url || '';
    document.getElementById('edit-continent').value =
        data.continent_id || '';
    document.getElementById('edit-bonus').checked = data.is_marketing_bonus;

    document.getElementById('event-creation').style.display = 'none';
    document.getElementById('manage-section').style.display = 'none';
    document.getElementById('edit-section').style.display = 'block';
};

window.cancelEdit = () => {
    editingActivityId = null;
    document.getElementById('edit-section').style.display = 'none';
    document.getElementById('event-creation').style.display = 'block';
    document.getElementById('manage-section').style.display = 'block';
};

window.deleteActivity = async (id) => {
    if (
        !confirm(
            'Are you sure? This will permanently delete the activity AND remove these points from all users who attended!',
        )
    )
        return;

    // 1. Delete scans attached to this activity to keep customer dashboards accurate
    const { error: scanError } = await supabase.from('scans').delete().eq('activity_id', id);

    if (scanError) {
        console.error(scanError);
        alert('Could not delete associated scans: ' + scanError.message);
        return;
    }

    // 2. Delete the activity itself
    const { data, error } = await supabase
        .from('activities')
        .delete()
        .eq('id', id)
        .select();

    if (error) {
        console.error(error);
        alert('Delete failed: ' + error.message);
    } else if (!data || data.length === 0) {
        alert('Delete failed: No matching activity found, or restricted by permissions (RLS). Please check database policies.');
    } else {
        loadActivities();
    }
};

async function submitEditActivity(e) {
    e.preventDefault();
    const name = document.getElementById('edit-name').value;
    const km = document.getElementById('edit-km').value;
    const cont = document.getElementById('edit-continent').value || null;
    const badge_name = document.getElementById('edit-badge-name').value || name;
    const badge_url = document.getElementById('edit-badge-url').value || null;
    const bonus = document.getElementById('edit-bonus').checked;

    // 1. Update the activity details
    const { error } = await supabase
        .from('activities')
        .update({
            name,
            base_points_km: km,
            continent_id: cont,
            badge_name,
            badge_url,
            is_marketing_bonus: bonus,
        })
        .eq('id', editingActivityId);

    if (error) {
        console.error(error);
        alert('Update failed: ' + error.message);
        return;
    }

    // 2. IMPORTANT: Update past scans so the users see the new points updated retroactively!
    await supabase
        .from('scans')
        .update({
            points_awarded: km,
        })
        .eq('activity_id', editingActivityId);

    alert('Activity updated successfully!');
    cancelEdit();
    loadActivities();
}

async function createActivity(e) {
    e.preventDefault();
    const name = document.getElementById('act-name').value;
    const km = document.getElementById('act-km').value;
    const cont = document.getElementById('act-continent').value || null;
    const badge_name = document.getElementById('act-badge-name').value || name;
    const badge_url = document.getElementById('act-badge-url').value || null;
    const bonus = document.getElementById('act-bonus').checked;

    const { data, error } = await supabase
        .from('activities')
        .insert([
            {
                name,
                base_points_km: km,
                continent_id: cont,
                badge_name,
                badge_url,
                is_marketing_bonus: bonus,
            },
        ])
        .select();

    if (error) {
        console.error(error);
        return;
    }

    currentActivityId = data[0].id;
    loadActivities(); // Refresh the list
    startRotatingQR();
}

function startRotatingQR() {
    document.getElementById('event-creation').style.display = 'none';
    document.getElementById('manage-section').style.display = 'none';
    document.getElementById('qr-section').style.display = 'block';

    if (rotationInterval) clearInterval(rotationInterval);
    if (timerInterval) clearInterval(timerInterval);

    document.getElementById('qrcode-dynamic').innerHTML = '';
    document.getElementById('qrcode-static').innerHTML = '';

    qrDynamicGenerator = new QRCode(document.getElementById('qrcode-dynamic'), { width: 220, height: 220 });
    qrStaticGenerator = new QRCode(document.getElementById('qrcode-static'), { width: 220, height: 220 });

    generateStaticAndStartDynamic();
}

async function generateStaticAndStartDynamic() {
    // 1. Get or create the Static Token
    const { data: act } = await supabase.from('activities').select('static_token').eq('id', currentActivityId).single();
    let staticToken = act?.static_token;

    if (!staticToken) {
        staticToken = generateUUID();
        await supabase.from('activities').update({ static_token: staticToken }).eq('id', currentActivityId);
    }

const scanUrlStatic = `${window.location.origin}${ROUTES.SCAN}?aid=${currentActivityId}&tk=${staticToken}`;
    qrStaticGenerator.makeCode(scanUrlStatic);

    // 2. Start dynamic rotation
    rotateDynamicToken();
    rotationInterval = setInterval(rotateDynamicToken, 15000);

    let secondsLeftRemaining = 15;
    document.getElementById('time-left').innerText = secondsLeftRemaining;
    timerInterval = setInterval(() => {
        secondsLeftRemaining--;
        document.getElementById('time-left').innerText = secondsLeftRemaining;
        if (secondsLeftRemaining <= 0) secondsLeftRemaining = 15;
    }, 1000);
}

async function rotateDynamicToken() {
    const newToken = generateUUID();
    const expires = new Date(Date.now() + 20000).toISOString();

    await supabase
        .from('activities')
        .update({ active_token: newToken, token_expires_at: expires })
        .eq('id', currentActivityId);

const scanUrl = `${window.location.origin}${ROUTES.SCAN}?aid=${currentActivityId}&tk=${newToken}`;
    qrDynamicGenerator.makeCode(scanUrl);
}

init();
