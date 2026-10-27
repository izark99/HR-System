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
// E2E_PORT lets two E2E runs (different checkouts) share one machine.
const PORT = Number(process.env.E2E_PORT ?? 4173);

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
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
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm --filter @hrflow/web preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
