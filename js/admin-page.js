// js/admin-page.js — Admin terminal logic
import { supabase } from './app.js';
import { generateUUID } from './utils.js';
import { ROUTES } from './routes.js';
import { renderCertificate, loadCertImage, CERT_FONTS } from './certificate.js';
import { uploadToDrive, deleteFromDrive, isUploadConfigured } from './upload.js';

const CERT_SAMPLE_NAME = 'ชื่อ นามสกุล';

const DEPARTMENTS = {
    1: 'อุปนายกฝ่ายบริหารองค์กร', 2: 'ดิจิทัลและสื่อสารองค์กร', 3: 'กิจการภายใน',
    4: 'กิจการภายนอก', 5: 'กิจการมหาวิทยาลัย', 6: 'วิชาการ',
    7: 'ยุทธศาสตร์และพัฒนาองค์กร', 8: 'คุณภาพชีวิตและสิ่งแวดล้อม',
    9: 'เวชนิทัศน์', 10: 'รังสีเทคนิค',
};

/**
 * Aggregate total points per user from scans, optionally filtered to a
 * department / sub-department via the activity each scan belongs to.
 * Returns rows sorted by points desc: { userId, name, email, points }.
 */
function aggregateLeaderboard(scans, activities, profiles, deptId, subId, startDate, endDate) {
    const actMap = new Map(activities.map(a => [a.id, a]));
    const profMap = new Map(profiles.map(p => [p.id, p]));
    const totals = new Map();

    scans.forEach(s => {
        if (startDate || endDate) {
            const d = (s.scanned_at || '').slice(0, 10); // ISO date portion
            if (startDate && d < startDate) return;
            if (endDate && d > endDate) return;
        }
        const act = actMap.get(s.activity_id);
        if (deptId && (!act || act.department_id !== deptId)) return;
        if (subId && (!act || act.sub_department_id !== subId)) return;
        const pts = s.points_awarded || act?.base_points_km || 0;
        totals.set(s.user_id, (totals.get(s.user_id) || 0) + pts);
    });

    return [...totals.entries()]
        .map(([userId, points]) => {
            const p = profMap.get(userId);
            return { userId, points, name: p?.full_name || '(unknown)', email: p?.email || '—' };
        })
        .sort((a, b) => b.points - a.points);
}

// --- CONFIG ---
const SUB_DEPT_OPTIONS = {
    '3': [{ value: '1', label: 'โครงการ' }, { value: '2', label: 'ชุมนุม' }],
    '5': [{ value: '3', label: 'จิตอาสา' }, { value: '4', label: '7 คณะ' }]
};

// --- STATE ---
let currentActivityId = null;
let editingActivityId = null;

// --- QR GENERATION ---
let qrStaticGenerator = null;

