import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // JSX without @vitejs/plugin-react: esbuild's automatic runtime is all a
  // test run needs (the plugin exists for Fast Refresh, and its current major
  // peers on vite 8 — incompatible with vitest 3).
  esbuild: { jsx: 'automatic' },
  resolve: {
    // Mirrors tsconfig.json's `paths: { "@/*": ["./src/*"] }` — page.tsx and
    // the route-level tests import through it.
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'jsdom',
    // Tests live beside their slice (VSA), not in a top-level tests/ dir.
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./vitest.setup.ts'],
  },
});
