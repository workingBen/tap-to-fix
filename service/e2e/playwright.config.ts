import { defineConfig, devices } from "@playwright/test";

// Browsers come from the local cache (chromium-1228, firefox-1532); never `playwright install`.
export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  globalSetup: "./global-setup.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  reporter: [["list"]],
  outputDir: "../.local/e2e-results",
  use: { baseURL: "http://localhost:4173", trace: "off", video: "off", screenshot: "off" },
  projects: [
    {
      name: "phone",
      use: { browserName: "chromium", viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
    },
    {
      name: "firefox-desktop",
      use: { browserName: "firefox", viewport: { width: 1280, height: 800 } },
      grep: /saving records the spot and a screenshot/,
    },
  ],
});
