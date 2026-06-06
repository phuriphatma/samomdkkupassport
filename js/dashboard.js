// js/dashboard.js — Passport ebook with memory popup
import { supabase } from './app.js';
import { checkSession, logout } from './auth.js';
import { fixGoogleDriveUrl, getPendingScanUrl, clearPendingScanUrl } from './utils.js';
import { renderCertificate, downloadCanvasPng } from './certificate.js';
import { ROUTES } from './routes.js';

// ─── State ───────────────────────────────────────────────
let currentPageIndex = 0;
let totalPages = 2; // cover + info (stamp pages added dynamically)
let currentUserId = null;
let currentUserName = '';
let currentModalActivity = null;
let currentModalScan = null;
const certsByActivity = new Map(); // activity_id -> [certificate, ...]
const allStamps = []; // flat registry for search: { activity, isActive, scan }
let userScansCache = [];
const activityById = new Map();
let seasonsList = [];
const archivedResults = new Map(); // season_id -> this user's archived points

const DEPARTMENTS = {
    1: 'อุปนายกฝ่ายบริหารองค์กร', 2: 'ดิจิทัลและสื่อสารองค์กร', 3: 'กิจการภายใน',
    4: 'กิจการภายนอก', 5: 'กิจการมหาวิทยาลัย', 6: 'วิชาการ',
    7: 'ยุทธศาสตร์และพัฒนาองค์กร', 8: 'คุณภาพชีวิตและสิ่งแวดล้อม',
    9: 'เวชนิทัศน์', 10: 'รังสีเทคนิค',
};
const SUBDEPARTMENTS = { 1: 'โครงการ', 2: 'ชุมนุม', 3: 'จิตอาสา', 4: '7 คณะ' };

const STAMPS_PER_PAGE = 12; // 3-col × 4-row grid

// ─── Page navigation ─────────────────────────────────────
function goToPage(idx) {
    const pages = document.querySelectorAll('.passport-page');
    pages.forEach((p, i) => {
        p.style.display = i === idx ? '' : 'none';
    });
    currentPageIndex = idx;

    document.getElementById('prev-page').disabled = idx === 0;
    document.getElementById('next-page').disabled = idx === totalPages - 1;

    document.querySelectorAll('.page-dot').forEach((dot, i) => {
        dot.classList.toggle('active', i === idx);
    });
}

function buildPageDots() {
    const row = document.getElementById('page-dots');
    row.innerHTML = '';
    for (let i = 0; i < totalPages; i++) {
        const dot = document.createElement('button');
        dot.className = 'page-dot' + (i === 0 ? ' active' : '');
        dot.setAttribute('aria-label', `Page ${i + 1}`);
        dot.addEventListener('click', () => goToPage(i));
        row.appendChild(dot);
    }
}

