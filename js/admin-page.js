// js/admin-page.js — Admin terminal logic
import { supabase } from './app.js';
import { generateUUID } from './utils.js';
import { ROUTES } from './routes.js';
import { renderCertificate, loadCertImage, CERT_FONTS } from './certificate.js';
import { uploadToDrive, deleteFromDrive, deleteFromDriveBeacon, isUploadConfigured } from './upload.js';
import { getCurrentContext } from './samo.js';

// --- ORPHANED-UPLOAD TRACKING ---
// Images upload to Drive immediately (so the preview/QR works), but if the admin
// never saves the activity/certificate that image would silently burn storage.
// We track every upload as "uncommitted" until a save uses it, and clean up the
// rest on cancel, on replacement, and when the tab closes.
const pendingUploads = new Map(); // inputId -> last uploaded (uncommitted) url
const uncommittedUploads = new Set();

function commitUpload(url) {
    if (!url) return;
    uncommittedUploads.delete(url);
    for (const [k, v] of pendingUploads) if (v === url) pendingUploads.delete(k);
}

function discardPendingUpload(inputId) {
    const url = pendingUploads.get(inputId);
    if (!url) return;
    uncommittedUploads.delete(url);
    pendingUploads.delete(inputId);
    deleteFromDrive(url);
    const el = document.getElementById(inputId);
    if (el && el.value === url) el.value = '';
}

const CERT_SAMPLE_NAME = 'ชื่อ นามสกุล';

const DEPARTMENTS = {
    1: 'อุปนายกฝ่ายบริหารองค์กร', 2: 'ดิจิทัลและสื่อสารองค์กร', 3: 'กิจการภายใน',
    4: 'กิจการภายนอก', 5: 'กิจการมหาวิทยาลัย', 6: 'วิชาการ',
    7: 'ยุทธศาสตร์และพัฒนาองค์กร', 8: 'คุณภาพชีวิตและสิ่งแวดล้อม',
    9: 'เวชนิทัศน์', 10: 'รังสีเทคนิค',
};

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

    // Clean up any uploaded-but-unsaved images when the tab closes.
    window.addEventListener('pagehide', () => {
        uncommittedUploads.forEach(url => deleteFromDriveBeacon(url));
    });

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
    setupCertSliders();

    // Drag-drop / click upload for image URL fields (if a GAS endpoint is set)
    wireUpload('act-badge-url', 'badges');
    wireUpload('edit-badge-url', 'badges');
    wireUpload('cert-bg-url', 'certificates');

    // Leaderboard filters (period = SamoYear → Season, + department/sub-dept)
    document.getElementById('lb-year').addEventListener('change', () => { populateLbSeasonsForYear(); renderAdminLeaderboard(); });
    document.getElementById('lb-season').addEventListener('change', renderAdminLeaderboard);
    document.getElementById('lb-department').addEventListener('change', onLbDeptChange);
    document.getElementById('lb-subdepartment').addEventListener('change', renderAdminLeaderboard);
    document.getElementById('lb-csv-btn').addEventListener('click', downloadLeaderboardCsv);

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
    discardPendingUpload('edit-badge-url'); // drop an uploaded-but-unsaved badge
    document.getElementById('edit-section').style.display = 'none';
    document.getElementById('event-creation').style.display = 'block';
    document.getElementById('manage-section').style.display = 'block';
};

