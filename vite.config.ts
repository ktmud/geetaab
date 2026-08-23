import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Relative, so one build works at the domain root, under /<repo>/ on GitHub
// Pages, and behind any custom domain without being rebuilt. The app is a
// single page with no routed sub-paths, which is what makes this safe.
const base = process.env.GEETAAB_BASE ?? './';

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
