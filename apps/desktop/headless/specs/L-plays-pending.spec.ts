/**
 * A playlist whose plays are not all in memory is safe: when the read of its
 * games' plays fails, the editor says so with a Try again instead of showing
 * an empty playlist, Export and Share are off, and nothing on the server
 * changes; Try again shows loading rows until the plays come, then the clips.
 * "No clips yet" never shows for a playlist that has clips. A clip on a game
 * this space doesn't list (a game in another space) counts as read only once
 * that game's row is in memory too, not when its plays alone came back. The
 * playlists list shows as soon as the page's own reads of the list are in, not
 * after the plays of every game its playlists hold clips from.
 *
 * Needs a game with plays on the staging test account. Creates the playlist
 * `headless-<port> pending` and deletes it afterwards. The failures and delays
 * are the page's own reads, rewritten in the browser: nothing on staging fails.
 */
import type { Page, Response, Route } from "@playwright/test";
import {
  PORT,
  delayPlaysReads,
  deleteOwnRowsNamed,
  expect,
  failPlaysReads,
  forgetLastPlaces,
  newPlaylistWithClips,
  playlistClips,
  playlistIdNamed,
  test,
  waitForQuiet,
} from "../helpers";

const NAME = `headless-${PORT} pending`;
const FAILED = "Couldn't load this playlist's clips.";

test.beforeEach(async ({ page }) => {
  await deleteOwnRowsNamed(page, "playlists", NAME);
});

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await deleteOwnRowsNamed(page, "playlists", NAME);
});

/** Notes on the window whether "No clips yet" was ever on the page, from the next load on. */
async function watchForNoClipsYet(page: Page): Promise<() => Promise<boolean>> {
  await page.addInitScript(() => {
    const w = window as unknown as { __sawNoClipsYet?: boolean };
    w.__sawNoClipsYet = false;
    new MutationObserver(() => {
      if (!w.__sawNoClipsYet && document.body?.textContent?.includes("No clips yet")) w.__sawNoClipsYet = true;
    }).observe(document, { childList: true, subtree: true, characterData: true });
  });
  return () => page.evaluate(() => (window as unknown as { __sawNoClipsYet?: boolean }).__sawNoClipsYet === true);
}

/**
 * /playlists loaded afresh (no plays in memory), and the playlist opened from its sidebar row. The page
 * would reopen the playlist made in the setup by itself as it loads: forgotten first, so the row opens it.
 */
async function openAfresh(page: Page, id: string): Promise<void> {
  await waitForQuiet(page);
  await forgetLastPlaces(page);
  await page.goto("/playlists");
  const row = page.locator(`[data-playlist-id="${id}"]`);
  await expect(row, "the playlist is in the list").toBeVisible({ timeout: 30_000 });
  await row.click();
}