window.deleteActivity = async (id) => {
    if (
        !confirm(
            'Delete this activity?\n\nIt disappears from the admin list and can no longer be scanned, but everyone who already earned it KEEPS their points, flight-log entry, and certificate (history is immutable).',
        )
    )
        return;

    // Only the badge image is removed from Drive — certificate backgrounds stay,
    // because past earners can still download those certificates. Scans + cert
    // templates are intentionally NOT deleted (they're frozen history; the DB FKs
    // were dropped in migration 0006 so the activity row can go without them).
    const { data: actRow } = await supabase.from('activities').select('badge_url').eq('id', id).single();

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
        if (actRow?.badge_url) deleteFromDrive(actRow.badge_url); // best-effort
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

    // 2. Update earned scans for the CURRENT season only — past seasons/years are
    //    frozen and must never change. Re-sync the snapshot (points + name + dept)
    //    so the current วาระ reflects the edit; older scans keep their old values.
    const { season } = await getCurrentContext().catch(() => ({ season: null }));
    if (season) {
        await supabase
            .from('scans')
            .update({ points_awarded: km, activity_name: name, department_id: dept, sub_department_id: subDept })
            .eq('activity_id', editingActivityId)
            .eq('season_id', season.id);
    }

    commitUpload(badge_url); // image is now attached to a saved activity
    alert(season
        ? 'Activity updated. Current-season points were re-synced; past seasons stay frozen.'
        : 'Activity updated. (No current season is active, so no earned scans changed.)');
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
    commitUpload(badge_url); // image is now attached to a saved activity
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
let editingCertId = null;       // null = adding; otherwise editing this cert
let certListCache = [];         // last-loaded certs for the open activity
let certCurrentSeason = null;   // the open season while managing certs
let certSeasonNames = new Map();// season_id -> name (for frozen-cert labels)

// New certs/edits attach to the current season; past-season certs are frozen.
async function loadCertSeasonContext() {
    const { season } = await getCurrentContext().catch(() => ({ season: null }));
    certCurrentSeason = season;
    const { data } = await supabase.from('samo_seasons').select('id, name');
    certSeasonNames = new Map((data || []).map(s => [s.id, s.name]));
}
const certEditable = (c) => !c.season_id || c.season_id === (certCurrentSeason?.id || null);

function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// Toggle the form between "Add" and "Edit existing" presentation.
function updateCertFormMode() {
    const editing = !!editingCertId;
    document.getElementById('cert-submit-btn').textContent = editing ? '💾 Save changes' : 'Add Certificate';
    document.getElementById('cert-edit-cancel').style.display = editing ? '' : 'none';
    document.getElementById('cert-form-heading').textContent = editing ? '✏️ Edit certificate' : 'Add a certificate';
}

window.manageCerts = async (id) => {
    const act = activitiesCache.find(a => a.id === id);
    certActivityId = id;
    document.getElementById('cert-activity-name').textContent = act ? act.name : '';

    document.getElementById('event-creation').style.display = 'none';
    document.getElementById('manage-section').style.display = 'none';
    document.getElementById('cert-section').style.display = 'block';

    editingCertId = null;
    document.getElementById('cert-form').reset();
    updateCertFormMode();
    previewImg = null; previewImgUrl = '';
    renderCertPreview();
    await loadCertSeasonContext();
    loadCerts(id);
};

window.closeCerts = () => {
    certActivityId = null;
    editingCertId = null;
    discardPendingUpload('cert-bg-url'); // drop an uploaded-but-unsaved background
    document.getElementById('cert-section').style.display = 'none';
    document.getElementById('event-creation').style.display = 'block';
    document.getElementById('manage-section').style.display = 'block';
};

// Load an existing certificate's settings into the form for editing.
window.editCert = (id) => {
    const c = certListCache.find(x => x.id === id);
    if (!c) return;
    if (!certEditable(c)) {
        alert('This certificate belongs to a past season and is frozen (so past earners keep it). Use "Duplicate to current season" to make an editable copy.');
        return;
    }
    editingCertId = id;
    document.getElementById('cert-label').value = c.label || '';
    document.getElementById('cert-bg-url').value = c.background_url || '';
    document.getElementById('cert-font').value = c.font_family || 'Sarabun';
    document.getElementById('cert-font-color').value = c.font_color || '#1f2d3d';
    setCertControl('cert-font-size', c.font_size ?? 6);
    setCertControl('cert-name-x', c.name_x ?? 50);
    setCertControl('cert-name-y', c.name_y ?? 52);
    updateCertFormMode();
    previewImg = null; previewImgUrl = '';
    renderCertPreview();
    document.getElementById('cert-form-heading').scrollIntoView({ behavior: 'smooth', block: 'start' });
};

window.cancelCertEdit = () => {
    editingCertId = null;
    document.getElementById('cert-form').reset();
    updateCertFormMode();
    renderCertPreview();
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

    certListCache = data || [];

    if (!data || data.length === 0) {
        list.innerHTML = '<p style="font-size:0.9rem;">No certificates yet for this activity.</p>';
        return;
    }

    const curId = certCurrentSeason?.id || null;
    const seasonLabel = (sid) => sid ? (certSeasonNames.get(sid) || 'season') : 'Default (any season)';

    list.innerHTML = certListCache.map(c => {
        const editable = certEditable(c);
        let tag;
        if (!c.season_id) tag = '<span class="cert-season-tag">Default</span>';
        else if (c.season_id === curId) tag = `<span class="cert-season-tag cur">${escapeHtml(seasonLabel(c.season_id))} · current</span>`;
        else tag = `<span class="cert-season-tag frozen">🔒 ${escapeHtml(seasonLabel(c.season_id))}</span>`;

        const actions = editable
            ? `<button onclick="editCert('${c.id}')" class="btn-action btn-edit">Edit</button>
               <button onclick="deleteCert('${c.id}')" class="btn-action btn-delete">Delete</button>`
            : `<button onclick="duplicateCertToCurrent('${c.id}')" class="btn-action">Duplicate to current season</button>`;

        return `<div class="cert-list-item${c.id === editingCertId ? ' cert-editing' : ''}">
            <span class="cert-list-label">${escapeHtml(c.label)} ${tag}</span>
            <span class="cert-actions">${actions}</span>
          </div>`;
    }).join('');
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

// Clone a (frozen, other-season) cert into the current season as an editable copy.
window.duplicateCertToCurrent = async (id) => {
    const c = certListCache.find(x => x.id === id);
    if (!c) return;
    const payload = {
        activity_id: c.activity_id,
        label: c.label,
        background_url: c.background_url,
        name_x: c.name_x, name_y: c.name_y,
        font_size: c.font_size, font_color: c.font_color, font_family: c.font_family,
        season_id: certCurrentSeason?.id || null,
    };
    let { error } = await supabase.from('certificates').insert([payload]);
    if (error && /font_family/.test(error.message || '')) {
        const { font_family, ...rest } = payload;
        ({ error } = await supabase.from('certificates').insert([rest]));
    }
    if (error) { alert('Duplicate failed: ' + error.message); return; }
    loadCerts(certActivityId);
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
    const groups = {};
    CERT_FONTS.forEach(f => { (groups[f.group || 'Fonts'] ||= []).push(f); });
    sel.innerHTML = Object.entries(groups).map(([g, fonts]) =>
        `<optgroup label="${g}">` +
        fonts.map(f => `<option value="${f.value}">${f.label}</option>`).join('') +
        '</optgroup>'
    ).join('');
}

// Cache the loaded background so dragging the name is instant (no re-fetch).
let previewImg = null;
let previewImgUrl = '';

async function renderCertPreview() {
    const canvas = document.getElementById('cert-preview');
    const hint = document.getElementById('cert-preview-hint');
    const tip = document.getElementById('cert-preview-tip');
    const cert = getCertFormValues();

    // Keep slider value-labels + ranges in step with the number inputs (e.g.
    // after the form resets to its defaults).
    ['cert-font-size', 'cert-name-x', 'cert-name-y'].forEach(id => {
        setCertControl(id, document.getElementById(id).value);
    });

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

// Keep a slider's number box, range, and the live "NN%" label in sync.
function setCertControl(numId, value) {
    const num = document.getElementById(numId);
    if (num) num.value = value;
    const range = document.getElementById(numId + '-range');
    if (range) range.value = value;
    const lbl = document.getElementById(numId + '-val');
    if (lbl) lbl.textContent = value + '%';
}

// Touch-friendly placement: drag the sliders (no type-delete-type on iPad).
function setupCertSliders() {
    [['cert-font-size-range', 'cert-font-size'],
     ['cert-name-x-range', 'cert-name-x'],
     ['cert-name-y-range', 'cert-name-y']].forEach(([rangeId, numId]) => {
        const range = document.getElementById(rangeId);
        const num = document.getElementById(numId);
        if (!range || !num) return;
        range.addEventListener('input', () => { setCertControl(numId, range.value); renderCertPreview(); });
        num.addEventListener('input', () => { setCertControl(numId, num.value); });
        num.addEventListener('focus', () => num.select()); // tap selects all — easy retype
    });
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
        setCertControl('cert-name-x', Math.round(x));
        setCertControl('cert-name-y', Math.round(y));
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

    // Update the existing cert when editing, otherwise insert a new one stamped
    // with the CURRENT season (so it only applies to this season's earners).
    const insertExtras = { activity_id: certActivityId, season_id: certCurrentSeason?.id ?? null };
    const run = (payload) => editingCertId
        ? supabase.from('certificates').update(payload).eq('id', editingCertId)
        : supabase.from('certificates').insert([{ ...insertExtras, ...payload }]);

    let { error } = await run(cert);
    // Drop optional columns the DB may not have yet (migration not run), then retry.
    if (error && /season_id|font_family|column|schema cache/i.test(error.message || '')) {
        const { font_family, ...rest } = cert;
        delete insertExtras.season_id;
        ({ error } = await run(rest));
    }

    if (error) {
        alert((editingCertId ? 'Failed to save changes: ' : 'Failed to add certificate: ') + error.message);
        return;
    }

    commitUpload(cert.background_url); // background is now attached to a saved cert
    editingCertId = null;
    document.getElementById('cert-form').reset();
    updateCertFormMode();
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

    // Wrap the URL field + upload button in a single flex row. (The button used
    // to be injected as a bare sibling after a full-width input, so it floated
    // off to the side and looked detached.) Drop the now-redundant trailing <br>.
    const trailingBr = input.nextElementSibling && input.nextElementSibling.tagName === 'BR'
        ? input.nextElementSibling : null;
    const row = document.createElement('div');
    row.className = 'upload-row';
    input.parentNode.insertBefore(row, input);
    row.appendChild(input);
    row.appendChild(btn);
    row.appendChild(picker);
    if (trailingBr) trailingBr.remove();

    const doUpload = async (file) => {
        if (!file) return;
        const old = btn.textContent;
        btn.disabled = true;
        btn.textContent = '⏳ Uploading…';
        try {
            const url = await uploadToDrive(file, folder);
            // A previous uncommitted upload in this same field is now orphaned.
            const prev = pendingUploads.get(inputId);
            if (prev && prev !== url) { uncommittedUploads.delete(prev); deleteFromDrive(prev); }
            pendingUploads.set(inputId, url);
            uncommittedUploads.add(url);
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

// --- วาระสโม (SamoYear) & SEASON CONTROL ---
const SUBDEPARTMENTS = { 1: 'โครงการ', 2: 'ชุมนุม', 3: 'จิตอาสา', 4: '7 คณะ' };

let samoYears = [];
let samoSeasons = [];

function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

async function loadSamoData() {
    const [{ data: ys }, { data: ss }] = await Promise.all([
        supabase.from('samo_years').select('*').order('started_at', { ascending: false }),
        supabase.from('samo_seasons').select('*').order('started_at', { ascending: false }),
    ]);
    samoYears = ys || [];
    samoSeasons = ss || [];
}

const currentYearRow = () => samoYears.find(y => !y.ended_at) || null;
const currentSeasonRow = () => {
    const y = currentYearRow();
    return y ? (samoSeasons.find(s => !s.ended_at && s.samo_year_id === y.id) || null) : null;
};
const seasonsOfYear = (yId) => samoSeasons.filter(s => s.samo_year_id === yId);
const fmtDate = (ts) => ts ? new Date(ts).toLocaleDateString() : '';

window.openSeasons = async () => {
    document.getElementById('event-creation').style.display = 'none';
    document.getElementById('manage-section').style.display = 'none';
    document.getElementById('seasons-section').style.display = 'block';
    await loadSamoData();
    renderSamoControl();
};

window.closeSeasons = () => {
    document.getElementById('seasons-section').style.display = 'none';
    document.getElementById('event-creation').style.display = 'block';
    document.getElementById('manage-section').style.display = 'block';
};

function renderSamoControl() {
    const y = currentYearRow();
    const s = currentSeasonRow();
    document.getElementById('samo-current').innerHTML = `
      <div class="samo-card">
        <div class="samo-row">
          <div class="samo-row-info">
            <span class="samo-label">Current วาระสโม</span>
            <strong class="samo-value">${y ? escapeHtml(y.name) : '— none yet —'}</strong>
            ${y ? `<small>since ${fmtDate(y.started_at)}</small>` : ''}
          </div>
          <button class="btn-action" onclick="startNewYear()">＋ New วาระสโม</button>
        </div>
        <div class="samo-row">
          <div class="samo-row-info">
            <span class="samo-label">Current Season</span>
            <strong class="samo-value">${s ? escapeHtml(s.name) : '— none yet —'}</strong>
            ${s ? `<small>since ${fmtDate(s.started_at)}</small>` : ''}
          </div>
          <button class="btn-action" onclick="startNewSeason()" ${y ? '' : 'disabled'}>＋ New Season</button>
        </div>
      </div>`;
    renderSamoHistory();
}

function renderSamoHistory() {
    const box = document.getElementById('samo-history');
    if (!samoYears.length) {
        box.innerHTML = '<p style="font-size:0.9rem;">No วาระสโม yet — start one above.</p>';
        return;
    }
    box.innerHTML = samoYears.map(y => {
        const seasons = seasonsOfYear(y.id);
        const cur = !y.ended_at;
        const seasonHtml = seasons.length
            ? seasons.map(s => `<div class="samo-hist-season">${escapeHtml(s.name)} ${!s.ended_at
                ? '<span class="samo-badge">current</span>'
                : `<small>${fmtDate(s.started_at)} → ${fmtDate(s.ended_at)}</small>`}</div>`).join('')
            : '<div class="samo-hist-season" style="opacity:.55;">(no seasons)</div>';
        return `<div class="samo-hist-year">
            <div class="samo-hist-head"><strong>${escapeHtml(y.name)}</strong> ${cur
                ? '<span class="samo-badge">current</span>'
                : `<small>ended ${fmtDate(y.ended_at)}</small>`}</div>
            ${seasonHtml}
          </div>`;
    }).join('');
}

window.startNewYear = async () => {
    const name = (prompt("Name the new วาระสโม (e.g. วาระสโม'69):") || '').trim();
    if (!name) return;
    if (!confirm(`Start "${name}"?\n\nThis ENDS the current วาระสโม + season and resets the live leaderboard and current-year totals. All past logs and standings are kept.`)) return;
    const now = new Date().toISOString();
    await supabase.from('samo_seasons').update({ ended_at: now }).is('ended_at', null);
    await supabase.from('samo_years').update({ ended_at: now }).is('ended_at', null);
    const { error } = await supabase.from('samo_years').insert([{ name }]);
    if (error) { alert('Failed: ' + error.message); return; }
    await loadSamoData();
    renderSamoControl();
    alert(`Started "${name}". Now start its first season (e.g. Q1).`);
};

window.startNewSeason = async () => {
    const y = currentYearRow();
    if (!y) { alert('Start a วาระสโม first.'); return; }
    const name = (prompt('Name the new Season (e.g. Q1):') || '').trim();
    if (!name) return;
    if (!confirm(`Start season "${name}" under ${y.name}?\n\nThis ENDS the current season and resets the live leaderboard. The previous season's standings stay viewable.`)) return;
    const now = new Date().toISOString();
    await supabase.from('samo_seasons').update({ ended_at: now }).is('ended_at', null).eq('samo_year_id', y.id);
    const { error } = await supabase.from('samo_seasons').insert([{ samo_year_id: y.id, name }]);
    if (error) { alert('Failed: ' + error.message); return; }
    await loadSamoData();
    renderSamoControl();
};

// --- LEADERBOARD (period view over immutable, stamped scans) ---
let lbScans = null;
let lbProfiles = null;

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
    await loadSamoData();
    const ok = await ensureLbScans();
    populateLbYears();
    if (ok) renderAdminLeaderboard();
};

window.closeLeaderboard = () => {
    document.getElementById('leaderboard-section').style.display = 'none';
    document.getElementById('event-creation').style.display = 'block';
    document.getElementById('manage-section').style.display = 'block';
};

async function ensureLbScans() {
    if (lbScans) return true;
    const table = document.getElementById('leaderboard-table');
    table.innerHTML = '<p style="font-size:0.9rem;">Loading…</p>';
    const [{ data: scans, error: e1 }, { data: profiles, error: e2 }] = await Promise.all([
        supabase.from('scans').select('user_id, points_awarded, samo_year_id, season_id, department_id, sub_department_id'),
        supabase.from('profiles').select('id, full_name, email'),
    ]);
    if (e1 || e2) {
        table.innerHTML = `<p style="color:var(--accent-danger);">Could not load leaderboard: ${(e1 || e2).message}</p>`;
        return false;
    }
    lbScans = scans || [];
    lbProfiles = new Map((profiles || []).map(p => [p.id, p]));
    return true;
}

function populateLbYears() {
    const sel = document.getElementById('lb-year');
    sel.innerHTML = samoYears.length
        ? samoYears.map(y => `<option value="${y.id}">${escapeHtml(y.name)}${!y.ended_at ? ' (current)' : ''}</option>`).join('')
        : '<option value="">(no วาระสโม yet)</option>';
    populateLbSeasonsForYear();
}

function populateLbSeasonsForYear() {
    const yId = document.getElementById('lb-year').value;
    const sel = document.getElementById('lb-season');
    sel.innerHTML = '<option value="">Whole วาระสโม (total)</option>' +
        seasonsOfYear(yId).map(s => `<option value="${s.id}">${escapeHtml(s.name)}${!s.ended_at ? ' (current)' : ''}</option>`).join('');
}

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
    renderAdminLeaderboard();
}

// Aggregate over stamped scans (immutable snapshots — survives activity deletion).
function adminAggregate(yearId, seasonId, deptId, subId) {
    const totals = new Map();
    (lbScans || []).forEach(s => {
        if (yearId && s.samo_year_id !== yearId) return;
        if (seasonId && s.season_id !== seasonId) return;
        if (deptId && s.department_id !== deptId) return;
        if (subId && s.sub_department_id !== subId) return;
        totals.set(s.user_id, (totals.get(s.user_id) || 0) + (s.points_awarded || 0));
    });
    return [...totals.entries()].map(([userId, points]) => {
        const p = lbProfiles.get(userId);
        return { userId, points, name: p?.full_name || '(unknown)', email: p?.email || '—' };
    }).sort((a, b) => b.points - a.points);
}

let lastLbRows = [];
let lastLbLabel = 'leaderboard';

function renderAdminLeaderboard() {
    if (!lbScans) return;
    const yId = document.getElementById('lb-year').value || null;
    const sId = document.getElementById('lb-season').value || null;
    const deptRaw = document.getElementById('lb-department').value;
    const subRaw = document.getElementById('lb-subdepartment').value;
    const deptId = deptRaw ? parseInt(deptRaw, 10) : null;
    const subId = subRaw ? parseInt(subRaw, 10) : null;

    const y = samoYears.find(x => x.id === yId);
    const s = samoSeasons.find(x => x.id === sId);
    const label = `${y ? y.name : '—'} · ${s ? s.name : 'whole วาระ'}${deptId ? ' · ' + DEPARTMENTS[deptId] : ''}${subId ? ' · ' + SUBDEPARTMENTS[subId] : ''}`;
    document.getElementById('lb-scope-label').textContent = label;
    lastLbLabel = label;

    renderLbTable(document.getElementById('leaderboard-table'), adminAggregate(yId, sId, deptId, subId));
}

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
