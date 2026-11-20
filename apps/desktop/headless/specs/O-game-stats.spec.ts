/**
 * The game's Stats view (docs/game-view.md, "Stats"): the switch has three
 * views, Stats reads the game as numbers, and a number opens exactly the
 * plays it counts in the Game view, as one filter that clears on its own.
 * Reads only; creates nothing.
 */
import type { Page } from "@playwright/test";
import { expect, openFirstGame, openSampleGame, playRows, shot, test } from "../helpers";

const showStats = async (page: Page) => {
  await page.getByRole("radio", { name: "Stats" }).click();
  await expect(page.getByRole("radio", { name: "Stats" })).toHaveAttribute("aria-checked", "true");
};

test("Stats reads the game, and a number opens its plays in the Game view", async ({ page, browserName }) => {
  const name = (step: string) => `${browserName}-O-stats-${step}`;
  const title = await openFirstGame(page);
  await expect(page.getByRole("radio", { name: "Game" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Details" })).toBeVisible();

  await showStats(page);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(title);
  await expect(page.getByRole("heading", { name: "Score", level: 2 })).toBeVisible({ timeout: 30_000 });
  await shot(page, name("score"));
  const factors = page.getByRole("heading", { name: "Why it went that way", level: 2 });
  await expect(factors).toBeVisible();
  await expect(page.getByText("Points per possession")).toBeVisible();
  await expect(page.getByRole("button", { name: /: points in the paint, \d+, show plays$/ }).first()).toBeVisible();
  await factors.scrollIntoViewIfNeeded();
  await shot(page, name("factors"));

  // Players: both teams, with the league's minutes; Season swaps in the league's averages.
  const players = page.getByRole("heading", { name: "Players", level: 2 });
  await players.scrollIntoViewIfNeeded();
  await expect(page.getByRole("columnheader", { name: "PTS" }).first()).toBeVisible();
  await expect(page.getByRole("row", { name: /^Totals/ })).toHaveCount(2);
  await shot(page, name("players"));
  const numbers = page.getByLabel("Numbers");
  await numbers.getByRole("radio", { name: "Season" }).click();
  await expect(page.getByRole("columnheader", { name: "PPG" }).first()).toBeVisible({ timeout: 30_000 });
  await shot(page, name("players-season"));
  await numbers.getByRole("radio", { name: "Game" }).click();
  await expect(page.getByRole("columnheader", { name: "PTS" }).first()).toBeVisible();

  // Shots and lineups, for a game imported with positions and fives.
  const shotsHeading = page.getByRole("heading", { name: "Shots", level: 2 });
  await shotsHeading.scrollIntoViewIfNeeded();
  await expect(page.getByRole("group", { name: /: shot chart$/ })).toHaveCount(2);
  await expect(page.getByRole("button", { name: /: threes, \d+\/\d+, show plays$/ }).first()).toBeVisible();
  await shot(page, name("shots"));
  const lineupsHeading = page.getByRole("heading", { name: "Lineups", level: 2 });
  await lineupsHeading.scrollIntoViewIfNeeded();
  await expect(page.getByRole("button", { name: /^Lineup .+, show plays$/ }).first()).toBeVisible();
  await shot(page, name("lineups"));
  await page.evaluate(() => document.querySelector("[data-page-scroller]")?.scrollTo(0, 0));

  // A quarter's figure: the home team's points in Q1.
  const quarter = page.getByRole("button", { name: /: points in Q1, \d+, show plays$/ }).first();
  const label = (await quarter.getAttribute("aria-label"))!;
  const setName = label.replace(/, \d+, show plays$/, "");
  await quarter.click();
  await expect(page.getByRole("radio", { name: "Game" })).toHaveAttribute("aria-checked", "true");
  const chip = page.getByRole("button", { name: `Clear ${setName}` });
  await expect(chip, "the Game view shows the set as one filter").toBeVisible({ timeout: 30_000 });
  await expect(playRows(page).first()).toBeVisible();
  await shot(page, name("picked"));

  // The chip clears on its own.
  await chip.click();
  await expect(chip).toHaveCount(0);

  // A player's shots: "made/attempts" opens exactly the attempts, and the way back keeps Stats where it was left.
  await showStats(page);
  const fg = page.getByRole("button", { name: /: shots, \d+\/[1-9]\d*, show plays$/ }).first();
  await fg.scrollIntoViewIfNeeded();
  const fgLabel = (await fg.getAttribute("aria-label"))!;
  const attempts = Number(/\/(\d+), show plays$/.exec(fgLabel)![1]);
  const fgName = fgLabel.replace(/, \d+\/\d+, show plays$/, "");
  // Scroll down to the players: where the coach left the page is what the way back restores.
  await fg.evaluate((el) => el.scrollIntoView({ block: "center" }));
  const scrolled = await page.evaluate(() => document.querySelector("[data-page-scroller]")!.scrollTop);
  expect(scrolled, "the page has scrolled to the players").toBeGreaterThan(100);
  await fg.click();
  await expect(page.getByRole("button", { name: `Clear ${fgName}` })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(`${attempts} ${attempts === 1 ? "play" : "plays"}`, { exact: true }).first()).toBeVisible();
  await expect(playRows(page)).toHaveCount(attempts);
  await showStats(page);
  await expect(page.getByRole("heading", { name: "Players", level: 2 })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.querySelector("[data-page-scroller]")!.scrollTop)).toBeGreaterThan(scrolled - 40);
});

test("a game without positions or fives says so instead of drawing them", async ({ page, browserName }) => {
  await openSampleGame(page);
  await showStats(page);
  await expect(page.getByRole("heading", { name: "Score", level: 2 })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Shot positions come with games imported since September 2026.")).toBeVisible();
  await expect(page.getByText("Lineups come with games imported since September 2026.")).toBeVisible();
  await expect(page.getByRole("group", { name: /: shot chart$/ })).toHaveCount(0);
  await shot(page, `${browserName}-O-stats-old-shape`);
});
