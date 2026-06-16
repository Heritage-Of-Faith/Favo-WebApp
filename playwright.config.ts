import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  timeout: 60_000,
  reporter: process.env.CI ? "github" : "html",
  use: {
    baseURL: process.env.PUBLIC_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
    actionTimeout: 15_000,
    navigationTimeout: 60_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "bun dev",
    url: "http://localhost:3000/api/healthz",
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
});
