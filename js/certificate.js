// js/certificate.js — Shared certificate renderer (client-side canvas)
// Draws a student's name onto a certificate background image. Used by both the
// admin live-preview and the student download. Nothing is uploaded or stored.
import { fixGoogleDriveUrl } from './utils.js';

// Fonts offered for certificates. Every family here MUST also be listed in the
// Google Fonts <link> on admin.html AND dashboard.html, or the canvas can't use
// it. Thai families render Thai names directly; the "Decorative / English" ones
// fall back to Noto Sans Thai for any Thai glyphs (great for English names).
export const CERT_FONTS = [
    // ── ภาษาไทย (Thai) ──
    { value: 'Sarabun', label: 'Sarabun', group: 'ภาษาไทย (Thai)' },
    { value: 'Prompt', label: 'Prompt', group: 'ภาษาไทย (Thai)' },
    { value: 'Kanit', label: 'Kanit', group: 'ภาษาไทย (Thai)' },
    { value: 'Mitr', label: 'Mitr', group: 'ภาษาไทย (Thai)' },
    { value: 'Mali', label: 'Mali', group: 'ภาษาไทย (Thai)' },
    { value: 'Maitree', label: 'Maitree', group: 'ภาษาไทย (Thai)' },
    { value: 'Niramit', label: 'Niramit', group: 'ภาษาไทย (Thai)' },
    { value: 'KoHo', label: 'KoHo', group: 'ภาษาไทย (Thai)' },
    { value: 'Krub', label: 'Krub', group: 'ภาษาไทย (Thai)' },
    { value: 'K2D', label: 'K2D', group: 'ภาษาไทย (Thai)' },
    { value: 'Kodchasan', label: 'Kodchasan', group: 'ภาษาไทย (Thai)' },
    { value: 'Athiti', label: 'Athiti', group: 'ภาษาไทย (Thai)' },
    { value: 'Anuphan', label: 'Anuphan', group: 'ภาษาไทย (Thai)' },
    { value: 'Bai Jamjuree', label: 'Bai Jamjuree', group: 'ภาษาไทย (Thai)' },
    { value: 'IBM Plex Sans Thai', label: 'IBM Plex Sans Thai', group: 'ภาษาไทย (Thai)' },
    { value: 'Chakra Petch', label: 'Chakra Petch', group: 'ภาษาไทย (Thai)' },
    { value: 'Fahkwang', label: 'Fahkwang', group: 'ภาษาไทย (Thai)' },
    { value: 'Pridi', label: 'Pridi', group: 'ภาษาไทย (Thai)' },
    { value: 'Taviraj', label: 'Taviraj', group: 'ภาษาไทย (Thai)' },
    { value: 'Trirong', label: 'Trirong', group: 'ภาษาไทย (Thai)' },
    { value: 'Thasadith', label: 'Thasadith', group: 'ภาษาไทย (Thai)' },
    { value: 'Noto Sans Thai', label: 'Noto Sans Thai', group: 'ภาษาไทย (Thai)' },
    { value: 'Noto Serif Thai', label: 'Noto Serif Thai (serif)', group: 'ภาษาไทย (Thai)' },
    { value: 'Itim', label: 'Itim (handwriting)', group: 'ภาษาไทย (Thai)' },
    { value: 'Charm', label: 'Charm (handwriting)', group: 'ภาษาไทย (Thai)' },
    { value: 'Charmonman', label: 'Charmonman (handwriting)', group: 'ภาษาไทย (Thai)' },
    { value: 'Sriracha', label: 'Sriracha (handwriting)', group: 'ภาษาไทย (Thai)' },
    { value: 'Srisakdi', label: 'Srisakdi (display)', group: 'ภาษาไทย (Thai)' },
    { value: 'Chonburi', label: 'Chonburi (display)', group: 'ภาษาไทย (Thai)' },
    { value: 'Pattaya', label: 'Pattaya (display)', group: 'ภาษาไทย (Thai)' },

    // ── Decorative / English ──
    { value: 'Playfair Display', label: 'Playfair Display', group: 'Decorative / English' },
    { value: 'Cormorant Garamond', label: 'Cormorant Garamond', group: 'Decorative / English' },
    { value: 'EB Garamond', label: 'EB Garamond', group: 'Decorative / English' },
    { value: 'Cinzel', label: 'Cinzel', group: 'Decorative / English' },
    { value: 'Lora', label: 'Lora', group: 'Decorative / English' },
    { value: 'Merriweather', label: 'Merriweather', group: 'Decorative / English' },
    { value: 'Montserrat', label: 'Montserrat', group: 'Decorative / English' },
    { value: 'Poppins', label: 'Poppins', group: 'Decorative / English' },
    { value: 'Raleway', label: 'Raleway', group: 'Decorative / English' },
    { value: 'Oswald', label: 'Oswald', group: 'Decorative / English' },
    { value: 'Lobster', label: 'Lobster (script)', group: 'Decorative / English' },
    { value: 'Pacifico', label: 'Pacifico (script)', group: 'Decorative / English' },
    { value: 'Dancing Script', label: 'Dancing Script', group: 'Decorative / English' },
    { value: 'Great Vibes', label: 'Great Vibes (script)', group: 'Decorative / English' },
    { value: 'Satisfy', label: 'Satisfy (script)', group: 'Decorative / English' },
    { value: 'Sacramento', label: 'Sacramento (script)', group: 'Decorative / English' },
    { value: 'Parisienne', label: 'Parisienne (script)', group: 'Decorative / English' },
    { value: 'Allura', label: 'Allura (script)', group: 'Decorative / English' },
    { value: 'Tangerine', label: 'Tangerine (script)', group: 'Decorative / English' },
    { value: 'Marck Script', label: 'Marck Script', group: 'Decorative / English' },
    { value: 'Caveat', label: 'Caveat (handwriting)', group: 'Decorative / English' },
    { value: 'Yellowtail', label: 'Yellowtail (script)', group: 'Decorative / English' },
    { value: 'Italianno', label: 'Italianno (script)', group: 'Decorative / English' },
    { value: 'Cookie', label: 'Cookie (script)', group: 'Decorative / English' },
];