test("a playlist whose plays can't be read says so and keeps its clips", async ({ page }) => {
  await newPlaylistWithClips(page, NAME, { count: 3 });
  const id = await playlistIdNamed(page, NAME);
  await failPlaysReads(page);
  await openAfresh(page, id);

  await expect(page.getByText(FAILED, { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
  await expect(page.getByText("No clips yet")).toHaveCount(0);
  await expect(page.locator("[role=row][data-row-key]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: /^Export/ })).toBeDisabled();
  // Share is in the toolbar only in a space with teams (the test account's personal space has none).
  const share = page.getByRole("button", { name: "Share", exact: true });
  if ((await share.count()) > 0) await expect(share).toBeDisabled();
  expect(await playlistClips(page, NAME), "the server still holds the three clips").toHaveLength(3);
});

test("Try again shows loading rows, then the clips", async ({ page }) => {
  const keys = await newPlaylistWithClips(page, NAME, { count: 3 });
  const id = await playlistIdNamed(page, NAME);
  const sawNoClipsYet = await watchForNoClipsYet(page);
  const lift = await failPlaysReads(page);
  await openAfresh(page, id);
  const tryAgain = page.getByRole("button", { name: "Try again", exact: true });
  await expect(tryAgain).toBeVisible({ timeout: 30_000 });

  await lift();
  await delayPlaysReads(page, 1500);
  await tryAgain.click();
  await expect(page.locator('[aria-busy="true"][aria-label="Loading clips"]')).toBeVisible();
  const rows = page.locator("[role=row][data-row-key]");
  await expect(rows).toHaveCount(3, { timeout: 30_000 });
  const shown = await rows.evaluateAll((els) => els.map((el) => el.getAttribute("data-row-key") ?? ""));
  expect(shown.sort(), "the playlist's own three clips").toEqual([...keys].sort());
  await expect(page.getByText(FAILED, { exact: true })).toHaveCount(0);
  expect(await sawNoClipsYet(), "\"No clips yet\" never showed").toBe(false);
});

/**
 * The page's reads of its games, told that these games are in another space: the game list leaves them out, so
 * the page reads their rows by id, and those row reads (not the plays) fail until `liftRowFailure` is called.
 */
async function gamesInAnotherSpace(page: Page, ids: readonly string[]): Promise<{ liftRowFailure: () => void }> {
  let failRows = true;
  await page.route("**/rest/v1/matches*", async (route: Route) => {
    const request = route.request();
    if (request.method() !== "GET" || request.url().includes("play_by_play_events")) return route.fallback();
    if (new URL(request.url()).searchParams.get("id")?.startsWith("in.")) {
      if (!failRows) return route.fallback();
      return route.fulfill({ status: 500, json: { code: "XX000", message: "row read failed on purpose", details: null, hint: null } });
    }
    const response = await route.fetch();
    const body: unknown = await response.json().catch(() => null);
    if (!Array.isArray(body)) return route.fulfill({ response });
    await route.fulfill({ response, json: body.filter((row: { id?: string }) => !ids.includes(row.id ?? "")) });
  });
  return { liftRowFailure: () => { failRows = false; } };
}

test("a clip on a game in another space waits for that game's row, not just its plays", async ({ page }) => {
  const keys = await newPlaylistWithClips(page, NAME, { count: 3 });
  const id = await playlistIdNamed(page, NAME);
  const games = [...new Set(keys.map((key) => key.slice(0, key.indexOf(":"))))];
  const sawNoClipsYet = await watchForNoClipsYet(page);
  const { liftRowFailure } = await gamesInAnotherSpace(page, games);
  await openAfresh(page, id);

  // The plays came back, the game's row didn't: the clips can't be shown, and the playlist says so.
  const tryAgain = page.getByRole("button", { name: "Try again", exact: true });
  await expect(page.getByText(FAILED, { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(tryAgain).toBeVisible();
  expect(await playlistClips(page, NAME), "the server still holds the three clips").toHaveLength(3);

  liftRowFailure();
  await tryAgain.click();
  const rows = page.locator("[role=row][data-row-key]");
  await expect(rows).toHaveCount(3, { timeout: 30_000 });
  const shown = await rows.evaluateAll((els) => els.map((el) => el.getAttribute("data-row-key") ?? ""));
  expect(shown.sort(), "the playlist's own three clips").toEqual([...keys].sort());
  expect(await sawNoClipsYet(), "\"No clips yet\" never showed").toBe(false);
});

/** The page's own read of its playlists (with their clips), not another view's read of names or shares. */
function isOwnListRead(response: Response): boolean {
  const request = response.request();
  const url = request.url();
  return request.method() === "GET" && url.includes("/rest/v1/playlists?") && url.includes("playlist_clips") && url.includes("user_id=eq.");
}

test("the list shows before the plays are in", async ({ page }) => {
  const keys = await newPlaylistWithClips(page, NAME, { count: 3 });
  const id = await playlistIdNamed(page, NAME);
  const sawNoClipsYet = await watchForNoClipsYet(page);
  await delayPlaysReads(page, 2000);
  // Opened from its row below, not reopened by the page as it loads.
  await forgetLastPlaces(page);
  await waitForQuiet(page);

  // When each of the page's list reads came back (a dev double mount reads twice; the last one is the list shown).
  const listReads: number[] = [];
  page.on("response", (response) => {
    if (isOwnListRead(response)) listReads.push(Date.now());
  });
  const firstListRead = page.waitForResponse(isOwnListRead);
  await page.goto("/playlists");
  await firstListRead;
  const row = page.locator(`[data-playlist-id="${id}"]`);
  await expect(row, "the playlist is in the list").toBeVisible({ timeout: 30_000 });
  const shownAt = Date.now();
  const readAt = listReads.filter((at) => at <= shownAt).at(-1) ?? shownAt;
  expect(shownAt - readAt, "the list shows within 1 s of its own read, with the plays held back 2 s").toBeLessThan(1000);

  await row.click();
  await expect(page.locator('[aria-busy="true"][aria-label="Loading clips"]')).toBeVisible();
  const rows = page.locator("[role=row][data-row-key]");
  await expect(rows).toHaveCount(3, { timeout: 30_000 });
  const shown = await rows.evaluateAll((els) => els.map((el) => el.getAttribute("data-row-key") ?? ""));
  expect(shown.sort(), "the playlist's own three clips").toEqual([...keys].sort());
  expect(await sawNoClipsYet(), "\"No clips yet\" never showed").toBe(false);
});
