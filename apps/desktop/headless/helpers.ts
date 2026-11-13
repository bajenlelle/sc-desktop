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
import { test as base, expect, webkit, type Locator, type Page, type Request } from "@playwright/test";
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
 * WebKit raises "ResizeObserver loop completed with undelivered notifications"
 * as an error event when an observer's callback changes layout (the Add clips
 * chips row measures its fade edges); it is a notice, and the app's Sentry
 * ignores it too (src/lib/sentry.ts).
 */
const BROWSER_NOISE = [/posthog\.com\/.*access control checks/, /ResizeObserver loop/];

/** The app's Supabase requests still in flight, per page (waitForQuiet). */
const inFlight = new WeakMap<Page, Set<Request>>();

function trackSupabaseReads(page: Page): void {
  const open = new Set<Request>();
  inFlight.set(page, open);
  const isSupabase = (r: Request) => r.url().includes(".supabase.co/");
  page.on("request", (r) => { if (isSupabase(r)) open.add(r); });
  page.on("requestfinished", (r) => open.delete(r));
  page.on("requestfailed", (r) => open.delete(r));
}

/**
 * Waits until the app has had no Supabase request in flight for 300 ms (at
 * most 15 s). Call it before a full page load or reload: WebKit reports each
 * fetch a navigation cancels as a page error ("… due to access control
 * checks"), which the shared `test` fails on; the app itself never reloads.
 */
export async function waitForQuiet(page: Page): Promise<void> {
  const open = inFlight.get(page);
  if (!open) return;
  const until = Date.now() + 15_000;
  let quietSince = open.size === 0 ? Date.now() : 0;
  while (Date.now() < until) {
    if (open.size > 0) quietSince = 0;
    else if (quietSince === 0) quietSince = Date.now();
    else if (Date.now() - quietSince >= 300) return;
    await page.waitForTimeout(50);
  }
  throw new Error(`headless: ${open.size} Supabase request(s) still open after 15 s: ${[...open].map((r) => r.url().slice(0, 120)).join(", ")}`);
}

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
      trackSupabaseReads(page);
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

/**
 * The helpers below write through the app's own signed-in Supabase client, in
 * the page: the module Vite serves the app (lib/supabase/client.ts), so it is
 * the same instance and session. The page has to be on the app's origin first.
 */
async function onAppOrigin(page: Page): Promise<void> {
  if (!page.url().startsWith(BASE_URL)) await page.goto("/");
}

/**
 * Creates a playlist in the active space (the first one the account belongs
 * to when none is stored) and returns its id. Name it `headless-<port> …` and
 * delete it in the same spec (deleteOwnRowsNamed).
 */
export async function createPlaylist(page: Page, name: string): Promise<string> {
  await onAppOrigin(page);
  return page.evaluate(async (playlistName) => {
    const { createClient } = await import("/src/lib/supabase/client.ts" as string);
    const sb = createClient();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) throw new Error("headless: not signed in");
    let orgId = localStorage.getItem("scoutable_active_org_id");
    if (!orgId) {
      const { data } = await sb.from("org_memberships").select("org_id").eq("user_id", user.id).limit(1);
      orgId = data?.[0]?.org_id ?? null;
    }
    const { data, error } = await sb.from("playlists").insert({ user_id: user.id, name: playlistName, org_id: orgId }).select("id").single();
    if (error || !data) throw new Error(`headless: couldn't create the playlist: ${error?.message}`);
    return data.id as string;
  }, name);
}

/**
 * Deletes the signed-in account's rows in `table` (playlists, filter_presets)
 * whose name starts with `prefix`: a spec's own `headless-<port> …` rows, in
 * its afterEach, so a failed run leaves nothing behind. Returns how many.
 */
export async function deleteOwnRowsNamed(page: Page, table: "playlists" | "filter_presets", prefix: string): Promise<number> {
  if (!prefix.startsWith(`headless-${PORT}`)) throw new Error(`headless: only delete what this port created (headless-${PORT} …)`);
  await onAppOrigin(page);
  return page.evaluate(async ({ table, prefix }) => {
    const { createClient } = await import("/src/lib/supabase/client.ts" as string);
    const sb = createClient();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return 0;
    const { data, error } = await sb.from(table).delete().eq("user_id", user.id).like("name", `${prefix}%`).select("id");
    if (error) throw new Error(`headless: couldn't delete ${table}: ${error.message}`);
    return (data ?? []).length;
  }, { table, prefix });
}

