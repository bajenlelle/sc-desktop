/**
 * Group C, Task 9: Add clips searches several games. A checkbox adds a game
 * and keeps the list open, the trigger reads "N games", rows name their game,
 * "Last 5 games" and "Last 5 games of {team}" choose games in one press, a
 * chosen player stays chosen across games that have them (by person id) and
 * goes once the plays of games without them are in, and the sheet reopens on
 * the same games.
 *
 * Needs the staging test account's games "BC Luleå vs Köping Stars",
 * "Södertälje BBK vs Köping Stars" (Köping Stars in two games) and "Nässjö
 * Basket vs Norrköping Dolphins". The account has fewer than 11 games, so the
 * 10-game cap can't be reached here. Creates the playlist
 * `headless-<port> games` and deletes it afterwards.
 */
import type { Locator, Page } from "@playwright/test";
import {
  PORT,
  createPlaylist,
  deleteOwnRowsNamed,
  eventCount,
  expect,
  gameTrigger,
  menuGroups,
  openAddClips,
  pickOnlyGame,
  shot,
  test,
  waitForPlays,
} from "../helpers";

const PLAYLIST = `headless-${PORT} games`;
const LULEA = "BC Luleå vs Köping Stars";
const SODERTALJE = "Södertälje BBK vs Köping Stars";
const NASSJO = "Nässjö Basket vs Norrköping Dolphins";
const KOPING = "Köping Stars";

test.afterEach(async ({ page }) => {
  await deleteOwnRowsNamed(page, "playlists", PLAYLIST);
});

const gameList = (page: Page) => page.getByRole("listbox", { name: "Games" });
/** The Game trigger while the (modal) picker is open, which hides the sheet from the accessibility tree. */
const triggerBehindPicker = (page: Page) => page.locator('button[aria-label="Game"]');

/**
 * Opens the Game picker. However it last closed (a row press, a footer
 * button, Escape), it opens with an empty search on every game.
 */
async function openPicker(page: Page, sheet: Locator): Promise<{ list: Locator }> {
  await gameTrigger(sheet).click();
  await expect(gameList(page)).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Search games or teams" }), "the picker reopens with an empty search").toHaveValue("");
  return { list: gameList(page) };
}

/** The games ticked in the open picker, by title: an option's aria-selected is its tick. */
async function tickedGames(list: Locator): Promise<string[]> {
  const titles = await list.getByRole("option", { selected: true }).evaluateAll((options) => options.map((o) => o.querySelector("span.block")?.textContent ?? ""));
  return titles.sort();
}

/**
 * A game's checkbox. An option's children are presentational in ARIA, so the
 * box has no checkbox role of its own; the option's aria-selected says it.
 */
const checkbox = (list: Locator, title: string) => list.locator(`input[type="checkbox"][aria-label="Include ${title}"]`);

async function closePicker(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(gameList(page)).toBeHidden();
}

