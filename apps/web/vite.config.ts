import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:4000' },
      '/health': { target: 'http://127.0.0.1:4000' },
    },
  },
  build: { sourcemap: false },
});
