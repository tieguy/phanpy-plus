import preact from '@preact/preset-vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: preact(),
  resolve: {
    alias: {
      react: 'preact/compat',
      'react-dom': 'preact/compat',
      'react/jsx-runtime': 'preact/jsx-runtime',
    },
  },
  test: {
    // Playwright owns tests/*.spec.js; vitest only runs unit tests in src/
    include: ['src/**/*.test.{js,jsx}'],
    globals: true,
  },
});
