import { resolve } from 'path';
import { defineConfig } from 'vite';
import htmlIncludes from './vite-plugin-html-includes.js';

export default defineConfig({
  // Served at the /passport/ subpath on samo.md.kku.ac.th (behind the KKU
  // VM's Nginx). Vite must prefix asset URLs with /passport/ or the HTML's
  // root-absolute /assets/* links resolve to samoweb's root → blank page.
  // Revert to '/' only if passport ever moves to its own subdomain root.
  base: '/passport/',
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