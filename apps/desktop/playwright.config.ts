/**
 * The headless UI harness (docs/headless-ui.md): Playwright against
 * `vite --mode headless`, the front end with Tauri mocked, signed in to
 * staging. `npm run headless [-- <spec>]`; HEADLESS_PORT (default 1430) keeps
 * worktrees apart.
 */
import { defineConfig, devices } from "@playwright/test";
import { BASE_URL, PORT, STATE_FILE } from "./headless/helpers";

export default defineConfig({
  testDir: "headless/specs",
  outputDir: "headless/out",
  globalSetup: "./headless/helpers.ts",
  workers: 1,
  fullyParallel: false,
  reporter: "list",
  timeout: 60_000,
  use: {
    baseURL: BASE_URL,
    storageState: STATE_FILE,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "vite --mode headless",
    url: BASE_URL,
    reuseExistingServer: true,
    env: { HEADLESS_PORT: String(PORT) },
    timeout: 60_000,
  },
  projects: [
    // Closest to the app's WKWebView; plays H.264 through the system media stack.
    { name: "webkit", use: { ...devices["Desktop Safari"], viewport: { width: 1440, height: 900 } } },
    // The installed Google Chrome as the cross-check (Playwright's own Chromium has no H.264).
    { name: "chrome", use: { ...devices["Desktop Chrome"], channel: "chrome", viewport: { width: 1440, height: 900 } } },
  ],
});
