import { defineConfig, devices } from "@playwright/test";

// macOS: without this, each Chromium launch leaves a code-signing copy of the app behind in
// /private/var/folders (hundreds of MB per run). Harmless elsewhere.
const CHROMIUM_LAUNCH = { args: ["--disable-features=MacAppCodeSignClone"] };

// Browsers: `npx playwright install chromium firefox` once. The pinned @playwright/test version
// decides which builds it fetches.
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
      use: { browserName: "chromium", viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true, launchOptions: CHROMIUM_LAUNCH },
      grepInvert: /@desktop/,
    },
    {
      name: "desktop",
      use: { browserName: "chromium", viewport: { width: 1280, height: 800 }, launchOptions: CHROMIUM_LAUNCH },
      grep: /@desktop/,
    },
    {
      name: "firefox-desktop",
      use: { browserName: "firefox", viewport: { width: 1280, height: 800 } },
      grep: /saving records the spot and a screenshot|a lazy image below the fold does not hold up the screenshot|a tap inside a same-origin frame/,
    },
  ],
});
