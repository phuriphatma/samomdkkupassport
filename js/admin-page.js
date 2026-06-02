// js/admin-page.js — Admin terminal logic
import { supabase } from './app.js';
import { generateUUID } from './utils.js';
import { ROUTES } from './routes.js';

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

    activitiesCache.forEach((act) => {
        // Apply filters
        if (filterDept && act.department_id !== parseInt(filterDept, 10)) {
            return;
        }
        if (filterSubDept && act.sub_department_id !== parseInt(filterSubDept, 10)) {
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

init();
