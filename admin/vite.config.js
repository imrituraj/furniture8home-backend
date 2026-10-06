import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The admin dashboard is served by the Worker at the backend's root URL.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    // `npm run dev` runs the Worker (API + data) on port 8787
    proxy: {
      '/api': process.env.API_PROXY_TARGET || 'http://localhost:8787',
      '/media': process.env.API_PROXY_TARGET || 'http://localhost:8787',
    },
  },
});
