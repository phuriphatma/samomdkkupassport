import { resolve } from 'path';
import { defineConfig } from 'vite';
import htmlIncludes from './vite-plugin-html-includes.js';

export default defineConfig({
  plugins: [htmlIncludes()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        dashboard: resolve(__dirname, 'html/dashboard.html'),
        admin: resolve(__dirname, 'html/admin.html'),
        scan: resolve(__dirname, 'html/scan.html'),
        themePreview: resolve(__dirname, 'theme-preview.html')
      }
    }
  }
});