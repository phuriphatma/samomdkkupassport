// js/dashboard.js — Passport ebook with memory popup
import { supabase } from './app.js';
import { checkSession, logout, ensureProfile, getPassportAccess, renderAccessBlock, renderReceivedBanner } from './auth.js';
import { fixGoogleDriveUrl, getPendingScanUrl, clearPendingScanUrl } from './utils.js';
import { renderCertificate, downloadCanvasPng } from './certificate.js';
import { ROUTES } from './routes.js';
import { getCurrentContext } from './samo.js';
import { DEPARTMENTS, SUBDEPARTMENTS } from './constants.js';

// ─── State ───────────────────────────────────────────────
let currentUserId = null;
let currentUserName = '';
let currentModalActivity = null;
let currentModalScan = null;
const certsByActivity = new Map(); // activity_id -> [certificate, ...]
const allStamps = []; // flat registry for search: { activity, isActive, scan }
let userScansCache = [];
const activityById = new Map();
let _allActivitiesCache = [];
// Stamps tab: which วาระ/quartile period the view is scoped to (like the Flight
// Log / Leaderboard), plus the department show/hide chip filter.
let stampYear = undefined;   // selected วาระสโม key ('none' = unassigned)
let stampSeason = undefined; // selected quartile key ('all' | 'none' | season id)
let stampDeptFilter = null;  // dept id (string) or null = all departments

// ── SamoYear / Season (new immutable model) ──
let currentYear = null;          // open samo_year
let currentSeason = null;        // open samo_season
const seasonNameById = new Map(); // season_id -> name (for labels)
const yearNameById = new Map();   // samo_year_id -> name (for flight-log grouping)
let flFilter = { type: 'all', id: null };  // all | dept | sub
let flYear = undefined;   // selected วาระสโม key in the Flight Log ('none' = unassigned)
let flSeason = undefined; // selected season key ('all' | 'none' | season id)
let flFiltersCollapsed = false; // mobile-only: hide the Filter card body when true
let lbpFilter = { type: 'all', id: null };  // all | dept | sub
let lbYear = undefined;   // selected วาระสโม key on the Leaderboard ('none' = unassigned)
let lbSeason = 'all';     // selected season key ('all' | 'none' | season id)
let lbFiltersCollapsed = false; // mobile-only: hide the Leaderboard Filter card body

// ─── Tab navigation: data-render hook ─────────────────────
// switchTab itself (the pure-DOM pane swap) lives in the classic inline <script> in
// dashboard.html, NOT here — that script runs at parse time, so the nav buttons work
// the instant the page is interactive, even before this deferred module finishes
// downloading (the "nav button does nothing on a slow/cold load, esp. iPad" race).
// Here we only expose the data-heavy renders the active tab needs; the inline
// switchTab calls window.__dashRenderTab(id), and init() calls it for whatever tab is
// active once scans finish loading. Keep this the ONLY copy of the render dispatch.
function renderTab(id) {
    try {
        if (id === 'leaderboard') renderLeaderboardPage();
        else if (id === 'log') renderFlightLogPage();
        else if (id === 'passport') fitMrz(); // refit now that the pane has a real width
    } catch (err) { console.error('renderTab failed:', err); }
}
window.__dashRenderTab = renderTab;

// ─── Stamp grid (flat, all activities) ───────────────────
const STAMP_COLORS = ['se-teal','se-blue','se-amber','se-rose','se-violet','se-coral'];

function buildStampPages(allActivities, userScans) {
    _allActivitiesCache = allActivities;

    // Resolve the selected วาระ (default = current), then build the controls and
    // render the grid for that period.
    const yearKeys = flYearKeys();
    if (stampYear === undefined || (stampYear !== 'all' && !yearKeys.includes(stampYear))) {
        stampYear = (currentYear && yearKeys.includes(currentYear.id)) ? currentYear.id : (yearKeys[0] ?? 'none');
    }
    stampDeptFilter = null;
    buildStampPeriodSelectors();
    buildDeptFilterChips(allActivities);
    renderStampGrid();

    renderFlightLogPage();
}

// Render the stamp grid + info strip for the selected วาระ/quartile. An activity
// counts as "earned" only if it was scanned within that period; everything else
// shows locked. Re-runs whenever the period selectors change.
function renderStampGrid() {
    const grid = document.getElementById('stamps-grid');
    if (!grid) return;
    const allActivities = _allActivitiesCache;

    const scope = userScansCache.filter(s =>
        (stampYear === 'all' || (s.samo_year_id ?? 'none') === stampYear) &&
        (stampSeason === 'all' || (s.season_id ?? 'none') === stampSeason));
    const scannedIds = new Set(scope.map(s => s.activity_id));
    const scanByActivity = new Map(scope.map(s => [s.activity_id, s]));

    grid.innerHTML = '';
    allStamps.length = 0;

    // Only earned stamps are shown (newest-first); not-yet-achieved ones are hidden.
    const earned = allActivities
        .filter(a => scannedIds.has(a.id))
        .sort((a, b) => (scanByActivity.get(b.id)?.scanned_at || '').localeCompare(scanByActivity.get(a.id)?.scanned_at || ''));

    earned.forEach(a => allStamps.push({ activity: a, isActive: true, scan: scanByActivity.get(a.id) }));

    if (earned.length === 0) {
        grid.innerHTML = '<div class="fl-empty">No stamps earned in this period yet 🗺️</div>';
    }

    earned.forEach((a, idx) => {
        const scan = scanByActivity.get(a.id);
        const card = document.createElement('div');
        card.className = 'stamp-card';
        card.setAttribute('data-activity-id', a.id);
        card.setAttribute('data-dept-id', a.department_id ?? '');

        const check = document.createElement('div');
        check.className = 'stamp-check';
        check.textContent = '✓';
        card.appendChild(check);

        const emojiDiv = document.createElement('div');
        emojiDiv.className = 'stamp-emoji ' + STAMP_COLORS[idx % STAMP_COLORS.length];
        if (a.badge_url) {
            const img = document.createElement('img');
            img.src = fixGoogleDriveUrl(a.badge_url);
            img.alt = a.badge_name || a.name;
            emojiDiv.appendChild(img);
            emojiDiv.classList.add('filled');  // enables the grain overlay over the image
        } else {
            emojiDiv.textContent = '✅';
        }
        // shadow lives on this wrapper (the stamp itself is masked, which would clip a shadow)
        const stampWrap = document.createElement('div');
        stampWrap.className = 'stamp-wrap';
        stampWrap.appendChild(emojiDiv);

        const name = document.createElement('div');
        name.className = 'stamp-name';
        name.textContent = a.badge_name || a.name;

        const count = document.createElement('div');
        count.className = 'stamp-count';
        count.textContent = `+${scan?.points_awarded || a.base_points_km || 0} km`;

        if ((certsByActivity.get(a.id) || []).length > 0) {
            const ribbon = document.createElement('span');
            ribbon.className = 'stamp-cert-badge';
            ribbon.textContent = '🎓';
            ribbon.title = 'Certificate available';
            card.appendChild(ribbon);
        }

        card.append(stampWrap, name, count);
        card.addEventListener('click', () => openMemoryModal(a, scan));
        grid.appendChild(card);
    });

    // Info strip. Collected, Total KM, "Km to status" and Completion all follow the
    // selected period (progress toward the status goal within that period).
    const periodKm = scope.reduce((t, s) => t + (s.points_awarded || 0), 0);
    const toNext = kmToNextStatus(periodKm);
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    set('stamps-collected', earned.length);
    set('stamps-next', toNext > 0 ? toNext.toLocaleString() : 'Max');
    set('stamps-pct', kmCompletionPct(periodKm) + '%');
    set('stamps-km', periodKm.toLocaleString());

    // Re-apply the department show/hide filter on the freshly-rendered cards.
    applyStampFilters();
}

