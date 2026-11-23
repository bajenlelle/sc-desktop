/**
 * Group C, Task 12: saved filter presets in Add clips and in the game view's
 * filter bar. Save names the trigger, apply ticks the chips again, a taken
 * name is refused inline, delete says so with Undo and Undo brings it back;
 * the same preset applies in the game view. A preset keeps plays, shot types,
 * situations and labels, never the team or players: one saved with a player
 * chosen applies without touching the player chosen at the time, in the game
 * view and in Add clips, and one applied while the plays are still loading
 * applies at once and leaves the chosen team and player alone, before and
 * after they land. The presets menu is filled at once from the last read of the
 * space's presets: a sheet opened again lists them while the new read is still
 * on its way, with what was saved, renamed and deleted in between, and without
 * a save that failed.
 *
 * Needs the staging test account's games "BC Luleå vs Köping Stars" and
 * "Södertälje BBK vs Köping Stars". The account has one space, so the
 * per-space list isn't checked. Creates the playlist `headless-<port> presets`
 * and presets named `headless-<port> …`, and deletes them afterwards, failed
 * or not.
 */
import type { Locator, Page, Route } from "@playwright/test";
import {
  PORT,
  createPlaylist,
  deleteOwnRowsNamed,
  eventCount,
  filterSection,
  filterToken,
  goViaSidebar,
  openFilters,
  closeFilters,
  pickFilter,
  ownRowNames,
  expect,
  gameTrigger,
  openAddClips,
  pickOnlyGame,
  readSheetRows,
  shot,
  test,
  toastWith,
  waitForPlays,
  waitForQuiet,
} from "../helpers";

const PREFIX = `headless-${PORT}`;
const PLAYLIST = `${PREFIX} presets`;
const GUARD = `${PREFIX} guard`;
const OTHER = `${PREFIX} other`;
const PLAYER = `${PREFIX} player`;
const PENDING = `${PREFIX} pending`;
const KEPT = `${PREFIX} kept`;
const DROPPED = `${PREFIX} dropped`;
const RENAMED_FROM = `${PREFIX} renamed from`;
const RENAMED_TO = `${PREFIX} renamed to`;
const FAILED = `${PREFIX} failed`;
const LULEA = "BC Luleå vs Köping Stars";
const SODERTALJE = "Södertälje BBK vs Köping Stars";
const KOPING = "Köping Stars";
const GUARD_TYPES = ["2PT made", "2PT miss", "3PT made", "3PT miss"];
const LABELS_GONE = /This preset's labels no longer exist/;

test.afterEach(async ({ page }) => {
  await deleteOwnRowsNamed(page, "filter_presets", PREFIX);
  await deleteOwnRowsNamed(page, "playlists", PLAYLIST);
});

/** The open presets menu (a popover with "Save current filters…" or the name field). */
const presetsMenu = (page: Page) =>
  page.locator('[data-slot="popover-content"]').filter({ has: page.getByText(/Save current filters…|No presets yet/) }).or(
    page.locator('[data-slot="popover-content"]').filter({ has: page.getByPlaceholder("Preset name") }),
  );

async function openPresets(page: Page, scope: Page | Locator, label = "Presets"): Promise<Locator> {
  await scope.getByRole("button", { name: label, exact: true }).click();
  const menu = presetsMenu(page);
  await expect(menu).toBeVisible();
  return menu;
}

async function savePreset(page: Page, menu: Locator, name: string): Promise<void> {
  await menu.getByRole("button", { name: "Save current filters…" }).click();
  await menu.getByPlaceholder("Preset name").fill(name);
  await page.keyboard.press("Enter");
  await expect(menu.getByRole("button", { name, exact: true }), `"${name}" is listed`).toBeVisible();
  await expect(menu.getByRole("button", { name: "Save current filters…" })).toBeVisible();
}

/** The row's "…" menu (shown on hover). */
async function rowAction(page: Page, menu: Locator, preset: string, action: "Rename" | "Delete"): Promise<void> {
  await menu.getByRole("button", { name: preset, exact: true }).hover();
  await menu.getByRole("button", { name: `${preset}: actions` }).click();
  await page.getByRole("menuitem", { name: action }).click();
}

