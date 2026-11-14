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
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as sidebarFs from "node:fs";
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
 * Runs `body` in the page with one of the app's own modules (`/src/...`, the
 * same Vite URL the app imports, so the same signed-in Supabase client). For
 * setup and cleanup a spec can't reach through the UI, never for what it tests.
 */
export async function withAppModule<A, R>(page: Page, modulePath: string, body: string, arg: A): Promise<R> {
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

/** This worktree's test video: what the dialog mock picks for Locate file…. */
export const FIXTURE_VIDEO = path.join(HERE, "fixtures", "game.mp4");

/**
 * The open link's journal, written before Locate file… changes a staging game
 * and removed once the game's own video_url is back. It lives in the system's
 * temp folder: anything under apps/desktop is in Vite's watch, and removing a
 * file there reloads the open page (mid-test, that cancels the app's own
 * requests); out/ is also emptied when a run starts.
 */
export const VIDEO_LINK_JOURNAL = path.join(tmpdir(), `scoutable-headless-video-link-${PORT}.json`);

/** A game linked to the test video for a spec, and what to put back. */
export interface FixtureLink {
  matchId: string;
  previous: string | null;
}

/**
 * Links the game on the editor's stage to this worktree's test video through
 * the player's "Locate file…" (the dialog mock picks FIXTURE_VIDEO). Before
 * the click it notes the game's own video_url, journals it, and hands the link
 * to `track`, so afterEach can restore it even when a wait below fails.
 * Refuses a game already pointing at a fixture (another worktree's link, or a
 * crashed run whose journal is gone). Pair with restoreGameVideo in afterEach
 * and restoreJournalledVideoLink in beforeEach.
 */
export async function linkStageGameToFixture(page: Page, matchId: string, track: (link: FixtureLink) => void): Promise<FixtureLink> {
  const [before] = await selectRows<{ video_url: string | null }>(page, "matches", "video_url", { id: matchId });
  expect(before, "the game is readable").toBeTruthy();
  expect(before.video_url ?? "", "the game isn't already linked to a headless fixture").not.toContain("/headless/fixtures/");
  const link: FixtureLink = { matchId, previous: before.video_url };
  writeFileSync(VIDEO_LINK_JOURNAL, JSON.stringify(link));
  track(link);
  await page.getByRole("button", { name: "Locate file…" }).click();
  await expect(page.getByText("This game's video file can't be found")).toBeHidden({ timeout: 15_000 });
  await expect(async () => {
    const [after] = await selectRows<{ video_url: string | null }>(page, "matches", "video_url", { id: matchId });
    expect(after.video_url).toBe(FIXTURE_VIDEO);
  }).toPass({ timeout: 10_000 });
  return link;
}

/**
 * Puts a linked game's own video_url back, only while it still points at this
 * worktree's test video, then removes the journal. Throws when that
 * compare-and-set matched nothing and the game doesn't hold its own value
 * either (someone else changed it meanwhile).
 */
export async function restoreGameVideo(page: Page, link: FixtureLink): Promise<void> {
  if (page.url() === "about:blank") await openPlaylists(page);
  const restored = await withAppModule<FixtureLink & { linked: string }, number>(page, "/src/lib/supabase/client.ts", `
    const { data, error } = await mod.createClient().from("matches").update({ video_url: arg.previous })
      .eq("id", arg.matchId).eq("video_url", arg.linked).select("id");
    if (error) throw new Error("headless: " + error.message);
    return data.length;
  `, { ...link, linked: FIXTURE_VIDEO });
  if (restored === 0) {
    // Nothing matched: fine only if the link never landed (a failure before the write).
    const [now] = await selectRows<{ video_url: string | null }>(page, "matches", "video_url", { id: link.matchId });
    if (now?.video_url !== link.previous) {
      throw new Error(`headless: couldn't restore ${link.matchId}: its video_url is ${JSON.stringify(now?.video_url)}, not this worktree's fixture or ${JSON.stringify(link.previous)}`);
    }
  }
  rmSync(VIDEO_LINK_JOURNAL, { force: true });
}

/** A link a crashed run left in the journal, restored; for beforeEach. Returns it, or null. */
export async function restoreJournalledVideoLink(page: Page): Promise<FixtureLink | null> {
  if (!existsSync(VIDEO_LINK_JOURNAL)) return null;
  const link = JSON.parse(readFileSync(VIDEO_LINK_JOURNAL, "utf8")) as FixtureLink;
  await restoreGameVideo(page, link);
  return link;
}

/** The id of the account's playlist named `name`, from its row in the playlist list. */
export async function playlistIdNamed(page: Page, name: string): Promise<string> {
  const id = await page.locator("[data-playlist-id]").filter({ hasText: name }).first().getAttribute("data-playlist-id");
  expect(id, `the playlist list has "${name}"`).toBeTruthy();
  return id!;
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

/** A name for something a spec creates on the shared account: `headless-<port> <what>`. */
export const owned = (what: string) => `headless-${PORT} ${what}`;

/** What a play row of the game view's list is, as a selector: not a period header, not a marker row (those are buttons). */
export const PLAY_ROW = 'div[data-row-key]:not([data-row-key^="period:"])';

/** The play rows of the game view's list (not the period headers or the marker rows). */
export const playRows = (page: Page) => page.getByRole("list", { name: "Plays" }).locator(PLAY_ROW);

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

/**
 * Runs `body` in a second page of the test's context, on /playlists, then
 * closes it: for beforeEach sweeps (deletePlaylistsNamed,
 * restoreJournalledVideoLink). The test's own page starts fresh afterwards,
 * so it never shows a swept row or a game's old link, and errors from
 * requests the closed page leaves behind don't count against the test.
 */
export async function inScratchPage<R>(page: Page, body: (scratch: Page) => Promise<R>): Promise<R> {
  const scratch = await page.context().newPage();
  try {
    await openPlaylists(scratch);
    return await body(scratch);
  } finally {
    await scratch.close();
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

export const videoTime = (page: Page) => page.evaluate(() => document.querySelector("video")?.currentTime ?? -1);
export const videoDuration = (page: Page) => page.evaluate(() => document.querySelector("video")?.duration ?? NaN);

/** The sample game on its Game view, with its footage ready to seek. */
export async function openSampleGame(page: Page): Promise<number> {
  await page.goto("/matches");
  await expect(page.getByRole("heading", { level: 1, name: "Library" })).toBeVisible({ timeout: 30_000 });
  const row = page.locator('a[href^="/matches/"]').filter({ hasText: "Sample game" }).first();
  await expect(row, "the test account has the sample game").toBeVisible({ timeout: 30_000 });
  await row.click();
  await expect(page.getByRole("radiogroup", { name: "View" })).toBeVisible({ timeout: 30_000 });
  await showGameView(page);
  await expect.poll(() => videoDuration(page), { message: "the sample game's video has loaded", timeout: 45_000 }).toBeGreaterThan(0);
  return videoDuration(page);
}

/**
 * Records what the app reports to analytics. PostHog drops every event from an
 * automated browser, so nothing reaches the network to read; the app's one
 * analytics module (src/lib/analytics.ts) is replaced at its edge with one
 * that keeps the calls on the page. Call before the first navigation.
 */
export async function recordAnalytics(page: Page): Promise<() => Promise<{ event: string; properties?: Record<string, unknown> }[]>> {
  await page.route("**/src/lib/analytics.ts*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: `
        export function initAnalytics() {}
        export function identifyUser() {}
        export function resetUser() {}
        export function trackEvent(event, properties) { (window.__tracked ??= []).push({ event, properties }); }
      `,
    }),
  );
  return () => page.evaluate(() => (window as unknown as { __tracked?: { event: string; properties?: Record<string, unknown> }[] }).__tracked ?? []);
}
