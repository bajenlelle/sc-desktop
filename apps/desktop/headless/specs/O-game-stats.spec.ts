/**
 * The game's Stats view (docs/game-view.md, "Stats"): the switch has three
 * views, Stats reads the game as numbers, and a number opens exactly the
 * plays it counts in the Game view, as one filter that clears on its own.
 * Reads only; creates nothing.
 */
import type { Page } from "@playwright/test";
import { expect, openFirstGame, playRows, shot, test } from "../helpers";

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
});