// ─── Stamp pages ──────────────────────────────────────────
function buildStampPages(allActivities, userScans) {
    const scannedIds = new Set(userScans.map(s => s.activity_id));
    // Only show stamps the student has actually earned (scanned). Locked/unearned
    // activities are not displayed in the passport.
    const earned = allActivities.filter(a => scannedIds.has(a.id));
    const numStampPages = Math.ceil(earned.length / STAMPS_PER_PAGE);
    const book = document.getElementById('page-1').parentElement; // passport-container

    // Flat registry so users can search across all (earned) stamp pages
    allStamps.length = 0;
    earned.forEach((activity, i) => {
        allStamps.push({
            activity,
            isActive: true,
            scan: userScans.find(sc => sc.activity_id === activity.id),
            pageIndex: 2 + Math.floor(i / STAMPS_PER_PAGE), // page that holds this stamp
        });
    });

    // Activity stamp pages
    for (let p = 0; p < numStampPages; p++) {
        const pageActivities = earned.slice(p * STAMPS_PER_PAGE, (p + 1) * STAMPS_PER_PAGE);
        const globalPageIdx = 2 + p;
        const pageNumLabel = String(globalPageIdx).padStart(2, '0');

        const page = document.createElement('div');
        page.className = 'passport-page page-inner';
        page.id = `page-${globalPageIdx}`;
        page.style.display = 'none';

        page.innerHTML = `
            <div class="inner-page-watermark">🏅</div>
            <div class="inner-page-header">
                <span class="inner-page-label">STAMP COLLECTION</span>
                <span class="inner-page-num">${pageNumLabel}</span>
            </div>
            <div class="stamp-page-grid" id="stamp-grid-${p}"></div>
            <div class="inner-page-footer"><div class="barcode-lines"></div></div>
        `;

        book.appendChild(page);

        const grid = page.querySelector(`#stamp-grid-${p}`);

        for (let s = 0; s < STAMPS_PER_PAGE; s++) {
            const activity = pageActivities[s];
            const slot = document.createElement('div');

            if (!activity) {
                slot.className = 'stamp-slot blank';
                slot.innerHTML = `<div class="stamp-circle"></div><div class="stamp-name"></div>`;
                grid.appendChild(slot);
                continue;
            }

            const isActive = scannedIds.has(activity.id);
            const scan = userScans.find(sc => sc.activity_id === activity.id);

            slot.className = `stamp-slot ${isActive ? 'active' : 'inactive'}`;
            slot.setAttribute('data-activity-id', activity.id);

            const circle = document.createElement('div');
            circle.className = 'stamp-circle';

            if (activity.badge_url && isActive) {
                const img = document.createElement('img');
                img.src = fixGoogleDriveUrl(activity.badge_url);
                img.className = 'stamp-img';
                img.alt = activity.badge_name || activity.name;
                circle.appendChild(img);
            } else {
                const emoji = document.createElement('span');
                emoji.className = 'stamp-emoji-placeholder';
                emoji.textContent = isActive ? '✅' : '○';
                circle.appendChild(emoji);
            }

            const label = document.createElement('div');
            label.className = 'stamp-name';
            label.textContent = activity.badge_name || activity.name;

            slot.appendChild(circle);
            slot.appendChild(label);

            slot.addEventListener('click', () => {
                if (isActive) openMemoryModal(activity, scan);
                else openLockedModal(activity);
            });

            grid.appendChild(slot);
        }
    }

    // Future stamps page — always present
    const futureIdx = 2 + numStampPages;
    const futurePage = document.createElement('div');
    futurePage.className = 'passport-page page-inner';
    futurePage.id = `page-${futureIdx}`;
    futurePage.style.display = 'none';
    const futureGrid = Array(STAMPS_PER_PAGE)
        .fill('<div class="stamp-slot blank"><div class="stamp-circle"></div><div class="stamp-name"></div></div>')
        .join('');
    futurePage.innerHTML = `
        <div class="inner-page-watermark">⭐</div>
        <div class="inner-page-header">
            <span class="inner-page-label">FUTURE STAMPS</span>
            <span class="inner-page-num">—</span>
        </div>
        <div class="stamp-page-grid">${futureGrid}</div>
        <div class="inner-page-footer"><div class="barcode-lines"></div></div>
    `;
    book.appendChild(futurePage);

    // Back cover — always last
    const backIdx = 2 + numStampPages + 1;
    const backCover = document.createElement('div');
    backCover.className = 'passport-page page-back-cover';
    backCover.id = `page-${backIdx}`;
    backCover.style.display = 'none';
    backCover.innerHTML = `
        <div class="page-cover-inner">
            <div class="cover-top-bar"></div>
            <div class="cover-emblem" style="opacity:0.3;">🌏</div>
            <div class="cover-title" style="opacity:0.2;font-size:1rem;letter-spacing:6px;">SAMO</div>
            <div class="cover-bottom-bar"></div>
        </div>
    `;
    book.appendChild(backCover);

    totalPages = 2 + numStampPages + 2; // +future +back cover
    buildPageDots();
    document.getElementById('next-page').disabled = totalPages <= 1;
}

// ─── Profile photo ─────────────────────────────────────────
function setupProfilePhoto(userId) {
    const box = document.getElementById('profile-photo-box');
    if (!box) return;

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    document.body.appendChild(input);

    const saved = localStorage.getItem(`profile_photo_${userId}`);
    if (saved) applyProfilePhoto(box, saved);

    box.addEventListener('click', () => input.click());
    input.addEventListener('change', function () {
        const file = this.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = e => {
            localStorage.setItem(`profile_photo_${userId}`, e.target.result);
            applyProfilePhoto(box, e.target.result);
        };
        reader.readAsDataURL(file);
        this.value = '';
    });
}

function applyProfilePhoto(box, dataUrl) {
    box.innerHTML = `<img src="${dataUrl}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:4px;">`;
}

// ─── Memory modal ─────────────────────────────────────────
function openMemoryModal(activity, scan) {
    currentModalActivity = activity;
    currentModalScan = scan;

    document.getElementById('modal-title').textContent = activity.name;
    const km = scan?.points_awarded ?? activity.base_points_km ?? 0;
    document.getElementById('modal-km').textContent = `+${km} km`;

    // Badge
    const wrap = document.getElementById('modal-badge-wrap');
    if (activity.badge_url) {
        wrap.innerHTML = `<img src="${fixGoogleDriveUrl(activity.badge_url)}" alt="${activity.name}">`;
    } else {
        wrap.innerHTML = `<span class="modal-badge-placeholder">🏅</span>`;
    }

    document.getElementById('modal-locked').style.display = 'none';

    populateCerts(activity.id);

    // If memory or photos exist → view card; otherwise → write form
    const savedText = localStorage.getItem(`mem_${currentUserId}_${activity.id}`) || '';
    const savedPhotos = JSON.parse(localStorage.getItem(`photos_${currentUserId}_${activity.id}`) || '[]');
    if (savedText || savedPhotos.length > 0) {
        showMemoryView(savedText, savedPhotos);
    } else {
        showMemoryWrite(activity.id);
    }

    showModal();
}

