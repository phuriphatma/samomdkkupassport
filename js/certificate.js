// js/certificate.js — Shared certificate renderer (client-side canvas)
// Draws a student's name onto a certificate background image. Used by both the
// admin live-preview and the student download. Nothing is uploaded or stored.
import { fixGoogleDriveUrl } from './utils.js';

// Fonts offered for certificates. All are Thai-capable Google Fonts and MUST be
// listed in the <link> on admin.html + dashboard.html so the canvas can use them.
export const CERT_FONTS = [
    { value: 'Prompt', label: 'Prompt' },
    { value: 'Sarabun', label: 'Sarabun' },
    { value: 'Kanit', label: 'Kanit' },
    { value: 'Mitr', label: 'Mitr' },
    { value: 'Charmonman', label: 'Charmonman (handwriting)' },
    { value: 'Noto Serif Thai', label: 'Noto Serif Thai' },
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
    const chosen = cert.font_family || 'Prompt';
    const family = `"${chosen}", "Noto Sans Thai", sans-serif`;

    // Make sure the web fonts are ready, otherwise the canvas falls back to a
    // default font (and Thai text may not render correctly).
    if (document.fonts && document.fonts.load) {
        try {
            await Promise.all([
                document.fonts.load(`600 ${fontPx}px "${chosen}"`, name),
                document.fonts.load(`600 ${fontPx}px "Noto Sans Thai"`, name),
            ]);
        } catch { /* fall back to default font */ }
    }

    ctx.font = `600 ${fontPx}px ${family}`;
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
