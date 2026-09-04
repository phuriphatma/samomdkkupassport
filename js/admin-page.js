// js/admin-page.js — Admin terminal logic
// `adminDb` is a LIVE BINDING (app.js): it points at the normal client, or at the
// legacy-admin client once admin/1234 signs in. Every DATA call in this file goes
// through it; auth calls stay on `supabase` so the Google sign-in and sign-out
// always act on the user's own session, never the shared one.
import { supabase, adminDb } from './app.js';
import { generateUUID, fixGoogleDriveUrl } from './utils.js';
import { ROUTES } from './routes.js';
import { renderCertificate, loadCertImage, CERT_FONTS } from './certificate.js';
import { uploadToDrive, deleteFromDrive, deleteFromDriveBeacon, isUploadConfigured } from './upload.js';
import { getCurrentContext } from './samo.js';
import { DEPARTMENTS, SUBDEPARTMENTS } from './constants.js';
import {
    getAdminScope, scopeCoversActivity, allowedDeptIds, allowedSubIdsForDept, scopeLabel,
    LEGACY_PASSWORD_LOGIN, getLegacyScope, legacyLogin, clearLegacySession,
    ensureLegacySession,
} from './admin-scope.js';

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

// --- CONFIG ---
const SUB_DEPT_OPTIONS = {
    '3': [{ value: '1', label: 'โครงการ' }, { value: '2', label: 'ชุมนุม' }],
    '5': [{ value: '3', label: 'จิตอาสา' }, { value: '4', label: '7 คณะ' }]
};

// --- STATE ---
let currentActivityId = null;
let editingActivityId = null;

// Who the signed-in admin is and which ฝ่าย they administer, from the ทีม SAMO
// tree via public.passport_admin_context(). Null until bootAdminAuth() resolves;
// every scope check treats null as "not an admin" (fail closed).
let adminScope = null;
const isAllDepts = () => adminScope?.allDepartments === true;

// --- QR GENERATION ---
let currentQrUrl = null;          // last static scan URL — rendered hi-res into the poster
let currentQrActivity = null;     // { name, badge_url } baked into the poster
let currentPosterDataUrl = null;  // the built poster PNG (shown on screen + downloaded)

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

    document
        .getElementById('admin-google-btn')
        .addEventListener('click', signInWithGoogle);
    document
        .getElementById('admin-switch-btn')
        .addEventListener('click', signOutAdmin);
    // TEMPORARY — legacy password form (see admin-scope.js LEGACY ESCAPE HATCH).
    document
        .getElementById('admin-login-form')
        ?.addEventListener('submit', handleLegacyLogin);
    document
        .getElementById('activity-form')
        .addEventListener('submit', createActivity);
    document
        .getElementById('edit-activity-form')
        .addEventListener('submit', submitEditActivity);
    document
        .getElementById('admin-logout')
        .addEventListener('click', signOutAdmin);

    document
        .getElementById('filter-department')
        .addEventListener('change', renderActivityList);

    document
        .getElementById('filter-sub-department')
        .addEventListener('change', renderActivityList);

    document
        .getElementById('search-activity')
        .addEventListener('input', renderActivityList);

    document
        .getElementById('filter-samoyear')
        .addEventListener('change', () => { populateActivitySamoFilters(); renderActivityList(); });

    document
        .getElementById('filter-season')
        .addEventListener('change', renderActivityList);

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

    // Live stamp preview under each badge-image field (must run after wireUpload so
    // it can anchor below the upload row when drag-drop is wired).
    wireStampPreview('act-badge-url');
    wireStampPreview('edit-badge-url');

    // Leaderboard filters (period = SamoYear → Season, + department/sub-dept)
    document.getElementById('lb-year').addEventListener('change', () => { populateLbSeasonsForYear(); renderAdminLeaderboard(); });
    document.getElementById('lb-season').addEventListener('change', renderAdminLeaderboard);
    document.getElementById('lb-department').addEventListener('change', onLbDeptChange);
    document.getElementById('lb-subdepartment').addEventListener('change', renderAdminLeaderboard);
    document.getElementById('lb-csv-btn').addEventListener('click', downloadLeaderboardCsv);

    const downloadBtn = document.getElementById('download-qr-btn');
    if (downloadBtn) {
        downloadBtn.addEventListener('click', downloadQrPoster);
    }

    // Last: resolve identity, then open (or refuse) the panel. Awaited so nothing
    // below can observe a half-known scope.
    await bootAdminAuth();
}

