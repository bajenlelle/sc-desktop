/**
 * Group C, Task 7: Add clips filters through the shared ClipFilters. Event
 * types widen within their group and every other control narrows, the
 * "N events" counter follows, there is no Timeout chip, a team narrows the
 * Player list, and switching to a game without the chosen team and player
 * clears them.
 *
 * Needs the staging test account's games "BC Luleå vs Köping Stars" and
 * "Nässjö Basket vs Norrköping Dolphins", and a label in the space. Creates
 * the playlist `headless-<port> filters` and deletes it afterwards.
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
} from "../helpers";

const PLAYLIST = `headless-${PORT} filters`;
const GAME = "BC Luleå vs Köping Stars";
const OTHER_GAME = "Nässjö Basket vs Norrköping Dolphins";

test.afterEach(async ({ page }) => {
  await deleteOwnRowsNamed(page, "playlists", PLAYLIST);
});

/** Ticks one option in a filter dropdown and closes it; returns the trigger. */
async function tickInDropdown(page: Page, sheet: Locator, trigger: string, option: string): Promise<void> {
  await sheet.getByRole("button", { name: trigger, exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: option, exact: true }).click();
  await expect(page.getByRole("menuitemcheckbox", { name: option, exact: true })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toBeHidden();
}

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
  const badges = await sheet.getByRole("grid", { name: "Events" }).getByRole("row").evaluateAll((rows) =>
    rows.map((r) => r.querySelector("span.rounded-full")?.textContent ?? ""),
  );
  expect(new Set(badges), "only made twos and missed threes are listed").toEqual(new Set(["2PT Made", "3PT Miss"]));
  await shot(page, name("types"));

  // Every further control narrows (or keeps) the list.
  const counts = [types];
  const step = async (what: string) => {
    const n = await eventCount(sheet);
    expect(n, `${what} narrows the list (${counts.join(" → ")} → ${n})`).toBeLessThanOrEqual(counts.at(-1)!);
    counts.push(n);
  };
  await tickInDropdown(page, sheet, "Shot type", "Layup");
  await expect(sheet.getByRole("button", { name: "Layup", exact: true })).toBeVisible();
  await step("a shot type");
  expect(counts.at(-1), "made layups are left").toBeGreaterThan(0);
  await tickInDropdown(page, sheet, "Situation", "In the paint");
  await expect(sheet.getByRole("button", { name: "In the paint", exact: true })).toBeVisible();
  await step("a situation");

  // A team narrows the list and the Player list to that team.
  await sheet.getByRole("button", { name: "Player", exact: true }).click();
  expect((await menuGroups(page.getByRole("menu"))).map((g) => g.heading).sort()).toEqual(["BC Luleå", "Köping Stars"]);
  await page.keyboard.press("Escape");
  await tickInDropdown(page, sheet, "Team", "BC Luleå");
  await expect(sheet.getByRole("button", { name: "BC Luleå", exact: true })).toBeVisible();
  await step("a team");
  await sheet.getByRole("button", { name: "Player", exact: true }).click();
  expect((await menuGroups(page.getByRole("menu"))).map((g) => g.heading), "the Player list keeps only the chosen team").toEqual(["BC Luleå"]);
  await page.keyboard.press("Escape");
  await shot(page, name("team"));

  // A player from the Leaders popover: the Player filter names them.
  await sheet.getByRole("button", { name: "Leaders" }).click();
  const leaders = page.getByRole("dialog").filter({ hasText: "Game leaders" });
  const leader = leaders.locator("button").filter({ hasText: "BC Luleå" }).first();
  await expect(leader, "Leaders lists a Luleå player").toBeVisible();
  const leaderName = (await leader.locator("span.block").first().innerText()).trim();
  await leader.click();
  await page.keyboard.press("Escape");
  await expect(leaders).toBeHidden();
  await expect(sheet.getByRole("button", { name: new RegExp(`^(#\\d+ )?${leaderName}$`) }), "the Player filter shows the leader").toBeVisible();
  await step("a player");

  // A label, if the space has one.
  // The filter's trigger opens a menu; each row's own "Labels" button opens the label picker.
  const labelsTrigger = sheet.getByRole("button", { name: "Labels", exact: true }).and(sheet.locator('[aria-haspopup="menu"]'));
  if (await labelsTrigger.count()) {
    await labelsTrigger.click();
    const firstLabel = page.getByRole("menuitemcheckbox").first();
    const labelName = (await firstLabel.innerText()).trim();
    await firstLabel.click();
    await page.keyboard.press("Escape");
    await expect(sheet.getByRole("button", { name: labelName, exact: true })).toBeVisible();
    await step("a label");
  }
  await shot(page, name("narrowed"));
  console.log(`${browserName} C-task7 events: all ${all} → 2PT made ${made2} → +3PT miss ${types} → layup, paint, team, player, label ${counts.slice(1).join(" → ")}`);

  // Switch to a game without Luleå: once its plays are in, team and player are cleared...
  await gameTrigger(sheet).click();
  await page.getByRole("combobox", { name: "Search games or teams" }).fill(OTHER_GAME);
  await page.getByRole("option").filter({ hasText: OTHER_GAME }).first().getByText(OTHER_GAME, { exact: true }).click();
  await expect(gameTrigger(sheet)).toHaveText(OTHER_GAME);
  await sheet.getByRole("button", { name: "Team", exact: true }).click();
  await expect(page.getByRole("menuitemcheckbox", { name: "Nässjö Basket" }), "the new game's plays are in").toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("menuitemcheckbox", { checked: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await shot(page, name("switched"));

  // ...not just hidden: back on the first game, Team and Player are still empty.
  await gameTrigger(sheet).click();
  await page.getByRole("combobox", { name: "Search games or teams" }).fill(GAME);
  await page.getByRole("option").filter({ hasText: GAME }).first().getByText(GAME, { exact: true }).click();
  await expect(gameTrigger(sheet)).toHaveText(GAME);
  await sheet.getByRole("button", { name: "Team", exact: true }).click();
  await expect(page.getByRole("menuitemcheckbox", { name: "BC Luleå" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("menuitemcheckbox", { name: "BC Luleå" }), "the team was cleared").toHaveAttribute("aria-checked", "false");
  await page.keyboard.press("Escape");
  await expect(sheet.getByRole("button", { name: "Player", exact: true }), "the player was cleared").toBeVisible();
  // The other filters stay: a game switch clears only team and player.
  await expect(chips.getByRole("button", { name: "2PT made" })).toHaveAttribute("aria-pressed", "true");
  await expect(sheet.getByRole("button", { name: "Layup", exact: true })).toBeVisible();
  await shot(page, name("back"));
});
