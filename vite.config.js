import { defineConfig } from 'vite';

export default defineConfig({
  // relative asset URLs so the build works from any GitHub Pages subpath
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
  test: { environment: 'node', include: ['tests/**/*.test.js'] },
});
