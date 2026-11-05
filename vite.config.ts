import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset paths: the app is a single page (state lives in the query string), so the
  // same build works at the domain root and under the GitHub Pages sub-path /pointscape-studio/.
  base: './',
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
