import { defineConfig, devices } from '@playwright/test';

const timeout = process.env.EHTW_STABILITY === 'full' ? 30 * 60_000 : 5 * 60_000;
const themeOnly = /J viewport and theme/;

export default defineConfig({
  testDir: './stability',
  testMatch: /.*\.spec\.mjs$/,
  timeout,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: 2,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: '../work/test-runs/stability-report' }], ['json', { outputFile: '../work/test-runs/stability-report/results.json' }]],
  outputDir: '../work/test-runs/stability-artifacts',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'en-US',
    timezoneId: 'UTC',
    serviceWorkers: 'block',
    actionTimeout: 15_000,
    navigationTimeout: 15_000,
    // Prevent browser-level popup or other requests from bypassing routes.
    launchOptions: { proxy: { server: 'http://127.0.0.1:9' } }
  },
  projects: [
    { name: 'desktop-1440-light', grepInvert: themeOnly, use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, colorScheme: 'light' } },
    { name: 'iphone-13-chromium', grepInvert: themeOnly, use: { ...devices['iPhone 13'], browserName: 'chromium', defaultBrowserType: 'chromium' } },
    { name: 'desktop-1440-dark', grep: /J /, use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, colorScheme: 'dark' } }
  ]
});
