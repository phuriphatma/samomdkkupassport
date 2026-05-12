// js/admin.js
import { supabase } from './app.js';
import { checkSession } from './auth.js';

let currentActivityId = null;
let qrGenerator = null;
let rotationInterval = null;
let secondsLeftRemaining = 15;

export async function initAdmin() {
    const user = await checkSession();
    if (!user) {
        window.location.href = 'index.html';
        return;
    }

    // Bind form submission
    document.getElementById('activity-form').addEventListener('submit', createActivity);
}

async function createActivity(e) {
    e.preventDefault();
    const name = document.getElementById('act-name').value;
    const km = document.getElementById('act-km').value;
    const cont = document.getElementById('act-continent').value;
    const bonus = document.getElementById('act-bonus').checked;

    const { data, error } = await supabase
        .from('activities')
        .insert([{
            name,
            base_points_km: km,
            continent_id: cont,
            is_marketing_bonus: bonus
        }])
        .select();

    if (error) {
        alert("Error creating activity: " + error.message);
        console.error(error);
        return;
    }

    currentActivityId = data[0].id;
    startRotatingQR();
}

function startRotatingQR() {
    document.getElementById('event-creation').style.display = 'none';
    document.getElementById('qr-section').style.display = 'block';

    // Ensure QRCode library is loaded in HTML
    qrGenerator = new QRCode(document.getElementById("qrcode"), { width: 300, height: 300 });

    rotateToken(); // Initial generation
    rotationInterval = setInterval(rotateToken, 15000); // 15s interval

    setInterval(() => {
        secondsLeftRemaining--;
        document.getElementById('time-left').innerText = secondsLeftRemaining;
        if (secondsLeftRemaining <= 0) secondsLeftRemaining = 15;
    }, 1000);
}

async function rotateToken() {
    const newToken = crypto.randomUUID();
    const expires = new Date(Date.now() + 20000).toISOString();

    const { error } = await supabase
        .from('activities')
        .update({ active_token: newToken, token_expires_at: expires })
        .eq('id', currentActivityId);

    if (error) {
        console.error("Failed to rotate token:", error);
        return;
    }

    const scanUrl = `${window.location.origin}/scan.html?aid=${currentActivityId}&tk=${newToken}`;
    qrGenerator.makeCode(scanUrl);
}