// วาระสโม + Quartile selectors for the stamps view (same model as the Flight Log
// / Leaderboard). Hidden when the user has no scans (nothing to scope).
function buildStampPeriodSelectors() {
    const row = document.getElementById('stamps-period-row');
    if (!row) return;
    const yearKeys = flYearKeys();
    if (yearKeys.length === 0) { row.style.display = 'none'; row.innerHTML = ''; return; }
    row.style.display = '';

    // "ทุกวาระสโม" (all วาระ / all-time): quartiles are year-specific, so the
    // quartile dropdown is hidden and the scope spans every วาระ.
    const allYears = stampYear === 'all';
    const seasonKeys = allYears ? [] : flSeasonKeys(stampYear);
    if (allYears) {
        stampSeason = 'all';
    } else if (stampSeason === undefined || (stampSeason !== 'all' && !seasonKeys.includes(stampSeason))) {
        stampSeason = 'all'; // default = the whole วาระ
    }
    const yearOpts = [`<option value="all"${allYears ? ' selected' : ''}>${escapeHtmlText(yearKeyName('all'))}</option>`]
        .concat(yearKeys.map(k =>
            `<option value="${k}"${k === stampYear ? ' selected' : ''}>${escapeHtmlText(yearKeyName(k))}</option>`)).join('');
    const seasonSelect = allYears ? '' :
        `<select class="fl-season-select" aria-label="Quartile">`
        + [`<option value="all"${stampSeason === 'all' ? ' selected' : ''}>${escapeHtmlText(seasonKeyName('all'))}</option>`]
            .concat(seasonKeys.map(k =>
                `<option value="${k}"${k === stampSeason ? ' selected' : ''}>${escapeHtmlText(seasonKeyName(k))}</option>`)).join('')
        + `</select>`;
    row.innerHTML = `
      <span class="filter-lbl">View</span>
      <select class="fl-year-select" aria-label="วาระสโม">${yearOpts}</select>
      ${seasonSelect}`;

    row.querySelector('.fl-year-select').addEventListener('change', e => {
        stampYear = e.target.value;
        stampSeason = 'all';            // reset quartile when the วาระ changes
        buildStampPeriodSelectors();    // refresh quartile options for the new วาระ
        renderStampGrid();
    });
    row.querySelector('.fl-season-select')?.addEventListener('change', e => {
        stampSeason = e.target.value;
        renderStampGrid();
    });
}

// Shared chip-row builder: a leading label, an "All" chip, then one chip per
// value. `onPick(value)` runs with null for "All" or the value's key otherwise.
function buildFilterChips(row, label, items, isActive, onPick) {
    row.innerHTML = '';
    const lbl = document.createElement('span');
    lbl.className = 'filter-lbl';
    lbl.textContent = label;
    row.appendChild(lbl);

    const mkChip = (text, value) => {
        const chip = document.createElement('div');
        chip.className = 'fchip' + (isActive(value) ? ' active' : '');
        chip.textContent = text;
        chip.addEventListener('click', () => {
            row.querySelectorAll('.fchip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            onPick(value);
        });
        row.appendChild(chip);
    };
    mkChip('All', null);
    items.forEach(({ text, value }) => mkChip(text, value));
}

function buildDeptFilterChips(allActivities) {
    const row = document.getElementById('dept-filter-row');
    if (!row) return;
    const deptIds = [...new Set(allActivities.map(a => a.department_id).filter(Boolean))];
    const items = deptIds.map(id => ({ text: DEPARTMENTS[id] || ('ฝ่าย ' + id), value: String(id) }));
    buildFilterChips(row, 'Dept', items, v => v === stampDeptFilter, v => {
        stampDeptFilter = v;
        applyStampFilters();
    });
}

// Department show/hide filter on the currently-rendered cards (วาระ/quartile
// scoping is handled upstream in renderStampGrid).
function applyStampFilters() {
    const grid = document.getElementById('stamps-grid');
    if (!grid) return;
    grid.querySelectorAll('.stamp-card').forEach(card => {
        card.style.display = (!stampDeptFilter || card.dataset.deptId === stampDeptFilter) ? '' : 'none';
    });
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
        wrap.innerHTML = `<div class="stamp-wrap"><div class="stamp-emoji se-blue filled"><img src="${fixGoogleDriveUrl(activity.badge_url)}" alt="${activity.name}"></div></div>`;
    } else {
        wrap.innerHTML = `<div class="stamp-wrap"><div class="stamp-emoji se-blue"><span class="modal-badge-placeholder">🏅</span></div></div>`;
    }

    document.getElementById('modal-locked').style.display = 'none';

    // Certificates always reflect the activity's CURRENT templates (no season
    // snapshot). If the activity is later deleted, its certs go with it.
    populateCerts(activity.id);

    // If memory or photos exist → view card; otherwise → write form
    const savedText = localStorage.getItem(`mem_${currentUserId}_${activity.id}`) || '';
    const savedPhotos = JSON.parse(localStorage.getItem(`photos_${currentUserId}_${activity.id}`) || '[]');
    if (savedText || savedPhotos.length > 0) {
        showMemoryView(savedText, savedPhotos);
    } else {
        showMemoryWrite(activity.id);
    }

    // Self-service removal is offered only for an earned activity (a real scan).
    const danger = document.getElementById('modal-danger');
    if (danger) danger.style.display = scan?.id ? '' : 'none';

    showModal();
}