async function init() {
    setupSubDepartmentToggle('act-department', 'act-sub-department');
    setupSubDepartmentToggle('edit-department', 'edit-sub-department');
    setupSubDepartmentToggle('filter-department', 'filter-sub-department'); // กรณีที่เปลี่ยนแผนกหลักในหน้าสร้างใหม่แล้วไปแก้ไขต่อ จะได้แสดงตัวเลือกแผนกย่อยถูกต้อง
    
    const preventScrollChange = (id) => {
    const el = document.getElementById(id);
    if (el) {
        el.addEventListener('wheel', () => {
            el.blur();
        });
    }
};
    
    preventScrollChange('act-km');
    preventScrollChange('edit-km');

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

    document
        .getElementById('filter-department')
        .addEventListener('change', renderActivityList);

    document
        .getElementById('filter-sub-department')
        .addEventListener('change', renderActivityList);

    document
        .getElementById('search-activity')
        .addEventListener('input', renderActivityList);

    // Certificates: live preview + submit
    document
        .getElementById('cert-form')
        .addEventListener('submit', submitCertificate);
    document
        .getElementById('cert-form')
        .addEventListener('input', debounce(renderCertPreview, 350));
    populateCertFonts();
    setupCertPreviewDrag();

    // Drag-drop / click upload for image URL fields (if a GAS endpoint is set)
    wireUpload('act-badge-url', 'badges');
    wireUpload('edit-badge-url', 'badges');
    wireUpload('cert-bg-url', 'certificates');

    // Leaderboard filters
    document.getElementById('lb-season').addEventListener('change', onLbSeasonChange);
    document.getElementById('lb-department').addEventListener('change', onLbDeptChange);
    document.getElementById('lb-subdepartment').addEventListener('change', onLbSeasonChange);
    document.getElementById('lb-csv-btn').addEventListener('click', downloadLeaderboardCsv);

    // Seasons
    document.getElementById('season-form').addEventListener('submit', submitSeason);
    document.getElementById('season-scope').addEventListener('change', onSeasonScopeChange);

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

function setupSubDepartmentToggle(deptSelectId, subDeptSelectId) {
    const deptEl = document.getElementById(deptSelectId);
    const subEl = document.getElementById(subDeptSelectId);

    if (!deptEl || !subEl) return;

    deptEl.addEventListener('change', () => {
        const selectedValue = deptEl.value;
        const options = SUB_DEPT_OPTIONS[selectedValue];

        // ล้างค่าเดิมและเพิ่มค่าเริ่มต้น
        subEl.innerHTML = '<option value="">เลือกประเภทย่อย</option>';

        if (options) {
            options.forEach(opt => {
                subEl.innerHTML += `<option value="${opt.value}">${opt.label}</option>`;
            });
            subEl.style.display = 'block';
            subEl.required = true; // บังคับเลือกเมื่อแสดงผล
        } else {
            subEl.style.display = 'none';
            subEl.value = '';
            subEl.required = false;
        }
    });
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
let activitiesCache = [];
async function loadActivities() {
    const { data, error } = await supabase
        .from('activities')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        console.error(error);
        return;
    }

    activitiesCache = data; // เก็บข้อมูลใน cache เพื่อใช้กับฟิลเตอร์

    renderActivityList();
}

function renderActivityList(){

    const list = document.getElementById('activities-list');
    list.innerHTML = '';

    if (activitiesCache.length === 0) {
        list.innerHTML =
            '<p style="font-size: 0.9rem;">No activities created yet.</p>';
        return;
    }
    const filterDept = document.getElementById('filter-department').value;
    const filterSubDept = document.getElementById('filter-sub-department').value;
    const searchTerm = document.getElementById('search-activity').value.trim().toLowerCase();

    activitiesCache.forEach((act) => {
        // Apply filters
        if (filterDept && act.department_id !== parseInt(filterDept, 10)) {
            return;
        }
        if (filterSubDept && act.sub_department_id !== parseInt(filterSubDept, 10)) {
            return;
        }
        if (searchTerm && !(act.name || '').toLowerCase().includes(searchTerm)) {
            return;
        }

        list.innerHTML += `
          <div class="activity-card">
            <div class="activity-card-header">
              <strong class="activity-card-name">${act.name}</strong>
              <span class="activity-card-km">${act.base_points_km} km</span>
            </div>
            <div class="activity-card-actions">
              <button onclick="startScannerFor('${act.id}')" class="btn-action">Generate QR</button>
              <button onclick="manageCerts('${act.id}')" class="btn-action">Certificates</button>
              <button onclick="editActivity('${act.id}')" class="btn-action btn-edit">Edit</button>
              <button onclick="deleteActivity('${act.id}')" class="btn-action btn-delete">Delete</button>
            </div>
          </div>
        `;
    });

    if(activitiesCache.length > 0 && list.innerHTML === '') {
        list.innerHTML = '<p style="font-size: 0.9rem;">No activities match the selected filters.</p>';
    }
}

window.startScannerFor = (id) => {
    currentActivityId = id;
    startStaticQR();
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

    // ตั้งค่าตัวเลือกฝ่ายหลัก
    const deptVal = data.department_id || '';
    document.getElementById('edit-department').value = deptVal;

    document.getElementById('edit-department').dispatchEvent(new Event('change'));

    document.getElementById('edit-sub-department').value = data.sub_department_id || '';

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

    // 0. Collect the Drive images to clean up (badge + certificate backgrounds)
    //    BEFORE the rows are gone (certificates cascade-delete with the activity).
    const imageUrls = [];
    const { data: actRow } = await supabase.from('activities').select('badge_url').eq('id', id).single();
    if (actRow?.badge_url) imageUrls.push(actRow.badge_url);
    const { data: certRows } = await supabase.from('certificates').select('background_url').eq('activity_id', id);
    (certRows || []).forEach(c => { if (c.background_url) imageUrls.push(c.background_url); });

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
        // 3. Best-effort: remove the uploaded images from the SAMO Drive.
        await Promise.all(imageUrls.map(deleteFromDrive));
        loadActivities();
    }
};

