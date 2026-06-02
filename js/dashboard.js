// js/dashboard.js — Passport ebook with memory popup
import { supabase } from './app.js';
import { checkSession, logout } from './auth.js';
import { fixGoogleDriveUrl, getPendingScanUrl, clearPendingScanUrl } from './utils.js';
import { ROUTES } from './routes.js';

// ─── State ───────────────────────────────────────────────
let currentPageIndex = 0;
let totalPages = 2; // cover + info (stamp pages added dynamically)
let currentUserId = null;
let currentModalActivity = null;
let currentModalScan = null;

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
    const numStampPages = Math.ceil(allActivities.length / STAMPS_PER_PAGE);
    const book = document.getElementById('page-1').parentElement; // passport-container

    // Activity stamp pages
    for (let p = 0; p < numStampPages; p++) {
        const pageActivities = allActivities.slice(p * STAMPS_PER_PAGE, (p + 1) * STAMPS_PER_PAGE);
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

    showModal();
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

function showModal() {
    const modal = document.getElementById('memory-modal');
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

function closeModal() {
    const modal = document.getElementById('memory-modal');
    modal.style.display = 'none';
    modal.classList.remove('view-mode');
    document.body.style.overflow = '';
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

    // ── Profile / tier ──────────────────────────────────────
    const pTier = document.getElementById('p-tier');
    const { data: profileTier, error: profileError } = await supabase
        .from('user_tiers')
        .select('*')
        .eq('id', user.id)
        .single();

    if (!profileError && profileTier) {
        if (profileTier.full_name) { pName.textContent = profileTier.full_name; }
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
        const [{ data: scans, error: scansError }, { data: allActivities, error: actError }] = await Promise.all([
            supabase.from('scans').select('*').eq('user_id', user.id),
            supabase.from('activities').select('*').order('created_at', { ascending: true }),
        ]);

        if (scansError) throw scansError;
        if (actError) throw actError;

        // Total KM
        let totalKm = 0;
        scans.forEach(s => {
            const act = allActivities.find(a => a.id === s.activity_id);
            totalKm += s.points_awarded || act?.base_points_km || 0;
        });
        const dbTotal = profileTier?.total_km || 0;
        pKm.textContent = Math.max(dbTotal, totalKm);
        pKm.classList.remove('skeleton');

        // ── Activity log (page 2) ────────────────────────────
        const logList = document.getElementById('activity-list');
        logList.innerHTML = '';
        if (scans.length === 0) {
            logList.innerHTML = '<div style="opacity:0.5;font-size:0.85rem;text-align:center;padding-top:20px;">No activities yet — start scanning! ✈️</div>';
        } else {
            // Show most recent first
            const sorted = [...scans].reverse().slice(0, 20);
            sorted.forEach(scan => {
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
