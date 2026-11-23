/**
 * The game page's and the team page's toolbars give way in order as the window narrows (packages/shared/lib/
 * toolbar-fit.ts): labels first (icons only, the labels as tooltips and accessible names), then the subtitle and
 * "Adding to", and the title last. Reads only: the "Adding to" playlist is one the test account has (a choice
 * kept on this device, not a write).
 */
import path from "node:path";
import type { Page } from "@playwright/test";
import {
  expect,
  FIXTURE_VIDEO,
  mockLeague,
  openLibraryGame,
  OUT_DIR,
  patchGameReads,
  PORT,
  selectRows,
  showGameView,
  test,
} from "../helpers";
import { madeUpLeague } from "../team-league";

const header = (page: Page) => page.locator("header").first();

/** The bar's level: 0 full, 1 icons only, 2 tight. */
async function fitLevel(page: Page): Promise<string | null> {
  return header(page).getAttribute("data-fit");
}

/** Whether the toolbar's title shows whole. */
async function titleWhole(page: Page): Promise<boolean> {
  return header(page).locator("h1").evaluate((h1) => h1.scrollWidth <= h1.clientWidth + 1 && h1.clientWidth > 0);
}

async function width(page: Page, w: number): Promise<void> {
  await page.setViewportSize({ width: w, height: 800 });
  await page.waitForTimeout(250);
}

async function chooseExistingTarget(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^(Choose the playlist to add plays to|Adding to .*\. Change playlist)$/ }).click();
  const option = page.locator("[data-radix-popper-content-wrapper] button").filter({ hasNotText: /^Create/ }).first();
  await expect(option, "the test account has a playlist to add to").toBeVisible({ timeout: 15_000 });
  await option.click();
  await expect(page.getByRole("button", { name: /^Adding to .*\. Change playlist$/ })).toBeVisible();
}

async function headerShots(page: Page, name: string): Promise<void> {
  for (const sidebar of [true, false]) {
    const toggle = page.getByRole("button", { name: sidebar ? "Show sidebar" : "Hide sidebar" });
    if (await toggle.isVisible()) {
      await toggle.click();
      await page.waitForTimeout(400);
    }
    for (const w of [1024, 1180, 1280, 1440, 1728]) {
      await width(page, w);
      // The view switch's thumb springs to its segment's new size: let it land before the shot.
      await page.waitForTimeout(600);
      await header(page).screenshot({ path: path.join(OUT_DIR, `${PORT}-V-${name}-${sidebar ? "sidebar" : "nosidebar"}-${w}.png`) });
    }
  }
  const show = page.getByRole("button", { name: "Show sidebar" });
  if (await show.isVisible()) await show.click();
}

async function gameView(page: Page): Promise<{ id: string; title: string }> {
  await patchGameReads(page, { videoUrl: FIXTURE_VIDEO });
  await page.goto("/matches");
  const game = await openLibraryGame(page, 0);
  await showGameView(page);
  await chooseExistingTarget(page);
  return game;
}

test("the game view's toolbar drops its labels before its title, and gets them back", async ({ page }) => {
  await gameView(page);
  const gameRadio = page.getByRole("radio", { name: "Game" });

  await width(page, 1728);
  expect(await fitLevel(page)).toBe("0");
  await expect(page.getByRole("button", { name: "Open playlist" })).toHaveText("Open playlist");
  await expect(header(page).getByRole("button", { name: "Games" })).toContainText("Games");
  expect((await gameRadio.boundingBox())!.width).toBeGreaterThan(60);

  // The narrowest window, with the sidebar: the labels give way and the title shows whole.
  await width(page, 1024);
  expect(await fitLevel(page)).toBe("1");
  expect(await titleWhole(page)).toBe(true);
  expect((await gameRadio.boundingBox())!.width).toBeLessThan(44);
  for (const name of ["Game", "Stats", "Details"]) await expect(page.getByRole("radio", { name })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open playlist" })).toHaveText("");
  await expect(header(page).getByRole("button", { name: "Games" })).toHaveText("");

  // Narrower than the app allows: "Adding to" goes, the playlist's name and count stay, and so does the control's name.
  await width(page, 860);
  expect(await fitLevel(page)).toBe("2");
  const adding = page.getByRole("button", { name: /^Adding to .*\. Change playlist$/ });
  await expect(adding).toBeVisible();
  await expect(adding).not.toContainText("Adding to");

  // A change of width keeps the same button, and the keyboard's focus on it.
  await width(page, 1728);
  await page.getByRole("button", { name: "Open playlist" }).focus();
  await width(page, 1024);
  expect(await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent)).toBe("Open playlist");

  // Wide again: every label is back.
  await width(page, 1728);
  expect(await fitLevel(page)).toBe("0");
  await expect(page.getByRole("button", { name: "Open playlist" })).toHaveText("Open playlist");
  await expect(adding).toContainText("Adding to");

  await headerShots(page, "game");
});

test("Teams' Plays toolbar keeps the team's name and drops the labels", async ({ page }) => {
  const game = await gameView(page);
  const [row] = await selectRows<{ source_game_id: string | null }>(page, "matches", "source_game_id", { id: game.id });
  await mockLeague(page, madeUpLeague({ libraryGame: Number(row.source_game_id) }));
  await page.goto("/teams");
  await page.getByRole("link", { name: "Alfa", exact: true }).click();
  await page.getByRole("radio", { name: "Plays" }).click({ timeout: 30_000 });
  await expect(page.getByRole("list", { name: "Plays" })).toBeVisible({ timeout: 30_000 });
  await chooseExistingTarget(page);

  await width(page, 1728);
  expect(await fitLevel(page)).toBe("0");
  await expect(page.getByRole("button", { name: /^(New|Open) report$/ })).toContainText("report");

  await width(page, 1024);
  expect(await fitLevel(page)).toBe("1");
  expect(await titleWhole(page)).toBe(true);
  await expect(header(page).getByRole("heading", { level: 1 })).toHaveText("Alfa");
  await expect(page.getByRole("button", { name: /^(New|Open) report$/ })).toHaveText("");
  await expect(header(page).getByRole("button", { name: "Teams" })).toHaveText("");
  for (const name of ["Season", "Plays"]) await expect(page.getByRole("radio", { name })).toBeVisible();

  // Without the sidebar the bar is wider, but the season beside the name still mustn't squeeze it.
  await page.getByRole("button", { name: "Hide sidebar" }).click();
  await page.waitForTimeout(400);
  expect(await titleWhole(page)).toBe(true);
  await page.getByRole("button", { name: "Show sidebar" }).click();
  await page.waitForTimeout(400);

  await width(page, 1728);
  expect(await fitLevel(page)).toBe("0");
  await expect(header(page).getByRole("button", { name: "Teams" })).toContainText("Teams");

  // Narrow, Plays steps up; Season, without the collect control, has the room for the full bar again.
  await width(page, 870);
  expect(Number(await fitLevel(page))).toBeGreaterThan(0);
  await page.getByRole("radio", { name: "Season" }).click();
  await expect.poll(() => fitLevel(page)).toBe("0");
  expect(await titleWhole(page)).toBe(true);
  await page.getByRole("radio", { name: "Plays" }).click();
  await width(page, 1728);

  await headerShots(page, "team");
});