async function submitEditActivity(e) {
    e.preventDefault();
    const name = document.getElementById('edit-name').value;
    const km = parseInt(document.getElementById('edit-km').value, 10);
    const deptRaw = document.getElementById('edit-department').value;
    const dept = deptRaw ? parseInt(deptRaw, 10) : null;
    const subDeptRaw = document.getElementById('edit-sub-department').value;
    const subDept = subDeptRaw ? parseInt(subDeptRaw, 10) : null;
    const badge_name = document.getElementById('edit-badge-name').value || name;
    const badge_url = document.getElementById('edit-badge-url').value || null;

    // 1. Update the activity details
    const { error } = await supabase
        .from('activities')
        .update({
            name,
            base_points_km: km,
            department_id: dept,
            sub_department_id: subDept,
            badge_name,
            badge_url,
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
    const km = parseInt(document.getElementById('act-km').value, 10);
    const deptRaw = document.getElementById('act-department').value;
    const dept = deptRaw ? parseInt(deptRaw, 10) : null;
    const subDeptRaw = document.getElementById('act-sub-department').value;
    const subDept = subDeptRaw ? parseInt(subDeptRaw, 10) : null;
    const badge_name = document.getElementById('act-badge-name').value || name;
    const badge_url = document.getElementById('act-badge-url').value || null;

    const { data, error } = await supabase
        .from('activities')
        .insert([
            {
                name,
                base_points_km: km,
                department_id: dept,
                sub_department_id: subDept,
                badge_name,
                badge_url,
            },
        ])
        .select();

    if (error) {
        console.error(error);
        alert('Failed to create activity: ' + error.message);
        return;
    }

    currentActivityId = data[0].id;
    loadActivities(); // Refresh the list
    startStaticQR();
}

async function startStaticQR() {
    if (!currentActivityId) {
        alert('Error: No active activity selected.');
        return;
    }
    
    document.getElementById('event-creation').style.display = 'none';
    document.getElementById('manage-section').style.display = 'none';
    document.getElementById('qr-section').style.display = 'block';

    const staticQrContainer = document.getElementById('qrcode-static');
    staticQrContainer.innerHTML = '';

    qrStaticGenerator = new QRCode(staticQrContainer, { width: 220, height: 220 });

    try {
        await generateStaticQR();
    } catch (error) {
        console.error(error);
        alert(error.message || 'An error occurred while generating the QR code.');

        // กู้คืน UI หน้าหลักเดิมกลับมาในกรณีที่ทำงานล้มเหลว
        document.getElementById('event-creation').style.display = 'block';
        document.getElementById('manage-section').style.display = 'block';
        document.getElementById('qr-section').style.display = 'none';
    }
}

async function generateStaticQR() {
    // 1. Get or create the Static Token
    const { data: act, error: selectError } = await supabase
        .from('activities')
        .select('static_token')
        .eq('id', currentActivityId)
        .single();

    if (selectError) {
        throw new Error('Failed to fetch activity: ' + selectError.message);
    }

    let staticToken = act?.static_token;

    if (!staticToken) {
        staticToken = generateUUID();
        const { error: updateError } = await supabase
            .from('activities')
            .update({ static_token: staticToken })
            .eq('id', currentActivityId);

        if (updateError) {
            throw new Error('Failed to update activity token: ' + updateError.message);
        }
    }

    const scanUrlStatic = `${window.location.origin}${ROUTES.SCAN}?aid=${currentActivityId}&tk=${staticToken}`;
    qrStaticGenerator.makeCode(scanUrlStatic);
}

// --- CERTIFICATES ---
let certActivityId = null;

function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

window.manageCerts = (id) => {
    const act = activitiesCache.find(a => a.id === id);
    certActivityId = id;
    document.getElementById('cert-activity-name').textContent = act ? act.name : '';

    document.getElementById('event-creation').style.display = 'none';
    document.getElementById('manage-section').style.display = 'none';
    document.getElementById('cert-section').style.display = 'block';

    document.getElementById('cert-form').reset();
    previewImg = null; previewImgUrl = '';
    renderCertPreview();
    loadCerts(id);
};

window.closeCerts = () => {
    certActivityId = null;
    document.getElementById('cert-section').style.display = 'none';
    document.getElementById('event-creation').style.display = 'block';
    document.getElementById('manage-section').style.display = 'block';
};

async function loadCerts(activityId) {
    const list = document.getElementById('cert-list');
    list.innerHTML = '<p style="font-size:0.9rem;">Loading…</p>';

    const { data, error } = await supabase
        .from('certificates')
        .select('*')
        .eq('activity_id', activityId)
        .order('created_at', { ascending: true });

    if (error) {
        list.innerHTML = `<p style="font-size:0.9rem;color:var(--accent-danger);">Could not load certificates: ${error.message}</p>`;
        return;
    }

    if (!data || data.length === 0) {
        list.innerHTML = '<p style="font-size:0.9rem;">No certificates yet for this activity.</p>';
        return;
    }

    list.innerHTML = data.map(c => `
        <div class="cert-list-item">
          <span class="cert-list-label">${c.label}</span>
          <button onclick="deleteCert('${c.id}')" class="btn-action btn-delete">Delete</button>
        </div>
    `).join('');
}

window.deleteCert = async (id) => {
    if (!confirm('Delete this certificate template?')) return;
    const { error } = await supabase.from('certificates').delete().eq('id', id);
    if (error) {
        alert('Delete failed: ' + error.message);
        return;
    }
    if (certActivityId) loadCerts(certActivityId);
};

function getCertFormValues() {
    return {
        label: document.getElementById('cert-label').value.trim(),
        background_url: document.getElementById('cert-bg-url').value.trim(),
        name_x: parseFloat(document.getElementById('cert-name-x').value) || 50,
        name_y: parseFloat(document.getElementById('cert-name-y').value) || 52,
        font_size: parseFloat(document.getElementById('cert-font-size').value) || 6,
        font_color: document.getElementById('cert-font-color').value || '#1f2d3d',
        font_family: document.getElementById('cert-font').value || 'Prompt',
    };
}

function populateCertFonts() {
    const sel = document.getElementById('cert-font');
    if (!sel || sel.options.length) return;
    sel.innerHTML = CERT_FONTS.map(f => `<option value="${f.value}">${f.label}</option>`).join('');
}

// Cache the loaded background so dragging the name is instant (no re-fetch).
let previewImg = null;
let previewImgUrl = '';

async function renderCertPreview() {
    const canvas = document.getElementById('cert-preview');
    const hint = document.getElementById('cert-preview-hint');
    const tip = document.getElementById('cert-preview-tip');
    const cert = getCertFormValues();

    if (!cert.background_url) {
        canvas.style.display = 'none';
        hint.style.display = '';
        hint.textContent = 'Paste a background URL to preview.';
        tip.style.display = 'none';
        previewImg = null; previewImgUrl = '';
        return;
    }

    try {
        if (cert.background_url !== previewImgUrl) {
            previewImg = await loadCertImage(cert.background_url);
            previewImgUrl = cert.background_url;
        }
        await renderCertificate(canvas, cert, CERT_SAMPLE_NAME, previewImg);
        canvas.style.display = '';
        hint.style.display = 'none';
        tip.style.display = '';
    } catch (err) {
        canvas.style.display = 'none';
        hint.style.display = '';
        hint.textContent = err.message || 'Could not load preview.';
        tip.style.display = 'none';
        previewImg = null; previewImgUrl = '';
    }
}

// Click / drag on the preview to place the name (updates X/Y + re-renders).
function setupCertPreviewDrag() {
    const canvas = document.getElementById('cert-preview');
    if (!canvas) return;
    let dragging = false;

    const apply = (e) => {
        const rect = canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const pt = e.touches ? e.touches[0] : e;
        const x = Math.min(100, Math.max(0, ((pt.clientX - rect.left) / rect.width) * 100));
        const y = Math.min(100, Math.max(0, ((pt.clientY - rect.top) / rect.height) * 100));
        document.getElementById('cert-name-x').value = Math.round(x);
        document.getElementById('cert-name-y').value = Math.round(y);
        renderCertPreview();
    };

    canvas.addEventListener('pointerdown', (e) => {
        dragging = true;
        canvas.setPointerCapture?.(e.pointerId);
        apply(e);
    });
    canvas.addEventListener('pointermove', (e) => { if (dragging) apply(e); });
    canvas.addEventListener('pointerup', () => { dragging = false; });
    canvas.addEventListener('pointercancel', () => { dragging = false; });
}

async function submitCertificate(e) {
    e.preventDefault();
    if (!certActivityId) return;
    const cert = getCertFormValues();

    let { error } = await supabase
        .from('certificates')
        .insert([{ activity_id: certActivityId, ...cert }]);

    // Resilience: if the font_family migration hasn't been run yet, retry without it.
    if (error && /font_family/.test(error.message || '')) {
        const { font_family, ...rest } = cert;
        ({ error } = await supabase.from('certificates').insert([{ activity_id: certActivityId, ...rest }]));
    }

    if (error) {
        alert('Failed to add certificate: ' + error.message);
        return;
    }

    document.getElementById('cert-form').reset();
    renderCertPreview();
    loadCerts(certActivityId);
}

// --- IMAGE UPLOAD (drag-drop / click) ---
function wireUpload(inputId, folder) {
    const input = document.getElementById(inputId);
    if (!input) return;
    if (!isUploadConfigured()) {
        console.info(`[upload] VITE_GAS_UPLOAD_URL not set — drag-drop disabled for #${inputId}; paste a link instead.`);
        return;
    }

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-action upload-btn';
    btn.textContent = '⬆️ Upload';

    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = 'image/*';
    picker.style.display = 'none';

    input.insertAdjacentElement('afterend', picker);
    input.insertAdjacentElement('afterend', btn);

    const doUpload = async (file) => {
        if (!file) return;
        const old = btn.textContent;
        btn.disabled = true;
        btn.textContent = '⏳ Uploading…';
        try {
            const url = await uploadToDrive(file, folder);
            input.value = url;
            input.dispatchEvent(new Event('input', { bubbles: true }));
        } catch (err) {
            alert('Upload failed: ' + (err.message || err));
        } finally {
            btn.disabled = false;
            btn.textContent = old;
        }
    };

    btn.addEventListener('click', () => picker.click());
    picker.addEventListener('change', function () { doUpload(this.files[0]); this.value = ''; });

    ['dragover', 'dragenter'].forEach(ev =>
        input.addEventListener(ev, (e) => { e.preventDefault(); input.classList.add('drag-over'); }));
    ['dragleave', 'drop'].forEach(ev =>
        input.addEventListener(ev, (e) => { e.preventDefault(); input.classList.remove('drag-over'); }));
    input.addEventListener('drop', (e) => {
        const f = e.dataTransfer?.files?.[0];
        if (f) doUpload(f);
    });
}

// --- SEASONS ---
const SUBDEPARTMENTS = { 1: 'โครงการ', 2: 'ชุมนุม', 3: 'จิตอาสา', 4: '7 คณะ' };
let seasonsCache = [];

async function ensureSeasons() {
    if (seasonsCache.length) return;
    const { data } = await supabase.from('seasons').select('*').order('start_date', { ascending: false });
    seasonsCache = data || [];
}

function seasonScopeLabel(s) {
    if (s.scope === 'department') return DEPARTMENTS[s.scope_id] || 'Department';
    if (s.scope === 'subdepartment') return SUBDEPARTMENTS[s.scope_id] || 'Sub-department';
    return 'Overall (วาระสโม)';
}

window.openSeasons = async () => {
    document.getElementById('event-creation').style.display = 'none';
    document.getElementById('manage-section').style.display = 'none';
    document.getElementById('seasons-section').style.display = 'block';
    document.getElementById('season-year').value = new Date().getFullYear();
    seasonsCache = [];
    await ensureSeasons();
    renderSeasonsList();
};

window.closeSeasons = () => {
    document.getElementById('seasons-section').style.display = 'none';
    document.getElementById('event-creation').style.display = 'block';
    document.getElementById('manage-section').style.display = 'block';
};

function renderSeasonsList() {
    const list = document.getElementById('seasons-list');
    if (!seasonsCache.length) {
        list.innerHTML = '<p style="font-size:0.9rem;">No seasons yet.</p>';
        return;
    }
    list.innerHTML = seasonsCache.map(s => {
        const archived = !!s.archived_at;
        return `
        <div class="cert-list-item${archived ? ' season-archived' : ''}">
          <span><strong>${escapeHtml(s.name)}</strong> — ${escapeHtml(seasonScopeLabel(s))}<br>
            <small>${s.start_date} → ${s.end_date} · ${s.year}${archived ? ' · 🔒 archived' : ''}</small></span>
          <span class="season-actions">
            ${archived ? '' : `<button onclick="archiveSeason('${s.id}')" class="btn-action">Archive</button>`}
            <button onclick="deleteSeason('${s.id}')" class="btn-action btn-delete">Delete</button>
          </span>
        </div>`;
    }).join('');
}

window.archiveSeason = async (id) => {
    const s = seasonsCache.find(x => x.id === id);
    if (!s) return;
    if (!confirm(`Archive "${s.name}"?\n\nThis freezes every participant's points for this season. The standings are kept even if the activities are later deleted.`)) return;

    const [{ data: scans }, { data: activities }, { data: profiles }] = await Promise.all([
        supabase.from('scans').select('user_id, activity_id, points_awarded, scanned_at'),
        supabase.from('activities').select('id, department_id, sub_department_id, base_points_km'),
        supabase.from('profiles').select('id, full_name, email'),
    ]);

    const deptId = s.scope === 'department' ? s.scope_id : null;
    const subId = s.scope === 'subdepartment' ? s.scope_id : null;
    const rows = aggregateLeaderboard(scans || [], activities || [], profiles || [], deptId, subId, s.start_date, s.end_date);

    // Re-archiving replaces any previous snapshot for this season.
    await supabase.from('season_results').delete().eq('season_id', id);
    if (rows.length) {
        const payload = rows.map(r => ({ season_id: id, user_id: r.userId, full_name: r.name, email: r.email, points: r.points }));
        const { error } = await supabase.from('season_results').insert(payload);
        if (error) { alert('Archive failed: ' + error.message); return; }
    }

    const { error: e2 } = await supabase.from('seasons').update({ archived_at: new Date().toISOString() }).eq('id', id);
    if (e2) { alert('Archive failed: ' + e2.message); return; }

    alert(`Archived "${s.name}" — ${rows.length} participant(s) snapshotted.`);
    seasonsCache = [];
    await ensureSeasons();
    renderSeasonsList();
};

window.deleteSeason = async (id) => {
    if (!confirm('Delete this season?')) return;
    const { error } = await supabase.from('seasons').delete().eq('id', id);
    if (error) { alert('Delete failed: ' + error.message); return; }
    seasonsCache = [];
    await ensureSeasons();
    renderSeasonsList();
};

function onSeasonScopeChange() {
    const scope = document.getElementById('season-scope').value;
    const wrap = document.getElementById('season-scope-id-wrap');
    const sel = document.getElementById('season-scope-id');
    const map = scope === 'department' ? DEPARTMENTS : scope === 'subdepartment' ? SUBDEPARTMENTS : null;
    if (map) {
        sel.innerHTML = Object.entries(map).map(([id, n]) => `<option value="${id}">${n}</option>`).join('');
        wrap.style.display = '';
    } else {
        sel.innerHTML = '';
        wrap.style.display = 'none';
    }
}

async function submitSeason(e) {
    e.preventDefault();
    const scope = document.getElementById('season-scope').value;
    const scopeIdRaw = document.getElementById('season-scope-id').value;
    const row = {
        name: document.getElementById('season-name').value.trim(),
        scope,
        scope_id: scope === 'overall' ? null : (scopeIdRaw ? parseInt(scopeIdRaw, 10) : null),
        start_date: document.getElementById('season-start').value,
        end_date: document.getElementById('season-end').value,
        year: parseInt(document.getElementById('season-year').value, 10) || new Date().getFullYear(),
    };
    if (!row.start_date || !row.end_date) { alert('Pick start and end dates'); return; }
    if (row.end_date < row.start_date) { alert('End date must be after start date'); return; }

    const { error } = await supabase.from('seasons').insert([row]);
    if (error) { alert('Failed to add season: ' + error.message); return; }

    document.getElementById('season-form').reset();
    document.getElementById('season-year').value = new Date().getFullYear();
    onSeasonScopeChange();
    seasonsCache = [];
    await ensureSeasons();
    renderSeasonsList();
}

// --- LEADERBOARD ---
let lbData = null; // { scans, activities, profiles }

function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function populateLbDepartments() {
    const sel = document.getElementById('lb-department');
    if (sel.options.length) return;
    sel.innerHTML = '<option value="">All departments (total)</option>' +
        Object.entries(DEPARTMENTS).map(([id, name]) => `<option value="${id}">${name}</option>`).join('');
}

window.openLeaderboard = async () => {
    document.getElementById('event-creation').style.display = 'none';
    document.getElementById('manage-section').style.display = 'none';
    document.getElementById('leaderboard-section').style.display = 'block';
    populateLbDepartments();
    await ensureSeasons();
    populateLbSeasons();
    await loadLeaderboard();
};

function populateLbSeasons() {
    const sel = document.getElementById('lb-season');
    sel.innerHTML = '<option value="">All time</option>' +
        seasonsCache.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
}

async function onLbSeasonChange() {
    const seasonId = document.getElementById('lb-season').value;
    const s = seasonsCache.find(x => x.id === seasonId);
    if (s && s.archived_at) {
        await renderArchivedLeaderboard(s);
    } else {
        // Live season (e.g. a trimester window) can still be sliced by the
        // department dropdown — so each ฝ่ายอุป can pull its own ranking.
        renderLeaderboard();
    }
}

async function renderArchivedLeaderboard(s) {
    lastLbLabel = `${s.name} · ${s.start_date} → ${s.end_date} · archived`;
    document.getElementById('lb-scope-label').textContent =
        `${s.name} · ${s.start_date} → ${s.end_date} · 🔒 archived`;
    const table = document.getElementById('leaderboard-table');
    table.innerHTML = '<p style="font-size:0.9rem;">Loading…</p>';

    const { data, error } = await supabase
        .from('season_results')
        .select('full_name, email, points')
        .eq('season_id', s.id)
        .order('points', { ascending: false });

    if (error) {
        table.innerHTML = `<p style="color:var(--accent-danger);">${error.message}</p>`;
        return;
    }
    renderLbTable(table, (data || []).map(r => ({ name: r.full_name || '(unknown)', email: r.email || '—', points: r.points })));
}

let lastLbRows = [];
let lastLbLabel = 'leaderboard';

function renderLbTable(table, rows) {
    lastLbRows = rows;
    if (!rows.length) {
        table.innerHTML = '<p style="font-size:0.9rem;">No points recorded for this scope yet.</p>';
        return;
    }
    table.innerHTML = `
      <table class="lb-table">
        <thead><tr><th>#</th><th>Name</th><th>Email</th><th>Points</th></tr></thead>
        <tbody>
          ${rows.map((r, i) => `
            <tr>
              <td>${i + 1}</td>
              <td>${escapeHtml(r.name)}</td>
              <td class="lb-email">${escapeHtml(r.email)}</td>
              <td class="lb-points">${r.points}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;
}

window.closeLeaderboard = () => {
    document.getElementById('leaderboard-section').style.display = 'none';
    document.getElementById('event-creation').style.display = 'block';
    document.getElementById('manage-section').style.display = 'block';
};

function onLbDeptChange() {
    const dept = document.getElementById('lb-department').value;
    const subSel = document.getElementById('lb-subdepartment');
    const options = SUB_DEPT_OPTIONS[dept];
    if (options) {
        subSel.innerHTML = '<option value="">All sub-departments</option>' +
            options.map(o => `<option value="${o.value}">${o.label}</option>`).join('');
        subSel.style.display = '';
    } else {
        subSel.innerHTML = '';
        subSel.style.display = 'none';
    }
    onLbSeasonChange(); // archived-aware refresh
}

async function loadLeaderboard() {
    const table = document.getElementById('leaderboard-table');
    table.innerHTML = '<p style="font-size:0.9rem;">Loading…</p>';

    const [{ data: scans, error: e1 }, { data: activities, error: e2 }, { data: profiles, error: e3 }] =
        await Promise.all([
            supabase.from('scans').select('user_id, activity_id, points_awarded, scanned_at'),
            supabase.from('activities').select('id, department_id, sub_department_id, base_points_km'),
            supabase.from('profiles').select('id, full_name, email'),
        ]);

    if (e1 || e2 || e3) {
        table.innerHTML = `<p style="color:var(--accent-danger);">Could not load leaderboard: ${(e1 || e2 || e3).message}</p>`;
        return;
    }

    lbData = { scans: scans || [], activities: activities || [], profiles: profiles || [] };
    renderLeaderboard();
}

function renderLeaderboard() {
    if (!lbData) return;
    let startDate = null, endDate = null;

    // Department/sub-department come from the dropdowns…
    const deptRaw = document.getElementById('lb-department').value;
    const subRaw = document.getElementById('lb-subdepartment').value;
    let deptId = deptRaw ? parseInt(deptRaw, 10) : null;
    let subId = subRaw ? parseInt(subRaw, 10) : null;

    // …and a selected season adds its date window (and locks the scope if it's
    // a department/sub-department season).
    const s = seasonsCache.find(x => x.id === document.getElementById('lb-season').value);
    let label;
    if (s) {
        startDate = s.start_date;
        endDate = s.end_date;
        if (s.scope === 'department') deptId = s.scope_id;
        else if (s.scope === 'subdepartment') subId = s.scope_id;
        const deptPart = deptId ? ` · ${DEPARTMENTS[deptId] || ''}` : '';
        label = `${s.name} · ${s.start_date} → ${s.end_date}${deptPart}`;
    } else {
        label = deptId
            ? `${DEPARTMENTS[deptId]}${subId ? ' — sub-department' : ''}`
            : 'All departments (overall total)';
    }

    document.getElementById('lb-scope-label').textContent = label;
    lastLbLabel = label;

    const rows = aggregateLeaderboard(lbData.scans, lbData.activities, lbData.profiles, deptId, subId, startDate, endDate);
    renderLbTable(document.getElementById('leaderboard-table'), rows);
}

function downloadLeaderboardCsv() {
    if (!lastLbRows.length) { alert('Nothing to export.'); return; }
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['Rank', 'Name', 'Email', 'Points'].map(esc).join(',')];
    lastLbRows.forEach((r, i) => lines.push([i + 1, r.name, r.email, r.points].map(esc).join(',')));
    // BOM so Excel reads UTF-8 (Thai names) correctly.
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `leaderboard-${(lastLbLabel || 'all').replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 40)}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

init();
