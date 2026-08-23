import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Deployed under a sub-path on GitHub Pages, at the root everywhere else.
const base = process.env.GEETAB_BASE ?? '/';

export default defineConfig({
  base,
  plugins: [react()],
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
  worker: { format: 'es' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
