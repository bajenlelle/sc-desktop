/**
 * Headless UI harness (docs/headless-ui.md): what every spec shares. Importing
 * this reads apps/desktop/.env.headless (HEADLESS_* only; the shell wins), so
 * the config, the global setup and the specs see the same port and account.
 * The default export is the global setup: one sign-in per run, saved as the
 * storage state every test starts from.
 *
 * Specs import `test` and `expect` from here, not from @playwright/test: this
 * `test` fails a test whose page logged a `headless:` line (an unmocked or
 * native Tauri call, even one the app swallowed) or threw an uncaught error.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as sidebarFs from "node:fs";
import { test as base, expect, webkit, type Locator, type Page } from "@playwright/test";
import { loadEnv } from "vite";

const HERE = path.dirname(fileURLToPath(import.meta.url));
Object.assign(process.env, loadEnv("headless", path.dirname(HERE), "HEADLESS_"));

export const PORT = Number(process.env.HEADLESS_PORT || 1430);
export const BASE_URL = `http://localhost:${PORT}`;
export const OUT_DIR = path.join(HERE, "out");
export const STATE_FILE = path.join(OUT_DIR, `state-${PORT}.json`);

/**
 * Page errors that are the browser's, not the app's. PostHog's config fetch
 * is refused by WebKit's CORS checks on localhost; the app never sees it.
 */
const BROWSER_NOISE = [/posthog\.com\/.*access control checks/];

export const test = base.extend<{ headlessProblems: void }>({
  headlessProblems: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on("console", (message) => {
        if (message.text().startsWith("headless:")) problems.push(`console.${message.type()}: ${message.text()}`);
      });
      page.on("pageerror", (error) => {
        if (!BROWSER_NOISE.some((noise) => noise.test(error.message))) problems.push(`pageerror: ${error.message}`);
      });
      await use();
      if (problems.length > 0) {
        throw new Error(`headless: the page reported ${problems.length} problem(s):\n${problems.join("\n")}`);
      }
    },
    { auto: true },
  ],
});
export { expect };

/** The Home or Library toolbar title: the app is signed in and past its loading screens. */
const signedInTitle = (page: Page) => page.getByRole("heading", { level: 1, name: /^(Home|Library)$/ });

