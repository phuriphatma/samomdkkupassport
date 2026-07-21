// js/routes.js
// BASE mirrors Vite base: '/' on pages.dev, '/passport/' on the KKU VM subpath build.
// So these paths are IDENTICAL to the old hardcoded ones on pages.dev,
// and correctly prefixed on the VM. Do not hardcode a leading-slash root here.
const BASE = import.meta.env.BASE_URL;
export const ROUTES = {
    HOME: BASE,
    DASHBOARD: BASE + 'html/dashboard.html',
    ADMIN: BASE + 'html/admin.html',
    SCAN: BASE + 'html/scan.html'
};
