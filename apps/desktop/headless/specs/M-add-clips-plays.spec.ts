/**
 * The Add clips sheet reads the plays of the games it shows itself: clips
 * added from a game the page had not loaded show in the editor at once, with
 * no loading rows in between; a game whose plays can't be read is named above
 * the list with a Try again, while the other games' plays are listed, and
 * choosing it again reads it again; and coming back to Playlists within a
 * session, the sheet still lists its plays.
 *
 * Needs the staging test account's games "BC Luleå vs Köping Stars" and
 * "Södertälje BBK vs Köping Stars" (and, for the first test, one of those or
 * "Nässjö Basket vs Norrköping Dolphins" that no playlist on the account has
 * clips from, so the page doesn't read it when it loads). Creates the playlist
 * `headless-<port> plays` and deletes it afterwards. The failure is the
 * page's own read of one game's plays, rewritten in the browser: nothing on
 * staging fails.
 */
import type { Locator, Page, Route } from "@playwright/test";
import {
  PORT,
  addClipsSheet,
  createPlaylist,
  deleteOwnRowsNamed,
  eventCount,
  expect,
  gameTrigger,
  goViaSidebar,
  newPlaylistWithClips,
  openAddClips,
  pickOnlyGame,
  playlistClips,
  readSheetRows,
  selectRows,
  sheetRow,
  shot,
  test,
  waitForPlays,
  waitForQuiet,
} from "../helpers";

const PLAYLIST = `headless-${PORT} plays`;
const LULEA = "BC Luleå vs Köping Stars";
const SODERTALJE = "Södertälje BBK vs Köping Stars";
const NASSJO = "Nässjö Basket vs Norrköping Dolphins";

test.beforeEach(async ({ page }) => {
  await deleteOwnRowsNamed(page, "playlists", PLAYLIST);
});

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await deleteOwnRowsNamed(page, "playlists", PLAYLIST);
});

/** Picks one game alone in the Game picker with a row press, whatever its plays do (pickOnlyGame waits for them). */
async function pressGame(page: Page, sheet: Locator, title: string): Promise<void> {
  await gameTrigger(sheet).click();
  const list = page.getByRole("listbox", { name: "Games" });
  await expect(list).toBeVisible();
  await page.getByRole("combobox", { name: "Search games or teams" }).fill(title);
  await list.getByRole("option").filter({ hasText: title }).first().getByText(title, { exact: true }).click();
  await expect(list).toBeHidden();
  await expect(gameTrigger(sheet)).toHaveText(title);
}

/**
 * From now on, notes each state the editor's list passes through (its empty state, its loading rows or
 * its clip rows; the sheet's own rows aside), in order, once per change. Returns a reader.
 */
async function watchEditorList(page: Page): Promise<() => Promise<string[]>> {
  await page.evaluate(() => {
    const states: string[] = [];
    (window as unknown as { __editorStates?: string[] }).__editorStates = states;
    const outsideSheet = (el: Element) => !el.closest("[role=dialog]");
    const note = () => {
      const loading = [...document.querySelectorAll('[aria-busy="true"][aria-label="Loading clips"]')].some(outsideSheet);
      const rows = [...document.querySelectorAll("[role=row][data-row-key]")].filter(outsideSheet).length;
      const empty = document.body.textContent?.includes("No clips yet") ?? false;
      const state = loading ? "loading rows" : rows > 0 ? `${rows} rows` : empty ? "No clips yet" : "nothing";
      if (states[states.length - 1] !== state) states.push(state);
    };
    note();
    new MutationObserver(note).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  return () => page.evaluate(() => (window as unknown as { __editorStates?: string[] }).__editorStates ?? []);
}

test("clips added from a game the page had not loaded show in the editor", async ({ page, browserName }) => {
  const playlistId = await createPlaylist(page, PLAYLIST);
  // Every read of plays the page makes, from a fresh load (no game's plays in memory) on.
  const playsReads: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "GET" && request.url().includes("play_by_play_events")) playsReads.push(request.url());
  });
  await waitForQuiet(page);
  await page.goto("/playlists");
  const row = page.locator(`[data-playlist-id="${playlistId}"]`).first();
  await expect(row, "the spec's playlist is listed").toBeVisible({ timeout: 30_000 });
  await row.click();
  await waitForQuiet(page);
  // A game the page did not read on its own (no playlist has clips from it): only the sheet reads it.
  const readAtLoad = [...playsReads];
  let game: string | null = null;
  for (const title of [SODERTALJE, LULEA, NASSJO]) {
    const ids = (await selectRows<{ id: string }>(page, "matches", "id", { title })).map((r) => r.id);
    if (ids.length > 0 && !ids.some((id) => readAtLoad.some((url) => url.includes(id)))) {
      game = title;
      break;
    }
  }
  console.log(`${browserName} M-add-clips-plays: ${readAtLoad.length} plays read(s) at load; adding from ${game ?? "none"}`);
  expect(game, "a game whose plays the page did not read when it loaded (no playlist has clips from it)").not.toBeNull();

  await page.getByRole("button", { name: "Add clips", exact: true }).first().click();
  const sheet = addClipsSheet(page);
  await expect(sheet).toBeVisible();
  await pickOnlyGame(page, sheet, game!);
  const keys = [...(await readSheetRows(sheet)).keys()].slice(0, 3);
  expect(keys, "the game lists three plays to tick").toHaveLength(3);
  for (const key of keys) await (await sheetRow(sheet, key)).getByRole("checkbox", { name: "Select" }).click();
  const editorStates = await watchEditorList(page);
  await sheet.getByRole("button", { name: "Add 3 clips", exact: true }).click();
  await sheet.getByRole("button", { name: "Close", exact: true }).click();
  await expect(sheet).toBeHidden();

  const rows = page.locator("[role=row][data-row-key]");
  await expect(rows, "the editor shows the three clips").toHaveCount(3, { timeout: 15_000 });
  expect((await rows.evaluateAll((els) => els.map((el) => el.getAttribute("data-row-key") ?? ""))).sort()).toEqual([...keys].sort());
  await expect(page.getByText("No clips yet")).toHaveCount(0);
  // From the press on, the editor goes from its empty state straight to the clips: the plays were in
  // before the clips went into the playlist, so no loading rows came between, and no empty state after.
  const states = await editorStates();
  console.log(`${browserName} M-add-clips-plays: the editor went ${states.join(" → ")}`);
  expect(states, "no loading rows between the press and the clips").not.toContain("loading rows");
  expect(states.at(-1)).toBe("3 rows");
  expect(states.slice(states.findIndex((st) => st.endsWith(" rows"))), "no empty state once the clips are in").not.toContain("No clips yet");
  await expect.poll(async () => (await playlistClips(page, PLAYLIST))?.length ?? 0, { message: "the server holds the three clips" }).toBe(3);
});