function openLockedModal(activity) {
    currentModalActivity = activity;
    currentModalScan = null;

    document.getElementById('modal-title').textContent = activity.name;
    const km = activity.base_points_km ?? 0;
    document.getElementById('modal-km').textContent = `+${km} km`;

    const wrap = document.getElementById('modal-badge-wrap');
    if (activity.badge_url) {
        wrap.innerHTML = `<img src="${fixGoogleDriveUrl(activity.badge_url)}" alt="${activity.name}" style="filter:grayscale(1);opacity:0.5;">`;
    } else {
        wrap.innerHTML = `<span class="modal-badge-placeholder" style="filter:grayscale(1);opacity:0.5;">🏅</span>`;
    }

    document.getElementById('modal-locked').style.display = '';
    document.getElementById('modal-body').style.display = 'none';
    document.getElementById('modal-view').style.display = 'none';
    document.getElementById('modal-certs').style.display = 'none';

    showModal();
}

// ─── Certificates ─────────────────────────────────────────
function populateCerts(activityId) {
    const section = document.getElementById('modal-certs');
    const list = document.getElementById('modal-certs-list');
    const certs = certsByActivity.get(activityId) || [];

    if (certs.length === 0) {
        section.style.display = 'none';
        return;
    }

    list.innerHTML = '';
    certs.forEach(cert => {
        const row = document.createElement('div');
        row.className = 'cert-row';

        const label = document.createElement('span');
        label.className = 'cert-row-label';
        label.textContent = cert.label;

        const viewBtn = document.createElement('button');
        viewBtn.className = 'cert-action-btn cert-view-btn';
        viewBtn.type = 'button';
        viewBtn.textContent = '👁 View';
        viewBtn.addEventListener('click', () => viewCert(cert, viewBtn));

        const dlBtn = document.createElement('button');
        dlBtn.className = 'cert-action-btn cert-download-btn';
        dlBtn.type = 'button';
        dlBtn.textContent = '⬇️ Download';
        dlBtn.addEventListener('click', () => generateAndDownloadCert(cert, dlBtn));

        row.appendChild(label);
        row.appendChild(viewBtn);
        row.appendChild(dlBtn);
        list.appendChild(row);
    });
    section.style.display = '';
}

async function buildCertCanvas(cert, btn) {
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⏳ …';
    try {
        const canvas = document.createElement('canvas');
        await renderCertificate(canvas, cert, currentUserName);
        return canvas;
    } finally {
        btn.disabled = false;
        btn.textContent = original;
    }
}

async function generateAndDownloadCert(cert, btn) {
    if (!currentUserName) { showToast('Your name is still loading — try again'); return; }
    try {
        const canvas = await buildCertCanvas(cert, btn);
        const clean = s => (s || '').replace(/[^\p{L}\p{N} _-]/gu, '').trim();
        const safeName = clean(currentUserName) || 'student';
        const safeLabel = clean(cert.label) || 'certificate';
        await downloadCanvasPng(canvas, `certificate-${safeLabel}-${safeName}.png`);
        showToast('Certificate downloaded ✓');
    } catch (err) {
        if (err.message === 'tainted') {
            showToast('Could not export — the background link must allow downloads (CORS)');
        } else {
            showToast(err.message || 'Could not generate certificate');
        }
    }
}

// View the certificate inline (works on iPad, where a `download` link won't open
// a preview). The image can be long-pressed to save to Photos.
async function viewCert(cert, btn) {
    if (!currentUserName) { showToast('Your name is still loading — try again'); return; }
    try {
        const canvas = await buildCertCanvas(cert, btn);
        let dataUrl;
        try { dataUrl = canvas.toDataURL('image/png'); }
        catch { showToast('Could not show — the background link must allow downloads (CORS)'); return; }
        showCertViewer(dataUrl);
    } catch (err) {
        showToast(err.message || 'Could not generate certificate');
    }
}

function showCertViewer(dataUrl) {
    let overlay = document.getElementById('cert-viewer');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'cert-viewer';
        overlay.className = 'cert-viewer';
        overlay.innerHTML = `
            <button class="cert-viewer-close" aria-label="Close">✕</button>
            <img class="cert-viewer-img" alt="Your certificate">
            <div class="cert-viewer-hint">Long-press the image to save it</div>`;
        document.body.appendChild(overlay);
        const close = () => { overlay.style.display = 'none'; };
        overlay.querySelector('.cert-viewer-close').addEventListener('click', close);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    }
    overlay.querySelector('.cert-viewer-img').src = dataUrl;
    overlay.style.display = 'flex';
}

function showMemoryView(text, photos) {
    document.getElementById('memory-modal').classList.add('view-mode');
    document.getElementById('modal-body').style.display = 'none';
    document.getElementById('modal-view').style.display = '';

    const textEl = document.getElementById('memory-view-text');
    textEl.textContent = text;
    textEl.style.display = text ? '' : 'none';

    const photosEl = document.getElementById('memory-view-photos');
    photosEl.innerHTML = '';
    photos.forEach(dataUrl => {
        const img = document.createElement('img');
        img.src = dataUrl;
        img.className = 'photo-thumb';
        photosEl.appendChild(img);
    });
    photosEl.style.display = photos.length > 0 ? '' : 'none';
}

