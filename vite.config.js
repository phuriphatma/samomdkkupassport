import { resolve } from 'path';
import { defineConfig } from 'vite';
import htmlIncludes from './vite-plugin-html-includes.js';

export default defineConfig({
  // Base path differs by deploy target:
  //   - Cloudflare Pages (samomdkkupassport.pages.dev) serves at ROOT → '/'
  //     (the default; DON'T set PASSPORT_BASE there or assets 404 + no CSS).
  //   - KKU VM Nginx serves at the /passport/ SUBPATH → build with
  //     `PASSPORT_BASE=/passport/ npm run build` (server/deploy.sh does this)
  //     so asset URLs are prefixed and don't resolve to samoweb's root.
  base: process.env.PASSPORT_BASE || '/',
  plugins: [htmlIncludes()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        dashboard: resolve(__dirname, 'html/dashboard.html'),
        admin: resolve(__dirname, 'html/admin.html'),
        scan: resolve(__dirname, 'html/scan.html')
      }
    }
  }
});