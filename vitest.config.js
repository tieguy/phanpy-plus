import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Playwright owns tests/*.spec.js; vitest only runs unit tests in src/
    include: ['src/**/*.test.js'],
  },
});
