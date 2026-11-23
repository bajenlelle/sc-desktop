/**
 * Group C, Task 8: the Add clips Filter popover lists players under their
 * team, as "#<number> <name>", numbers ascending and players without one
 * last; its search narrows them by name or by shirt number ("#7"), and ⌘F
 * opens it with the search focused. Picking a team leaves only that team's
 * players.
 *
 * Needs the staging test account's Genius game "BC Luleå vs Köping Stars"
 * (two teams, one Luleå player without a shirt number). Creates the playlist
 * `headless-<port>-<slot> players` and deletes it afterwards.
 */
import type { Locator } from "@playwright/test";
import {
  owned,
  closeFilters,
  createPlaylist,
  deleteOwnRowsNamed,
  expect,
  filterPopover,
  filterSearch,
  filterToken,
  openAddClips,
  openFilters,
  pickFilter,
  pickOnlyGame,
  playerSectionNames,
  sectionChips,
  shot,
  test,
} from "../helpers";

const PLAYLIST = owned("players");
const GAME = "BC Luleå vs Köping Stars";

test.afterEach(async ({ page }) => {
  await deleteOwnRowsNamed(page, "playlists", PLAYLIST);
});

/** "#12 Ada Lind" → { number: 12, name: "Ada Lind" }; a label without "#" has no number. */
function parse(label: string): { number: number | null; name: string } {
  const m = /^#(\d+) (.+)$/.exec(label);
  return m ? { number: Number(m[1]), name: m[2] } : { number: null, name: label };
}

/** Every player chip the popover shows now, by team. */
async function playersShown(popover: Locator): Promise<{ heading: string; options: string[] }[]> {
  const out: { heading: string; options: string[] }[] = [];
  for (const heading of await playerSectionNames(popover)) out.push({ heading, options: (await sectionChips(popover, heading)).map((c) => c.label) });
  return out;
}

test("players are grouped by team with shirt numbers on Player's page, and its search narrows them by name or number", async ({ page, browserName }) => {
  const name = (step: string) => `${browserName}-C-task8-${step}`;
  await deleteOwnRowsNamed(page, "playlists", PLAYLIST);
  const playlistId = await createPlaylist(page, PLAYLIST);
  const sheet = await openAddClips(page, playlistId);
  await pickOnlyGame(page, sheet, GAME);

  // ⌘F opens the Filter popover with its search focused.
  await sheet.getByRole("group", { name: "Event type" }).getByRole("button", { name: "2PT made" }).focus();
  await page.keyboard.press("Meta+f");
  await expect(filterPopover(page), "⌘F opens the Filter popover").toBeVisible();
  await expect(filterSearch(page), "with its search focused").toBeFocused();

  // Two teams, each with "#N Name" chips sorted by number, players without one last.
  const popover = filterPopover(page);
  const groups = await playersShown(popover);
  expect(groups.map((g) => g.heading).sort(), "one section per team").toEqual(["BC Luleå", "Köping Stars"]);
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

  // The search narrows the players to those whose name holds what is typed (any case), and keeps their team.
  const all = groups.flatMap((g) => g.options);
  const fragment = (label: string) => parse(label).name.slice(0, 3).toLowerCase();
  const byName = (typed: string) => all.filter((label) => parse(label).name.toLowerCase().includes(typed)).sort();
  const target = all.find((label) => byName(fragment(label)).length < all.length / 2);
  expect(target, "some player's first three letters narrow the players").toBeTruthy();
  const typed = fragment(target!).toUpperCase();
  await filterSearch(page).pressSequentially(typed);
  await expect
    .poll(async () => (await playersShown(popover)).flatMap((g) => g.options).sort(), { message: `"${typed}" leaves the players whose name holds it` })
    .toEqual(byName(typed.toLowerCase()));
  expect((await playersShown(popover)).flatMap((g) => g.options), `${target} is among them`).toContain(target);
  await shot(page, name("search-name"));

  // A shirt number, with or without "#": the players whose number starts with it ("1" finds #1 and #12).
  const numbered = all.map(parse).find((p) => p.number !== null)!;
  const byNumber = (n: string) => all.filter((label) => String(parse(label).number ?? "").startsWith(n) || parse(label).name.toLowerCase().includes(n)).sort();
  await filterSearch(page).fill(`#${numbered.number}`);
  await expect
    .poll(async () => (await playersShown(popover)).flatMap((g) => g.options).sort(), { message: `"#${numbered.number}" finds the players by number` })
    .toEqual(byNumber(String(numbered.number)));
  expect(byNumber(String(numbered.number)), `#${numbered.number} is some player's number`).toContain(`#${numbered.number} ${numbered.name}`);
  await shot(page, name("search-number"));

  // A search that matches nothing says so; clearing it brings every player back.
  await filterSearch(page).fill("zzqx");
  await expect(popover.getByText("No filters match “zzqx”.")).toBeVisible();
  await filterSearch(page).fill("");
  await expect.poll(async () => (await playersShown(popover)).flatMap((g) => g.options).length).toBe(all.length);
  // The search narrows the choices, never the plays: nothing is chosen by it.
  await closeFilters(page);
  await expect(filterToken(sheet, "Player")).toHaveCount(0);

  // A team in Team leaves only that team's players.
  await pickFilter(page, sheet, "Team", "Köping Stars");
  await expect(filterToken(sheet, "Team")).toContainText("Köping Stars");
  await openFilters(page, sheet);
  expect(await playerSectionNames(popover), "only the chosen team's players").toEqual(["Köping Stars"]);
  await shot(page, name("one-team"));
  await closeFilters(page);
});