function showMemoryWrite(activityId) {
    document.getElementById('memory-modal').classList.remove('view-mode');
    document.getElementById('modal-view').style.display = 'none';
    document.getElementById('modal-body').style.display = '';
    document.getElementById('modal-memory-text').value =
        localStorage.getItem(`mem_${currentUserId}_${activityId}`) || '';
    loadPhotoPreview(activityId);
}

// Keep any open modal sized to the *visible* viewport. When the on-screen
// keyboard opens on iOS/iPad, the layout viewport doesn't shrink — so a
// bottom-anchored modal gets pushed under the keyboard and its top clips.
// Pinning the modal to visualViewport.height/offsetTop keeps it on-screen.
function syncModalViewport() {
    const vv = window.visualViewport;
    if (!vv) return;
    document.querySelectorAll('.memory-modal').forEach(m => {
        if (m.style.display === 'flex') {
            m.style.height = vv.height + 'px';
            m.style.top = vv.offsetTop + 'px';
            m.style.bottom = 'auto';
        }
    });
}

function resetModalViewport(m) {
    m.style.height = '';
    m.style.top = '';
    m.style.bottom = '';
}

function showModal() {
    const modal = document.getElementById('memory-modal');
    modal.style.display = 'flex';
    syncModalViewport();
}

function closeModal() {
    const modal = document.getElementById('memory-modal');
    modal.style.display = 'none';
    modal.classList.remove('view-mode');
    resetModalViewport(modal);
    currentModalActivity = null;
    currentModalScan = null;
}

// ─── Photo handling ────────────────────────────────────────
function loadPhotoPreview(activityId) {
    const grid = document.getElementById('photo-preview-grid');
    const hint = document.getElementById('upload-hint');
    const photosKey = `photos_${currentUserId}_${activityId}`;
    const photos = JSON.parse(localStorage.getItem(photosKey) || '[]');

    grid.innerHTML = '';
    hint.style.display = photos.length === 0 ? '' : 'none';

    photos.forEach((dataUrl, idx) => {
        const wrap = document.createElement('div');
        wrap.className = 'photo-thumb-wrap';

        const img = document.createElement('img');
        img.src = dataUrl;
        img.className = 'photo-thumb';

        const removeBtn = document.createElement('button');
        removeBtn.className = 'photo-thumb-remove';
        removeBtn.textContent = '✕';
        removeBtn.onclick = (e) => {
            e.stopPropagation();
            const updated = JSON.parse(localStorage.getItem(photosKey) || '[]');
            updated.splice(idx, 1);
            localStorage.setItem(photosKey, JSON.stringify(updated));
            loadPhotoPreview(activityId);
        };

        wrap.appendChild(img);
        wrap.appendChild(removeBtn);
        grid.appendChild(wrap);
    });
}

function resizeAndAddPhoto(file, activityId) {
    const reader = new FileReader();
    reader.onload = function (e) {
        const img = new Image();
        img.onload = function () {
            const MAX = 700;
            let w = img.width, h = img.height;
            if (w > MAX || h > MAX) {
                if (w > h) { h = Math.round((h / w) * MAX); w = MAX; }
                else       { w = Math.round((w / h) * MAX); h = MAX; }
            }
            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.72);

            const key = `photos_${currentUserId}_${activityId}`;
            const stored = JSON.parse(localStorage.getItem(key) || '[]');
            stored.push(dataUrl);
            try {
                localStorage.setItem(key, JSON.stringify(stored));
            } catch (err) {
                showToast('Storage full — try removing some photos');
                return;
            }
            loadPhotoPreview(activityId);
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

// ─── Toast ────────────────────────────────────────────────
function showToast(msg, duration = 2400) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.style.display = '';
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => { toast.style.display = 'none'; }, duration);
}

// ─── Data backup (export / import) ────────────────────────
// User content (profile photo, memories, memory photos) lives only in this
// browser's localStorage. These helpers let users back it up to a JSON file
// and restore it on another device signed in to the same account.
function collectUserData() {
    const prefixes = [
        `profile_photo_${currentUserId}`,
        `mem_${currentUserId}_`,
        `photos_${currentUserId}_`,
    ];
    const data = {};
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (prefixes.some(p => key === p || key.startsWith(p))) {
            data[key] = localStorage.getItem(key);
        }
    }
    return data;
}

