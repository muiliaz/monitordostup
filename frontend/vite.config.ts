import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev, proxy API calls to the backend so the app is same-origin (cookies + SSE).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': 'http://localhost:3000' },
  },
});
