// js/admin-page.js — Admin terminal logic
import { supabase } from './app.js';
import { generateUUID } from './utils.js';
import { ROUTES } from './routes.js';
import { renderCertificate, loadCertImage, CERT_FONTS } from './certificate.js';
import { uploadToDrive, isUploadConfigured } from './upload.js';

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
function aggregateLeaderboard(scans, activities, profiles, deptId, subId) {
    const actMap = new Map(activities.map(a => [a.id, a]));
    const profMap = new Map(profiles.map(p => [p.id, p]));
    const totals = new Map();

    scans.forEach(s => {
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
    document.getElementById('lb-department').addEventListener('change', onLbDeptChange);
    document.getElementById('lb-subdepartment').addEventListener('change', renderLeaderboard);

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

    const { error } = await supabase
        .from('certificates')
        .insert([{ activity_id: certActivityId, ...cert }]);

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
    await loadLeaderboard();
};

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
    renderLeaderboard();
}

async function loadLeaderboard() {
    const table = document.getElementById('leaderboard-table');
    table.innerHTML = '<p style="font-size:0.9rem;">Loading…</p>';

    const [{ data: scans, error: e1 }, { data: activities, error: e2 }, { data: profiles, error: e3 }] =
        await Promise.all([
            supabase.from('scans').select('user_id, activity_id, points_awarded'),
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
    const deptRaw = document.getElementById('lb-department').value;
    const subRaw = document.getElementById('lb-subdepartment').value;
    const deptId = deptRaw ? parseInt(deptRaw, 10) : null;
    const subId = subRaw ? parseInt(subRaw, 10) : null;

    document.getElementById('lb-scope-label').textContent = deptId
        ? `${DEPARTMENTS[deptId]}${subId ? ' — sub-department' : ''}`
        : 'All departments (overall total)';

    const rows = aggregateLeaderboard(lbData.scans, lbData.activities, lbData.profiles, deptId, subId);
    const table = document.getElementById('leaderboard-table');

    if (rows.length === 0) {
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

init();
