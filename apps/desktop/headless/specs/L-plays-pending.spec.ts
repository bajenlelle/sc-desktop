/**
 * A playlist whose plays are not all in memory is safe: when the read of its
 * games' plays fails, the editor says so with a Try again instead of showing
 * an empty playlist, Export and Share are off, and nothing on the server
 * changes; Try again shows loading rows until the plays come, then the clips.
 * "No clips yet" never shows for a playlist that has clips.
 *
 * Needs a game with plays on the staging test account. Creates the playlist
 * `headless-<port> pending` and deletes it afterwards. The failures and delays
 * are the page's own reads, rewritten in the browser: nothing on staging fails.
 */
import type { Page } from "@playwright/test";
import {
  PORT,
  delayPlaysReads,
  deleteOwnRowsNamed,
  expect,
  failPlaysReads,
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

/** /playlists loaded afresh (no plays in memory), and the playlist opened from its sidebar row. */
async function openAfresh(page: Page, id: string): Promise<void> {
  await waitForQuiet(page);
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
