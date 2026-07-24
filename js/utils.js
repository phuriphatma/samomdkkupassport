// js/utils.js — Shared utility helpers

/**
 * Generate a UUID v4 string.
 * Uses crypto.randomUUID() when available, falls back to manual generation.
 */
export function generateUUID() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

/**
 * Fix Google Drive share URLs to direct-viewable image URLs.
 * Handles every Drive link form we store or admins paste — `/file/d/FILE_ID/...`,
 * `/d/FILE_ID`, and the query forms `?id=`, `open?id=`, `uc?id=`, `thumbnail?id=` —
 * normalising them all to `lh3.googleusercontent.com/d/FILE_ID`, which serves the
 * right CORS headers (needed so a badge/cert drawn onto a <canvas> can be exported).
 * A pasted `?id=` link left un-normalised loads fine as an <img> but is CORS-blocked
 * under `crossOrigin='anonymous'`, so the canvas silently drops it. See MISTAKES.md.
 * Returns the original URL unchanged if it's not a recognised Google Drive link.
 */
export function fixGoogleDriveUrl(url) {
    if (!url) return url;
    const gdriveMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (gdriveMatch) {
        return `https://lh3.googleusercontent.com/d/${gdriveMatch[1]}`;
    }
    return url;
}

/**
 * Get the pending scan URL from localStorage (saved when a user scans
 * a QR code before logging in).
 * @returns {string|null}
 */
export function getPendingScanUrl() {
    try {
        return localStorage.getItem('pendingScanUrl');
    } catch (e) {
        console.warn('Could not read localStorage', e);
        return null;
    }
}

/**
 * Save a pending scan URL to localStorage.
 * @param {string} url
 */
export function savePendingScanUrl(url) {
    try {
        localStorage.setItem('pendingScanUrl', url);
    } catch (e) {
        console.warn('Could not write localStorage', e);
    }
}

/**
 * Remove the pending scan URL from localStorage.
 */
export function clearPendingScanUrl() {
    try {
        localStorage.removeItem('pendingScanUrl');
    } catch (e) {
        console.warn('Could not clear localStorage', e);
    }
}
