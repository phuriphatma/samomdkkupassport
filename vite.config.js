import { resolve } from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
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