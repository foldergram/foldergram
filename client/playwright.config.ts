import { defineConfig } from '@playwright/test';

const previewPort = Number(process.env.FOLDERGRAM_PLAYWRIGHT_PORT || 4173);
const previewUrl = `http://127.0.0.1:${previewPort}`;

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  use: {
    baseURL: previewUrl,
    browserName: 'chromium',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined
    },
    serviceWorkers: 'block',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  },
  webServer: {
    command: `pnpm build && pnpm exec vite preview --host 127.0.0.1 --port ${previewPort} --strictPort`,
    url: previewUrl,
    reuseExistingServer: process.env.FOLDERGRAM_REUSE_PREVIEW === '1',
    env: { VITEST: 'true' },
    timeout: 120_000
  }
});
