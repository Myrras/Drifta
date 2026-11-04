import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  test: {
    environment: 'node',
    testTimeout: 20000, // heavy suites exceed 5s under load
    exclude: ['**/node_modules/**', 'dist/**', '.claude/**'],
  },
});
