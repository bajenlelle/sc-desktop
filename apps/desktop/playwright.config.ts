/**
 * The headless UI harness (docs/headless-ui.md): Playwright against
 * `vite --mode headless`, the front end with Tauri mocked, signed in to
 * staging. `npm run headless [-- <spec>]` (WebKit), `npm run headless:full`
 * (WebKit and Chrome, before a merge to staging), `npm run headless:smoke`
 * (the @smoke tests); HEADLESS_PORT (default 1430) keeps worktrees apart,
 * HEADLESS_WORKERS overrides the worker count.
 */
import { defineConfig, devices } from "@playwright/test";
import { BASE_URL, PORT, STATE_FILE } from "./headless/helpers";

const WEBKIT = { ...devices["Desktop Safari"], viewport: { width: 1440, height: 900 } };
const CHROME = { ...devices["Desktop Chrome"], channel: "chrome", viewport: { width: 1440, height: 900 } };
/** Tests tagged @alone (not @alone:<group>, which run with the rest). */
const ALONE = /@alone(?!:)/;
/**
 * Every test but those, to leave out of the -alone projects. Both kinds of project choose with grepInvert:
 * a project's own grep would replace the command line's --grep (npm run headless:smoke).
 */
const NOT_ALONE = /^(?![\s\S]*@alone(?!:))/;

export default defineConfig({
  testDir: "headless/specs",
  outputDir: "headless/out",
  globalSetup: "./headless/helpers.ts",
  // Tests run side by side, each file's tests spread over the workers. What a test writes is named by its
  // worker (OWNER in headless/helpers.ts); a test tagged @alone runs with nothing else in flight.
  workers: Number(process.env.HEADLESS_WORKERS || 3),
  fullyParallel: true,
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
    { name: "webkit", use: WEBKIT, grepInvert: ALONE },
    // The installed Google Chrome as the cross-check (Playwright's own Chromium has no H.264).
    { name: "chrome", use: CHROME, grepInvert: ALONE },
    // The @alone tests, one at a time, listed last so they are queued last: together at the end of a run,
    // they wait once for the other tests to finish rather than once each (the lock in headless/helpers.ts
    // keeps them apart from anything in flight). `--project='webkit*'` picks both WebKit projects.
    { name: "webkit-alone", use: WEBKIT, grepInvert: NOT_ALONE, workers: 1 },
    { name: "chrome-alone", use: CHROME, grepInvert: NOT_ALONE, workers: 1 },
  ],
});