test("a game whose plays can't be read is named, and the others are listed", async ({ page, browserName }) => {
  const playlistId = await createPlaylist(page, PLAYLIST);
  const failingIds = (await selectRows<{ id: string }>(page, "matches", "id", { title: SODERTALJE })).map((r) => r.id);
  expect(failingIds.length, `the test account has the game "${SODERTALJE}"`).toBeGreaterThan(0);
  // Before the page loads, so no read of the game's plays (the page's own, of the playlists' games) comes back first.
  let failing = true;
  let failedReads = 0;
  await page.route("**/rest/v1/matches*", async (route: Route) => {
    const request = route.request();
    const url = request.url();
    if (!failing || request.method() !== "GET" || !url.includes("play_by_play_events") || !failingIds.some((id) => url.includes(id))) {
      return route.fallback();
    }
    failedReads += 1;
    await route.fulfill({ status: 500, json: { code: "XX000", message: "plays read failed on purpose", details: null, hint: null } });
  });

  const sheet = await openAddClips(page, playlistId);
  await pickOnlyGame(page, sheet, LULEA);
  const lulea = await eventCount(sheet);
  const failed = sheet.getByText(`Couldn't load plays for ${SODERTALJE}.`, { exact: true });
  const tryAgain = sheet.getByRole("button", { name: "Try again", exact: true });

  // The failing game alone: it is named, and nothing says it is still loading.
  await pressGame(page, sheet, SODERTALJE);
  await expect(failed, "the game whose plays didn't come is named").toBeVisible({ timeout: 30_000 });
  await expect(tryAgain).toBeVisible();
  await expect(sheet.getByText("Loading plays…")).toHaveCount(0);
  // Picking it alone again is a retry: it is read again (and fails again), never left loading.
  const readsBefore = failedReads;
  await pressGame(page, sheet, SODERTALJE);
  await expect.poll(() => failedReads, { message: "choosing the failed game again reads it again" }).toBeGreaterThan(readsBefore);
  await expect(failed, "it is named again").toBeVisible({ timeout: 30_000 });
  await expect(sheet.getByText("Loading plays…")).toHaveCount(0);

  // Tick the first game too: its plays are listed, and the second game is named.
  await gameTrigger(sheet).click();
  const list = page.getByRole("listbox", { name: "Games" });
  await expect(list).toBeVisible();
  await list.locator(`input[type="checkbox"][aria-label="Include ${LULEA}"]`).click();
  await page.keyboard.press("Escape");
  await expect(list).toBeHidden();
  await expect(gameTrigger(sheet)).toHaveText("2 games");
  await expect(failed, "the game whose plays didn't come is named").toBeVisible({ timeout: 30_000 });
  await expect(tryAgain).toBeVisible();
  await expect(sheet.getByText("Loading plays…")).toHaveCount(0);
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

  await goViaSidebar(page, "Games");
  await expect(page.getByRole("heading", { level: 1, name: "Games" })).toBeVisible({ timeout: 30_000 });
  await goViaSidebar(page, "Playlists");
  const row = page.locator(`[data-playlist-id="${playlistId}"]`).first();
  await expect(row, "the spec's playlist is listed").toBeVisible({ timeout: 30_000 });
  await row.click();
  await page.getByRole("button", { name: "Add clips", exact: true }).first().click();
  sheet = addClipsSheet(page);
  await expect(sheet).toBeVisible();
  await waitForPlays(sheet);
});

test("a play already in the playlist shows ✓ at full contrast and can't be ticked", async ({ page }) => {
  const [key] = await newPlaylistWithClips(page, PLAYLIST, { count: 1 });
  await page.getByRole("button", { name: "Add clips", exact: true }).first().click();
  const sheet = addClipsSheet(page);
  await expect(sheet.getByRole("grid", { name: "Events" }).getByRole("row").first()).toBeVisible({ timeout: 30_000 });
  const row = await sheetRow(sheet, key);
  await expect(row.getByLabel("Already in this playlist")).toBeVisible();
  await expect(row.getByRole("checkbox", { name: "Select" })).toHaveCount(0);
  expect(await row.evaluate((el) => Number(getComputedStyle(el).opacity))).toBe(1);
  expect(Math.round((await row.boundingBox())!.height)).toBe(32);
});
