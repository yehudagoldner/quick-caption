import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  testMatch: /marketing-(?:home|mobile-stability)\.spec\.ts/,
  // Local frontend fixtures only; no application server or database is started.
  workers: 1,
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'iphone-webkit', use: { ...devices['iPhone 13'] } },
  ],
});
