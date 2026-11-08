// Offline desktop + mobile matrix for EH Twitter Style.
// Run: cd tests && npm install && npx playwright install chromium webkit && npm test
import { defineConfig, devices } from '@playwright/test';

const withWebkit = process.env.EHTW_WEBKIT !== '0';
const chromiumPhone = (device) => ({ ...devices[device], browserName: 'chromium', defaultBrowserType: 'chromium' });

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.mjs$/,
  timeout: 60_000,
  expect: { timeout: 7_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: '../work/test-runs/offline-report' }], ['json', { outputFile: '../work/test-runs/offline-report/results.json' }]],
  outputDir: '../work/test-runs/offline-artifacts',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'en-US',
    timezoneId: 'UTC',
    serviceWorkers: 'block',
    // Context routes do not intercept every WebKit popup navigation. Make the
    // browser itself unable to reach any unhandled host while keeping routed
    // requests fulfilled by the offline mock.
    launchOptions: { proxy: { server: 'http://127.0.0.1:9' } }
  },
  projects: [
    // ---- desktop -----------------------------------------------------------
    { name: 'desktop-1440-light', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, colorScheme: 'light' } },
    { name: 'desktop-1440-dark', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, colorScheme: 'dark' } },
    { name: 'desktop-1280', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'tablet-900', use: { ...devices['Desktop Chrome'], viewport: { width: 900, height: 1000 } } },
    { name: 'narrow-699', use: { ...devices['Desktop Chrome'], viewport: { width: 699, height: 900 } } },
    // ---- phones (Chromium mobile emulation: touch, isMobile, DPR, UA) ---------
    { name: 'iphone-13-chromium', use: chromiumPhone('iPhone 13') },
    { name: 'iphone-14-pro-max-chromium', use: chromiumPhone('iPhone 14 Pro Max') },
    { name: 'pixel-7', use: { ...devices['Pixel 7'] } },
    { name: 'iphone-13-landscape-chromium', use: chromiumPhone('iPhone 13 landscape') },
    // ---- WebKit (closest automatable engine to iOS Safari) -------------------
    ...(withWebkit ? [
      { name: 'webkit-iphone-13', use: { ...devices['iPhone 13'] } },
      { name: 'webkit-desktop', use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } } }
    ] : [])
  ]
});