// Let a student remove an activity they scanned by mistake. Deletes only their OWN
// scan (id + user_id scoped); RLS already permits this. We reload afterwards so every
// view (km, stamps, flight log, leaderboard, boarding pass) reflects it without
// partial-cache bookkeeping. Scans stay immutable to *edits*; a user pruning their own
// mis-scan is a deliberate exception (see MISTAKES.md).
async function removeOwnScan() {
    const scan = currentModalScan;
    const activity = currentModalActivity;
    if (!scan?.id) { showToast('Nothing to remove'); return; }
    const name = activity?.name || 'this activity';
    if (!window.confirm(`Remove "${name}" from your passport?\n\nThis deletes the stamp and its km. You can scan it again later.`)) return;

    const btn = document.getElementById('modal-remove');
    const original = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Removing…'; }
    try {
        const { error } = await supabase.from('scans').delete()
            .eq('id', scan.id).eq('user_id', currentUserId);
        if (error) throw error;
        // On-device memory/photos for this activity are no longer reachable — clean up.
        try {
            localStorage.removeItem(`mem_${currentUserId}_${activity.id}`);
            localStorage.removeItem(`photos_${currentUserId}_${activity.id}`);
        } catch { /* localStorage may be unavailable */ }
        showToast('Removed from your passport ✓');
        closeModal();
        setTimeout(() => location.reload(), 600);
    } catch (err) {
        console.error('Failed to remove scan', err);
        showToast('Could not remove — please try again');
        if (btn) { btn.disabled = false; btn.textContent = original; }
    }
}