/** The names of the signed-in account's rows in `table` that start with `prefix` (to wait on a write). */
export async function ownRowNames(page: Page, table: "playlists" | "filter_presets", prefix: string): Promise<string[]> {
  return page.evaluate(async ({ table, prefix }) => {
    const { createClient } = await import("/src/lib/supabase/client.ts" as string);
    const sb = createClient();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return [];
    const { data } = await sb.from(table).select("name").eq("user_id", user.id).like("name", `${prefix}%`);
    return ((data ?? []) as { name: string }[]).map((r) => r.name).sort();
  }, { table, prefix });
}

/** The Add clips sheet (it is a dialog; so are the popovers opened inside it). */
export const addClipsSheet = (page: Page) =>
  page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Add clips", exact: true }) });

/**
 * Goes to a sidebar page the way a coach does, without a full page load
 * (see waitForQuiet).
 */
export async function goViaSidebar(page: Page, link: "Home" | "Playlists" | "Library"): Promise<void> {
  const nav = page.getByRole("navigation", { name: "Main" });
  if (!page.url().startsWith(BASE_URL) || !(await nav.isVisible())) {
    await waitForQuiet(page);
    await page.goto(link === "Library" ? "/matches" : link === "Playlists" ? "/playlists" : "/");
    return;
  }
  await nav.getByRole("link", { name: link, exact: true }).click();
}

/**
 * Opens the playlist on a freshly loaded Playlists page and its Add clips
 * sheet; returns the sheet. A fresh load, not the sidebar: coming back to the
 * page within a session, the sheet's plays come from the in-memory cache at
 * once, and the page's own mount load (run twice in the dev build) can land
 * after them and replace them, leaving the sheet on "No events match"
 * (reported in C-specs-report.md; pages/playlists.tsx, not group C's code).
 */
export async function openAddClips(page: Page, playlistId: string) {
  await waitForQuiet(page);
  await page.goto("/playlists");
  const row = page.locator(`[data-playlist-id="${playlistId}"]`).first();
  await expect(row, "the spec's playlist is listed").toBeVisible({ timeout: 30_000 });
  await row.click();
  await page.getByRole("button", { name: "Add clips", exact: true }).first().click();
  const sheet = addClipsSheet(page);
  await expect(sheet).toBeVisible();
  return sheet;
}

/** The sheet's "N events" counter: how many plays the filters leave. */
export async function eventCount(sheet: Locator): Promise<number> {
  const text = await sheet.getByText(/^\d+ events?$/).innerText();
  return Number(text.split(" ")[0]);
}

/**
 * Waits until the chosen games' plays are listed: no "Loading clips…" and at
 * least one event. Only for filters that leave some plays.
 */
export async function waitForPlays(sheet: Locator): Promise<number> {
  await expect(sheet.getByText("Loading clips…")).toBeHidden({ timeout: 30_000 });
  await expect.poll(() => eventCount(sheet), { message: "the chosen games' plays are listed", timeout: 30_000 }).toBeGreaterThan(0);
  return eventCount(sheet);
}

/** The Game picker's trigger (its accessible name is "Game"; its text is the choice). */
export const gameTrigger = (sheet: Locator) => sheet.getByRole("button", { name: "Game", exact: true });

/** Picks one game alone in the Game picker (a row press) and waits for its plays. */
export async function pickOnlyGame(page: Page, sheet: Locator, title: string): Promise<void> {
  await gameTrigger(sheet).click();
  const list = page.getByRole("listbox", { name: "Games" });
  await expect(list).toBeVisible();
  await page.getByRole("combobox", { name: "Search games or teams" }).fill(title);
  const option = list.getByRole("option").filter({ hasText: title }).first();
  await expect(option, `the test account has the game "${title}"`).toBeVisible();
  // The row's middle is its title: pressing it picks that game alone (the checkbox is on the left).
  await option.getByText(title, { exact: true }).click();
  await expect(list).toBeHidden();
  await expect(gameTrigger(sheet)).toHaveText(title);
  await waitForPlays(sheet);
}

/** A Radix menu read in order: each group heading with its options' labels (flat menus give one group named ""). */
export async function menuGroups(menu: Locator): Promise<{ heading: string; options: string[] }[]> {
  return menu.evaluate((el) => {
    const groups: { heading: string; options: string[] }[] = [];
    for (const child of Array.from(el.children)) {
      const role = child.getAttribute("role");
      const text = (child.textContent ?? "").trim();
      if (role === "menuitemcheckbox") {
        if (groups.length === 0) groups.push({ heading: "", options: [] });
        groups[groups.length - 1].options.push(text);
      } else if (!role && text) {
        groups.push({ heading: text, options: [] });
      }
    }
    return groups;
  });
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
