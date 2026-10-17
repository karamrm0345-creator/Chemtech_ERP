import { defineConfig } from "@playwright/test";

// End-to-end tests run against a running dev/staging server seeded with demo data.
// E2E_BASE_URL (default http://localhost:3000) and E2E_PASSWORD (the DEMO_PASSWORD) are required.
export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  workers: 1,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
    viewport: { width: 1366, height: 900 },
  },
});
