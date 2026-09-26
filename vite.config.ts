import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  publicDir: mode === 'demo' ? 'demo/public' : 'public',
  build: { outDir: 'dist' },
}));
