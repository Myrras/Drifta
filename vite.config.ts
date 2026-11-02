import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  test: {
    environment: 'node',
    exclude: ['**/node_modules/**', 'dist/**', '.claude/**'],
  },
});