function exportUserData() {
    const data = collectUserData();
    if (Object.keys(data).length === 0) {
        showToast('Nothing to export yet');
        return;
    }
    const payload = {
        app: 'samo-passport',
        type: 'user-backup',
        version: 1,
        userId: currentUserId,
        exportedAt: new Date().toISOString(),
        data,
    };
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `samo-passport-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast('Backup downloaded ✓');
}

function importUserData(file) {
    const reader = new FileReader();
    reader.onload = e => {
        let payload;
        try {
            payload = JSON.parse(e.target.result);
        } catch {
            showToast('Invalid backup file');
            return;
        }
        if (payload?.app !== 'samo-passport' || !payload.data) {
            showToast('Not a SAMO passport backup');
            return;
        }
        if (payload.userId && payload.userId !== currentUserId &&
            !confirm('This backup is from a different account. Restore anyway? Your memories may not match your current stamps.')) {
            return;
        }
        // Restore is a merge by key — entries not in the backup are left intact,
        // so importing never deletes existing memories. Stop cleanly if storage
        // fills up rather than leaving things half-written without notice.
        let restored = 0;
        try {
            for (const [key, value] of Object.entries(payload.data)) {
                localStorage.setItem(key, value);
                restored++;
            }
        } catch {
            showToast(`Storage full — restored ${restored} of ${Object.keys(payload.data).length} items`);
            return;
        }
        showToast(`Backup restored (${restored} items) — reloading…`);
        setTimeout(() => window.location.reload(), 900);
    };
    reader.readAsText(file);
}

// ─── History (seasons + yearly วาระสโม totals) ────────────
function pointsOfScan(s) {
    return s.points_awarded || activityById.get(s.activity_id)?.base_points_km || 0;
}

// The current วาระสโม window = the active 'overall' season covering today;
// otherwise the current calendar year. Points reset each วาระสโม.
function currentVaraWindow() {
    const today = new Date().toISOString().slice(0, 10);
    const overall = seasonsList
        .filter(s => s.scope === 'overall' && s.start_date <= today && today <= s.end_date)
        .sort((a, b) => b.start_date.localeCompare(a.start_date))[0];
    if (overall) return { start: overall.start_date, end: overall.end_date, name: overall.name };
    const y = new Date().getFullYear();
    return { start: `${y}-01-01`, end: `${y}-12-31`, name: 'This year' };
}

function userPointsInWindow(startDate, endDate, scope, scopeId) {
    let total = 0;
    userScansCache.forEach(s => {
        const d = (s.scanned_at || '').slice(0, 10);
        if (startDate && d < startDate) return;
        if (endDate && d > endDate) return;
        const act = activityById.get(s.activity_id);
        if (scope === 'department' && (!act || act.department_id !== scopeId)) return;
        if (scope === 'subdepartment' && (!act || act.sub_department_id !== scopeId)) return;
        total += pointsOfScan(s);
    });
    return total;
}

function seasonScopeLabel(s) {
    if (s.scope === 'department') return DEPARTMENTS[s.scope_id] || 'Department';
    if (s.scope === 'subdepartment') return SUBDEPARTMENTS[s.scope_id] || 'Sub-department';
    return 'วาระสโม (overall)';
}

function openHistory() {
    const modal = document.getElementById('history-modal');
    const body = document.getElementById('history-body');
    modal.style.display = 'flex';
    syncModalViewport();

    // Yearly วาระสโม totals (points + badges earned that year)
    const byYear = new Map(); // year -> { pts, badges:Set(activityId) }
    userScansCache.forEach(s => {
        const y = (s.scanned_at || '').slice(0, 4);
        if (!y) return;
        if (!byYear.has(y)) byYear.set(y, { pts: 0, badges: new Set() });
        const e = byYear.get(y);
        e.pts += pointsOfScan(s);
        if (activityById.get(s.activity_id)?.badge_url) e.badges.add(s.activity_id);
    });
    const years = [...byYear.entries()].sort((a, b) => b[0].localeCompare(a[0]));

    const today = new Date().toISOString().slice(0, 10);
    const currentName = currentVaraWindow().name;

    let html = '<div class="hist-section"><div class="hist-h">วาระสโม — yearly totals</div>';
    if (years.length === 0) {
        html += '<p class="hist-empty">No activity yet.</p>';
    } else {
        years.forEach(([y, e]) => {
            html += `<div class="hist-row">
                <span><strong>วาระสโม ${y}</strong><small>${e.badges.size} badge${e.badges.size === 1 ? '' : 's'}</small></span>
                <span class="hist-pts">${e.pts} km</span></div>`;
        });
    }
    html += `<p class="hist-empty" style="margin-top:6px;">Current: ${escapeHtmlText(currentName)} — your score resets each วาระสโม.</p>`;
    html += '</div>';

    html += '<div class="hist-section"><div class="hist-h">Seasons</div>';
    if (seasonsList.length === 0) {
        html += '<p class="hist-empty">No seasons yet.</p>';
    } else {
        seasonsList.forEach(s => {
            // Archived seasons use the frozen snapshot (survives activity deletion);
            // active seasons are computed live from the user's scans.
            const archived = !!s.archived_at;
            const pts = archived
                ? (archivedResults.get(s.id) || 0)
                : userPointsInWindow(s.start_date, s.end_date, s.scope, s.scope_id);
            const status = archived ? '🔒 archived' : (s.end_date < today ? 'ended' : 'ongoing');
            html += `
              <div class="hist-row hist-season">
                <span>
                  <strong>${escapeHtmlText(s.name)}</strong>
                  <small>${seasonScopeLabel(s)} · ${s.start_date} → ${s.end_date} · ${status}</small>
                </span>
                <span class="hist-pts">${pts} km</span>
              </div>`;
        });
    }
    html += '</div>';

    body.innerHTML = html;
}

function closeHistory() {
    const modal = document.getElementById('history-modal');
    modal.style.display = 'none';
    resetModalViewport(modal);
}

function escapeHtmlText(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ─── Leaderboard ──────────────────────────────────────────
async function openLeaderboard() {
    const modal = document.getElementById('leaderboard-modal');
    const list = document.getElementById('lb-list');
    modal.style.display = 'flex';
    syncModalViewport();
    list.innerHTML = '<p class="lb-loading">Loading…</p>';

    // Rank by points within the CURRENT วาระสโม (resets each year).
    const win = currentVaraWindow();
    const [{ data: scans, error: e1 }, { data: profiles, error: e2 }] = await Promise.all([
        supabase.from('scans').select('user_id, activity_id, points_awarded, scanned_at'),
        supabase.from('profiles').select('id, full_name'),
    ]);

    if (e1 || e2) {
        list.innerHTML = '<p class="lb-loading">Could not load leaderboard.</p>';
        return;
    }

    const nameById = new Map((profiles || []).map(p => [p.id, p.full_name]));
    const totals = new Map();
    (scans || []).forEach(s => {
        const d = (s.scanned_at || '').slice(0, 10);
        if (d < win.start || d > win.end) return;
        totals.set(s.user_id, (totals.get(s.user_id) || 0) + (s.points_awarded || 0));
    });

    const rows = [...totals.entries()]
        .map(([uid, pts]) => ({ uid, pts, name: nameById.get(uid) || 'Traveler' }))
        .sort((a, b) => b.pts - a.pts)
        .slice(0, 100);

    document.querySelector('.lb-modal-title').textContent = `🏆 Leaderboard · ${win.name}`;

    if (rows.length === 0) {
        list.innerHTML = '<p class="lb-loading">No rankings yet for this วาระสโม.</p>';
        return;
    }

    list.innerHTML = '';
    rows.forEach((r, i) => {
        const row = document.createElement('div');
        row.className = 'lb-row' + (r.uid === currentUserId ? ' lb-me' : '');
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`;
        const nameEl = document.createElement('span');
        nameEl.className = 'lb-row-name';
        nameEl.textContent = r.name;
        row.innerHTML = `<span class="lb-rank">${medal}</span>`;
        row.appendChild(nameEl);
        const pts = document.createElement('span');
        pts.className = 'lb-row-pts';
        pts.textContent = `${r.pts} km`;
        row.appendChild(pts);
        list.appendChild(row);
    });
}

