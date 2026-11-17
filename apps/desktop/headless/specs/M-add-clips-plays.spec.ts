/**
 * The Add clips sheet reads the plays of the games it shows itself: clips
 * added from a game the page had not loaded show in the editor at once; a
 * game whose plays can't be read is named above the list with a Try again,
 * while the other games' plays are listed; and coming back to Playlists
 * within a session, the sheet still lists its plays.
 *
 * Needs the staging test account's games "BC Luleå vs Köping Stars" and
 * "Södertälje BBK vs Köping Stars". Creates the playlist
 * `headless-<port> plays` and deletes it afterwards. The failure is the
 * page's own read of one game's plays, rewritten in the browser: nothing on
 * staging fails.
 */
import type { Route } from "@playwright/test";
import {
  PORT,
  addClipsSheet,
  createPlaylist,
  deleteOwnRowsNamed,
  eventCount,
  expect,
  gameTrigger,
  goViaSidebar,
  openAddClips,
  pickOnlyGame,
  playlistClips,
  readSheetRows,
  selectRows,
  sheetRow,
  shot,
  test,
  waitForPlays,
} from "../helpers";

const PLAYLIST = `headless-${PORT} plays`;
const LULEA = "BC Luleå vs Köping Stars";
const SODERTALJE = "Södertälje BBK vs Köping Stars";

test.beforeEach(async ({ page }) => {
  await deleteOwnRowsNamed(page, "playlists", PLAYLIST);
});

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await deleteOwnRowsNamed(page, "playlists", PLAYLIST);
});

test("clips added from a game the page had not loaded show in the editor", async ({ page }) => {
  const playlistId = await createPlaylist(page, PLAYLIST);
  // openAddClips loads /playlists afresh: no game's plays are in memory, and this playlist has none.
  const sheet = await openAddClips(page, playlistId);
  await pickOnlyGame(page, sheet, SODERTALJE);
  const keys = [...(await readSheetRows(sheet)).keys()].slice(0, 3);
  expect(keys, "the game lists three plays to tick").toHaveLength(3);
  for (const key of keys) await (await sheetRow(sheet, key)).getByRole("checkbox", { name: "Select" }).click();
  await sheet.getByRole("button", { name: "Add 3 clips", exact: true }).click();
  await sheet.getByRole("button", { name: "Close", exact: true }).click();
  await expect(sheet).toBeHidden();

  const rows = page.locator("[role=row][data-row-key]");
  await expect(rows, "the editor shows the three clips").toHaveCount(3, { timeout: 15_000 });
  expect((await rows.evaluateAll((els) => els.map((el) => el.getAttribute("data-row-key") ?? ""))).sort()).toEqual([...keys].sort());
  await expect(page.getByText("No clips yet")).toHaveCount(0);
  await expect.poll(async () => (await playlistClips(page, PLAYLIST))?.length ?? 0, { message: "the server holds the three clips" }).toBe(3);
});

test("a game whose plays can't be read is named, and the others are listed", async ({ page, browserName }) => {
  const playlistId = await createPlaylist(page, PLAYLIST);
  const failingIds = (await selectRows<{ id: string }>(page, "matches", "id", { title: SODERTALJE })).map((r) => r.id);
  expect(failingIds.length, `the test account has the game "${SODERTALJE}"`).toBeGreaterThan(0);
  // Before the page loads, so no read of the game's plays (the page's own, of the playlists' games) comes back first.
  let failing = true;
  await page.route("**/rest/v1/matches*", async (route: Route) => {
    const request = route.request();
    const url = request.url();
    if (!failing || request.method() !== "GET" || !url.includes("play_by_play_events") || !failingIds.some((id) => url.includes(id))) {
      return route.fallback();
    }
    await route.fulfill({ status: 500, json: { code: "XX000", message: "plays read failed on purpose", details: null, hint: null } });
  });

  const sheet = await openAddClips(page, playlistId);
  await pickOnlyGame(page, sheet, LULEA);
  const lulea = await eventCount(sheet);

  // Tick the second game: its read fails.
  await gameTrigger(sheet).click();
  const list = page.getByRole("listbox", { name: "Games" });
  await expect(list).toBeVisible();
  await list.locator(`input[type="checkbox"][aria-label="Include ${SODERTALJE}"]`).click();
  await page.keyboard.press("Escape");
  await expect(list).toBeHidden();
  await expect(gameTrigger(sheet)).toHaveText("2 games");

  const failed = sheet.getByText(`Couldn't load plays for ${SODERTALJE}.`, { exact: true });
  await expect(failed, "the game whose plays didn't come is named").toBeVisible({ timeout: 30_000 });
  const tryAgain = sheet.getByRole("button", { name: "Try again", exact: true });
  await expect(tryAgain).toBeVisible();
  await expect(sheet.getByText("Loading clips…")).toHaveCount(0);
  expect(await eventCount(sheet), "the first game's plays are listed").toBe(lulea);
  await shot(page, `${browserName}-M-failed-game`);

  failing = false;
  await tryAgain.click();
  await expect(failed).toHaveCount(0, { timeout: 30_000 });
  await expect.poll(() => eventCount(sheet), { message: "the second game's plays came", timeout: 30_000 }).toBeGreaterThan(lulea);
  const both = await eventCount(sheet);
  await pickOnlyGame(page, sheet, SODERTALJE);
  expect(both, "the counter is both games' plays").toBe(lulea + (await eventCount(sheet)));
});

test("coming back to Playlists within a session, Add clips lists its plays", async ({ page }) => {
  const playlistId = await createPlaylist(page, PLAYLIST);
  let sheet = await openAddClips(page, playlistId);
  await waitForPlays(sheet);
  await sheet.getByRole("button", { name: "Close", exact: true }).click();
  await expect(sheet).toBeHidden();

  await goViaSidebar(page, "Library");
  await expect(page.getByRole("heading", { level: 1, name: "Library" })).toBeVisible({ timeout: 30_000 });
  await goViaSidebar(page, "Playlists");
  const row = page.locator(`[data-playlist-id="${playlistId}"]`).first();
  await expect(row, "the spec's playlist is listed").toBeVisible({ timeout: 30_000 });
  await row.click();
  await page.getByRole("button", { name: "Add clips", exact: true }).first().click();
  sheet = addClipsSheet(page);
  await expect(sheet).toBeVisible();
  await waitForPlays(sheet);
});
