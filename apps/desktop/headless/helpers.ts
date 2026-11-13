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
import { test as base, expect, webkit, type Page } from "@playwright/test";
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

/** A name for something a spec creates on the shared account: `headless-<port> <what>`. */
export const owned = (what: string) => `headless-${PORT} ${what}`;

/** The play rows of the game view's list (not the period headers or the marker rows). */
export const playRows = (page: Page) =>
  page.getByRole("list", { name: "Plays" }).locator('div[data-row-key]:not([data-row-key^="period:"])');

/**
 * Opens the Library's nth game from inside the app (the toolbar's Library
 * button when there is one, so the app's session memory survives; a load of
 * /matches otherwise) and waits for its page. Returns its id and title.
 */
export async function openLibraryGame(page: Page, index: number): Promise<{ id: string; title: string }> {
  const library = page.locator("header").getByRole("button", { name: "Library", exact: true });
  if (await library.isVisible()) await library.click();
  // Already loaded at /matches (a spec's cleanup ran there): no second load.
  else if (new URL(page.url(), BASE_URL).pathname !== "/matches" || !page.url().startsWith(BASE_URL)) await page.goto("/matches");
  await expect(page.getByRole("heading", { level: 1, name: "Library" })).toBeVisible({ timeout: 30_000 });
  const row = page.locator('a[href^="/matches/"]').nth(index);
  await expect(row, `the test account has a game at Library row ${index}`).toBeVisible({ timeout: 30_000 });
  const id = (await row.getAttribute("href"))!.replace("/matches/", "");
  const title = (await row.locator("span").first().innerText()).trim();
  await row.click();
  await expect(page.getByRole("radiogroup", { name: "View" })).toBeVisible({ timeout: 30_000 });
  return { id, title };
}

/** Puts the open game on its Game view (a staging game usually opens on Details) and waits for the play list. */
export async function showGameView(page: Page): Promise<void> {
  const game = page.getByRole("radio", { name: "Game" });
  if ((await game.getAttribute("aria-checked")) !== "true") await game.click();
  await expect(game).toHaveAttribute("aria-checked", "true");
  await expect(playRows(page).first()).toBeVisible({ timeout: 30_000 });
}

/**
 * In the game view, makes a new playlist the "Adding to" target through the
 * toolbar's picker (its search field names the new playlist).
 */
export async function chooseNewTarget(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: /^(Choose the playlist to add plays to|Adding to .*\. Change playlist)$/ }).click();
  await page.getByPlaceholder("Search or name a new playlist").fill(name);
  await page.getByRole("button", { name: `New playlist “${name}”` }).click();
  await expect(page.getByRole("button", { name: `Adding to ${name}. Change playlist` })).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press("Escape");
}

/** The count chip of the toolbar's "Adding to {name}" control, on its own (the control's text also holds the name). */
export const addingCount = (page: Page, name: string) =>
  page.getByRole("button", { name: `Adding to ${name}. Change playlist` }).locator("span").last();

/**
 * Deletes the test account's playlists with exactly these names through the
 * app's own signed-in Supabase client (Vite serves its modules). For a spec's
 * cleanup: every name must be this worktree's (`owned(…)`, `headless-<port> …`),
 * anything else is refused. Returns how many went.
 */
export async function deleteOwnedPlaylists(page: Page, names: readonly string[]): Promise<number> {
  const outside = names.filter((n) => !n.startsWith(`headless-${PORT} `));
  if (outside.length > 0) throw new Error(`headless: refusing to delete playlists outside "headless-${PORT} …": ${outside.join(", ")}`);
  if (!page.url().startsWith(BASE_URL)) await page.goto("/matches");
  return page.evaluate(async (names) => {
    const { createClient } = await import("/src/lib/supabase/client.ts" as string);
    const sb = createClient();
    const { data: auth } = await sb.auth.getUser();
    if (!auth.user) throw new Error("headless: not signed in for the cleanup");
    const { data, error } = await sb.from("playlists").delete().eq("user_id", auth.user.id).in("name", names).select("id");
    if (error) throw new Error(`headless: cleanup failed: ${error.message}`);
    return (data ?? []).length;
  }, [...names]);
}

/** The clips of the test account's playlist of that name, as the server holds them; null when there is no such playlist. */
export async function playlistClips(page: Page, name: string): Promise<{ matchId: string; eventId: number }[] | null> {
  return page.evaluate(async (name) => {
    const { createClient } = await import("/src/lib/supabase/client.ts" as string);
    const sb = createClient();
    const { data: auth } = await sb.auth.getUser();
    const { data, error } = await sb
      .from("playlists")
      .select("id, playlist_clips(item_type, match_id, event_id, position)")
      .eq("user_id", auth.user!.id)
      .eq("name", name);
    if (error) throw new Error(`headless: playlist read failed: ${error.message}`);
    if (!data || data.length === 0) return null;
    const rows = (data[0].playlist_clips ?? []) as { item_type: string; match_id: string; event_id: number; position: number }[];
    return rows
      .filter((r) => r.item_type === "clip")
      .sort((a, b) => a.position - b.position)
      .map((r) => ({ matchId: r.match_id, eventId: r.event_id }));
  }, name);
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
