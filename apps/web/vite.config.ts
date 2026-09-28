import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// base: './' is what lets the SAME build be loaded from Electron's
// privileged app:// scheme AND served from an arbitrary path by Nest/Caddy
// (design doc §1.4) — an absolute base would break one or the other.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  server: {
    port: 5173,
    proxy: {
      // Port 3000 collides with another local Docker project on this
      // machine (a container also publishes host:3000) — moved to 3010
      // to stop the lab server's dev traffic from being intercepted.
      // Keep this in sync with apps/server/.env's PORT.
      // 127.0.0.1 (not localhost) avoids Node resolving to IPv6 ::1.
      '/api': { target: 'http://127.0.0.1:3010', changeOrigin: true },
      '/socket.io': { target: 'http://127.0.0.1:3010', ws: true, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
