/**
 * Group C, Task 7: Add clips filters through the shared filter bar
 * (PlaysFilterBar). Event types widen within their group and every other
 * filter narrows, the "N plays" count line follows, there is no Timeout chip,
 * each filter that is on gets a token, a team narrows the Filter popover's
 * players to that team, and switching to a game without the chosen team and
 * player clears them.
 *
 * Needs the staging test account's games "BC Luleå vs Köping Stars" and
 * "Nässjö Basket vs Norrköping Dolphins", and a label in the space. Creates
 * the playlist `headless-<port> filters` and deletes it afterwards.
 */
import {
  hasFilterField,
  PORT,
  closeFilters,
  createPlaylist,
  deleteOwnRowsNamed,
  eventCount,
  expect,
  filterSection,
  filterToken,
  gameTrigger,
  openAddClips,
  openFilters,
  pickFilter,
  pickOnlyGame,
  playerSectionNames,
  readSheetRows,
  sectionChips,
  shot,
  test,
} from "../helpers";

const PLAYLIST = `headless-${PORT} filters`;
const GAME = "BC Luleå vs Köping Stars";
const OTHER_GAME = "Nässjö Basket vs Norrköping Dolphins";

test.afterEach(async ({ page }) => {
  await deleteOwnRowsNamed(page, "playlists", PLAYLIST);
});