test("Add clips searches several games and keeps a player across them", async ({ page, browserName }) => {
  const name = (step: string) => `${browserName}-C-task9-${step}`;
  await deleteOwnRowsNamed(page, "playlists", PLAYLIST);
  const playlistId = await createPlaylist(page, PLAYLIST);
  let sheet = await openAddClips(page, playlistId);
  const grid = sheet.getByRole("grid", { name: "Events" });

  // One game at a time first, for the counts.
  await pickOnlyGame(page, sheet, LULEA);
  const lulea = await eventCount(sheet);
  await pickOnlyGame(page, sheet, SODERTALJE);
  const sodertalje = await eventCount(sheet);

  // After a row pick found by search, the picker reopens on every game, not just the one searched for.
  let { list } = await openPicker(page, sheet);
  await expect(list.getByRole("group", { name: "All games" }).getByRole("option"), "every game is listed again").not.toHaveCount(1);
  await expect(list.getByRole("option").filter({ hasText: LULEA })).toBeVisible();
  // Let the popover finish fading in, so the screenshot shows it.
  await list.evaluate((el) => Promise.all((el.closest("[role=dialog]")?.getAnimations() ?? []).map((a) => a.finished)));
  await shot(page, name("reopened-search"));

  // A checkbox adds a game and keeps the list open; the trigger counts the games.
  await checkbox(list, LULEA).click();
  await expect(list, "the list stays open after a tick").toBeVisible();
  await expect(triggerBehindPicker(page)).toHaveText("2 games");
  expect(await tickedGames(list)).toEqual([LULEA, SODERTALJE].sort());
  await shot(page, name("two-ticked"));
  await closePicker(page);
  await expect.poll(() => eventCount(sheet), { message: "two games list both games' plays", timeout: 30_000 }).toBe(lulea + sodertalje);
  // Every row names its game, and both games are there.
  const rowGames = await grid.getByRole("row").evaluateAll((rows, titles) => rows.map((r) => titles.find((t) => r.textContent?.includes(t)) ?? "none"), [LULEA, SODERTALJE]);
  expect(rowGames, "every row names its game").not.toContain("none");
  expect(new Set(rowGames)).toEqual(new Set([LULEA, SODERTALJE]));
  await shot(page, name("two-games"));

  // "Last 5 games" chooses the latest five (or every game, with fewer) and closes.
  ({ list } = await openPicker(page, sheet));
  const games = await list.getByRole("group", { name: "All games" }).getByRole("option").count();
  const latest = Math.min(5, games);
  console.log(`${browserName} C-task9: the account has ${games} games (the 10-game cap needs 11); Luleå ${lulea} + Södertälje ${sodertalje} events`);
  await page.getByRole("button", { name: "Last 5 games", exact: true }).click();
  await expect(gameList(page)).toBeHidden();
  await expect(gameTrigger(sheet)).toHaveText(`${latest} games`);
  ({ list } = await openPicker(page, sheet));
  expect((await tickedGames(list)).length).toBe(latest);
  await shot(page, name("last-5"));
  await closePicker(page);
  await waitForPlays(sheet);

  // One player, then "Last 5 games of {their team}": that team's games, and the player stays picked.
  await pickOnlyGame(page, sheet, LULEA);
  await sheet.getByRole("button", { name: "Player", exact: true }).click();
  const koping = (await menuGroups(page.getByRole("menu"))).find((g) => g.heading === KOPING);
  expect(koping, "the Player list has Köping Stars").toBeTruthy();
  const playerLabel = koping!.options[0];
  const playerName = playerLabel.replace(/^#\d+ /, "");
  await page.getByRole("menuitemcheckbox", { name: playerLabel, exact: true }).click();
  await page.keyboard.press("Escape");
  const playerTrigger = sheet.getByRole("button", { name: playerLabel, exact: true });
  await expect(playerTrigger).toBeVisible();
  ({ list } = await openPicker(page, sheet));
  const teamButton = page.getByRole("button", { name: `Last 5 games of ${KOPING}`, exact: true });
  await expect(teamButton, "the footer offers the player's team").toBeVisible();
  await shot(page, name("team-footer"));
  await teamButton.click();
  await expect(gameList(page)).toBeHidden();
  await expect(gameTrigger(sheet)).toHaveText("2 games");
  ({ list } = await openPicker(page, sheet));
  expect(await tickedGames(list), "Köping Stars' games").toEqual([LULEA, SODERTALJE].sort());
  await closePicker(page);
  await waitForPlays(sheet);
  await expect(playerTrigger, "the player is still picked once the plays are in").toBeVisible();
  const players = await grid.getByRole("row").evaluateAll((rows) => rows.map((r) => r.querySelector("span.truncate.text-sm")?.textContent ?? ""));
  expect(new Set(players), `only ${playerName}'s plays`).toEqual(new Set([playerName]));
  await shot(page, name("team-games"));

  // A game without the player: once its plays are in the player is gone, and stays gone with their game back.
  await pickOnlyGame(page, sheet, NASSJO);
  ({ list } = await openPicker(page, sheet));
  await checkbox(list, LULEA).click();
  await expect(triggerBehindPicker(page)).toHaveText("2 games");
  await closePicker(page);
  await waitForPlays(sheet);
  await expect(sheet.getByRole("button", { name: "Player", exact: true }), "the player was pruned with the game that lacked them").toBeVisible();
  await shot(page, name("pruned"));

  // Close and reopen: the same games come back.
  await sheet.getByRole("button", { name: "Close", exact: true }).click();
  await expect(sheet).toBeHidden();
  await page.getByRole("button", { name: "Add clips", exact: true }).first().click();
  await expect(sheet).toBeVisible();
  await expect(gameTrigger(sheet), "the sheet reopens on the same games").toHaveText("2 games");
  ({ list } = await openPicker(page, sheet));
  expect(await tickedGames(list)).toEqual([LULEA, NASSJO].sort());
  await shot(page, name("reopened"));
  await closePicker(page);
});
