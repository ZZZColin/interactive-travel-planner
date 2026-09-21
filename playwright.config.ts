import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:8765',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'edge',
      use: { ...devices['Desktop Chrome'], channel: 'msedge', viewport: { width: 1600, height: 1000 } },
    },
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://127.0.0.1:8765',
    reuseExistingServer: true,
    timeout: 30_000,
  },
})