function closeLeaderboard() {
    const modal = document.getElementById('leaderboard-modal');
    modal.style.display = 'none';
    resetModalViewport(modal);
}

// ─── Edit name ────────────────────────────────────────────
async function editName() {
    const current = currentUserName || '';
    const next = (prompt('Enter your full name:', current) || '').trim();
    if (!next || next === current) return;

    const { error } = await supabase
        .from('profiles')
        .update({ full_name: next })
        .eq('id', currentUserId);

    if (error) {
        showToast('Could not save name');
        console.error('Name update failed:', error);
        return;
    }
    currentUserName = next;
    document.getElementById('p-name').textContent = next;
    showToast('Name updated ✓');
}

// Briefly highlight + scroll to a stamp on its page (used after search).
function flashStamp(activityId) {
    requestAnimationFrame(() => {
        const slot = document.querySelector(`.stamp-slot[data-activity-id="${activityId}"]`);
        if (!slot) return;
        slot.scrollIntoView({ block: 'center', behavior: 'smooth' });
        slot.classList.remove('flash');
        void slot.offsetWidth; // restart the animation
        slot.classList.add('flash');
        setTimeout(() => slot.classList.remove('flash'), 1700);
    });
}

// ─── Stamp search ─────────────────────────────────────────
function searchMatches(term) {
    const q = (term || '').trim().toLowerCase();
    if (!q) return [];
    return allStamps
        .filter(s => (s.activity.name || s.activity.badge_name || '').toLowerCase().includes(q))
        .slice(0, 12);
}

function hideSearchResults() {
    const box = document.getElementById('stamp-search-results');
    box.style.display = 'none';
    box.innerHTML = '';
}

// Navigate to a stamp's page and highlight it — no popup.
function goToStamp(activity, pageIndex) {
    const search = document.getElementById('stamp-search');
    search.value = '';
    search.blur();
    hideSearchResults();
    if (typeof pageIndex === 'number' && pageIndex < totalPages) {
        goToPage(pageIndex);
        flashStamp(activity.id);
    }
}

// Live dropdown of matching stamps as the user types.
function renderStampSearch(term) {
    const box = document.getElementById('stamp-search-results');
    const matches = searchMatches(term);

    if (!term.trim()) { hideSearchResults(); return; }

    if (matches.length === 0) {
        box.innerHTML = '<div class="stamp-search-empty">No matching stamps yet 🔍</div>';
        box.style.display = '';
        return;
    }

    box.innerHTML = '';
    matches.forEach(({ activity, pageIndex }) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'stamp-search-item';

        const thumb = document.createElement('span');
        thumb.className = 'ss-thumb';
        if (activity.badge_url) {
            const img = document.createElement('img');
            img.src = fixGoogleDriveUrl(activity.badge_url);
            img.alt = '';
            thumb.appendChild(img);
        } else {
            thumb.textContent = '🏅';
        }

        const name = document.createElement('span');
        name.className = 'ss-name';
        name.textContent = activity.name || activity.badge_name || 'Activity';

        const go = document.createElement('span');
        go.className = 'ss-go';
        go.textContent = `Page ${pageIndex + 1} ›`;

        row.append(thumb, name, go);
        row.addEventListener('click', () => goToStamp(activity, pageIndex));
        box.appendChild(row);
    });
    box.style.display = '';
}