async function pressedChips(group: Locator): Promise<string[]> {
  return (await group.getByRole("button", { pressed: true }).allInnerTexts()).map((t) => t.trim()).sort();
}

test("presets save, apply, refuse a taken name, delete with Undo, travel to the game view, and leave the chosen player alone", async ({ page, browserName }) => {
  test.setTimeout(150_000);
  const name = (step: string) => `${browserName}-C-task12-${step}`;
  await deleteOwnRowsNamed(page, "filter_presets", PREFIX);
  await deleteOwnRowsNamed(page, "playlists", PLAYLIST);
  const playlistId = await createPlaylist(page, PLAYLIST);
  let sheet = await openAddClips(page, playlistId);
  await pickOnlyGame(page, sheet, LULEA);
  const chips = sheet.getByRole("group", { name: "Event type" });

  // Save: four event types as "guard"; the trigger names it.
  for (const type of GUARD_TYPES) await chips.getByRole("button", { name: type, exact: true }).click();
  let menu = await openPresets(page, sheet);
  await expect(menu.getByText("No presets yet. Choose some filters, then save them here.")).toBeVisible();
  await savePreset(page, menu, GUARD);
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(sheet.getByRole("button", { name: GUARD, exact: true }), "the trigger names the saved preset").toBeVisible();
  await shot(page, name("saved"));

  // Clear, then apply: the four chips are ticked again.
  await chips.getByRole("button", { name: "Clear" }).click();
  expect(await pressedChips(chips)).toEqual([]);
  await expect(sheet.getByRole("button", { name: "Presets", exact: true })).toBeVisible();
  menu = await openPresets(page, sheet);
  await menu.getByRole("button", { name: GUARD, exact: true }).click();
  await expect(menu).toBeHidden();
  await expect.poll(() => pressedChips(chips), { message: "the preset ticks its four types" }).toEqual([...GUARD_TYPES].sort());
  await expect(sheet.getByRole("button", { name: GUARD, exact: true })).toBeVisible();
  await shot(page, name("applied"));

  // A second preset, then rename "guard" to its name: refused inline.
  await chips.getByRole("button", { name: "FT made", exact: true }).click();
  menu = await openPresets(page, sheet);
  await savePreset(page, menu, OTHER);
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await chips.getByRole("button", { name: "FT made", exact: true }).click();
  await expect(sheet.getByRole("button", { name: GUARD, exact: true }), "back on guard's filters, the trigger names guard").toBeVisible();
  menu = await openPresets(page, sheet, GUARD);
  await rowAction(page, menu, GUARD, "Rename");
  const renameField = menu.getByRole("textbox", { name: "Preset name" });
  await expect(renameField).toHaveValue(GUARD);
  await renameField.fill(OTHER);
  await page.keyboard.press("Enter");
  await expect(menu.getByText(`You already have a preset called “${OTHER}”.`), "a taken name is refused inline").toBeVisible();
  await expect(renameField, "the field stays for another name").toBeVisible();
  await shot(page, name("duplicate"));
  await page.keyboard.press("Escape");
  await expect(menu.getByRole("button", { name: GUARD, exact: true }), "Escape keeps the old name").toBeVisible();

  // Delete with Undo.
  await rowAction(page, menu, GUARD, "Delete");
  const deleted = page.getByText(`Deleted “${GUARD}”`);
  await expect(deleted, "the delete is said, with Undo").toBeVisible();
  await expect(menu.getByRole("button", { name: GUARD, exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  // Undo is pressed through the UI over the open sheet: what is on top at its centre is the button.
  const undo = page.locator("[data-sonner-toast]").filter({ hasText: `Deleted “${GUARD}”` }).getByRole("button", { name: "Undo" });
  const onTop = await undo.evaluate((button) => {
    const box = button.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return !!hit && button.contains(hit);
  });
  expect(onTop, "the toast's Undo can be pressed while the Add clips sheet is open").toBe(true);
  await shot(page, name("deleted"));
  await undo.click();
  await expect(sheet, "Undo leaves the Add clips sheet open").toBeVisible();
  menu = await openPresets(page, sheet, GUARD);
  await expect(menu.getByRole("button", { name: GUARD, exact: true }), "Undo brings the preset back").toBeVisible({ timeout: 10_000 });
  await shot(page, name("undone"));
  // Undo saves it again; let that write land before the page is left.
  await expect.poll(() => ownRowNames(page, "filter_presets", GUARD), { message: "Undo's save reached the database" }).toEqual([GUARD]);
  await page.keyboard.press("Escape");
  await sheet.getByRole("button", { name: "Close", exact: true }).click();
  await expect(sheet).toBeHidden();

  // The game view: the same preset ticks its event chips.
  await goViaSidebar(page, "Games");
  const gameLink = page.locator('a[href^="/matches/"]').filter({ hasText: LULEA }).first();
  await expect(gameLink, `the test account has the game "${LULEA}"`).toBeVisible({ timeout: 30_000 });
  await gameLink.click();
  await page.getByRole("radio", { name: "Game" }).click();
  await expect(page.getByRole("list", { name: "Plays" })).toBeVisible({ timeout: 30_000 });
  const plays = page.getByRole("group", { name: "Event type" });
  menu = await openPresets(page, page);
  await menu.getByRole("button", { name: GUARD, exact: true }).click();
  await expect(menu).toBeHidden();
  await expect.poll(() => pressedChips(plays), { message: "the game view's chips follow the preset" }).toEqual([...GUARD_TYPES].sort());
  await expect(page.getByRole("button", { name: GUARD, exact: true })).toBeVisible();
  await shot(page, name("game-view-applied"));

  // Save one there with a team and a player chosen: "FT made" alone becomes the preset.
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  expect(await pressedChips(plays)).toEqual([]);
  const koping = page.getByRole("radiogroup", { name: "Team" }).getByRole("radio", { name: KOPING });
  await koping.click();
  await expect(koping).toBeChecked();
  const squad = filterSection(await openFilters(page), KOPING);
  const first = squad.getByRole("button").nth(0);
  const second = squad.getByRole("button").nth(1);
  await first.click();
  await expect(first).toHaveAttribute("aria-pressed", "true");
  await closeFilters(page);
  await plays.getByRole("button", { name: "FT made", exact: true }).click();
  menu = await openPresets(page, page);
  await savePreset(page, menu, PLAYER);
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(page.getByRole("button", { name: PLAYER, exact: true }), "the bar's trigger names it").toBeVisible();
  await shot(page, name("game-view-saved"));

  // Another player: the trigger still names it (a player isn't part of a preset). FT made off, then
  // the preset applied: FT made is back, the player and team chosen in the meantime stay.
  await openFilters(page);
  await first.click();
  await second.click();
  await expect(second).toHaveAttribute("aria-pressed", "true");
  await expect(first).toHaveAttribute("aria-pressed", "false");
  await closeFilters(page);
  await expect(page.getByRole("button", { name: PLAYER, exact: true }), "a change of player keeps the preset's name on the trigger").toBeVisible();
  await plays.getByRole("button", { name: "FT made", exact: true }).click();
  await expect(page.getByRole("button", { name: "Presets", exact: true })).toBeVisible();
  menu = await openPresets(page, page);
  await menu.getByRole("button", { name: PLAYER, exact: true }).click();
  await expect(menu).toBeHidden();
  await expect.poll(() => pressedChips(plays), { message: "the preset ticks FT made again" }).toEqual(["FT made"]);
  await openFilters(page);
  await expect(second, "the player chosen in the meantime stays").toHaveAttribute("aria-pressed", "true");
  await expect(first, "the player chosen when the preset was saved isn't brought back").toHaveAttribute("aria-pressed", "false");
  await expect(koping, "the team stays").toBeChecked();
  await expect(page.getByText(LABELS_GONE)).toHaveCount(0);
  await shot(page, name("game-view-player-kept"));
  await closeFilters(page);

  // Back in Add clips with a team and a player chosen: the preset ticks FT made and leaves them alone.
  sheet = await openAddClips(page, playlistId);
  await waitForPlays(sheet);
  await pickFilter(page, sheet, "Team", KOPING);
  const playerLabel = await pickFilter(page, sheet, KOPING);
  await expect(filterToken(sheet, "Player")).toContainText(playerLabel);
  menu = await openPresets(page, sheet);
  await menu.getByRole("button", { name: PLAYER, exact: true }).click();
  await expect(menu).toBeHidden();
  await expect.poll(() => pressedChips(chips), { message: "the preset ticks FT made in Add clips" }).toEqual(["FT made"]);
  await expect(filterToken(sheet, "Team"), "the chosen team stays").toContainText(KOPING);
  await expect(filterToken(sheet, "Player"), "the chosen player stays").toContainText(playerLabel);
  await expect(sheet.getByRole("button", { name: PLAYER, exact: true }), "the trigger names the preset with a team and a player chosen").toBeVisible();
  await expect(page.getByText(LABELS_GONE)).toHaveCount(0);
  await shot(page, name("add-clips-player-kept"));

});

test("a preset applied while the plays load applies at once and leaves the chosen team and player alone, before and after they land", async ({ page, browserName }) => {
  const name = (step: string) => `${browserName}-C-task12-${step}`;
  await deleteOwnRowsNamed(page, "filter_presets", PREFIX);
  await deleteOwnRowsNamed(page, "playlists", PLAYLIST);
  await goViaSidebar(page, "Games");
  const gameLink = page.locator('a[href^="/matches/"]').filter({ hasText: LULEA }).first();
  await expect(gameLink, `the test account has the game "${LULEA}"`).toBeVisible({ timeout: 30_000 });
  const luleaId = ((await gameLink.getAttribute("href")) ?? "").replace("/matches/", "");
  expect(luleaId, "Games links the Luleå game").not.toBe("");
  const playlistId = await createPlaylist(page, PLAYLIST);

  // "2PT made" saved as a preset, with a team and a player chosen at the time (a preset keeps neither).
  const sheet = await openAddClips(page, playlistId);
  await pickOnlyGame(page, sheet, LULEA);
  const chips = sheet.getByRole("group", { name: "Event type" });
  await pickFilter(page, sheet, "Team", KOPING);
  await pickFilter(page, sheet, KOPING);
  await chips.getByRole("button", { name: "2PT made", exact: true }).click();
  let menu = await openPresets(page, sheet);
  await savePreset(page, menu, PENDING);
  await page.keyboard.press("Escape");
  await expect.poll(() => ownRowNames(page, "filter_presets", PENDING)).toEqual([PENDING]);

  // Södertälje alone, Köping still chosen: the games and team the playlist remembers.
  await pickOnlyGame(page, sheet, SODERTALJE);
  await expect(filterToken(sheet, "Team"), "Köping is in Södertälje's game too").toContainText(KOPING);
  // A fresh page, with Luleå's plays held back. The sheet reopens on Södertälje with the remembered team
  // (Köping) back, a Köping player is chosen from its plays, and Luleå is ticked: Södertälje's plays stay
  // listed while Luleå's are on their way. (A change of games lands in one update, so a sheet opening on
  // both games would list nothing until both were in.)
  let held = 0;
  let released = 0;
  const lulea = (url: URL) => url.href.includes("play_by_play_events") && url.href.includes(luleaId);
  await page.route(lulea, async (route) => {
    held += 1;
    await new Promise((resolve) => setTimeout(resolve, 10_000));
    released += 1;
    await route.continue().catch(() => {});
  });
  await waitForQuiet(page);
  await page.reload();
  const playlistRow = page.locator(`[data-playlist-id="${playlistId}"]`).first();
  await expect(playlistRow).toBeVisible({ timeout: 30_000 });
  await playlistRow.click();
  await page.getByRole("button", { name: "Add clips", exact: true }).first().click();
  await expect(sheet).toBeVisible();
  await expect(gameTrigger(sheet)).toHaveText(SODERTALJE);
  await expect(filterToken(sheet, "Team"), "the team remembered with the game is back").toContainText(KOPING);
  const playerLabel = await pickFilter(page, sheet, KOPING);
  const playerName = playerLabel.replace(/^#\d+ /, "");
  await expect(filterToken(sheet, "Player")).toContainText(playerLabel);
  await gameTrigger(sheet).click();
  await page.locator(`input[type="checkbox"][aria-label="Include ${LULEA}"]`).click();
  await page.keyboard.press("Escape");
  await expect(gameTrigger(sheet)).toHaveText("2 games");
  await expect.poll(() => held, { message: "the sheet asks for Luleå's plays" }).toBeGreaterThan(0);
  await expect(sheet.getByText("Loading plays…"), "Södertälje's plays stay listed").toHaveCount(0);
  await expect(filterToken(sheet, "Team"), "the team stays while Luleå's plays load").toContainText(KOPING);
  await expect(filterToken(sheet, "Player"), "the player stays while Luleå's plays load").toContainText(playerLabel);
  expect(released, "Luleå's plays are still held back").toBe(0);

  // The preset goes in before Luleå's plays land: it applies at once, nothing of it waits for them.
  menu = await openPresets(page, sheet);
  await menu.getByRole("button", { name: PENDING, exact: true }).click();
  await expect(menu).toBeHidden();
  await expect.poll(() => pressedChips(chips), { message: "the preset ticks 2PT made at once" }).toEqual(["2PT made"]);
  expect(released, "the preset went in while Luleå's plays were still held back").toBe(0);
  await expect(filterToken(sheet, "Team"), "the team chosen before stays").toContainText(KOPING);
  await expect(filterToken(sheet, "Player"), "the player chosen before stays").toContainText(playerLabel);
  await expect(sheet.getByRole("button", { name: PENDING, exact: true }), "the trigger names the preset").toBeVisible();
  await shot(page, name("pending"));

  // Luleå's plays land: the team, the player and the preset's chip all survive, and nothing is said.
  await expect.poll(() => released, { message: "Luleå's plays are let through", timeout: 25_000 }).toBeGreaterThan(0);
  await waitForQuiet(page);
  await page.unroute(lulea);
  await expect(sheet.getByText("Loading plays…")).toBeHidden();
  await expect(filterToken(sheet, "Team"), "the team survives the plays landing").toContainText(KOPING);
  await expect(filterToken(sheet, "Player"), "the player survives the plays landing").toContainText(playerLabel);
  expect(await pressedChips(chips), "the preset's chip survives the plays landing").toEqual(["2PT made"]);
  await expect(page.getByText(LABELS_GONE), "no \"labels no longer exist\" toast").toHaveCount(0);
  // The player may have few or no 2PT made; whatever is listed is theirs.
  const others = [...(await readSheetRows(sheet)).values()].filter((r) => !r.text.includes(playerName));
  expect(others.map((r) => r.text), `only ${playerName}'s plays`).toEqual([]);
  console.log(`${browserName} C-task12: ${playerLabel} has ${await eventCount(sheet)} 2PT made in the two games`);
  await shot(page, name("pending-landed"));
});

test("the presets menu is filled from the last read, while the next read is still on its way", async ({ page, browserName }) => {
  test.setTimeout(120_000);
  const name = (step: string) => `${browserName}-C-task12-${step}`;
  await deleteOwnRowsNamed(page, "filter_presets", PREFIX);
  await deleteOwnRowsNamed(page, "playlists", PLAYLIST);
  const playlistId = await createPlaylist(page, PLAYLIST);

  // Three presets saved in the sheet, one of them renamed and one deleted: the kept list is what a coach
  // would see now, not what the database held when the sheet first read it.
  const sheet = await openAddClips(page, playlistId);
  await pickOnlyGame(page, sheet, LULEA);
  const chips = sheet.getByRole("group", { name: "Event type" });
  await chips.getByRole("button", { name: "2PT made", exact: true }).click();
  let menu = await openPresets(page, sheet);
  await savePreset(page, menu, KEPT);
  await savePreset(page, menu, DROPPED);
  await savePreset(page, menu, RENAMED_FROM);
  await rowAction(page, menu, RENAMED_FROM, "Rename");
  const renameField = menu.getByRole("textbox", { name: "Preset name" });
  await renameField.fill(RENAMED_TO);
  await page.keyboard.press("Enter");
  await expect(menu.getByRole("button", { name: RENAMED_TO, exact: true }), "the renamed preset is listed").toBeVisible();
  await rowAction(page, menu, DROPPED, "Delete");
  await expect(menu.getByRole("button", { name: DROPPED, exact: true })).toHaveCount(0);
  // A save the database refuses is taken back: not listed now, nor when the sheet opens again.
  const presetsUrl = "**/rest/v1/filter_presets*";
  const refuseWrites = async (route: Route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "refused by the spec" }) });
    } else await route.continue();
  };
  await page.route(presetsUrl, refuseWrites);
  try {
    await menu.getByRole("button", { name: "Save current filters…" }).click();
    await menu.getByPlaceholder("Preset name").fill(FAILED);
    await page.keyboard.press("Enter");
    await expect(toastWith(page, "Couldn't save the preset. Try again."), "the failed save is said").toBeVisible();
  } finally {
    await page.unroute(presetsUrl, refuseWrites);
  }
  await expect(menu.getByRole("button", { name: FAILED, exact: true }), "the failed save is taken back").toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect
    .poll(() => ownRowNames(page, "filter_presets", PREFIX), { message: "the saves, the rename and the delete reached the database" })
    .toEqual([KEPT, RENAMED_TO].sort());
  await sheet.getByRole("button", { name: "Close", exact: true }).click();
  await expect(sheet).toBeHidden();

  // Every read of the presets is held back and never answered, until the test lets them go.
  const held: Route[] = [];
  const hold = async (route: Route) => {
    if (route.request().method() === "GET") held.push(route);
    else await route.continue();
  };
  await page.route(presetsUrl, hold);
  const release = async () => {
    await page.unroute(presetsUrl, hold);
    for (const route of held.splice(0)) await route.continue().catch(() => {});
  };
  try {
    // The sheet opened again in the same page (a fresh load empties what the app keeps by design).
    await page.getByRole("button", { name: "Add clips", exact: true }).first().click();
    await expect(sheet).toBeVisible();
    await expect.poll(() => held.length, { message: "the sheet still reads the presets in the background" }).toBeGreaterThan(0);
    menu = await openPresets(page, sheet);
    await expect(menu.getByRole("button", { name: KEPT, exact: true }), "the menu lists the saved preset before the read answers").toBeVisible();
    await expect(menu.getByRole("button", { name: RENAMED_TO, exact: true }), "...under its new name").toBeVisible();
    await expect(menu.getByRole("button", { name: RENAMED_FROM, exact: true }), "...not the old one").toHaveCount(0);
    await expect(menu.getByRole("button", { name: DROPPED, exact: true }), "a deleted preset isn't listed").toHaveCount(0);
    await expect(menu.getByRole("button", { name: FAILED, exact: true }), "a save that failed isn't listed").toHaveCount(0);
    await expect(menu.getByText("No presets yet")).toHaveCount(0);
    await shot(page, name("kept-list"));

    // The read answers with the same presets: the menu stays as it was.
    await release();
    await waitForQuiet(page);
    await expect(menu.getByRole("button", { name: KEPT, exact: true })).toBeVisible();
    await expect(menu.getByRole("button", { name: RENAMED_TO, exact: true })).toBeVisible();
    await expect(menu.getByRole("button", { name: DROPPED, exact: true })).toHaveCount(0);
    await expect(menu.getByRole("button", { name: FAILED, exact: true })).toHaveCount(0);
  } finally {
    await release();
  }
});
