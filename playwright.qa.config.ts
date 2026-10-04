import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests', testMatch: /qa-upload\.spec\.ts/,
  metadata: { environment: 'qa' },
  fullyParallel: true, workers: 2, reporter: 'list',
  use: { baseURL: 'http://localhost:5194/qa/', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev -- --port 5194 --strictPort', url: 'http://localhost:5194/qa/',
    reuseExistingServer: false, timeout: 120000,
    env: { VITE_APP_BASE_PATH: '/qa/', VITE_API_BASE_URL: '/qa', VITE_APP_ENV: 'qa' },
  },
});