// Enter / the keyboard Search key jumps straight to the first match.
function jumpToSearch(term) {
    const matches = searchMatches(term);
    if (matches.length === 0) { showToast('No matching stamp'); return; }
    goToStamp(matches[0].activity, matches[0].pageIndex);
}

// ─── Main init ────────────────────────────────────────────
async function init() {
    document.getElementById('logout-btn').addEventListener('click', async (e) => {
        e.preventDefault();
        await logout();
    });

    document.getElementById('prev-page').addEventListener('click', () => {
        if (currentPageIndex > 0) goToPage(currentPageIndex - 1);
    });

    document.getElementById('next-page').addEventListener('click', () => {
        if (currentPageIndex < totalPages - 1) goToPage(currentPageIndex + 1);
    });

    // Tap the cover to open the passport (it says "Open to view →")
    const cover = document.getElementById('page-0');
    if (cover) cover.addEventListener('click', () => { if (currentPageIndex === 0) goToPage(1); });

    // Swipe left/right to turn pages (horizontal gestures only — vertical scrolls)
    const book = document.querySelector('.passport-container');
    let sx = 0, sy = 0;
    book.addEventListener('touchstart', (e) => {
        const t = e.changedTouches[0];
        sx = t.clientX; sy = t.clientY;
    }, { passive: true });
    book.addEventListener('touchend', (e) => {
        const t = e.changedTouches[0];
        const dx = t.clientX - sx, dy = t.clientY - sy;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.4) {
            if (dx < 0 && currentPageIndex < totalPages - 1) goToPage(currentPageIndex + 1);
            else if (dx > 0 && currentPageIndex > 0) goToPage(currentPageIndex - 1);
        }
    }, { passive: true });

    // Modal close
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('modal-backdrop').addEventListener('click', closeModal);
    document.getElementById('modal-edit').addEventListener('click', () => {
        if (!currentModalActivity) return;
        showMemoryWrite(currentModalActivity.id);
    });

    // Photo zone click
    document.getElementById('photo-zone').addEventListener('click', () => {
        document.getElementById('photo-input').click();
    });

    document.getElementById('photo-input').addEventListener('change', function () {
        if (!currentModalActivity) return;
        Array.from(this.files).forEach(f => resizeAndAddPhoto(f, currentModalActivity.id));
        this.value = '';
    });

    document.getElementById('modal-save').addEventListener('click', () => {
        if (!currentModalActivity) return;
        const key = `mem_${currentUserId}_${currentModalActivity.id}`;
        localStorage.setItem(key, document.getElementById('modal-memory-text').value);
        showToast('Memory saved ✓');
        closeModal();
    });

    // Leaderboard
    document.getElementById('leaderboard-btn').addEventListener('click', (e) => {
        e.preventDefault();
        openLeaderboard();
    });
    document.getElementById('lb-close').addEventListener('click', closeLeaderboard);
    document.getElementById('lb-backdrop').addEventListener('click', closeLeaderboard);

    // History
    document.getElementById('history-btn').addEventListener('click', (e) => {
        e.preventDefault();
        openHistory();
    });
    document.getElementById('history-close').addEventListener('click', closeHistory);
    document.getElementById('history-backdrop').addEventListener('click', closeHistory);

    // Edit name
    document.getElementById('edit-name-btn').addEventListener('click', editName);

    // Stamp search — live dropdown; click an item (or press Enter) to jump to
    // that stamp's page and highlight it (no popup).
    const stampSearch = document.getElementById('stamp-search');
    stampSearch.addEventListener('input', function () { renderStampSearch(this.value); });
    stampSearch.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); jumpToSearch(stampSearch.value); }
        else if (e.key === 'Escape') { hideSearchResults(); stampSearch.blur(); }
    });
    stampSearch.addEventListener('search', () => jumpToSearch(stampSearch.value));
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.stamp-search-bar')) hideSearchResults();
    });

    // Keep modals glued to the visible viewport as the keyboard opens/closes.
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', syncModalViewport);
        window.visualViewport.addEventListener('scroll', syncModalViewport);
    }
    // When the memory textarea is focused, make sure it scrolls into view above
    // the keyboard once the layout settles.
    document.getElementById('modal-memory-text').addEventListener('focus', () => {
        setTimeout(() => {
            document.getElementById('modal-memory-text')
                .scrollIntoView({ block: 'center', behavior: 'smooth' });
        }, 300);
    });

    // "My data" info icon — explains what the backup covers
    document.getElementById('backup-info-btn').addEventListener('click', () => {
        showToast('Backup saves your profile photo, activity memories & notes (kept only on this device) to a file.', 4200);
    });

    // Data backup (export / import)
    document.getElementById('export-data-btn').addEventListener('click', exportUserData);
    document.getElementById('import-data-btn').addEventListener('click', () => {
        document.getElementById('import-data-input').click();
    });
    document.getElementById('import-data-input').addEventListener('change', function () {
        if (this.files[0]) importUserData(this.files[0]);
        this.value = '';
    });

    // ── Auth check ──────────────────────────────────────────
    const user = await checkSession();
    if (!user) { window.location.href = ROUTES.HOME; return; }

    const pendingUrl = getPendingScanUrl();
    if (pendingUrl) { clearPendingScanUrl(); window.location.href = pendingUrl; return; }

    currentUserId = user.id;
    setupProfilePhoto(currentUserId);

    // ── Display name ────────────────────────────────────────
    let displayName = user.user_metadata?.full_name
        || user.user_metadata?.name
        || user.email?.split('@')[0]
        || 'Traveler';

    const pName = document.getElementById('p-name');
    pName.textContent = displayName;
    pName.classList.remove('skeleton');
    currentUserName = displayName;

    // ── Profile / tier ──────────────────────────────────────
    const pTier = document.getElementById('p-tier');
    const { data: profileTier, error: profileError } = await supabase
        .from('user_tiers')
        .select('*')
        .eq('id', user.id)
        .single();

    if (!profileError && profileTier) {
        if (profileTier.full_name) { pName.textContent = profileTier.full_name; currentUserName = profileTier.full_name; }
        pTier.textContent = profileTier.final_tier || 'Novice';
        if (profileTier.has_travel_visa) {
            document.getElementById('visa-visa').style.display = '';
        }
    } else {
        pTier.textContent = 'Novice';
    }
    pTier.classList.remove('skeleton');

    // ── Activities & scans ──────────────────────────────────
    const pKm = document.getElementById('p-km');
    try {
        const [
            { data: scans, error: scansError },
            { data: allActivities, error: actError },
            { data: allCerts },
            { data: allSeasons },
            { data: myArchived },
        ] = await Promise.all([
            supabase.from('scans').select('*').eq('user_id', user.id).order('scanned_at', { ascending: false }),
            supabase.from('activities').select('*').order('created_at', { ascending: true }),
            supabase.from('certificates').select('*').order('created_at', { ascending: true }),
            supabase.from('seasons').select('*').order('start_date', { ascending: false }),
            supabase.from('season_results').select('season_id, points').eq('user_id', user.id),
        ]);

        if (scansError) throw scansError;
        if (actError) throw actError;

        // Caches for the history view (seasons are optional — ignore errors)
        userScansCache = scans;
        activityById.clear();
        allActivities.forEach(a => activityById.set(a.id, a));
        seasonsList = allSeasons || [];
        archivedResults.clear();
        (myArchived || []).forEach(r => archivedResults.set(r.season_id, r.points));

        // Group certificate templates by activity (ignore errors — certs are optional)
        certsByActivity.clear();
        (allCerts || []).forEach(c => {
            if (!certsByActivity.has(c.activity_id)) certsByActivity.set(c.activity_id, []);
            certsByActivity.get(c.activity_id).push(c);
        });

        // Headline KM = points in the CURRENT วาระสโม only (resets each year);
        // past years live in the history view.
        const win = currentVaraWindow();
        let yearKm = 0;
        scans.forEach(s => {
            const d = (s.scanned_at || '').slice(0, 10);
            if (d >= win.start && d <= win.end) yearKm += pointsOfScan(s);
        });
        pKm.textContent = yearKm;
        pKm.classList.remove('skeleton');
        const wlabel = document.getElementById('km-window-label');
        if (wlabel) wlabel.textContent = win.name;

        // ── Activity log (page 2) ────────────────────────────
        const logList = document.getElementById('activity-list');
        logList.innerHTML = '';
        if (scans.length === 0) {
            logList.innerHTML = '<div style="opacity:0.5;font-size:0.85rem;text-align:center;padding-top:20px;">No activities yet — start scanning! ✈️</div>';
        } else {
            // Most recent first (scans already ordered by scanned_at desc)
            scans.forEach(scan => {
                const act = allActivities.find(a => a.id === scan.activity_id) || {};
                const pts = scan.points_awarded || act.base_points_km || 0;
                const name = act.name || 'Unknown Activity';
                const item = document.createElement('div');
                item.className = 'flight-log-item';
                item.innerHTML = `<span>✈️ ${name}</span><span class="log-km">+${pts} km</span>`;
                logList.appendChild(item);
            });
        }

        // ── Stamp pages (always builds future + back cover too) ─
        buildStampPages(allActivities, scans);

    } catch (err) {
        console.error('Failed to load activities:', err);
        document.getElementById('activity-list').innerHTML =
            `<div style="color:var(--accent-danger);font-size:0.85rem;">Error loading activities.</div>`;
        pKm.textContent = '0';
        pKm.classList.remove('skeleton');
        buildStampPages([], []); // still shows future stamps + back cover
    }

    // Initial render
    goToPage(0);
}

init();
