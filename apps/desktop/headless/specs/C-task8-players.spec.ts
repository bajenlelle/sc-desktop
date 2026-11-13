/**
 * Group C, Task 8: the Add clips Player dropdown lists players under their
 * team, as "#<number> <name>", numbers ascending and players without one
 * last, and type-ahead finds a player by name (not by "#"). Picking a team
 * leaves only that team's heading.
 *
 * Needs the staging test account's Genius game "BC Luleå vs Köping Stars"
 * (two teams, one Luleå player without a shirt number). Creates the playlist
 * `headless-<port> players` and deletes it afterwards.
 */
import { PORT, createPlaylist, deleteOwnRowsNamed, expect, menuGroups, openAddClips, pickOnlyGame, shot, test } from "../helpers";

const PLAYLIST = `headless-${PORT} players`;
const GAME = "BC Luleå vs Köping Stars";

test.afterEach(async ({ page }) => {
  await deleteOwnRowsNamed(page, "playlists", PLAYLIST);
});

/** "#12 Ada Lind" → { number: 12, name: "Ada Lind" }; a label without "#" has no number. */
function parse(label: string): { number: number | null; name: string } {
  const m = /^#(\d+) (.+)$/.exec(label);
  return m ? { number: Number(m[1]), name: m[2] } : { number: null, name: label };
}

test("players are grouped by team with shirt numbers, and type-ahead goes by name", async ({ page, browserName }) => {
  const name = (step: string) => `${browserName}-C-task8-${step}`;
  await deleteOwnRowsNamed(page, "playlists", PLAYLIST);
  const playlistId = await createPlaylist(page, PLAYLIST);
  const sheet = await openAddClips(page, playlistId);
  await pickOnlyGame(page, sheet, GAME);

  // Two team headings, each with "#N Name" options sorted by number, players without one last.
  await sheet.getByRole("button", { name: "Player", exact: true }).click();
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitemcheckbox").first()).toBeVisible();
  const groups = await menuGroups(menu);
  expect(groups.map((g) => g.heading).sort(), "one heading per team").toEqual(["BC Luleå", "Köping Stars"]);
  for (const group of groups) {
    const parsed = group.options.map(parse);
    expect(parsed.length, `${group.heading} lists players`).toBeGreaterThan(0);
    const numbers = parsed.filter((p) => p.number !== null).map((p) => p.number!);
    expect(numbers, `${group.heading}: numbers ascending`).toEqual([...numbers].sort((a, b) => a - b));
    const firstUnnumbered = parsed.findIndex((p) => p.number === null);
    if (firstUnnumbered >= 0) {
      expect(parsed.slice(firstUnnumbered).every((p) => p.number === null), `${group.heading}: players without a number come last`).toBe(true);
    }
  }
  const luleå = groups.find((g) => g.heading === "BC Luleå")!.options;
  expect(luleå.at(-1), "Luleå's player without a shirt number is listed last, by name").toBe("Robert Holmes");
  await shot(page, name("groups"));

  // Type-ahead: the first letters of a name whose two-letter start no one else shares.
  const all = groups.flatMap((g) => g.options);
  const prefix = (label: string) => parse(label).name.slice(0, 2).toLowerCase();
  const target = all.slice(1).find((label) => all.filter((other) => prefix(other) === prefix(label)).length === 1);
  expect(target, "some player's first two letters are their own").toBeTruthy();
  await page.keyboard.type(prefix(target!));
  await expect(menu.locator("[role=menuitemcheckbox][data-highlighted]"), `typing "${prefix(target!)}" moves to ${target}`).toHaveText(target!);
  await shot(page, name("typeahead"));
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();

  // Typing "#" matches nothing: the numbers are in the label, not in what type-ahead reads.
  await sheet.getByRole("button", { name: "Player", exact: true }).click();
  await expect(menu.getByRole("menuitemcheckbox").first()).toBeVisible();
  await page.keyboard.type("#1");
  await expect(menu.locator("[role=menuitemcheckbox][data-highlighted]"), "type-ahead doesn't read the shirt number").toHaveCount(0);
  await page.keyboard.press("Escape");

  // A team in Team leaves only that team's heading.
  await sheet.getByRole("button", { name: "Team", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: "Köping Stars" }).click();
  await page.keyboard.press("Escape");
  await expect(sheet.getByRole("button", { name: "Köping Stars", exact: true })).toBeVisible();
  await sheet.getByRole("button", { name: "Player", exact: true }).click();
  await expect(menu.getByRole("menuitemcheckbox").first()).toBeVisible();
  expect((await menuGroups(menu)).map((g) => g.heading), "only the chosen team's heading").toEqual(["Köping Stars"]);
  await shot(page, name("one-team"));
  await page.keyboard.press("Escape");
});
