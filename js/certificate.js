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
 * Load a certificate background image with CORS enabled so the resulting canvas
 * can be exported. Google Drive links are normalised to lh3.googleusercontent.com,
 * which serves the right CORS headers.
 */
export function loadCertImage(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Could not load the background image. Check the link is public.'));
        img.src = fixGoogleDriveUrl(url);
    });
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

    const fontPx = (Number(cert.font_size) / 100) * canvas.width;
    const chosen = cert.font_family || 'Sarabun';
    const family = `"${chosen}", "Noto Sans Thai", sans-serif`;

    // Make sure the web fonts are ready, otherwise the canvas falls back to a
    // default font (and Thai text may not render correctly). We load/draw at the
    // family's regular weight — guaranteed present for every font in the picker,
    // including the single-weight script/display fonts.
    if (document.fonts && document.fonts.load) {
        try {
            await Promise.all([
                document.fonts.load(`${fontPx}px "${chosen}"`, name),
                document.fonts.load(`${fontPx}px "Noto Sans Thai"`, name),
            ]);
        } catch { /* fall back to default font */ }
    }

    ctx.font = `${fontPx}px ${family}`;
    ctx.fillStyle = cert.font_color || '#1f2d3d';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const x = (Number(cert.name_x) / 100) * canvas.width;
    const y = (Number(cert.name_y) / 100) * canvas.height;
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
