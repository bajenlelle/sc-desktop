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

/**
 * Runs `body` in the page with one of the app's own modules (`/src/...`, the
 * same Vite URL the app imports, so the same signed-in Supabase client). For
 * setup and cleanup a spec can't reach through the UI, never for what it tests.
 */
async function withAppModule<A, R>(page: Page, modulePath: string, body: string, arg: A): Promise<R> {
  return page.evaluate(
    async ({ modulePath, body, arg }) => {
      const mod = await import(/* @vite-ignore */ modulePath);
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      return new Function("mod", "arg", `return (async () => { ${body} })()`)(mod, arg);
    },
    { modulePath, body, arg },
  ) as Promise<R>;
}

/**
 * /playlists with its list loaded; stays put when already there. Leaving a page
 * while it still loads cancels its requests, and WebKit reports each cancelled
 * Supabase fetch as a page error ("… due to access control checks").
 */
export async function openPlaylists(page: Page): Promise<void> {
  if (new URL(page.url(), BASE_URL).pathname !== "/playlists" || page.url() === "about:blank") await page.goto("/playlists");
  // The list loads after the toolbar: a new playlist added before that would be dropped.
  await expect(page.locator("[data-playlist-id]").or(page.getByText("No playlists yet")).first()).toBeVisible({ timeout: 30_000 });
}

/** The account's own playlists whose names start with `prefix` (this worktree's `headless-<port> `), deleted. Returns their names. */
export async function deletePlaylistsNamed(page: Page, prefix: string): Promise<string[]> {
  if (!prefix.startsWith(`headless-${PORT} `)) throw new Error(`headless: refusing to delete playlists outside "headless-${PORT} "`);
  if (page.url() === "about:blank") await openPlaylists(page);
  return withAppModule(page, "/src/lib/supabase/client.ts", `
    const sb = mod.createClient();
    const { data: u } = await sb.auth.getUser();
    if (!u.user) throw new Error("headless: not signed in");
    const { data, error } = await sb.from("playlists").delete().eq("user_id", u.user.id).like("name", arg + "%").select("name");
    if (error) throw new Error("headless: " + error.message);
    return (data ?? []).map((p) => p.name);
  `, prefix);
}

/** Reads rows through the app's signed-in client (read-only checks of what the UI saved). */
export async function selectRows<T = Record<string, unknown>>(
  page: Page,
  table: string,
  columns: string,
  eq: Record<string, string | number>,
): Promise<T[]> {
  return withAppModule(page, "/src/lib/supabase/client.ts", `
    let q = mod.createClient().from(arg.table).select(arg.columns);
    for (const [k, v] of Object.entries(arg.eq)) q = q.eq(k, v);
    const { data, error } = await q;
    if (error) throw new Error("headless: " + error.message);
    return data;
  `, { table, columns, eq });
}

/**
 * On /playlists: a new playlist named `name` (the toolbar's New playlist and
 * the inline name field), then Add clips with the given Events rows ticked
 * (`rowKeys`, `<matchId>:<eventId>`), or else the first `count`, and the
 * sheet closed. Returns the playlist's row keys in the editor.
 */
export async function newPlaylistWithClips(
  page: Page,
  name: string,
  options: { count?: number; pick?: (rowKeys: string[]) => Promise<string[]> | string[] } = {},
): Promise<string[]> {
  await openPlaylists(page);
  await page.getByRole("button", { name: "New playlist" }).first().click();
  const field = page.locator("input:focus");
  await field.fill(name);
  await field.press("Enter");
  await expect(page.locator("[data-playlist-id]").filter({ hasText: name }), "the new playlist is in the list").toBeVisible();
  const addClips = page.getByRole("button", { name: "Add clips", exact: true }).first();
  await expect(addClips).toBeVisible({ timeout: 15_000 });
  await addClips.click();
  const sheet = page.getByRole("dialog");
  const grid = sheet.getByRole("grid", { name: "Events" });
  await expect(grid.getByRole("row").first()).toBeVisible({ timeout: 30_000 });
  const all = await grid.locator("[role=row][data-row-key]").evaluateAll((rows) => rows.map((r) => r.getAttribute("data-row-key")!));
  const keys = options.pick ? await options.pick(all) : all.slice(0, options.count ?? 2);
  expect(keys.length, "Add clips lists the rows the spec wants").toBeGreaterThan(0);
  for (const key of keys) await grid.locator(`[role=row][data-row-key="${key}"]`).getByRole("checkbox", { name: "Select" }).click();
  await sheet.getByRole("button", { name: `Add ${keys.length} clip${keys.length === 1 ? "" : "s"}` }).click();
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toBeHidden();
  const editorRows = page.locator("[role=row][data-row-key]");
  await expect(editorRows).toHaveCount(keys.length);
  return keys;
}

/** A game linked to the test video for a spec, and what to put back. */
export interface FixtureLink {
  matchId: string;
  previous: string | null;
  linked: string;
}

/**
 * Links the game on the editor's stage to the fixture through the player's
 * "Locate file…" (the dialog mock picks headless/fixtures/game.mp4), after
 * noting the game's own video_url. Refuses a game another worktree has linked.
 * Pair with restoreGameVideo in afterEach.
 */
export async function linkStageGameToFixture(page: Page, matchId: string): Promise<FixtureLink> {
  const [before] = await selectRows<{ video_url: string | null }>(page, "matches", "video_url", { id: matchId });
  expect(before, "the game is readable").toBeTruthy();
  expect(before.video_url ?? "", "no other worktree has this game linked to its fixture").not.toContain("/headless/fixtures/");
  await page.getByRole("button", { name: "Locate file…" }).click();
  await expect(page.getByText("This game's video file can't be found")).toBeHidden({ timeout: 15_000 });
  let linked = "";
  await expect(async () => {
    const [after] = await selectRows<{ video_url: string | null }>(page, "matches", "video_url", { id: matchId });
    linked = after.video_url ?? "";
    expect(linked).toContain("/headless/fixtures/game.mp4");
  }).toPass({ timeout: 10_000 });
  return { matchId, previous: before.video_url, linked };
}

/** Puts a linked game's own video_url back, only if it still holds this spec's link. */
export async function restoreGameVideo(page: Page, link: FixtureLink): Promise<void> {
  if (page.url() === "about:blank") await openPlaylists(page);
  await withAppModule(page, "/src/lib/supabase/client.ts", `
    const { error } = await mod.createClient().from("matches").update({ video_url: arg.previous })
      .eq("id", arg.matchId).eq("video_url", arg.linked);
    if (error) throw new Error("headless: " + error.message);
  `, link);
}

/**
 * A point on the open sheet's dim scrim: beside the sheet if there is room,
 * else under it, never in the title-bar strip.
 */
export async function sheetScrimPoint(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.locator("[data-slot=sheet-content]").boundingBox();
  if (!box) throw new Error("headless: no sheet is open");
  const viewport = page.viewportSize()!;
  if (box.x >= 12) return { x: box.x / 2, y: box.y + box.height / 2 };
  const below = viewport.height - (box.y + box.height);
  if (below >= 8) return { x: viewport.width / 2, y: box.y + box.height + below / 2 };
  throw new Error("headless: the sheet leaves no scrim to click");
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