/**
 * Load a certificate/badge image with CORS enabled so the resulting canvas can be
 * exported. Google Drive links are normalised to lh3.googleusercontent.com (CORS-correct).
 *
 * lh3 **rate-limits** (HTTP 429) under load, which shows up as an intermittent onerror —
 * "the stamp/background is sometimes missing". Two mitigations, matching the badge <img>
 * in scanning.js: send **no referrer** (lh3 throttles partly on Referer), and **retry**
 * a few times with backoff since a 429 is transient. A cache-busting query param forces
 * each retry to actually re-fetch instead of replaying the failed response.
 */
export function loadCertImage(url) {
    const src = fixGoogleDriveUrl(url);
    const attempt = (n) => new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.referrerPolicy = 'no-referrer';
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Could not load the image. Check the link is public.'));
        img.src = n === 0 ? src : `${src}${src.includes('?') ? '&' : '?'}_r=${n}`;
    });
    const RETRIES = 3, BACKOFF_MS = 700;
    return attempt(0).catch(async (err) => {
        for (let n = 1; n <= RETRIES; n++) {
            await new Promise((r) => setTimeout(r, BACKOFF_MS * n));
            try { return await attempt(n); } catch { /* keep retrying */ }
        }
        throw err;
    });
}

// ── On-demand web-font loading ──────────────────────────────────────────────
// A cert may use ANY family in CERT_FONTS. Rather than make every host page
// preload ~60 font <link>s (the dashboard intentionally ships only its UI fonts),
// we inject the chosen family's Google Fonts stylesheet once, on demand, then wait
// for the exact glyphs to download BEFORE drawing. Otherwise the canvas silently
// paints a *system fallback* whose metrics differ — so the name lands off-position
// / wrong-size on devices that happen to lack the font locally (the "works for some
// friends, not others" misalignment). See MISTAKES.md.
const _fontCssInjected = new Set();
// Resolves true once the stylesheet has actually loaded (so its @font-face rules are
// registered), false on error / a slow-link safety timeout. Crucially we DON'T resolve
// on a short blind timeout and then draw — doing so painted a system fallback whenever
// the CSS lost the race (Thai fonts/stylesheets are larger ⇒ slower ⇒ lost it most),
// and the fallback's metrics shifted the name off-centre. See MISTAKES.md.
function injectFontStylesheet(family) {
    return new Promise((resolve) => {
        if (!family) { resolve(false); return; }
        if (_fontCssInjected.has(family)) { resolve(true); return; }
        _fontCssInjected.add(family);
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = `https://fonts.googleapis.com/css2?family=${family.trim().replace(/\s+/g, '+')}&display=swap`;
        link.addEventListener('load', () => resolve(true));
        link.addEventListener('error', () => resolve(false));   // fall back silently
        document.head.appendChild(link);
        setTimeout(() => resolve(false), 10000);   // safety net only — never hang forever
    });
}

