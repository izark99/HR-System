import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

/**
 * E2E against the production build served by `vite preview` (same CSP as public/_headers).
 * Browsers are not downloaded: use the pre-installed Chromium when present, or set
 * PW_CHROMIUM_PATH.
 */
const PREINSTALLED = '/opt/pw-browsers/chromium';
const executablePath =
  process.env.PW_CHROMIUM_PATH ?? (existsSync(PREINSTALLED) ? PREINSTALLED : undefined);
// PW_CHANNEL=chrome runs the installed Google Chrome instead (pnpm perf:local on a real machine).
const CHANNEL = process.env.PW_CHANNEL;
// E2E_PORT lets two E2E runs (different checkouts) share one machine.
const PORT = Number(process.env.E2E_PORT ?? 4173);

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: {
    timeout: 15_000,
    // Pixel comparison of the design screenshots (spec §30.3). Zero tolerance, never raise it: a
    // dropped Vietnamese tone mark changes only 1–9 pixels (an acute accent: 1 pixel, AC-TL-14).
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      maxDiffPixels: 0,
    },
  },
  // Baselines are made with the preinstalled Chromium only (one platform): no OS suffix.
  snapshotPathTemplate: 'e2e/__screenshots__/{testFileName}/{arg}{ext}',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: `http://localhost:${PORT}`,
    acceptDownloads: true,
    locale: 'vi-VN',
    trace: 'retain-on-failure',
    ...(executablePath && !CHANNEL ? { launchOptions: { executablePath } } : {}),
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], ...(CHANNEL ? { channel: CHANNEL } : {}) },
    },
  ],
  webServer: {
    command: `pnpm --filter @hrflow/web preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
