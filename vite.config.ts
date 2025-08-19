import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      buffer: 'buffer',
      process: 'process/browser',
    },
  },
  define: {
    global: 'globalThis',
    'process.env': {}, // some libs read process.env
  },
  optimizeDeps: {
    include: ['buffer', 'process'],
  },
  server: {
    port: 5173,
    open: false,
  },
});