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

/*
 * Archive helpers (group E). The archive spec is the one spec that changes a
 * game it didn't create: it archives one and brings it back in the same test.
 * These read and write through the app's own signed-in Supabase client (the
 * module the app imports, so the same session); the page has to be on the
 * app's origin.
 */

/** Runs `body` in the page with the app's Supabase client as `sb` and the signed-in user as `user`. */
async function archiveWithClient<A, R>(page: Page, body: string, arg: A): Promise<R> {
  if (!page.url().startsWith(BASE_URL)) await page.goto("/");
  return page.evaluate(
    async ({ body, arg }) => {
      const mod = await import(/* @vite-ignore */ "/src/lib/supabase/client.ts" as string);
      const sb = mod.createClient();
      const { data: { user } } = await sb.auth.getUser();
      if (!user) throw new Error("headless: not signed in");
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      return new Function("sb", "user", "arg", `return (async () => { ${body} })()`)(sb, user, arg);
    },
    { body, arg },
  ) as Promise<R>;
}

/** The game's `archived_at` as the server has it (null: in the Library). */
export async function archiveStateOnServer(page: Page, matchId: string): Promise<string | null> {
  return archiveWithClient(page, `
    const { data, error } = await sb.from("matches").select("archived_at").eq("id", arg).single();
    if (error) throw new Error("headless: " + error.message);
    return data.archived_at;
  `, matchId);
}

/**
 * Puts an archived game back in the Library through the app's client when the
 * UI didn't (a failed step), then polls the server until it reads null. Safe
 * to call when the game is already back.
 */
export async function archiveRestoreGame(page: Page, matchId: string): Promise<void> {
  if ((await archiveStateOnServer(page, matchId)) !== null) {
    await archiveWithClient(page, `
      const { error } = await sb.from("matches").update({ archived_at: null }).eq("id", arg);
      if (error) throw new Error("headless: " + error.message);
    `, matchId);
  }
  await expect.poll(() => archiveStateOnServer(page, matchId), { message: "the game is back in the Library on the server", timeout: 15_000 }).toBeNull();
}

/**
 * Creates an empty playlist in the active space and returns its id. Name it
 * `headless-<port> …`; archiveDeletePlaylistsNamed removes it.
 */
export async function archiveCreatePlaylist(page: Page, name: string): Promise<string> {
  return archiveWithClient(page, `
    let orgId = localStorage.getItem("scoutable_active_org_id");
    if (!orgId) {
      const { data } = await sb.from("org_memberships").select("org_id").eq("user_id", user.id).limit(1);
      orgId = data?.[0]?.org_id ?? null;
    }
    const { data, error } = await sb.from("playlists").insert({ user_id: user.id, name: arg, org_id: orgId }).select("id").single();
    if (error || !data) throw new Error("headless: couldn't create the playlist: " + error?.message);
    return data.id;
  `, name);
}

/** Deletes the account's own playlists whose names start with `prefix` (this port's `headless-<port> `). Returns their names. */
export async function archiveDeletePlaylistsNamed(page: Page, prefix: string): Promise<string[]> {
  if (!prefix.startsWith(`headless-${PORT} `)) throw new Error(`headless: refusing to delete playlists outside "headless-${PORT} "`);
  return archiveWithClient(page, `
    const { data, error } = await sb.from("playlists").delete().eq("user_id", user.id).like("name", arg + "%").select("name");
    if (error) throw new Error("headless: " + error.message);
    return (data ?? []).map((p) => p.name);
  `, prefix);
}

/** The account's own playlists whose names start with `prefix`. */
export async function archivePlaylistNames(page: Page, prefix: string): Promise<string[]> {
  return archiveWithClient(page, `
    const { data, error } = await sb.from("playlists").select("name").eq("user_id", user.id).like("name", arg + "%");
    if (error) throw new Error("headless: " + error.message);
    return (data ?? []).map((p) => p.name);
  `, prefix);
}

/** The Library's toolbar subtitle, "N games", as a number. */
export async function libraryGameCount(page: Page): Promise<number> {
  const text = await page.getByText(/^\d+ games$/).innerText();
  return Number(text.split(" ")[0]);
}
