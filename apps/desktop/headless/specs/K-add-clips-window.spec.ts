/**
 * Add clips draws only the plays near the view: on the test account's five
 * games (about 1,790 plays) the list holds a few dozen rows, the grid says how
 * many there are, scrolling and Home/End reach both ends, a filter switched on
 * at the bottom still shows its plays, and Select all counts every play, drawn
 * or not.
 *
 * Needs the staging test account's five games. Creates the playlist
 * `headless-<port> window` and deletes it afterwards.
 */
import type { Locator, Page } from "@playwright/test";
import {
  PORT,
  createPlaylist,
  deleteOwnRowsNamed,
  eventCount,
  expect,
  gameTrigger,
  openAddClips,
  readSheetRows,
  test,
  waitForPlays,
} from "../helpers";

const PLAYLIST = `headless-${PORT} window`;

test.afterEach(async ({ page }) => {
  await deleteOwnRowsNamed(page, "playlists", PLAYLIST);
});

/** A new playlist's Add clips on "Last 5 games", with the plays listed: the sheet, its grid and the counter. */
async function openOnFiveGames(page: Page): Promise<{ sheet: Locator; grid: Locator; count: number }> {
  await deleteOwnRowsNamed(page, "playlists", PLAYLIST);
  const playlistId = await createPlaylist(page, PLAYLIST);
  const sheet = await openAddClips(page, playlistId);
  await gameTrigger(sheet).click();
  const list = page.getByRole("listbox", { name: "Games" });
  await expect(list).toBeVisible();
  await page.getByRole("button", { name: "Last 5 games", exact: true }).click();
  await expect(list).toBeHidden();
  await waitForPlays(sheet);
  // The five games' plays arrive one game at a time: wait for the counter to settle.
  let count = 0;
  await expect
    .poll(async () => {
      const now = await eventCount(sheet);
      const settled = now === count;
      count = now;
      return settled;
    }, { message: "the five games' plays are all listed", timeout: 30_000, intervals: [500] })
    .toBe(true);
  return { sheet, grid: sheet.getByRole("grid", { name: "Events" }), count };
}

/**
 * A row wholly in view. The sheet around the list sits on fractions of a
 * pixel, and clips a few hundredths of one off a row at the list's bottom
 * edge (a ratio of 0.9994 for a row that ends exactly there).
 */
const WHOLE = 0.99;

/** The element that scrolls the list (the grid's parent). */
const scrollerOf = (grid: Locator) => grid.locator("xpath=..");

/** Scrolls the list to its end and waits two frames, so the rows there are drawn. */
async function scrollToBottom(grid: Locator): Promise<void> {
  await scrollerOf(grid).evaluate(async (el) => {
    el.scrollTop = el.scrollHeight;
    await new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
  });
}

/** How many rows show, wholly or partly, inside the list's scrolling box. */
const rowsInView = (grid: Locator) =>
  scrollerOf(grid).evaluate((el) => {
    const box = el.getBoundingClientRect();
    return [...el.querySelectorAll("[role=row]")].filter((row) => {
      const r = row.getBoundingClientRect();
      return r.bottom > box.top && r.top < box.bottom;
    }).length;
  });

test("the list draws only the rows near the view", async ({ page }) => {
  const { grid, count } = await openOnFiveGames(page);
  expect(count, "five games hold well over 800 plays").toBeGreaterThan(800);
  expect(await grid.locator("[role=row]").count(), "only the rows near the view are drawn").toBeLessThanOrEqual(60);
  await expect(grid).toHaveAttribute("aria-rowcount", String(count));
});

test("scrolling reaches the last play", async ({ page }) => {
  const { sheet, grid, count } = await openOnFiveGames(page);
  await scrollToBottom(grid);
  const last = grid.locator(`[role=row][aria-rowindex="${count}"]`);
  await expect(last, "the last play is at the bottom").toBeInViewport({ ratio: WHOLE });
  // The drawn rows and the space for the rest add up to the whole list, and the last row's bottom is the view's.
  const fit = await last.evaluate((row) => {
    const grid = row.parentElement!;
    const scroller = grid.parentElement!;
    return {
      gridHeight: grid.getBoundingClientRect().height,
      scrollHeight: scroller.scrollHeight,
      afterLast: grid.getBoundingClientRect().bottom - row.getBoundingClientRect().bottom,
      belowView: row.getBoundingClientRect().bottom - scroller.getBoundingClientRect().bottom,
    };
  });
  expect(fit.gridHeight, "every row is 45 px").toBe(count * 45);
  expect(fit.scrollHeight, "the list scrolls as far as every row reaches").toBe(count * 45);
  expect(fit.afterLast, "the last row ends the list").toBe(0);
  expect(Math.abs(fit.belowView), "and meets the bottom of the view").toBeLessThan(0.5);
  expect((await readSheetRows(sheet)).size, "scrolling through reads every play").toBe(count);
});

test("End plays the last play and brings it into view; Home the first", async ({ page }) => {
  const { grid, count } = await openOnFiveGames(page);
  await page.keyboard.press("End");
  const last = grid.locator(`[role=row][aria-rowindex="${count}"]`);
  await expect(last, "End brings the last play into view").toBeInViewport({ ratio: WHOLE });
  await expect(last, "and plays it").toHaveAttribute("aria-current", "true");
  await page.keyboard.press("Home");
  const first = grid.locator('[role=row][aria-rowindex="1"]');
  await expect(first, "Home brings the first play into view").toBeInViewport({ ratio: WHOLE });
  await expect(first).toHaveAttribute("aria-current", "true");
});

test("a filter switched on at the bottom of the list still shows its plays", async ({ page }) => {
  const { sheet, grid } = await openOnFiveGames(page);
  await scrollToBottom(grid);
  await sheet.getByRole("group", { name: "Event type" }).getByRole("button", { name: "3PT made" }).click();
  await expect.poll(() => eventCount(sheet), { message: "the filter leaves some plays" }).toBeGreaterThan(0);
  await expect.poll(() => rowsInView(grid), { message: "the list shows them, not an empty stretch" }).toBeGreaterThan(0);
});

test("Select all counts every play", async ({ page }) => {
  const { sheet, count } = await openOnFiveGames(page);
  const selectAll = sheet.getByRole("checkbox", { name: /^Select all/ });
  await selectAll.click();
  await expect(sheet.getByRole("button", { name: `Add ${count} clips`, exact: true })).toBeVisible();
  await selectAll.click();
  await expect(sheet.getByRole("button", { name: "Add clips", exact: true })).toBeVisible();
});
