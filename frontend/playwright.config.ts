import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: process.env.TALKDECK_TEST_URL ?? "http://127.0.0.1:8873",
    headless: true,
    viewport: { width: 1512, height: 900 },
    trace: "retain-on-failure",
  },
  reporter: "list",
});