// ─── Certificates ─────────────────────────────────────────
function populateCerts(activityId) {
    const section = document.getElementById('modal-certs');
    const list = document.getElementById('modal-certs-list');
    // Certs are no longer season-scoped — show every template on the activity.
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

        // Keep View + Download together as one unit so they never split across lines
        // (on narrow mobile the row wraps the whole pair below the label, not apart).
        const actions = document.createElement('div');
        actions.className = 'cert-row-actions';
        actions.appendChild(viewBtn);
        actions.appendChild(dlBtn);

        row.appendChild(label);
        row.appendChild(actions);
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

// Status ladder: named tiers, one upgrade per 2,000 km. The top tier is reached
// at the goal (last rung × 2,000 km); progress and "km to next" track that goal.
const KM_PER_STATUS = 2000;
const STATUS_TIERS = ['Explorer', 'Adventurer', 'Pathfinder', 'Voyager', 'Pioneer'];
const KM_STATUS_GOAL = (STATUS_TIERS.length - 1) * KM_PER_STATUS;  // 8,000 km (Pioneer)
// Tier name for a lifetime km total (index = km / 2,000, capped at the top tier).
function statusTierName(km) {
    return STATUS_TIERS[Math.min(STATUS_TIERS.length - 1, Math.floor(Math.max(0, km) / KM_PER_STATUS))];
}
// km left to reach the next status (0 once the goal / top tier is reached).
function kmToNextStatus(km) {
    if (km >= KM_STATUS_GOAL) return 0;
    return (Math.floor(km / KM_PER_STATUS) + 1) * KM_PER_STATUS - km;
}
// Progress toward the status goal as a clamped integer percent.
function kmCompletionPct(km) {
    return Math.max(0, Math.min(100, Math.round(km / KM_STATUS_GOAL * 100)));
}
// Progress through the current 2,000 km tier toward the next status (0–100%),
// i.e. km earned since the last status / km required for the next one. Full once
// the goal / top tier is reached.
function kmStatusProgressPct(km) {
    if (km >= KM_STATUS_GOAL) return 100;
    return Math.round((km % KM_PER_STATUS) / KM_PER_STATUS * 100);
}
// Set the displayed Status (passport + sidebar) from a lifetime km total.
function setStatusTier(km) {
    const name = statusTierName(km);
    const pTier = document.getElementById('p-tier');
    if (pTier) { pTier.textContent = name; pTier.classList.remove('skeleton'); }
    const sideTier = document.getElementById('side-tier');
    if (sideTier) sideTier.textContent = name;
    // Boarding-pass Group + Seat track the Status tier. Set here (not in
    // renderPassportMeta, which runs before km loads) so they fill once the tier is known.
    const grp = document.getElementById('bp-group');
    if (grp) grp.textContent = name.replace(/^the\s+/i, '').replace(/[^A-Za-z]/g, '').slice(0, 5).toUpperCase() || '—';
    const seat = document.getElementById('bp-seat');
    if (seat) seat.textContent = seatCode(currentUserId, name);
}

// Fallback window used for the headline only when no SamoYear is declared yet:
// the current calendar year.
function currentVaraWindow() {
    const y = new Date().getFullYear();
    return { start: `${y}-01-01`, end: `${y}-12-31`, name: 'This year' };
}

function escapeHtmlText(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ─── Passport identity block ──────────────────────────────
// One full name is stored; the passport shows it split as Given (first word) +
// Surname (the rest), plus a derived passport no., the วาระสโม dates, and an MRZ strip.
function splitFullName(full) {
    const parts = (full || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return { given: '—', surname: '—' };
    if (parts.length === 1) return { given: parts[0], surname: '—' };
    return { given: parts[0], surname: parts.slice(1).join(' ') };
}

function setPassportName(full) {
    const { given, surname } = splitFullName(full);
    const g = document.getElementById('p-given');
    const s = document.getElementById('p-surname');
    if (g) { g.textContent = given; g.classList.remove('skeleton'); }
    if (s) { s.textContent = surname; s.classList.remove('skeleton'); }
    const sn = document.getElementById('side-name');
    if (sn) { sn.textContent = full || '—'; sn.querySelector('.skeleton')?.remove(); }
}

function fmtPassportDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    const M = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][d.getMonth()];
    return `${String(d.getDate()).padStart(2, '0')} ${M} ${d.getFullYear()}`;
}

function passportNumber(userId, startedAt) {
    let h = 0; const s = String(userId || '');
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    const yr = startedAt && !isNaN(new Date(startedAt)) ? new Date(startedAt).getFullYear() : new Date().getFullYear();
    return `MP-${yr}-${String(h % 10000).padStart(4, '0')}`;
}

function buildMrz(surname, given, passportNo, issuedIso, expiresIso) {
    const up = s => (s || '').toUpperCase().replace(/\s+/g, '<');
    const pad = s => (s + '<'.repeat(44)).slice(0, 44);
    const ymd = iso => { const d = iso ? new Date(iso) : null; return (d && !isNaN(d))
        ? `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}` : ''; };
    const l1 = pad(`PMDKS${up(surname)}<<${up(given)}`);
    const l2 = pad(`${(passportNo || '').replace(/-/g, '')}<<<THA<<${ymd(issuedIso)}<${ymd(expiresIso)}`);
    return [l1, l2];
}

// Stretch each MRZ <text> to span the full SVG width. Percentage textLength is
// honored inconsistently (Safari ignores it), so set it in px from the rendered
// width. Re-run on resize/orientation change so it stays edge-to-edge everywhere.
function fitMrz() {
    ['p-mrz1', 'p-mrz2'].forEach(id => {
        const t = document.getElementById(id);
        if (!t) return;
        const w = t.closest('svg')?.clientWidth || 0;
        if (w > 0) t.setAttribute('textLength', w);
    });
}
if (!window.__mrzFitBound) {
    window.__mrzFitBound = true;
    window.addEventListener('resize', fitMrz);
}

// Fills passport no., Issued/Expires and the MRZ — needs currentYear + currentUserName,
// so it runs after those load (and again after a name edit).
function renderPassportMeta() {
    const startedAt = currentYear?.started_at || null;
    let expiresIso = currentYear?.ended_at || null;
    if (!expiresIso && startedAt) {
        const d = new Date(startedAt);
        if (!isNaN(d)) { d.setFullYear(d.getFullYear() + 1); expiresIso = d.toISOString(); }
    }
    const passNo = passportNumber(currentUserId, startedAt);
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    set('p-passport-no', passNo);
    set('p-issued', fmtPassportDate(startedAt));
    set('p-expires', fmtPassportDate(expiresIso));
    const { given, surname } = splitFullName(currentUserName);
    const [m1, m2] = buildMrz(surname, given, passNo, startedAt, expiresIso);
    set('p-mrz1', m1); set('p-mrz2', m2);
    fitMrz();

    // Boarding pass
    set('bp-pax', currentUserName || '—');
    set('bp-flight', currentYear ? upFlight(currentYear.name) : 'MD-2027');
    // Group + Seat are filled by setStatusTier (they need the loaded km/tier).
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
    setPassportName(next);
    renderPassportMeta();
    showToast('Name updated ✓');
}

// Briefly highlight + scroll to a stamp in the stamps grid.
function flashStamp(activityId) {
    requestAnimationFrame(() => {
        const card = document.querySelector(`.stamp-card[data-activity-id="${activityId}"]`);
        if (!card) return;
        card.scrollIntoView({ block: 'center', behavior: 'smooth' });
        card.classList.remove('flash');
        void card.offsetWidth;
        card.classList.add('flash');
        setTimeout(() => card.classList.remove('flash'), 1700);
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

// Navigate to a stamp in the grid (switch to stamps tab) and highlight it.
function goToStamp(activity) {
    const search = document.getElementById('stamp-search');
    search.value = '';
    search.blur();
    hideSearchResults();
    window.switchTab('stamps');
    flashStamp(activity.id);
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
    matches.forEach(({ activity }) => {
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
        go.textContent = 'View ›';

        row.append(thumb, name, go);
        row.addEventListener('click', () => goToStamp(activity));
        box.appendChild(row);
    });
    box.style.display = '';
}

// Enter / the keyboard Search key jumps straight to the first match.
function jumpToSearch(term) {
    const matches = searchMatches(term);
    if (matches.length === 0) { showToast('No matching stamp'); return; }
    goToStamp(matches[0].activity);
}

// ─── Flight Log + Leaderboard pages (SamoYear / Season model) ─────────────
function scanDisplayName(s) { return s.activity_name || activityById.get(s.activity_id)?.name || 'Activity'; }
function scanDept(s) { return s.department_id ?? activityById.get(s.activity_id)?.department_id ?? null; }
function scanSubDept(s) { return s.sub_department_id ?? activityById.get(s.activity_id)?.sub_department_id ?? null; }

// Compact department/sub-department filter as a single <select> (there can be ~10
// departments — chips took up too much space). Only lists scopes present in `scans`.
function deptSelectHtml(scans, filter) {
    const depts = [...new Set(scans.map(scanDept).filter(x => x != null))];
    const subs = [...new Set(scans.map(scanSubDept).filter(x => x != null))];
    const sel = (cond) => cond ? ' selected' : '';
    let html = `<select class="seg-select"><option value="all"${sel(filter.type === 'all')}>ทุกฝ่าย (All)</option>`;
    depts.forEach(d => html += `<option value="dept:${d}"${sel(filter.type === 'dept' && filter.id === d)}>${escapeHtmlText(DEPARTMENTS[d] || ('ฝ่าย ' + d))}</option>`);
    subs.forEach(d => html += `<option value="sub:${d}"${sel(filter.type === 'sub' && filter.id === d)}>${escapeHtmlText(SUBDEPARTMENTS[d] || ('ย่อย ' + d))}</option>`);
    html += '</select>';
    return html;
}

function applyFilter(scans, filter) {
    if (filter.type === 'dept') return scans.filter(s => scanDept(s) === filter.id);
    if (filter.type === 'sub') return scans.filter(s => scanSubDept(s) === filter.id);
    return scans;
}

function parseDeptValue(v) {
    if (v === 'all') return { type: 'all', id: null };
    const [t, id] = v.split(':');
    return { type: t, id: parseInt(id, 10) };
}

// Distinct วาระสโม keys present in the user's scans, newest-first ('none' = no year).
function flYearKeys() {
    const m = new Map();
    userScansCache.forEach(s => {
        const k = s.samo_year_id ?? 'none', t = s.scanned_at || '';
        if (!m.has(k) || t > m.get(k)) m.set(k, t);
    });
    return [...m.entries()].sort((a, b) => b[1].localeCompare(a[1])).map(([k]) => k);
}
// Distinct season keys within a year key, newest-first ('none' = no season).
function flSeasonKeys(yearKey) {
    const m = new Map();
    userScansCache.forEach(s => {
        if ((s.samo_year_id ?? 'none') !== yearKey) return;
        const k = s.season_id ?? 'none', t = s.scanned_at || '';
        if (!m.has(k) || t > m.get(k)) m.set(k, t);
    });
    return [...m.entries()].sort((a, b) => b[1].localeCompare(a[1])).map(([k]) => k);
}
// Flight (วาระสโม) names/numbers are always shown uppercased. Thai labels are
// unaffected by toUpperCase(), so it only caps latin names like "samo71".
const upFlight = s => (s || '').toUpperCase();
const yearKeyName = k => upFlight(k === 'all' ? 'ทุกวาระสโม' : k === 'none' ? 'ไม่ระบุวาระสโม' : (yearNameById.get(k) || 'วาระสโม'));
const seasonKeyName = k => k === 'all' ? 'ทุกซีซั่น' : k === 'none' ? 'ไม่ระบุซีซั่น' : (seasonNameById.get(k) || 'ซีซั่น');

function renderFlightLogPage() {
    const listBox = document.getElementById('flightlog-list');
    const sideBox = document.getElementById('flightlog-side');
    if (!listBox || !sideBox) return;

    // No scans yet → just the empty state (no point showing empty dropdowns).
    if (userScansCache.length === 0) {
        listBox.innerHTML = '<div class="fl-empty">No flights logged here yet ✈️</div>';
        sideBox.innerHTML = '';
        return;
    }

    // Resolve the selected วาระสโม/season, defaulting to the current ones.
    const yearKeys = flYearKeys();
    if (flYear === undefined || !yearKeys.includes(flYear)) {
        flYear = (currentYear && yearKeys.includes(currentYear.id)) ? currentYear.id : (yearKeys[0] ?? 'none');
    }
    const seasonKeys = flSeasonKeys(flYear);
    if (flSeason === undefined || (flSeason !== 'all' && !seasonKeys.includes(flSeason))) {
        flSeason = (currentSeason && seasonKeys.includes(currentSeason.id)) ? currentSeason.id : 'all';
    }

    // Scope = scans in the selected วาระสโม (+ season unless "all").
    const scope = userScansCache.filter(s =>
        (s.samo_year_id ?? 'none') === flYear &&
        (flSeason === 'all' || (s.season_id ?? 'none') === flSeason));
    // Keep the department filter in sync with the scope: if the chosen dept/sub
    // isn't present in this period, fall back to "all" (avoids an empty list while
    // the dropdown shows a stale value).
    const inScope = (get, id) => scope.some(s => get(s) === id);
    if ((flFilter.type === 'dept' && !inScope(scanDept, flFilter.id)) ||
        (flFilter.type === 'sub' && !inScope(scanSubDept, flFilter.id))) {
        flFilter = { type: 'all', id: null };
    }
    const filtered = applyFilter(scope, flFilter)
        .slice().sort((a, b) => (b.scanned_at || '').localeCompare(a.scanned_at || ''));
    const total = filtered.reduce((t, s) => t + pointsOfScan(s), 0);

    const yearOpts = yearKeys.map(k => `<option value="${k}"${k === flYear ? ' selected' : ''}>${escapeHtmlText(yearKeyName(k))}</option>`).join('');
    const seasonOpts = [`<option value="all"${flSeason === 'all' ? ' selected' : ''}>${escapeHtmlText(seasonKeyName('all'))}</option>`]
        .concat(seasonKeys.map(k => `<option value="${k}"${k === flSeason ? ' selected' : ''}>${escapeHtmlText(seasonKeyName(k))}</option>`)).join('');

    // ── Side cards: filters card + a separate summary card below it ──
    const sideHtml = `
      <div class="ls-card filter-card${flFiltersCollapsed ? ' filters-collapsed' : ''}">
        <button type="button" class="ls-title filter-toggle" aria-expanded="${!flFiltersCollapsed}">
          <span>🧭 Filter</span><span class="filter-chevron">▾</span>
        </button>
        <div class="fl-selectors">
          <select class="fl-year-select" aria-label="วาระสโม">${yearOpts}</select>
          <select class="fl-season-select" aria-label="Season">${seasonOpts}</select>
          ${deptSelectHtml(scope, flFilter)}
        </div>
      </div>
      <div class="ls-card totals-card">
        <div class="ls-title">📊 Totals</div>
        <div class="ls-summary">
          <div class="ls-row"><span class="ls-lbl">วาระสโม</span><span class="ls-val">${escapeHtmlText(yearKeyName(flYear))}</span></div>
          <div class="ls-row"><span class="ls-lbl">Quartile</span><span class="ls-val">${escapeHtmlText(seasonKeyName(flSeason))}</span></div>
          <div class="ls-row ls-total"><span class="ls-lbl">Total</span><span class="ls-val">${total}<small>km</small></span></div>
        </div>
      </div>`;

    // ── Flight list (left column) ──
    let html = '';
    if (filtered.length === 0) {
        html += '<div class="fl-empty">No flights logged here yet ✈️</div>';
    } else {
        filtered.forEach(s => {
            const seTag = flSeason === 'all' && s.season_id ? ` <small class="fl-season">${escapeHtmlText(seasonNameById.get(s.season_id) || '')}</small>` : '';
            // Meta line: when it was earned · ฝ่ายอุปนายก · sub-department
            const deptId = scanDept(s), subId = scanSubDept(s);
            const meta = [
                fmtPassportDate(s.scanned_at),
                deptId != null ? (DEPARTMENTS[deptId] || ('ฝ่าย ' + deptId)) : '',
                subId != null ? (SUBDEPARTMENTS[subId] || ('ย่อย ' + subId)) : '',
            ].filter(Boolean).map(escapeHtmlText).join(' · ');
            // Icon: reuse the activity's stamp badge (image, or ✈️ fallback).
            const act = activityById.get(s.activity_id);
            const colorCls = STAMP_COLORS[(Number(deptId) || 0) % STAMP_COLORS.length];
            const iconInner = act?.badge_url
                ? `<img src="${fixGoogleDriveUrl(act.badge_url)}" alt="${escapeHtmlText(act.badge_name || scanDisplayName(s))}">`
                : '✈️';
            html += `<div class="fl-item">
                <div class="fl-item-icon ${colorCls}">${iconInner}</div>
                <div class="fl-item-main">
                  <span class="fl-item-name">${escapeHtmlText(scanDisplayName(s))}${seTag}</span>
                  <span class="fl-item-meta">${meta}</span>
                </div>
                <span class="fl-item-km">+${pointsOfScan(s)} km</span>
              </div>`;
        });
    }
    listBox.innerHTML = html;
    sideBox.innerHTML = sideHtml;

    sideBox.querySelector('.fl-year-select')?.addEventListener('change', e => {
        flYear = e.target.value; flSeason = undefined; // re-default the season for the new year
        renderFlightLogPage();
    });
    sideBox.querySelector('.fl-season-select')?.addEventListener('change', e => {
        flSeason = e.target.value; renderFlightLogPage();
    });
    sideBox.querySelector('.seg-select')?.addEventListener('change', e => {
        flFilter = parseDeptValue(e.target.value); renderFlightLogPage();
    });
    // Mobile: collapse/expand the Filter card body. Toggle the class live (no
    // re-render) and remember the state so it survives a later re-render.
    sideBox.querySelector('.filter-toggle')?.addEventListener('click', e => {
        flFiltersCollapsed = !flFiltersCollapsed;
        const card = e.currentTarget.closest('.filter-card');
        card.classList.toggle('filters-collapsed', flFiltersCollapsed);
        e.currentTarget.setAttribute('aria-expanded', String(!flFiltersCollapsed));
    });
}

// All-users leaderboard data (snapshot dept/season), fetched once.
let lbPageScans = null;
let lbPageNames = null;

async function ensureLbPageData() {
    if (lbPageScans) return true;
    // Names come from passport.leaderboard_names() rather than a `profiles` read.
    // profiles carries every student's EMAIL, and a table read hands over whole
    // rows — so selecting `id, full_name` from it only looked narrow: the policy
    // that allowed it (`profiles_read_all using (true)`) allowed email too, to
    // anyone holding the bundled anon key. The RPC is a projection of exactly
    // (id, full_name), for participants only, and requires a session.
    const [{ data: scans, error: e1 }, { data: names, error: e2 }] = await Promise.all([
        supabase.from('scans').select('user_id, activity_id, points_awarded, samo_year_id, season_id, department_id, sub_department_id, scanned_at'),
        supabase.rpc('leaderboard_names'),
    ]);
    if (e1 || e2) return false;
    lbPageScans = scans || [];
    lbPageNames = new Map((names || []).map(p => [p.id, p.full_name]));
    return true;
}

// Distinct วาระสโม / season keys present across ALL scans, newest-first (mirrors the
// Flight Log helpers but global, not just the current user's scans).
function lbYearKeys() {
    const m = new Map();
    (lbPageScans || []).forEach(s => {
        const k = s.samo_year_id ?? 'none', t = s.scanned_at || '';
        if (!m.has(k) || t > m.get(k)) m.set(k, t);
    });
    return [...m.entries()].sort((a, b) => b[1].localeCompare(a[1])).map(([k]) => k);
}
function lbSeasonKeys(yearKey) {
    const m = new Map();
    (lbPageScans || []).forEach(s => {
        if ((s.samo_year_id ?? 'none') !== yearKey) return;
        const k = s.season_id ?? 'none', t = s.scanned_at || '';
        if (!m.has(k) || t > m.get(k)) m.set(k, t);
    });
    return [...m.entries()].sort((a, b) => b[1].localeCompare(a[1])).map(([k]) => k);
}

function lbPageRanking() {
    const totals = new Map();
    (lbPageScans || []).forEach(s => {
        if ((s.samo_year_id ?? 'none') !== lbYear) return;
        if (lbSeason !== 'all' && (s.season_id ?? 'none') !== lbSeason) return;
        if (lbpFilter.type === 'dept' && (s.department_id ?? null) !== lbpFilter.id) return;
        if (lbpFilter.type === 'sub' && (s.sub_department_id ?? null) !== lbpFilter.id) return;
        totals.set(s.user_id, (totals.get(s.user_id) || 0) + (s.points_awarded || 0));
    });
    // Status tier reflects the km earned in the selected period (the row's pts).
    return [...totals.entries()]
        .map(([uid, pts]) => ({ uid, pts, name: lbPageNames.get(uid) || 'Traveler', tier: statusTierName(pts) }))
        .sort((a, b) => b.pts - a.pts);
}

// Cabin layout per Status tier, laid out like a real aircraft: First (Pioneer) is a
// roomy 4-abreast at the nose, Business (Pathfinder/Voyager) 8-abreast in the middle,
// Economy (Explorer/Adventurer + default) 10-abreast toward the back. "I" is skipped the
// way airlines do. `rows` is the cabin's row count starting at `rowMin`. First/Business
// are fixed cabins; Economy `grows` — `rows` is a realistic *minimum* that expands when
// the crowd outgrows it, so the plane gains rows instead of running out of seats.
function cabinLayout(tier) {
    if (tier === 'Pioneer')                              // First — 4/row, 4 rows
        return { letters: ['A', 'C', 'D', 'F'], rowMin: 1, rows: 4, grows: false };
    if (tier === 'Pathfinder' || tier === 'Voyager')     // Business — 8/row, 10 rows
        return { letters: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], rowMin: 5, rows: 10, grows: false };
    return { letters: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K'], rowMin: 20, rows: 39, grows: true }; // Economy — 10/row, 39+ rows
}

// Decorative but stable boarding-pass seat (e.g. "12C"), derived from the user id so it
// never changes per reload. The cabin (rows + seats/row) follows the Status tier. Row and
// letter use different bits of the hash so they don't correlate. `population` is the head
// count in this cabin: Economy adds rows so the plane is at least as big as the crowd
// (10/row), keeping a realistic minimum; First/Business are fixed and ignore it.
function seatCode(uid, tier, population = 0) {
    let h = 0; const s = String(uid || '');
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    const { letters, rowMin, rows, grows } = cabinLayout(tier);
    const rowSpan = grows ? Math.max(rows, Math.ceil(population / letters.length)) : rows;
    const row = rowMin + (h % rowSpan);
    const letter = letters[(h >>> 8) % letters.length];
    return `${row}${letter}`;
}

async function renderLeaderboardPage() {
    const box = document.getElementById('leaderboard-content');
    if (!box) return;
    const winEl = document.getElementById('lbp-window');
    if (winEl) winEl.textContent = currentYear ? upFlight(currentYear.name) : '—';

    box.innerHTML = '<p class="lb-loading">Loading…</p>';
    if (!(await ensureLbPageData())) { box.innerHTML = '<p class="lb-loading">Could not load leaderboard.</p>'; return; }

    // Resolve the selected วาระสโม / season (default to the current ones), mirroring
    // the Flight Log filter resolution.
    const yearKeys = lbYearKeys();
    if (lbYear === undefined || !yearKeys.includes(lbYear)) {
        lbYear = (currentYear && yearKeys.includes(currentYear.id)) ? currentYear.id : (yearKeys[0] ?? 'none');
    }
    const seasonKeys = lbSeasonKeys(lbYear);
    if (lbSeason !== 'all' && !seasonKeys.includes(lbSeason)) lbSeason = 'all';

    // Keep the dept filter in scope: if the chosen dept/sub isn't present in the
    // selected period, fall back to "all" (avoids an empty board on a stale value).
    const scopeScans = (lbPageScans || []).filter(s =>
        (s.samo_year_id ?? 'none') === lbYear &&
        (lbSeason === 'all' || (s.season_id ?? 'none') === lbSeason));
    const inScope = (key, id) => scopeScans.some(s => (s[key] ?? null) === id);
    if ((lbpFilter.type === 'dept' && !inScope('department_id', lbpFilter.id)) ||
        (lbpFilter.type === 'sub' && !inScope('sub_department_id', lbpFilter.id))) {
        lbpFilter = { type: 'all', id: null };
    }

    const rows = lbPageRanking();
    const medals = ['🥇', '🥈', '🥉'];

    // ── Filter card (year / quartile / dept — same controls as the Flight Log) ──
    const yearOpts = yearKeys.map(k => `<option value="${k}"${k === lbYear ? ' selected' : ''}>${escapeHtmlText(yearKeyName(k))}</option>`).join('');
    const seasonOpts = [`<option value="all"${lbSeason === 'all' ? ' selected' : ''}>${escapeHtmlText(seasonKeyName('all'))}</option>`]
        .concat(seasonKeys.map(k => `<option value="${k}"${k === lbSeason ? ' selected' : ''}>${escapeHtmlText(seasonKeyName(k))}</option>`)).join('');
    const filterCard = `
      <div class="ls-card filter-card${lbFiltersCollapsed ? ' filters-collapsed' : ''}">
        <button type="button" class="ls-title filter-toggle" aria-expanded="${!lbFiltersCollapsed}">
          <span>🧭 Filter</span><span class="filter-chevron">▾</span>
        </button>
        <div class="fl-selectors">
          <select class="lb-year-select" aria-label="วาระสโม">${yearOpts}</select>
          <select class="lb-season-select" aria-label="Season">${seasonOpts}</select>
          ${deptSelectHtml(scopeScans, lbpFilter)}
        </div>
      </div>`;

    // ── Your Stats card ──
    const myIdx = rows.findIndex(r => r.uid === currentUserId);
    const myRow = myIdx >= 0 ? rows[myIdx] : null;
    // Distinct stamps the current user earned within the selected filter period.
    const periodStamps = new Set((lbPageScans || []).filter(s =>
        s.user_id === currentUserId &&
        (s.samo_year_id ?? 'none') === lbYear &&
        (lbSeason === 'all' || (s.season_id ?? 'none') === lbSeason) &&
        (lbpFilter.type !== 'dept' || (s.department_id ?? null) === lbpFilter.id) &&
        (lbpFilter.type !== 'sub' || (s.sub_department_id ?? null) === lbpFilter.id)
    ).map(s => s.activity_id)).size;
    // Status mirrors the period total shown in this card (myRow.pts).
    const statusTier = statusTierName(myRow ? myRow.pts : 0);
    const statsCard = `
      <div class="ls-card lb-stats-card">
        <div class="ls-title">📊 Your Stats</div>
        <div class="ls-summary">
          <div class="ls-row"><span class="ls-lbl">Rank</span><span class="ls-val">${myRow ? `#${myIdx + 1} of ${rows.length}` : '—'}</span></div>
          <div class="ls-row"><span class="ls-lbl">Total km</span><span class="ls-val">${myRow ? myRow.pts.toLocaleString() : 0} km</span></div>
          <div class="ls-row"><span class="ls-lbl">Total Stamps</span><span class="ls-val">${periodStamps}</span></div>
          <div class="ls-row"><span class="ls-lbl">Status</span><span class="ls-val">${escapeHtmlText(statusTier)}</span></div>
        </div>
      </div>`;

    // ── Top 3 Podium card (2nd · 1st · 3rd bar chart) ──
    const top3 = rows.slice(0, 3);
    let podiumCard = '';
    if (top3.length) {
        const maxPts = Math.max(...top3.map(r => r.pts), 1);
        const podOrder = [1, 0, 2]; // render 2nd, 1st, 3rd
        const bars = podOrder.filter(i => top3[i]).map(i => {
            const r = top3[i];
            const h = 34 + Math.round((r.pts / maxPts) * 46); // 34–80px
            const place = ['1st', '2nd', '3rd'][i];
            return `<div class="lb-pod-col lb-pod-${i + 1}${r.uid === currentUserId ? ' lb-me' : ''}" title="${escapeHtmlText(r.name)} · ${r.pts} km">
                <div class="lb-pod-name">${escapeHtmlText(r.name.split(/\s+/)[0] || r.name)}</div>
                <div class="lb-pod-bar" style="height:${h}px">${medals[i]}</div>
                <div class="lb-pod-place">${place}</div>
              </div>`;
        }).join('');
        podiumCard = `
          <div class="ls-card lb-podium-card">
            <div class="ls-title">🏆 Top 3 Podium</div>
            <div class="lb-podium">${bars}</div>
          </div>`;
    }

    // ── Top Passengers list (top 10) ──
    const scopeName = `${yearKeyName(lbYear)} · ${lbSeason === 'all' ? 'All time' : seasonKeyName(lbSeason)}`.toUpperCase();
    let listHtml;
    if (rows.length === 0) {
        listHtml = '<div class="lb-empty">No rankings yet ✈️</div>';
    } else {
        // Economy cabin grows with its crowd, so the seat needs the cabin head count.
        const econPop = rows.filter(r => cabinLayout(r.tier).grows).length;
        listHtml = rows.slice(0, 10).map((r, i) => {
            const rk = i + 1;
            const initial = escapeHtmlText((r.name.trim()[0] || '?').toUpperCase());
            const medal = rk <= 3 ? `<span class="lb-medal">${medals[rk - 1]}</span>` : '';
            const youPill = r.uid === currentUserId ? '<span class="lb-you">🪪 you</span>' : '';
            return `<div class="lb-row${r.uid === currentUserId ? ' lb-me' : ''}">
                <span class="lb-rank r${rk}">${rk}</span>
                <div class="lb-av">${initial}${medal}</div>
                <div class="lb-info">
                  <div class="lb-name">${escapeHtmlText(r.name)}${youPill}</div>
                  <div class="lb-badge">${escapeHtmlText(r.tier)} · ${seatCode(r.uid, r.tier, econPop)}</div>
                </div>
                <div class="lb-km-wrap"><div class="lb-km">${r.pts.toLocaleString()}</div><div class="lb-kmu">km</div></div>
              </div>`;
        }).join('');
    }

    box.innerHTML = `
      <div class="lb-grid">
        <div class="lb-card lb-main">
          <div class="lb-head">
            <span class="lb-head-title">Top Passengers ✈️</span>
            <span class="lb-head-sub">${escapeHtmlText(scopeName)}</span>
          </div>
          <div class="lb-list">${listHtml}</div>
        </div>
        <aside class="lb-side">
          ${filterCard}
          ${statsCard}
          ${podiumCard}
        </aside>
      </div>`;

    box.querySelector('.lb-year-select')?.addEventListener('change', e => {
        lbYear = e.target.value; lbSeason = 'all'; // re-default the season for the new year
        renderLeaderboardPage();
    });
    box.querySelector('.lb-season-select')?.addEventListener('change', e => {
        lbSeason = e.target.value; renderLeaderboardPage();
    });
    box.querySelector('.seg-select')?.addEventListener('change', e => {
        lbpFilter = parseDeptValue(e.target.value); renderLeaderboardPage();
    });
    box.querySelector('.filter-toggle')?.addEventListener('click', e => {
        lbFiltersCollapsed = !lbFiltersCollapsed;
        const card = e.currentTarget.closest('.filter-card');
        card.classList.toggle('filters-collapsed', lbFiltersCollapsed);
        e.currentTarget.setAttribute('aria-expanded', String(!lbFiltersCollapsed));
    });
}

// ─── Main init ────────────────────────────────────────────
async function init() {
    document.getElementById('logout-btn').addEventListener('click', async (e) => {
        e.preventDefault();
        await logout();
    });
    const pmLogout = document.getElementById('pm-logout');
    if (pmLogout) pmLogout.addEventListener('click', async () => { await logout(); });

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

    document.getElementById('modal-remove')?.addEventListener('click', removeOwnScan);

    // Edit name
    document.getElementById('edit-name-btn').addEventListener('click', editName);

    // Stamp search
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
    document.getElementById('modal-memory-text').addEventListener('focus', () => {
        setTimeout(() => {
            document.getElementById('modal-memory-text')
                .scrollIntoView({ block: 'center', behavior: 'smooth' });
        }, 300);
    });

    // Data backup
    document.getElementById('backup-info-btn')?.addEventListener('click', () => {
        showToast('Backup saves your profile photo, activity memories & notes (kept only on this device) to a file.', 4200);
    });
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

    // ── kkumail-only gate ───────────────────────────────────
    // Blocks non-kkumail accounts and accounts whose data was migrated away.
    // Runs BEFORE the pending-scan redirect so a blocked user isn't bounced to
    // the scan page, and before ensureProfile so no junk profile is created.
    const access = await getPassportAccess(user);
    if (access.status === 'moved' || access.status === 'blocked') { renderAccessBlock(access); return; }

    const pendingUrl = getPendingScanUrl();
    if (pendingUrl) { clearPendingScanUrl(); window.location.href = pendingUrl; return; }

    currentUserId = user.id;
    await ensureProfile(user);   // create passport profile if this user has none yet
    if (access.receivedFrom) renderReceivedBanner(access.receivedFrom);
    setupProfilePhoto(currentUserId);

    // ── Display name ────────────────────────────────────────
    let displayName = user.user_metadata?.full_name
        || user.user_metadata?.name
        || user.email?.split('@')[0]
        || 'Traveler';

    setPassportName(displayName);
    currentUserName = displayName;

    // ── Profile ──────────────────────────────────────────────
    // Status (tier) is derived from total km after scans load (setStatusTier);
    // user_tiers still supplies the stored name + travel-visa flag.
    const { data: profileTier, error: profileError } = await supabase
        .from('user_tiers')
        .select('*')
        .eq('id', user.id)
        .single();

    if (!profileError && profileTier) {
        if (profileTier.full_name) { setPassportName(profileTier.full_name); currentUserName = profileTier.full_name; }
        if (profileTier.has_travel_visa) {
            document.getElementById('visa-visa').style.display = '';
        }
    }

    // ── Activities & scans ──────────────────────────────────
    try {
        const [
            { data: scans, error: scansError },
            { data: allActivities, error: actError },
            { data: allCerts },
            samoCtx,
            { data: samoSeasonRows },
            { data: samoYearRows },
        ] = await Promise.all([
            supabase.from('scans').select('*').eq('user_id', user.id).order('scanned_at', { ascending: false }),
            supabase.from('activities').select('*').order('created_at', { ascending: true }),
            supabase.from('certificates').select('*').order('created_at', { ascending: true }),
            getCurrentContext().catch(() => ({ year: null, season: null })),
            supabase.from('samo_seasons').select('id, name'),
            supabase.from('samo_years').select('id, name'),
        ]);

        if (scansError) throw scansError;
        if (actError) throw actError;

        userScansCache = scans;
        activityById.clear();
        allActivities.forEach(a => activityById.set(a.id, a));

        // Current SamoYear / Season (new immutable model) + season-name map.
        currentYear = samoCtx?.year || null;
        currentSeason = samoCtx?.season || null;
        seasonNameById.clear();
        (samoSeasonRows || []).forEach(s => seasonNameById.set(s.id, s.name));
        yearNameById.clear();
        (samoYearRows || []).forEach(y => yearNameById.set(y.id, y.name));

        // Passport identity meta (no., issued/expires, MRZ) now that the วาระสโม is loaded.
        renderPassportMeta();

        // Group certificate templates by activity (ignore errors — certs are optional)
        certsByActivity.clear();
        (allCerts || []).forEach(c => {
            if (!certsByActivity.has(c.activity_id)) certsByActivity.set(c.activity_id, []);
            certsByActivity.get(c.activity_id).push(c);
        });

        // Headline KM = SamoYear total; the Log-tab banner label shows the current
        // season's points. Falls back to the legacy calendar-วาระ window if no year
        // is declared yet.
        let yearKm = 0;
        let windowLabelText = 'Distance traveled';
        if (currentYear) {
            yearKm = scans.filter(s => s.samo_year_id === currentYear.id).reduce((t, s) => t + pointsOfScan(s), 0);
            const seasonKm = currentSeason
                ? scans.filter(s => s.season_id === currentSeason.id).reduce((t, s) => t + pointsOfScan(s), 0)
                : 0;
            windowLabelText = currentSeason
                ? `${upFlight(currentYear.name)} · ${currentSeason.name}: ${seasonKm} km`
                : upFlight(currentYear.name);
        } else {
            const win = currentVaraWindow();
            scans.forEach(s => {
                const d = (s.scanned_at || '').slice(0, 10);
                if (d >= win.start && d <= win.end) yearKm += pointsOfScan(s);
            });
            windowLabelText = upFlight(win.name);
        }
        const sideKm = document.getElementById('side-km');
        if (sideKm) sideKm.textContent = yearKm.toLocaleString();

        // ── Top bar flight chip ──────────────────────────────
        const tbChip = document.getElementById('tb-flight-chip');
        if (tbChip && currentYear) tbChip.textContent = `✈ ${upFlight(currentYear.name)}`;
        const pageFlight = document.getElementById('page-flight-label');
        if (pageFlight && currentYear) pageFlight.textContent = `Flight ${upFlight(currentYear.name)}`;

        // ── Stat banner (Log tab) ─────────────────────────────
        const totalKmEl = document.getElementById('log-total-km');
        const windowLabelEl = document.getElementById('log-window-label');
        const barFillEl = document.getElementById('log-bar-fill');
        const activitiesEl = document.getElementById('log-activities');
        const stampsCountEl = document.getElementById('log-stamps-count');
        const seasonKmEl = document.getElementById('log-season-km');

        if (totalKmEl) totalKmEl.textContent = yearKm;
        if (windowLabelEl) windowLabelEl.textContent = windowLabelText;
        // Bar + "Km to next" mini-stat track progress to the next status: the bar
        // fills with km earned in the current 2,000 km tier; the mini-stat shows
        // km remaining (lifetime journey to the status goal).
        const lifetimeKm = scans.reduce((t, s) => t + pointsOfScan(s), 0);
        setStatusTier(lifetimeKm);
        const toNextStatus = kmToNextStatus(lifetimeKm);
        if (barFillEl) barFillEl.style.width = kmStatusProgressPct(lifetimeKm) + '%';
        if (activitiesEl) activitiesEl.textContent = scans.length;
        if (stampsCountEl) stampsCountEl.textContent = toNextStatus > 0 ? toNextStatus.toLocaleString() : 'Max';
        const seasonKmVal = currentSeason
            ? scans.filter(s => s.season_id === currentSeason.id).reduce((t, s) => t + pointsOfScan(s), 0)
            : 0;
        if (seasonKmEl) seasonKmEl.textContent = seasonKmVal;

        // ── Stamp pages ──────────────────────────────────────
        buildStampPages(allActivities, scans);

    } catch (err) {
        console.error('Failed to load activities:', err);
        const flc = document.getElementById('flightlog-list');
        if (flc) flc.innerHTML = `<div style="color:var(--accent-danger);font-size:0.85rem;padding:12px;">Error loading activities.</div>`;
        const sideKm = document.getElementById('side-km');
        if (sideKm) sideKm.textContent = '0';
        setStatusTier(0);
        buildStampPages([], []);
    }

    // If the user tapped a data-heavy tab (Log/Leaderboard) before scans finished
    // loading, the parse-time switchTab already swapped the pane but the module
    // wasn't ready to render it. Render the now-active tab once data is in.
    renderTab(window.__getActiveTab ? window.__getActiveTab() : 'passport');
}

init();
