/**
 * Step 1 toward one layout for every list of plays (docs/game-view.md, docs/teams.md): the count line over each
 * list, Teams' Plays with the game view's selection pill, rows that keep their event name when narrow, a chip row
 * that pages, and the editor's sync warning under its video. Reads only.
 */
import type { Page } from "@playwright/test";
import {
  closeFilters,
  expect,
  filterPopover,
  filterSearch,
  FIXTURE_VIDEO,
  mockLeague,
  openLibraryGame,
  patchGameReads,
  playRows,
  selectRows,
  shot,
  showGameView,
  test,
} from "../helpers";
import { madeUpLeague } from "../team-league";

async function gameView(page: Page): Promise<void> {
  await patchGameReads(page, { videoUrl: FIXTURE_VIDEO });
  await page.goto("/matches");
  await openLibraryGame(page, 0);
  await showGameView(page);
}

/** Alfa's Plays, with the Library's first game as one of Alfa's games and the test video as its footage. */
async function teamPlays(page: Page): Promise<void> {
  await page.goto("/matches");
  const game = await openLibraryGame(page, 0);
  const [row] = await selectRows<{ source_game_id: string | null }>(page, "matches", "source_game_id", { id: game.id });
  await patchGameReads(page, { videoUrl: FIXTURE_VIDEO });
  await mockLeague(page, madeUpLeague({ libraryGame: Number(row.source_game_id) }));
  await page.goto("/teams");
  await page.getByRole("link", { name: "Alfa", exact: true }).click();
  await page.getByRole("radio", { name: "Plays" }).click({ timeout: 30_000 });
  await expect(page.getByRole("list", { name: "Plays" })).toBeVisible({ timeout: 30_000 });
}

test("the game view always says how many plays are listed, and Clear filters brings them all back", async ({ page }) => {
  await gameView(page);
  const count = page.getByRole("status").filter({ hasText: /^\d+ plays?$/ });
  await expect(count).toBeVisible();
  const all = Number((await count.innerText()).split(" ")[0]);
  // One team: the team switch's second option (Both, then the home team).
  await page.getByRole("radiogroup").filter({ has: page.getByRole("radio", { name: "Both" }) }).getByRole("radio").nth(1).click();
  await expect(page.getByRole("status").filter({ hasText: new RegExp(`^\\d+ of ${all} plays$`) })).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.getByRole("status").filter({ hasText: new RegExp(`^${all} plays$`) })).toBeVisible();
});

test("a narrow game list keeps each play's event name", async ({ page, browserName }) => {
  await page.setViewportSize({ width: 1180, height: 760 });
  await gameView(page);
  const first = playRows(page).first();
  const event = first.locator("[title]").filter({ has: page.locator("span.truncate") }).first();
  const what = await event.getAttribute("title");
  expect(what, "the row names its event").toBeTruthy();
  await expect(event.getByText(what!, { exact: true })).toBeVisible();
  await shot(page, `${browserName}-S-game-narrow`);
});

test("a chip row that runs past its edge pages with ›", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 760 });
  await gameView(page);
  // The event chips: the bar's one chip row (the moments went into the Filter popover's When).
  const row = page.getByRole("group", { name: "Event type" });
  await expect(row).toHaveAttribute("data-more", /end|both/);
  await row.hover();
  const more = page.locator('[data-scroll-page="end"]').first();
  await expect(more).toBeVisible();
  await more.click();
  await expect.poll(() => row.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  await expect(row).toHaveAttribute("data-more", /start|both/);
});

test("⌘F opens the Filter popover with its search focused, in the game view and in Teams' Plays", async ({ page }) => {
  await gameView(page);
  await playRows(page).first().click();
  await page.keyboard.press("Meta+f");
  await expect(filterPopover(page), "the game view's Filter opens").toBeVisible();
  await expect(filterSearch(page), "with its search focused").toBeFocused();
  // The search narrows the choices, not the plays: the count line keeps every play.
  const count = page.getByRole("status").filter({ hasText: /^\d+ plays?$/ });
  const all = await count.innerText();
  await filterSearch(page).fill("zzqx");
  await expect(filterPopover(page).getByText("No filters match “zzqx”.")).toBeVisible();
  await expect(count, "typing in the search doesn't filter the plays").toHaveText(all);
  await closeFilters(page);

  await teamPlays(page);
  await page.getByRole("list", { name: "Plays" }).locator("[data-key]").first().click();
  await page.keyboard.press("Meta+f");
  await expect(filterPopover(page), "Teams' Plays' Filter opens").toBeVisible();
  await expect(filterSearch(page), "with its search focused").toBeFocused();
  await closeFilters(page);
});

test("Teams' Plays: the count line clears filters, and a selection gets the game view's pill", async ({ page, browserName }) => {
  await teamPlays(page);
  await expect(page.getByRole("status").filter({ hasText: /^\d+ plays? in \d+ games?$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear filters" })).toHaveCount(0);
  const chip = page.getByRole("group", { name: "Event type" }).getByRole("button", { name: "2PT made" });
  await chip.click();
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Clear filters" }).first().click();
  await expect(chip).toHaveAttribute("aria-pressed", "false");

  const rows = page.getByRole("list", { name: "Plays" }).locator("[data-key]");
  await rows.nth(0).click({ modifiers: ["Meta"] });
  await rows.nth(1).click({ modifiers: ["Meta"] });
  const pill = page.getByRole("toolbar", { name: "Selection" });
  await expect(pill).toBeVisible();
  await expect(pill).toContainText("2");
  await expect(pill.getByRole("button", { name: /^(Add to|Add 2)/ })).toBeVisible();
  await expect(page.getByText(/^\d+ selected$/)).toHaveCount(0); // the old line under the player is gone
  await shot(page, `${browserName}-S-team-selection`);
  await page.keyboard.press("Escape");
  await expect(pill).toBeHidden();
});

test("the editor's sync warning sits in the player's column with one way to fix it", async ({ page, browserName }) => {
  // Reads only: a playlist of the test account whose clips fall past the end of the two-minute test video. A fresh
  // playlist doesn't get there headless (its game's plays and the video's length arrive another way), so this
  // borrows one the account keeps, and skips when it is gone.
  await patchGameReads(page, { videoUrl: FIXTURE_VIDEO });
  await page.goto("/playlists");
  const row = page.locator("[data-playlist-id]").filter({ hasText: /^New Playlistardrsdytu/ }).first();
  const there = await row.waitFor({ timeout: 20_000 }).then(() => true, () => false);
  test.skip(!there, "the test account no longer has the playlist this check reads");
  await row.click();
  const warning = page.getByText(/(start|starts) after the video ends|run past the end of its video/);
  await expect(warning).toBeVisible({ timeout: 30_000 });
  const callout = warning.locator("xpath=ancestor::div[contains(@class,'rounded-window')][1]");
  await expect(callout.getByRole("button", { name: /^(Fix sync…|Set quarters…)$/ })).toHaveCount(1);
  await expect(callout.getByRole("button", { name: "Dismiss" })).toBeVisible();
  // In the player's column, right of the clips (before step 1 it sat over them, in the list's column).
  const clip = (await page.locator("[role=row][data-row-key]").first().boundingBox())!;
  const box = (await callout.boundingBox())!;
  expect(box.x, "the warning is right of the clip list").toBeGreaterThanOrEqual(clip.x + clip.width);
  await shot(page, `${browserName}-S-editor-warning`);
});