test("Add clips filters narrow the list together, and a game switch clears team and player", async ({ page, browserName }) => {
  const name = (step: string) => `${browserName}-C-task7-${step}`;
  await deleteOwnRowsNamed(page, "playlists", PLAYLIST);
  const playlistId = await createPlaylist(page, PLAYLIST);
  const sheet = await openAddClips(page, playlistId);
  await pickOnlyGame(page, sheet, GAME);
  const all = await eventCount(sheet);

  // No Timeout chip: timeouts live in game marks, so it would match nothing.
  const chips = sheet.getByRole("group", { name: "Event type" });
  await expect(chips.getByRole("button", { name: "2PT made" })).toBeVisible();
  await expect(chips.getByRole("button", { name: "Timeout" })).toHaveCount(0);

  // Event types: one narrows, a second in the same group widens again (either type).
  await chips.getByRole("button", { name: "2PT made" }).click();
  await expect(chips.getByRole("button", { name: "2PT made" })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => eventCount(sheet)).toBeLessThan(all);
  const made2 = await eventCount(sheet);
  expect(made2, "the game has made twos").toBeGreaterThan(0);
  await chips.getByRole("button", { name: "3PT miss" }).click();
  await expect(chips.getByRole("button", { name: "3PT miss" })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => eventCount(sheet)).toBeGreaterThan(made2);
  const types = await eventCount(sheet);
  expect(types).toBeLessThan(all);
  const badges = [...(await readSheetRows(sheet)).values()].map((r) => r.badge);
  expect(new Set(badges), "only made twos and missed threes are listed").toEqual(new Set(["2PT made", "3PT miss"]));
  // The events have their chips: no token says them again.
  await expect(filterToken(sheet, "Event")).toHaveCount(0);
  await shot(page, name("types"));

  // Every further filter narrows (or keeps) the list, and says itself in a token.
  const counts = [types];
  const step = async (what: string) => {
    const n = await eventCount(sheet);
    expect(n, `${what} narrows the list (${counts.join(" → ")} → ${n})`).toBeLessThanOrEqual(counts.at(-1)!);
    counts.push(n);
  };
  await pickFilter(page, sheet, "Shot type", "Layup");
  await expect(filterToken(sheet, "Shot type")).toContainText("Layup");
  await step("a shot type");
  expect(counts.at(-1), "made layups are left").toBeGreaterThan(0);
  await pickFilter(page, sheet, "Situation", "In the paint");
  await expect(filterToken(sheet, "Situation")).toContainText("In the paint");
  await step("a situation");
  await expect(sheet.getByRole("button", { name: "Filters, 2 on", exact: true }), "the Filter button counts what is on in it").toBeVisible();

  // A team narrows the list and the popover's players to that team.
  let popover = await openFilters(page, sheet);
  expect((await playerSectionNames(popover)).sort()).toEqual(["BC Luleå", "Köping Stars"]);
  await closeFilters(page);
  await pickFilter(page, sheet, "Team", "BC Luleå");
  await expect(filterToken(sheet, "Team")).toContainText("BC Luleå");
  await step("a team");
  popover = await openFilters(page, sheet);
  expect(await playerSectionNames(popover), "the players are only the chosen team's").toEqual(["BC Luleå"]);
  await closeFilters(page);
  await shot(page, name("team"));

  // A player from the Leaders popover: the Player token names them.
  await sheet.getByRole("button", { name: "Leaders" }).click();
  const leaders = page.getByRole("dialog").filter({ hasText: "Game leaders" });
  const leader = leaders.locator("button").filter({ hasText: "BC Luleå" }).first();
  await expect(leader, "Leaders lists a Luleå player").toBeVisible();
  const leaderName = (await leader.locator("span.block").first().innerText()).trim();
  await leader.click();
  await page.keyboard.press("Escape");
  await expect(leaders).toBeHidden();
  await expect(
    filterToken(sheet, "Player").getByRole("button", { name: new RegExp(`^(#\\d+ )?${leaderName}$`) }),
    "the Player token shows the leader",
  ).toBeVisible();
  popover = await openFilters(page, sheet);
  expect(
    (await sectionChips(popover, "BC Luleå")).filter((c) => c.pressed).map((c) => c.label.replace(/^#\d+ /, "")),
    "the leader is the player chosen in the popover",
  ).toEqual([leaderName]);
  await closeFilters(page);
  await step("a player");

  // A label, if the space has one.
  popover = await openFilters(page, sheet);
  const hasLabels = await hasFilterField(popover, "Labels");
  await closeFilters(page);
  if (hasLabels) {
    const labelName = await pickFilter(page, sheet, "Labels");
    await expect(filterToken(sheet, "Label")).toContainText(labelName);
    await step("a label");
  }
  await shot(page, name("narrowed"));
  console.log(`${browserName} C-task7 events: all ${all} → 2PT made ${made2} → +3PT miss ${types} → layup, paint, team, player, label ${counts.slice(1).join(" → ")}`);

  // Switch to a game without Luleå: once its plays are in, team and player are cleared...
  await gameTrigger(sheet).click();
  await page.getByRole("combobox", { name: "Search games or teams" }).fill(OTHER_GAME);
  await page.getByRole("option").filter({ hasText: OTHER_GAME }).first().getByText(OTHER_GAME, { exact: true }).click();
  await expect(gameTrigger(sheet)).toHaveText(OTHER_GAME);
  popover = await openFilters(page, sheet);
  const teams = await filterSection(popover, "Team");
  await expect(teams.getByRole("option", { name: "Nässjö Basket" }), "the new game's plays are in").toBeVisible({ timeout: 30_000 });
  await expect(teams.getByRole("option", { selected: true })).toHaveCount(0);
  await closeFilters(page);
  await expect(filterToken(sheet, "Team")).toHaveCount(0);
  await expect(filterToken(sheet, "Player")).toHaveCount(0);
  await shot(page, name("switched"));

  // ...not just hidden: back on the first game, Team and Player are still empty.
  await gameTrigger(sheet).click();
  await page.getByRole("combobox", { name: "Search games or teams" }).fill(GAME);
  await page.getByRole("option").filter({ hasText: GAME }).first().getByText(GAME, { exact: true }).click();
  await expect(gameTrigger(sheet)).toHaveText(GAME);
  popover = await openFilters(page, sheet);
  const lulea = (await filterSection(popover, "Team")).getByRole("option", { name: "BC Luleå" });
  await expect(lulea).toBeVisible({ timeout: 30_000 });
  await expect(lulea, "the team was cleared").toHaveAttribute("aria-selected", "false");
  expect((await sectionChips(popover, "BC Luleå")).filter((c) => c.pressed), "the player was cleared").toEqual([]);
  await closeFilters(page);
  await expect(filterToken(sheet, "Team")).toHaveCount(0);
  await expect(filterToken(sheet, "Player"), "the player was cleared").toHaveCount(0);
  // The other filters stay: a game switch clears only team and player.
  await expect(chips.getByRole("button", { name: "2PT made" })).toHaveAttribute("aria-pressed", "true");
  await expect(filterToken(sheet, "Shot type")).toContainText("Layup");
  await shot(page, name("back"));
});