// Is an @font-face for `family` registered yet? document.fonts.load() is a silent
// no-op (resolves instantly, loads nothing) until the injected stylesheet has parsed,
// so we confirm the face exists before asking for its glyphs.
function faceRegistered(family) {
    const want = family.toLowerCase();
    for (const f of document.fonts) {
        if (f.family.replace(/^['"]|['"]$/g, '').toLowerCase() === want) return true;
    }
    return false;
}

// Ensure the chosen family + the Thai fallback are fully downloaded for the glyphs
// we're about to draw, so the very first canvas paint uses the real font (not a system
// fallback whose metrics move the name). Bounded so a blocked/slow font can't hang the
// render — but generous enough that a real (even slow) fetch wins.
async function ensureCertFonts(chosen, fontPx, sample) {
    const cssOk = await injectFontStylesheet(chosen);
    if (!(document.fonts && document.fonts.load)) return;
    // If the stylesheet loaded but its @font-face hasn't registered in this tick yet,
    // wait (bounded) for it before loading glyphs.
    if (cssOk) {
        const deadline = Date.now() + 4000;
        while (Date.now() < deadline && !faceRegistered(chosen)) {
            await new Promise(r => setTimeout(r, 80));
        }
    }
    try {
        await Promise.all([
            document.fonts.load(`${fontPx}px "${chosen}"`, sample),
            document.fonts.load(`${fontPx}px "Noto Sans Thai"`, sample),
        ]);
        await document.fonts.ready;
    } catch { /* fall back to whatever's available */ }
}

/**
 * Render a certificate onto the given canvas.
 * @param {HTMLCanvasElement} canvas
 * @param {{background_url:string,name_x:number,name_y:number,font_size:number,font_color:string}} cert
 * @param {string} name - text to draw (the student's name)
 */
export async function renderCertificate(canvas, cert, name, preloadedImg) {
    const img = preloadedImg || await loadCertImage(cert.background_url);
    canvas.width = img.naturalWidth || 1000;
    canvas.height = img.naturalHeight || 700;

    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const fontPx = (Number(cert.font_size ?? 6) / 100) * canvas.width;
    const chosen = cert.font_family || 'Sarabun';
    const family = `"${chosen}", "Noto Sans Thai", sans-serif`;

    // Download + register the chosen font (regular weight — guaranteed present for
    // every picker font, including single-weight script/display ones) before drawing.
    await ensureCertFonts(chosen, fontPx, name || '');

    ctx.font = `${fontPx}px ${family}`;
    ctx.fillStyle = cert.font_color || '#1f2d3d';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const x = (Number(cert.name_x ?? 50) / 100) * canvas.width;
    const y = (Number(cert.name_y ?? 52) / 100) * canvas.height;
    ctx.fillText(name || '', x, y);

    return canvas;
}

/**
 * Download a canvas as a PNG. Rejects with 'tainted' if the canvas can't be
 * exported (cross-origin image without CORS headers).
 */
export function downloadCanvasPng(canvas, filename) {
    return new Promise((resolve, reject) => {
        let dataUrl;
        try {
            dataUrl = canvas.toDataURL('image/png');
        } catch {
            reject(new Error('tainted'));
            return;
        }
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        resolve();
    });
}
