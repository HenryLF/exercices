import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['tests/global-setup.ts'],
    setupFiles: ['tests/setup.ts'],
    env: {
      NODE_ENV: 'test',
      MONGODB_URI: 'mongodb://127.0.0.1:1/unused-in-tests',
      SESSION_SECRET: 'test-secret-test-secret-test-secret-000',
      QR_SECRET: 'qr-secret-qr-secret-qr-secret-qr-secret-00',
      BASE_URL: 'http://exercices.test',
    },
    testTimeout: 20000,
    hookTimeout: 120000,
  },
});