/** Signs in through the real login form with the staging test account from .env.headless. */
export async function signIn(page: Page): Promise<void> {
  const email = process.env.HEADLESS_EMAIL;
  const password = process.env.HEADLESS_PASSWORD;
  if (!email || !password) {
    throw new Error("headless: set HEADLESS_EMAIL and HEADLESS_PASSWORD in apps/desktop/.env.headless (docs/headless-ui.md)");
  }
  await page.goto("/auth/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  // A space with no team answer asks "Which team do you coach?" once after sign-in.
  // The modal hides the page from the accessibility tree, so answer it first: Skip
  // is an answer the app keeps per space, so later specs never see the prompt.
  const skipTeam = page.getByRole("button", { name: "Skip for now" });
  if (await skipTeam.waitFor({ state: "visible", timeout: 10_000 }).then(() => true, () => false)) {
    await skipTeam.click();
  }
  await expect(signedInTitle(page), "signed in and on Home or Library").toBeVisible({ timeout: 30_000 });
}

/** A full-page screenshot at headless/out/<port>-<name>.png; returns its path. */
export async function shot(page: Page, name: string): Promise<string> {
  const file = path.join(OUT_DIR, `${PORT}-${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

/**
 * Opens the first game in the Library and waits for its page: the Game view
 * when its video plays here and it is synced, else Details (a staging game's
 * video is usually on another computer), which is a game page all the same.
 * With `shotLibraryAs`, the loaded Library is screenshotted first under that
 * name. Returns the opened game's title as its Library row shows it.
 */
export async function openFirstGame(page: Page, options: { shotLibraryAs?: string } = {}): Promise<string> {
  await page.goto("/matches");
  await expect(page.getByRole("heading", { level: 1, name: "Library" })).toBeVisible();
  const first = page.locator('a[href^="/matches/"]').first();
  await expect(first, "the test account has a game in its Library").toBeVisible();
  // The row's first text is the game's title (components/match-row.tsx).
  const title = (await first.locator("span").first().innerText()).trim();
  if (options.shotLibraryAs) await shot(page, options.shotLibraryAs);
  await first.click();
  await expect(page.getByRole("radiogroup", { name: "View" })).toBeVisible({ timeout: 30_000 });
  return title;
}

export default async function globalSetup(): Promise<void> {
  if (!process.env.HEADLESS_DEVICE_ID) {
    throw new Error("headless: set HEADLESS_DEVICE_ID in apps/desktop/.env.headless, one per worktree (docs/headless-ui.md)");
  }
  execFileSync(path.join(HERE, "make-fixture.sh"), { stdio: "inherit" });
  const browser = await webkit.launch();
  try {
    const context = await browser.newContext({ baseURL: BASE_URL });
    await signIn(await context.newPage());
    await context.storageState({ path: STATE_FILE });
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------------------
// The playlists sidebar (group A, specs/A-*): kept together, appended last
// ---------------------------------------------------------------------------

/** A saved playlist's sidebar row (a temp row has no data-playlist-id), by its exact name. */
export function playlistRow(page: Page, name: string): Locator {
  return page.locator("[data-playlist-id]").filter({ has: page.getByText(name, { exact: true }) });
}

/** A folder's sidebar header row by its exact name (a temp folder's id starts with "temp-"). */
export function folderRow(page: Page, name: string): Locator {
  return page.locator("[data-folder-id]:not([data-folder-id^='temp-'])").filter({ has: page.getByText(name, { exact: true }) });
}

/** A Sonner toast by its text. */
export function toastWith(page: Page, text: string | RegExp): Locator {
  return page.locator("[data-sonner-toast]").filter({ hasText: text });
}

/** The focused element's value and selection, when it is a text field. */
export async function focusedField(page: Page): Promise<{ value: string; start: number | null; end: number | null } | null> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!(el instanceof HTMLInputElement)) return null;
    return { value: el.value, start: el.selectionStart, end: el.selectionEnd };
  });
}

/** Opens /playlists and waits until the sidebar has loaded (its footer's New Playlist shows once loading ends). */
export async function openPlaylistsSidebar(page: Page): Promise<void> {
  await page.goto("/playlists");
  await expect(page.getByRole("button", { name: "New Playlist", exact: true })).toBeVisible({ timeout: 30_000 });
}

/**
 * The sidebar's New Playlist (or, with `folder`, the New folder button), named
 * through the field it opens. Waits for the saved row. Inherits the selected
 * playlist's folder, like the button does.
 */
export async function createInSidebar(page: Page, kind: "playlist" | "folder", name: string): Promise<Locator> {
  if (kind === "playlist") await page.getByRole("button", { name: "New Playlist", exact: true }).click();
  else await page.getByRole("button", { name: "New folder", exact: true }).click();
  const field = page.locator("input:focus");
  await expect(field).toHaveValue(kind === "playlist" ? "New Playlist" : "New Folder");
  await field.fill(name);
  await field.press("Enter");
  const row = kind === "playlist" ? playlistRow(page, name) : folderRow(page, name);
  await expect(row, `the new ${kind} "${name}" is saved`).toBeVisible({ timeout: 15_000 });
  return row;
}

const SIDEBAR_SUPABASE = loadEnv("headless", path.dirname(HERE), "VITE_SUPABASE_");

/**
 * The signed-in account's own rows over Supabase REST, for a spec's bookkeeping
 * (reading what was saved, and cleaning up), never for the step under test.
 * The token is the page's session, else the saved storage state's.
 */
async function sidebarRest(page: Page, method: "GET" | "DELETE", pathAndQuery: string): Promise<unknown> {
  const url = SIDEBAR_SUPABASE.VITE_SUPABASE_URL;
  const key = SIDEBAR_SUPABASE.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("headless: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing from .env.headless");
  const storageKey = `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
  let session = await page.evaluate((k) => localStorage.getItem(k), storageKey).catch(() => null);
  if (!session) {
    const state = JSON.parse(sidebarFs.readFileSync(STATE_FILE, "utf8")) as { origins: { localStorage: { name: string; value: string }[] }[] };
    session = state.origins.flatMap((o) => o.localStorage).find((l) => l.name === storageKey)?.value ?? null;
  }
  const token = session ? (JSON.parse(session) as { access_token?: string }).access_token : undefined;
  if (!token) throw new Error("headless: no signed-in session to read or clean up with");
  const response = await page.request.fetch(`${url}/rest/v1/${pathAndQuery}`, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${token}`, Prefer: "return=representation" },
  });
  if (!response.ok()) throw new Error(`headless: ${method} ${pathAndQuery} answered ${response.status()}: ${await response.text()}`);
  return response.json();
}

type SidebarTable = "playlists" | "playlist_folders";

/** The account's playlists or folders whose name starts with `prefix`, as stored. */
export async function sidebarRowsNamed(page: Page, table: SidebarTable, prefix: string): Promise<Record<string, unknown>[]> {
  return (await sidebarRest(page, "GET", `${table}?select=*&name=like.${encodeURIComponent(`${prefix}*`)}`)) as Record<string, unknown>[];
}

/**
 * Deletes the account's playlists, then folders, whose name starts with
 * `prefix` (a port-named prefix, `headless-<port> `, so only what a spec made).
 * Returns how many rows went.
 */
export async function deleteSidebarRowsNamed(page: Page, prefix: string): Promise<number> {
  if (!prefix.startsWith(`headless-${PORT} `)) throw new Error(`headless: refusing to delete rows outside "headless-${PORT} …"`);
  let removed = 0;
  for (const table of ["playlists", "playlist_folders"] as const) {
    removed += ((await sidebarRest(page, "DELETE", `${table}?name=like.${encodeURIComponent(`${prefix}*`)}`)) as unknown[]).length;
  }
  return removed;
}