// Download the poster currently shown on screen (built in generateStaticQR). Rebuilds
// on demand if it isn't ready yet.
async function downloadQrPoster() {
    try {
        let dataUrl = currentPosterDataUrl;
        if (!dataUrl) {
            if (!currentQrUrl) { alert('QR Code is still rendering. Please try again in a moment.'); return; }
            dataUrl = await buildQrPoster(makeQrDataUrl(currentQrUrl, 880), (currentQrActivity?.name || '').trim(), currentQrActivity?.badge_url || '');
        }
        const link = document.createElement('a');
        link.href = dataUrl;
        link.download = `qr-${currentActivityId || 'code'}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    } catch (err) {
        console.error(err);
        alert('Could not build the image: ' + (err.message || err));
    }
}

// Render an off-screen QR at an arbitrary size and return its PNG data URL (sync —
// the CDN QRCode lib draws to a <canvas> immediately).
function makeQrDataUrl(text, size) {
    try {
        const holder = document.createElement('div');
        new QRCode(holder, { width: size, height: size, correctLevel: QRCode.CorrectLevel.M }).makeCode(text);
        const canvas = holder.querySelector('canvas');
        if (canvas) return canvas.toDataURL('image/png');
        const img = holder.querySelector('img');
        return img && img.src ? img.src : '';
    } catch {
        return '';
    }
}

// The designed poster background (public/qr-poster-template.png). Everything decorative —
// MDKKU PASSPORT title, tagline, globe/postmark, world-map band, SAMO logo, footer, and the
// empty QR box outline — is baked into this image. Only the QR and the activity name are
// drawn on at run time. BASE_URL-prefixed so it resolves under the '/passport/' subpath on
// the KKU VM (a root-absolute '/qr-poster-template.png' would 404 there — see routes.js).
const POSTER_TEMPLATE = import.meta.env.BASE_URL + 'qr-poster-template.png';
const POSTER_W = 1086, POSTER_H = 1448;  // native template size (px)
// Slots measured from the template: the QR sits centred inside the box outline; the name
// occupies the blank band between the box and the world-map band.
const QR_CX = 540, QR_CY = 707, QR_SIZE = 430;
const NAME_TOP = 963, NAME_BOTTOM = 1112, NAME_CX = 540, NAME_MAXW = 720;
// The activity badge, drawn as a passport stamp, sits in the empty centre of the
// world-map band (the map continents sit either side of it).
const STAMP_CX = 540, STAMP_CY = 1208, STAMP_SIZE = 150;

// Draw the live QR + activity name (+ badge stamp) onto the designed template; return a PNG data URL.
async function buildQrPoster(qrDataUrl, name, badgeUrl) {
    if (document.fonts?.ready) await document.fonts.ready; // Thai/Nunito metrics before measuring

    const [template, qrImg] = await Promise.all([
        loadImageEl(POSTER_TEMPLATE),
        loadImageEl(qrDataUrl),
    ]);
    let badgeImg = null;
    if (badgeUrl) {
        // CORS-safe (fixGoogleDriveUrl → lh3); skip the stamp if the image can't load.
        try { badgeImg = await loadCertImage(badgeUrl); }
        catch { badgeImg = null; console.warn('[poster] badge image failed to load; stamp omitted:', badgeUrl); }
    }

    const SS = 2;                       // supersample so overlaid text stays crisp
    const fam = "Nunito, 'Noto Sans Thai', system-ui, sans-serif";
    const nameWeight = 700, nameColor = '#1e3a5f';

    const canvas = document.createElement('canvas');
    canvas.width = POSTER_W * SS; canvas.height = POSTER_H * SS;
    const ctx = canvas.getContext('2d');
    ctx.scale(SS, SS);

    // Full-bleed template, then the QR centred in its box (white quiet-zone covers the
    // box interior; the printed blue outline stays visible around it).
    ctx.drawImage(template, 0, 0, POSTER_W, POSTER_H);
    ctx.drawImage(qrImg, QR_CX - QR_SIZE / 2, QR_CY - QR_SIZE / 2, QR_SIZE, QR_SIZE);

    // Activity name: wrap to the box width, shrink to fit the band, then vertically centre.
    if (name) {
        ctx.fillStyle = nameColor;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        const bandH = NAME_BOTTOM - NAME_TOP;
        let size = 36, lines, blockH;
        for (;;) {
            ctx.font = `${nameWeight} ${size}px ${fam}`;
            lines = wrapLines(ctx, name, NAME_MAXW);
            blockH = lines.length * size * 1.32;
            if (blockH <= bandH || size <= 20) break;
            size -= 2;
        }
        const lineH = size * 1.32;
        const top = NAME_TOP + Math.max(0, (bandH - blockH) / 2);
        lines.forEach((ln, i) => ctx.fillText(ln, NAME_CX, top + size + i * lineH));
    }

    // Activity badge as a passport stamp, centred in the world-map band.
    if (badgeImg) {
        const [grain, grainFilled] = await Promise.all([
            loadImageEl(STAMP_GRAIN), loadImageEl(STAMP_GRAIN_FILLED),
        ]).catch(() => [null, null]); // grain is decorative — render without it if it fails
        const stamp = renderStampCanvas(badgeImg, STAMP_SIZE * SS, grain, grainFilled);
        ctx.save();
        ctx.shadowColor = 'rgba(60,45,20,.3)';
        ctx.shadowBlur = 7;
        ctx.shadowOffsetY = 4;
        ctx.drawImage(stamp, STAMP_CX - STAMP_SIZE / 2, STAMP_CY - STAMP_SIZE / 2, STAMP_SIZE, STAMP_SIZE);
        ctx.restore();
    }

    return canvas.toDataURL('image/png');
}

function loadImageEl(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('image load failed'));
        img.src = src;
    });
}

// Compounds the ICU dictionary splits but that should never break across lines (e.g.
// ปีการศึกษา → ปี + การศึกษา). Add phrases here to keep them on one row.
const KEEP_TOGETHER = ['ปีการศึกษา'];

// Whole dates must stay on one line (Thai + English + numeric). Each pattern matches a
// full date so it becomes one unbreakable token: "21 มิ.ย. 2569", "21 มิถุนายน 2569",
// "21 Jun 2026", "June 21, 2026", "21/06/2026", "2026-06-21".
const _TH_MONTH = 'ม\\.?ค\\.?|ก\\.?พ\\.?|มี\\.?ค\\.?|เม\\.?ย\\.?|พ\\.?ค\\.?|มิ\\.?ย\\.?|ก\\.?ค\\.?|ส\\.?ค\\.?|ก\\.?ย\\.?|ต\\.?ค\\.?|พ\\.?ย\\.?|ธ\\.?ค\\.?|มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม';
const _EN_MONTH = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\\.?';
const DATE_PATTERNS = [
    new RegExp(`\\d{1,2}\\s*(?:${_TH_MONTH})\\s*\\d{2,4}`, 'g'),
    new RegExp(`\\d{1,2}\\s+${_EN_MONTH}\\s*,?\\s*\\d{2,4}`, 'gi'),
    new RegExp(`${_EN_MONTH}\\s+\\d{1,2}\\s*,?\\s*\\d{2,4}`, 'gi'),
    /\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}/g,
];

// Character ranges in `text` that must not be split (KEEP_TOGETHER phrases + dates),
// expanded over any wrapping brackets/quotes so e.g. "(21 มิ.ย. 2569)" stays whole.
function protectedRanges(text) {
    const ranges = [];
    for (const phrase of KEEP_TOGETHER) {
        for (let i = text.indexOf(phrase); i !== -1; i = text.indexOf(phrase, i + phrase.length)) {
            ranges.push([i, i + phrase.length]);
        }
    }
    for (const re of DATE_PATTERNS) for (const m of text.matchAll(re)) ranges.push([m.index, m.index + m[0].length]);
    const open = '([{“"\'', close = ')]}”"\'';
    return ranges.map(([s, e]) => {
        while (s > 0 && open.includes(text[s - 1])) s--;
        while (e < text.length && close.includes(text[e])) e++;
        return [s, e];
    });
}

// Split text into break units: real Thai words via Intl.Segmenter (ICU dictionary —
// Thai has no spaces, so this is the only way to break between words, not mid-syllable),
// with spaces/punctuation as their own tokens. Falls back to space-splitting. Segments
// inside a protected range (compound / date) are merged into one unbreakable token.
function segmentWords(text) {
    const ranges = protectedRanges(text);
    const rangeAt = (i) => ranges.find(([s, e]) => i >= s && i < e) || null;

    let segs;
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
        try { segs = [...new Intl.Segmenter('th', { granularity: 'word' }).segment(text)].map(s => ({ t: s.segment, i: s.index })); }
        catch { /* fall through to the simple splitter */ }
    }
    if (!segs) { segs = []; let idx = 0; for (const t of text.split(/(\s+)/)) { if (t !== '') segs.push({ t, i: idx }); idx += t.length; } }

    const out = [];
    let buf = '', bufRange = null;
    const flushBuf = () => { if (buf) out.push(buf); buf = ''; bufRange = null; };
    for (const { t, i } of segs) {
        const r = rangeAt(i);
        if (r) {
            if (bufRange && r[0] === bufRange[0] && r[1] === bufRange[1]) buf += t; // same protected span
            else { flushBuf(); buf = t; bufRange = r; }
        } else {
            flushBuf();
            out.push(t);
        }
    }
    flushBuf();
    return out;
}

// Wrap the name to fit maxW, breaking at Thai word boundaries / spaces. A single
// segment wider than the line is char-broken as a last resort so nothing overflows.
function wrapLines(ctx, text, maxW) {
    const lines = [];
    let line = '';
    const flush = () => { lines.push(line.replace(/\s+$/, '')); line = ''; };
    for (const tok of segmentWords(text)) {
        if (ctx.measureText(line + tok).width <= maxW) { line += tok; continue; }
        if (line) flush();
        if (/^\s+$/.test(tok)) continue;                  // don't start a line with a space
        if (ctx.measureText(tok).width <= maxW) { line = tok; continue; }
        // segment too wide on its own — break it character by character
        let chunk = '';
        for (const ch of tok) {
            if (chunk && ctx.measureText(chunk + ch).width > maxW) { lines.push(chunk); chunk = ch; }
            else chunk += ch;
        }
        line = chunk;
    }
    if (line.trim()) lines.push(line.replace(/\s+$/, ''));
    return lines;
}

// Grain textures lifted verbatim from css/passport/_stamps.css so the downloaded stamp
// matches the dashboard: fine fractal noise multiplied onto the parchment, and coarser
// noise laid over the badge (overlay blend). width/height added so the SVG has an
// intrinsic size when drawn to canvas.
const STAMP_GRAIN = "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='120'%20height='120'%20viewBox='0%200%20120%20120'%3E%3Cfilter%20id='n'%3E%3CfeTurbulence%20type='fractalNoise'%20baseFrequency='0.9'%20numOctaves='2'%20stitchTiles='stitch'/%3E%3CfeColorMatrix%20type='saturate'%20values='0'/%3E%3C/filter%3E%3Crect%20width='120'%20height='120'%20filter='url(%23n)'%20opacity='0.12'/%3E%3C/svg%3E";
const STAMP_GRAIN_FILLED = "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='120'%20height='120'%20viewBox='0%200%20120%20120'%3E%3Cfilter%20id='g'%3E%3CfeTurbulence%20type='fractalNoise'%20baseFrequency='0.4'%20numOctaves='2'%20stitchTiles='stitch'/%3E%3CfeColorMatrix%20type='saturate'%20values='0'/%3E%3C/filter%3E%3Crect%20width='120'%20height='120'%20filter='url(%23g)'/%3E%3C/svg%3E";

// The scalloped postage-stamp outline (square minus edge perforations), as an SVG
// path over a 100×100 box — same geometry as the CSS mask in css/passport/_stamps.css.
function stampOutlinePath() {
    const r = 4.5, step = 100 / 9;
    const circle = (cx, cy) => `M${cx - r},${cy}a${r},${r},0,1,0,${2 * r},0a${r},${r},0,1,0,${-2 * r},0`;
    let d = 'M0,0H100V100H0Z';
    for (let i = 0; i <= 9; i++) { const p = i * step; d += circle(p, 0) + circle(p, 100); }
    for (let j = 1; j <= 8; j++) { const p = j * step; d += circle(0, p) + circle(100, p); }
    return d;
}

// Render the badge as a passport stamp on its own transparent canvas. Clipping to the
// 0–100 box makes the edge perforations read as inward NOTCHES (the CSS mask's SVG
// viewBox clips the same way) — without it the circles bulge outward as bumps. Then:
// parchment fill, badge image (cover-fit), dashed inner frame. Drawn with a shadow by
// the caller, which traces this canvas's scalloped alpha.
function renderStampCanvas(img, px, grain, grainFilled) {
    const c = document.createElement('canvas');
    c.width = px; c.height = px;
    const ctx = c.getContext('2d');
    ctx.scale(px / 100, px / 100);

    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, 100, 100); ctx.clip(); // viewBox clip: drop the outward bumps
    ctx.clip(new Path2D(stampOutlinePath()), 'evenodd');   // scalloped outline

    // Parchment: warm cream radial + fine grain (multiply) — matches _stamps.css.
    const rg = ctx.createRadialGradient(25, 15, 0, 25, 15, 120);
    rg.addColorStop(0, '#fffefb'); rg.addColorStop(0.6, '#fdf9f0'); rg.addColorStop(1, '#faf4e6');
    ctx.fillStyle = rg; ctx.fillRect(0, 0, 100, 100);
    if (grain) { ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.drawImage(grain, 0, 0, 100, 100); ctx.restore(); }

    // Badge image (cover-fit) over the parchment.
    drawImageCover(ctx, img, 0, 0, 100, 100);

    // Aged grain over the badge (overlay blend, like .stamp-emoji.filled::after).
    if (grainFilled) { ctx.save(); ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = 0.5; ctx.drawImage(grainFilled, 0, 0, 100, 100); ctx.restore(); }

    // Aged-ink dashed inner frame (.stamp-emoji::before). CSS is 1.5px dashed, inset 7px,
    // radius 4px on a 60px stamp — expressed here as % of the 100-unit box to match.
    ctx.strokeStyle = '#7a6a3f';
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 2.5;          // 1.5px / 60px
    ctx.setLineDash([5, 5]);
    const ins = 11.67, side = 100 - 2 * ins, rad = 6.67; // 7px inset, 4px radius / 60px
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(ins, ins, side, side, rad); ctx.stroke(); }
    else ctx.strokeRect(ins, ins, side, side);

    ctx.restore();
    return c;
}

// object-fit: cover — crop the image to fill the destination box, centred.
function drawImageCover(ctx, img, dx, dy, dw, dh) {
    const ir = img.width / img.height, dr = dw / dh;
    let sw, sh, sx, sy;
    if (ir > dr) { sh = img.height; sw = sh * dr; sx = (img.width - sw) / 2; sy = 0; }
    else { sw = img.width; sh = sw / dr; sx = 0; sy = (img.height - sh) / 2; }
    ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
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

// ── ADMIN IDENTITY (ทีม SAMO tree → public.passport_admin_context) ───────────
// Replaces the old client-side admin/1234 + localStorage flag. Fails closed:
// no session, rpc error, or no grant all land on the gate, never on the panel.

async function bootAdminAuth() {
    // OAuth lands back here with #access_token=…; give adminDb-js a beat to
    // persist it before asking for the session (same race as auth.js checkSession).
    const fromOAuth = window.location.hash.includes('access_token');
    if (fromOAuth) await new Promise((r) => setTimeout(r, 300));

    adminScope = await getAdminScope();

    // Wipe the token from the URL bar only AFTER the session has been read.
    // Clearing it first (as this did) races detectSessionInUrl: on a slow device
    // the 300ms can elapse before adminDb-js has parsed the hash, and removing
    // it destroys the only copy of the token — the user silently lands back on
    // the gate, and signing in again loops through the same window.
    if (fromOAuth && adminScope.user) {
        window.history.replaceState(null, null, window.location.pathname + window.location.search);
    }

    // A real ทีม SAMO identity ALWAYS wins over a stored legacy session — otherwise
    // anyone who once ticked "remember me" would never see their ฝ่าย scope apply.
    if (!adminScope.isAdmin) {
        // A stored legacy marker outlives the shared Supabase session, so re-establish
        // it before trusting it — otherwise the panel renders and every write is
        // rejected, which is precisely the failure this door was rebuilt to avoid.
        const legacy = getLegacyScope();
        if (legacy && await ensureLegacySession()) adminScope = legacy;
    }

    if (adminScope.isAdmin) {
        await showAdminPanel();
        return;
    }
    showAdminGate(adminScope);
}

function showAdminGate(scope) {
    const title = document.getElementById('admin-gate-title');
    const msg = document.getElementById('admin-gate-msg');
    const googleBtn = document.getElementById('admin-google-btn');
    const switchBtn = document.getElementById('admin-switch-btn');

    document.getElementById('admin-login-section').style.display = '';
    document.getElementById('admin-content').style.display = 'none';
    document.getElementById('admin-logout').style.display = 'none';

    const legacyBox = document.getElementById('admin-legacy-box');
    if (legacyBox && LEGACY_PASSWORD_LOGIN) legacyBox.style.display = '';

    if (!scope?.user) return; // signed out — the default markup already says it

    // Signed in but not an admin: say so, and offer a switch rather than a
    // re-login button that would just bounce them back to the same account.
    googleBtn.style.display = 'none';
    switchBtn.style.display = '';
    title.textContent = 'บัญชีนี้ไม่มีสิทธิ์ผู้ดูแล';
    msg.innerHTML = scope.error
        ? `ตรวจสอบสิทธิ์ไม่สำเร็จ<br><span style="opacity:.75;font-size:.9em">${escapeHtml(scope.error)}</span>` +
          `<br><br>กรุณาลองใหม่อีกครั้ง หรือติดต่อผู้ดูแลระบบ`
        : `<b style="word-break:break-all">${escapeHtml(scope.user.email || '')}</b><br>` +
          `ยังไม่ได้รับสิทธิ์ SAMO Passport<br><br>` +
          `ขอสิทธิ์ได้ที่ เว็บ SAMO → <b>ทีม SAMO</b> → จัดการสิทธิ์ → SAMO Passport`;
}

async function signInWithGoogle() {
    // NB: do NOT set queryParams.hd — forcing the hosted domain sends kkumail
    // logins to KKU's malformed SAML IdP URL (see js/index.js for the full note).
    const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin + window.location.pathname },
    });
    if (error) alert('เข้าสู่ระบบไม่สำเร็จ: ' + error.message);
}

// TEMPORARY — see the LEGACY ESCAPE HATCH block in admin-scope.js. Delete this
// handler together with its markup when every admin has a ทีม SAMO grant.
async function handleLegacyLogin(e) {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const label = btn?.textContent;
    if (btn) { btn.disabled = true; btn.textContent = 'กำลังเข้าสู่ระบบ...'; }
    try {
        // Now a real sign-in to the shared admin account, so it can fail for
        // reasons a string compare never could (offline, shared account disabled).
        // Distinguish that from a wrong password: null = wrong, throw = broken.
        const scope = await legacyLogin(
            document.getElementById('admin-user').value,
            document.getElementById('admin-pass').value,
            document.getElementById('admin-remember').checked,
        );
        if (!scope) { alert('Invalid credentials!'); return; }
        adminScope = scope;
        await showAdminPanel();
    } catch (err) {
        alert('เข้าสู่ระบบไม่สำเร็จ: ' + (err?.message || err));
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = label; }
    }
}

async function signOutAdmin() {
    await clearLegacySession();
    try {
        await Promise.race([
            supabase.auth.signOut(),
            new Promise((resolve) => setTimeout(resolve, 2000)),
        ]);
    } catch (err) {
        console.error('Logout error:', err);
    }
    window.location.reload();
}

async function showAdminPanel() {
    document.getElementById('admin-login-section').style.display = 'none';
    document.getElementById('admin-content').style.display = 'block';
    document.getElementById('admin-logout').style.display = 'inline-block';
    applyScopeToUi();
    await loadSamoData().catch(() => {}); // for the วาระสโม/Season activity filters
    populateActivitySamoFilters();
    loadActivities();
}

// Narrow every department-bearing control to what this admin actually owns.
// This is presentation + accident-prevention; the authoritative filter is
// scopeCoversActivity(), re-checked on every read AND every write below.
function applyScopeToUi() {
    const banner = document.getElementById('admin-scope-banner');
    if (banner) {
        const legacy = adminScope.legacy === true;
        banner.style.display = '';
        banner.className = 'admin-scope-banner'
            + (isAllDepts() ? ' is-all' : '') + (legacy ? ' is-legacy' : '');
        banner.innerHTML = legacy
            // Say plainly that no ฝ่าย scope is in effect — otherwise a scoped
            // admin who fell back to the password wonders why they see everything.
            ? '<span class="asb-who">เข้าสู่ระบบด้วยรหัสผ่านชั่วคราว (ไม่ผูกกับบัญชี)</span>' +
              '<span class="asb-scope">ขอบเขต: ทุกฝ่าย — ยังไม่จำกัดตามสิทธิ์ ทีม SAMO</span>'
            : `<span class="asb-who">${escapeHtml(adminScope.user?.email || '')}</span>` +
              `<span class="asb-scope">ขอบเขต: ${escapeHtml(
                  scopeLabel(adminScope, { departments: DEPARTMENTS, subDepartments: SUBDEPARTMENTS }))}</span>`;
    }

    const allowed = allowedDeptIds(adminScope); // null = unrestricted
    if (allowed) {
        ['act-department', 'edit-department', 'filter-department'].forEach((id) =>
            restrictDeptSelect(id, allowed));
    }

    // Seasons and the destructive data wipe are org-wide operations — a
    // department-scoped admin must not start a new วาระ or clean everyone's data.
    if (!isAllDepts()) {
        document.querySelectorAll('[onclick^="openSeasons"]').forEach((el) => el.remove());
    }
}

// Keep only `allowed` departments in a <select>, and drop the "any department"
// placeholder when exactly one remains so the choice can't be left blank.
function restrictDeptSelect(id, allowed) {
    const sel = document.getElementById(id);
    if (!sel) return;
    const single = allowed.length === 1;
    [...sel.options].forEach((opt) => {
        if (opt.value === '') { if (single) opt.remove(); return; }
        if (!allowed.includes(parseInt(opt.value, 10))) opt.remove();
    });
    if (single) {
        sel.value = String(allowed[0]);
        sel.dispatchEvent(new Event('change')); // rebuild the dependent sub-dept select
        restrictSubSelect(sel, allowed[0]);
    }
    sel.addEventListener('change', () => restrictSubSelect(sel, sel.value));
}

// A sub-department grant owns ONE sub, not the whole parent department: pin the
// dependent select to it (setupSubDepartmentToggle has just refilled it).
function restrictSubSelect(deptSel, deptId) {
    const subSel = document.getElementById(deptSel.id.replace(/-department$/, '-sub-department'));
    if (!subSel) return;
    const subs = allowedSubIdsForDept(adminScope, deptId);
    if (subs === null) return; // owns the whole department
    [...subSel.options].forEach((opt) => {
        if (opt.value === '') { if (subs.length === 1) opt.remove(); return; }
        if (!subs.includes(parseInt(opt.value, 10))) opt.remove();
    });
    if (subs.length === 1) subSel.value = String(subs[0]);
}

// Guard for every write path: refuse a department the admin does not own.
// Returns true when the write may proceed.
function assertInScope(act, what) {
    if (scopeCoversActivity(adminScope, act)) return true;
    alert(`ไม่มีสิทธิ์${what}กิจกรรมของฝ่ายนี้\n\nขอบเขตของคุณ: ` +
        scopeLabel(adminScope, { departments: DEPARTMENTS, subDepartments: SUBDEPARTMENTS }));
    return false;
}

// Fill the วาระสโม + Season dropdowns used to filter the activity list. The
// season list narrows to the chosen year (or shows all when no year is picked).
function populateActivitySamoFilters() {
    const yearSel = document.getElementById('filter-samoyear');
    const seasonSel = document.getElementById('filter-season');
    if (!yearSel || !seasonSel) return;
    const selYear = yearSel.value;
    yearSel.innerHTML = '<option value="">All วาระสโม</option>' +
        samoYears.map(y => `<option value="${y.id}">${escapeHtml(y.name)}</option>`).join('');
    yearSel.value = selYear;

    const selSeason = seasonSel.value;
    const seasons = selYear ? samoSeasons.filter(s => s.samo_year_id === selYear) : samoSeasons;
    seasonSel.innerHTML = '<option value="">All Seasons</option>' +
        seasons.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
    seasonSel.value = seasons.some(s => s.id === selSeason) ? selSeason : '';
}

// --- ACTIVITY LIST & MANAGEMENT ---
let activitiesCache = [];
async function loadActivities() {
    const { data, error } = await adminDb
        .from('activities')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        console.error(error);
        return;
    }

    // Drop out-of-scope rows at the CACHE boundary, not just at render: every
    // later lookup (editActivity, manageCerts, the QR generator) reads this
    // array, so anything that never enters it cannot leak through them either.
    activitiesCache = (data || []).filter((act) => scopeCoversActivity(adminScope, act));

    renderActivityList();
}

function renderActivityList(){

    const list = document.getElementById('activities-list');
    list.innerHTML = '';

    if (activitiesCache.length === 0) {
        // Distinguish "none exist" from "none in your ฝ่าย" — otherwise a scoped
        // admin reads an empty list as a broken query.
        list.innerHTML = isAllDepts()
            ? '<p style="font-size: 0.9rem;">No activities created yet.</p>'
            : '<p style="font-size: 0.9rem;">ยังไม่มีกิจกรรมในขอบเขตของคุณ</p>';
        return;
    }
    const filterDept = document.getElementById('filter-department').value;
    const filterSubDept = document.getElementById('filter-sub-department').value;
    const searchTerm = document.getElementById('search-activity').value.trim().toLowerCase();
    const filterYear = document.getElementById('filter-samoyear')?.value || '';
    const filterSeason = document.getElementById('filter-season')?.value || '';
    // วาระสโม/Season filter the activity list by the time window it was CREATED in.
    const win = activitySamoWindow(filterSeason || filterYear, !!filterSeason);

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
        if (win && !withinWindow(act.created_at, win)) {
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

// Resolve a วาระสโม/Season id to its [started_at, ended_at] window. `ended_at`
// NULL = still open. Returns null when nothing is selected (no time filtering).
function activitySamoWindow(id, isSeason) {
    if (!id) return null;
    const row = isSeason ? samoSeasons.find(s => s.id === id) : samoYears.find(y => y.id === id);
    return row ? { start: row.started_at, end: row.ended_at } : null;
}

function withinWindow(createdAt, win) {
    if (!win) return true;
    if (!createdAt) return false;
    const t = new Date(createdAt).getTime();
    if (win.start && t < new Date(win.start).getTime()) return false;
    if (win.end && t > new Date(win.end).getTime()) return false;
    return true;
}

window.startScannerFor = (id) => {
    if (!assertInScope(activitiesCache.find((a) => a.id === id), 'สร้าง QR ของ')) return;
    currentActivityId = id;
    startStaticQR();
};

window.editActivity = async (id) => {
    const { data, error } = await adminDb
        .from('activities')
        .select('*')
        .eq('id', id)
        .single();
    if (error) {
        alert('Could not load activity.');
        return;
    }
    // Re-check against the row we just fetched, not the cached one — these
    // window.* handlers are reachable from the console with any id.
    if (!assertInScope(data, 'แก้ไข')) return;
    editingActivityId = id;

    document.getElementById('edit-name').value = data.name;
    document.getElementById('edit-km').value = data.base_points_km;
    document.getElementById('edit-badge-name').value = data.badge_name || '';
    document.getElementById('edit-badge-url').value = data.badge_url || '';
    document.getElementById('edit-badge-url').dispatchEvent(new Event('input', { bubbles: true }));

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
    const { data: scopeRow } = await adminDb
        .from('activities').select('department_id, sub_department_id').eq('id', id).single();
    if (!assertInScope(scopeRow, 'ลบ')) return;

    if (
        !confirm(
            'Delete this activity?\n\nIt disappears from the admin list and can no longer be scanned. Earners KEEP their points + flight-log entry (history is immutable), but its CERTIFICATES are deleted with it — once the activity is gone, the certificate is gone (students must collect it while the activity is open).',
        )
    )
        return;

    // The badge image is removed from Drive. Scans are kept (immutable flight-log
    // history), but certificate templates are deleted with the activity: certs are
    // no longer season-scoped snapshots — "activity gone ⇒ cert gone".
    const { data: actRow } = await adminDb.from('activities').select('badge_url').eq('id', id).single();

    const { data, error } = await adminDb
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
        await adminDb.from('certificates').delete().eq('activity_id', id); // certs die with the activity
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

    // Guard the DESTINATION department too: a scoped admin must not be able to
    // move an activity they own out into a department they don't.
    if (!assertInScope({ department_id: dept, sub_department_id: subDept }, 'ย้ายกิจกรรมไปยัง')) return;

    // 1. Update the activity details
    const { error } = await adminDb
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
        await adminDb
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

    // A scoped admin must file the activity under a department they own —
    // including the "no department" case, which only a full admin may create.
    if (!assertInScope({ department_id: dept, sub_department_id: subDept }, 'สร้าง')) return;

    const { data, error } = await adminDb
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
    document.getElementById('qr-poster').removeAttribute('src'); // clear stale preview while building

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
    // 1. Get or create the Static Token (+ name & badge for the poster).
    const { data: act, error: selectError } = await adminDb
        .from('activities')
        .select('static_token, name, badge_url')
        .eq('id', currentActivityId)
        .single();

    if (selectError) {
        throw new Error('Failed to fetch activity: ' + selectError.message);
    }

    currentQrActivity = { name: act?.name || '', badge_url: act?.badge_url || '' };
    currentPosterDataUrl = null; // drop any previous poster until this one finishes building

    let staticToken = act?.static_token;
    if (!staticToken) {
        staticToken = generateUUID();
        const { error: updateError } = await adminDb
            .from('activities')
            .update({ static_token: staticToken })
            .eq('id', currentActivityId);

        if (updateError) {
            throw new Error('Failed to update activity token: ' + updateError.message);
        }
    }

    currentQrUrl = `${window.location.origin}${ROUTES.SCAN}?aid=${currentActivityId}&tk=${staticToken}`;

    // 2. Build the downloadable poster and show it — the on-screen preview IS the download.
    const qrDataUrl = makeQrDataUrl(currentQrUrl, 880);
    currentPosterDataUrl = await buildQrPoster(qrDataUrl, currentQrActivity.name.trim(), currentQrActivity.badge_url);
    document.getElementById('qr-poster').src = currentPosterDataUrl;
}

// --- CERTIFICATES ---
let certActivityId = null;
let editingCertId = null;       // null = adding; otherwise editing this cert
let certListCache = [];         // last-loaded certs for the open activity

// Certificates are NOT season-scoped: a template belongs to its activity and
// always reflects its current settings. Delete the activity → its certs go too.

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
    if (!assertInScope(act, 'จัดการเกียรติบัตรของ')) return;
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

    const { data, error } = await adminDb
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

    list.innerHTML = certListCache.map(c => {
        const actions =
            `<button onclick="editCert('${c.id}')" class="btn-action btn-edit">Edit</button>
             <button onclick="deleteCert('${c.id}')" class="btn-action btn-delete">Delete</button>`;
        return `<div class="cert-list-item${c.id === editingCertId ? ' cert-editing' : ''}">
            <span class="cert-list-label">${escapeHtml(c.label)}</span>
            <span class="cert-actions">${actions}</span>
          </div>`;
    }).join('');
}

window.deleteCert = async (id) => {
    // certListCache only ever holds certs of the in-scope activity manageCerts
    // opened, so membership IS the scope check — and it also closes the
    // console route (deleteCert('<any-uuid>')) that the rendered buttons can't reach.
    if (!certListCache.some(c => c.id === id)) {
        alert('ไม่มีสิทธิ์ลบเกียรติบัตรนี้');
        return;
    }
    if (!confirm('Delete this certificate template?')) return;
    const { error } = await adminDb.from('certificates').delete().eq('id', id);
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

    // Certs are not season-scoped — just attach to the activity (season_id stays
    // NULL). Editing updates in place so the template is always "what it is now".
    const insertExtras = { activity_id: certActivityId };
    const run = (payload) => editingCertId
        ? adminDb.from('certificates').update(payload).eq('id', editingCertId)
        : adminDb.from('certificates').insert([{ ...insertExtras, ...payload }]);

    let { error } = await run(cert);
    // Drop the optional font column if the DB doesn't have it yet, then retry.
    if (error && /font_family|column|schema cache/i.test(error.message || '')) {
        const { font_family, ...rest } = cert;
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

// Live preview of a badge image inside the real stamp treatment (perforated mask +
// parchment + grain), shown under the badge-URL field so admins see what students get
// before saving. Reuses the dashboard's exact markup + the shared _stamps.css partial,
// so it's pixel-accurate, and updates on upload, paste, or edit-form populate.
function wireStampPreview(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;

    const preview = document.createElement('div');
    preview.className = 'stamp-preview';
    preview.hidden = true;
    // shadow lives on .stamp-wrap; the masked .stamp-emoji holds the image (same as the
    // dashboard). se-blue is just a representative accent — the parchment fill overrides it.
    const emoji = document.createElement('div');
    emoji.className = 'stamp-emoji se-blue filled';
    const img = document.createElement('img');
    img.alt = 'Stamp preview';
    emoji.appendChild(img);
    const wrap = document.createElement('div');
    wrap.className = 'stamp-wrap';
    wrap.appendChild(emoji);
    const lbl = document.createElement('span');
    lbl.className = 'stamp-preview-lbl';
    lbl.textContent = 'Stamp preview';
    preview.append(wrap, lbl);

    // Anchor below the upload row (if wireUpload wrapped the field) or the field itself,
    // skipping a trailing <br>.
    const anchor = input.closest('.upload-row') || input;
    const ref = anchor.nextElementSibling?.tagName === 'BR' ? anchor.nextElementSibling : anchor;
    ref.parentNode.insertBefore(preview, ref.nextSibling);

    const update = () => {
        const url = input.value.trim();
        preview.hidden = !url;
        if (url) img.src = fixGoogleDriveUrl(url);
        else img.removeAttribute('src');
    };
    input.addEventListener('input', update);
    update();
}

// --- วาระสโม (SamoYear) & SEASON CONTROL ---
let samoYears = [];
let samoSeasons = [];

function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

async function loadSamoData() {
    const [{ data: ys }, { data: ss }] = await Promise.all([
        adminDb.from('samo_years').select('*').order('started_at', { ascending: false }),
        adminDb.from('samo_seasons').select('*').order('started_at', { ascending: false }),
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

// วาระสโม / Season / the data wipe are ORG-WIDE: starting a new season freezes
// every department's points at once. Only an all-departments admin may do it —
// applyScopeToUi() removes the entry button, and this guards the console route.
function assertOrgWide(what) {
    if (isAllDepts()) return true;
    alert(`${what} เป็นการดำเนินการระดับองค์กร — ต้องมีสิทธิ์ SAMO Passport ทุกฝ่าย`);
    return false;
}

window.openSeasons = async () => {
    if (!assertOrgWide('การจัดการวาระสโม/Season')) return;
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
    populateActivitySamoFilters(); // a new วาระสโม/season may have been added
    renderActivityList();
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
    if (!assertOrgWide('การเริ่มวาระสโมใหม่')) return;
    const name = (prompt("Name the new วาระสโม (e.g. วาระสโม'69):") || '').trim();
    if (!name) return;
    // A วาระสโม must open WITH a season — otherwise scans before the first season is
    // started would land in the uncategorized (season_id NULL) bucket. Require it here.
    const seasonName = (prompt(`Name the FIRST season for "${name}" (e.g. Q1):`) || '').trim();
    if (!seasonName) { alert('Cancelled — a วาระสโม must start with a season (so scans are never uncategorized).'); return; }
    if (!confirm(`Start "${name}" with season "${seasonName}"?\n\nThis ENDS the current วาระสโม + season and resets the live leaderboard and current-year totals. All past logs and standings are kept.`)) return;
    // ⛔ THE ORDER IS LOAD-BEARING: CREATE the new rows, THEN end the old ones.
    // This used to end first, and that left a window — four network round-trips
    // wide — with NO open วาระ and NO open season. passport.stamp_scan stamps
    // every scan with "the open row having the latest started_at", and both
    // columns are nullable, so a scan in that window is filed under NULL: the
    // student sees no error, their km still lands on total_km, and the row is
    // missing from every per-season view for ever, unrepairable except by
    // guessing from a timestamp. Worse, if a later step failed the old rows
    // were ALREADY ended, leaving nothing open until a human noticed.
    //
    // Creating first makes the worst case a one-second OVERLAP, which every
    // reader resolves correctly because they all take the newest open row:
    // stamp_scan, samo.js getCurrentYear/getCurrentSeason, and admin's
    // currentYearRow (its list is loaded started_at-descending). And if an
    // insert fails, nothing has been ended — the current วาระ is still running.
    // docs/INVARIANTS.md, "Never leave a GAP between two วาระ or two seasons".
    const { data: yRows, error } = await adminDb.from('samo_years').insert([{ name }]).select();
    if (error) { alert(`Failed: ${error.message}\nNothing was changed — the current วาระสโม is still running.`); return; }
    const newYear = yRows && yRows[0];
    if (!newYear) { alert('Could not read the new วาระสโม back — nothing was ended; check the list and retry.'); await loadSamoData(); renderSamoControl(); return; }

    const { data: sRows, error: sErr } = await adminDb.from('samo_seasons')
        .insert([{ samo_year_id: newYear.id, name: seasonName }]).select();
    if (sErr || !sRows || !sRows[0]) {
        // Undo the วาระ just created. Leaving it would be worse than failing:
        // stamp_scan resolves the season GLOBALLY (no year filter), so an open
        // year with no season of its own would pair the NEW year with the OLD
        // year's season — a mismatched stamp on every scan until someone spotted it.
        const { error: undoErr } = await adminDb.from('samo_years').delete().eq('id', newYear.id);
        alert(undoErr
            ? `The season failed (${sErr ? sErr.message : 'could not read it back'}) AND rolling back "${name}" failed (${undoErr.message}).\nEND "${name}" MANUALLY NOW, or scans will be mis-stamped.`
            : `Failed to create the season: ${sErr ? sErr.message : 'could not read it back'}\nNothing was changed — the current วาระสโม is still running.`);
        await loadSamoData(); renderSamoControl(); return;
    }
    const newSeason = sRows[0];

    // Only now close the previous ones — excluding the two just created.
    const now = new Date().toISOString();
    await adminDb.from('samo_seasons').update({ ended_at: now }).is('ended_at', null).neq('id', newSeason.id);
    await adminDb.from('samo_years').update({ ended_at: now }).is('ended_at', null).neq('id', newYear.id);

    await loadSamoData();
    renderSamoControl();
    alert(`Started "${name}" · season "${seasonName}".`);
};

window.startNewSeason = async () => {
    if (!assertOrgWide('การเริ่ม Season ใหม่')) return;
    const y = currentYearRow();
    if (!y) { alert('Start a วาระสโม first.'); return; }
    const name = (prompt('Name the new Season (e.g. Q1):') || '').trim();
    if (!name) return;
    if (!confirm(`Start season "${name}" under ${y.name}?\n\nThis ENDS the current season and resets the live leaderboard. The previous season's standings stay viewable.`)) return;
    // ⛔ CREATE first, then end — same reason as startNewYear above, and the
    // same reason spelled out in docs/INVARIANTS.md. Ending first leaves a
    // window where no season is open and scans are filed under NULL silently.
    const { data: sRows, error } = await adminDb.from('samo_seasons')
        .insert([{ samo_year_id: y.id, name }]).select();
    if (error || !sRows || !sRows[0]) {
        alert(`Failed: ${error ? error.message : 'could not read the new season back'}\nNothing was changed — the current season is still running.`);
        return;
    }
    const now = new Date().toISOString();
    await adminDb.from('samo_seasons').update({ ended_at: now })
        .is('ended_at', null).eq('samo_year_id', y.id).neq('id', sRows[0].id);
    await loadSamoData();
    renderSamoControl();
};

// Danger zone: wipe all app content (keeps user accounts). Double-gated.
window.cleanAllData = async () => {
    if (!assertOrgWide('การล้างข้อมูลทั้งหมด')) return;
    if (!confirm('⚠️ This permanently deletes ALL activities, certificates, scans, and every วาระสโม/season — AND the badge + certificate images they stored in the SAMO Google Drive.\n\nUser accounts (profiles) are kept. This CANNOT be undone.\n\nContinue?')) return;
    const typed = prompt('Type DELETE to confirm wiping all data:');
    if ((typed || '').trim() !== 'DELETE') { alert('Cancelled — you did not type DELETE.'); return; }

    // Collect the Drive image URLs BEFORE deleting the rows that hold them, so we
    // can remove the files from the SAMO Drive too (otherwise they're orphaned).
    const driveUrls = [];
    if (isUploadConfigured()) {
        const [{ data: acts }, { data: certs }] = await Promise.all([
            adminDb.from('activities').select('badge_url'),
            adminDb.from('certificates').select('background_url'),
        ]);
        (acts || []).forEach(a => { if (a.badge_url) driveUrls.push(a.badge_url); });
        (certs || []).forEach(c => { if (c.background_url) driveUrls.push(c.background_url); });
    }

    // `id IS NOT NULL` matches every row and works for ANY primary-key type.
    // (The old `.neq('id', <uuid>)` threw "invalid input syntax for type integer"
    // on scans — whose id is a bigint — aborting the whole wipe. See MISTAKES.md.)
    const wipe = (table) => adminDb.from(table).delete().not('id', 'is', null).select('id');
    try {
        // Dependents first (FKs to activities were dropped in 0006; samo_seasons +
        // season_results cascade from their parents, but delete explicitly to be safe).
        const stuck = [];
        for (const t of ['scans', 'certificates', 'season_results', 'samo_seasons', 'samo_years', 'seasons', 'activities']) {
            const { data, error } = await wipe(t);
            // A missing table/column is fine (migration not run yet); anything else is real.
            if (error && !/does not exist|schema cache/i.test(error.message || '')) {
                throw new Error(`${t}: ${error.message}`);
            }
            // No error but 0 rows deleted while rows exist ⇒ blocked by RLS (no DELETE
            // policy). Flag it so the admin knows the wipe was incomplete.
            if (!error && Array.isArray(data) && data.length === 0) {
                const { count } = await adminDb.from(t).select('id', { count: 'exact', head: true });
                if (count) stuck.push(`${t} (${count} rows — needs a DELETE policy; run db/0007)`);
            }
        }
        if (stuck.length) {
            alert('⚠️ Some data could NOT be deleted (blocked by RLS):\n\n' + stuck.join('\n') +
                '\n\nRun db/0007_clean_all_policies.sql in the Supabase SQL editor, then try again.' +
                '\n\n(Drive images were NOT touched — fix RLS and retry for a full wipe.)');
            return;
        }

        // Rows are gone — now delete their Drive images (best-effort, in parallel).
        let drive = '';
        if (driveUrls.length) {
            const res = await Promise.allSettled(driveUrls.map(u => deleteFromDrive(u)));
            const failed = res.filter(r => r.status === 'rejected').length;
            drive = `\n${driveUrls.length - failed}/${driveUrls.length} Drive image(s) deleted.` +
                (failed ? ` ${failed} failed (delete them manually).` : '');
        }
        alert('✅ All data cleared.' + drive + '\n\nReloading.');
        window.location.reload();
    } catch (e) {
        alert('Clean failed: ' + (e.message || e));
    }
};

// --- LEADERBOARD (period view over immutable, stamped scans) ---
let lbScans = null;
let lbProfiles = null;

function populateLbDepartments() {
    const sel = document.getElementById('lb-department');
    if (sel.options.length) return;
    const allowed = allowedDeptIds(adminScope); // null = every department
    const entries = Object.entries(DEPARTMENTS)
        .filter(([id]) => !allowed || allowed.includes(parseInt(id, 10)));
    // "All departments" means "everything you administer" — for a scoped admin
    // that is their own ฝ่าย, not the org total, so drop the option when it
    // would be the only meaningful choice anyway.
    sel.innerHTML = (allowed && entries.length === 1 ? '' : '<option value="">All departments (total)</option>') +
        entries.map(([id, name]) => `<option value="${id}">${name}</option>`).join('');
    if (allowed && entries.length === 1) {
        sel.value = String(entries[0][0]);
        onLbDeptChange();
    }
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
    // Names + emails come from passport.admin_leaderboard(), NOT from a profiles
    // read. The previous version fetched EVERY profile (id, full_name, email) and
    // narrowed it in the browser — so a ฝ่าย-scoped admin still received the whole
    // 593-student roster over the wire, and the policy that permitted it
    // (`profiles_read_all using (true)`) permitted it to anyone with the bundled
    // anon key too. The RPC re-applies the caller's own ฝ่าย scope inside a
    // SECURITY DEFINER function, so out-of-scope students never leave Postgres.
    //
    // Scans are still read directly (scans_read stays public) because the
    // year/season/ฝ่าย facet dropdowns are derived from them client-side; they
    // carry no personal data beyond user_id.
    // ONE path for both doors. This briefly had a `adminScope.legacy` fallback that
    // read `profiles` directly, because admin/1234 had no session for
    // admin_leaderboard()'s is_admin() guard to accept. That door now signs into the
    // shared admin account, so it holds a real JWT and takes the same RPC as a
    // Google admin — which is the whole point of doing it that way: no second code
    // path to keep in step, and no reliance on profiles being world-readable.
    const [{ data: scans, error: e1 }, { data: people, error: e2 }] = await Promise.all([
        adminDb.from('scans').select('user_id, points_awarded, samo_year_id, season_id, department_id, sub_department_id'),
        adminDb.rpc('admin_leaderboard'),
    ]);
    if (e1 || e2) {
        table.innerHTML = `<p style="color:var(--accent-danger);">Could not load leaderboard: ${(e1 || e2).message}</p>`;
        return false;
    }
    lbScans = (scans || []).filter(s => scopeCoversActivity(adminScope, s));
    // The RPC returns one row per in-scope participant, already ฝ่าย-filtered
    // server-side; per-facet totals are still aggregated client-side from lbScans,
    // so only the identity map comes from here.
    lbProfiles = new Map((people || [])
        .map(p => [p.user_id, { full_name: p.full_name, email: p.email }]));
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
        // Scope first: the dropdowns below only narrow WITHIN what you administer.
        // A scan carries the department it was stamped under, so the same
        // predicate as the activity list applies unchanged.
        if (!scopeCoversActivity(adminScope, s)) return;
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
