/**
 * Add clips draws only the plays near the view: on the test account's five
 * games (about 1,790 plays) the list holds a few dozen rows, the grid says how
 * many there are, scrolling and Home/End reach both ends, a filter switched on
 * at the bottom still shows its plays, and ⌘A selects every play, drawn
 * or not. The rows hold one label picker between them, on the row being
 * labelled, and it closes when that row leaves the list.
 *
 * Needs the staging test account's five games and a label in its space.
 * Creates the playlist `headless-<port> window` and deletes it afterwards;
 * takes off every label it puts on.
 */
import type { Locator, Page } from "@playwright/test";
import {
  selectionPill,
  PORT,
  createPlaylist,
  deleteOwnRowsNamed,
  eventCount,
  expect,
  gameTrigger,
  openAddClips,
  readSheetRows,
  sheetRow,
  test,
  waitForPlays,
  withAppModule,
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
  // The five games' plays arrive one game at a time, and a game can come late: the counter
  // must read the same three times over a second before the list counts as whole.
  const reads: number[] = [];
  await expect
    .poll(async () => {
      reads.push(await eventCount(sheet));
      const [a, b, c] = reads.slice(-3);
      return reads.length >= 3 && a === b && b === c;
    }, { message: "the five games' plays are all listed", timeout: 30_000, intervals: [500] })
    .toBe(true);
  return { sheet, grid: sheet.getByRole("grid", { name: "Events" }), count: reads.at(-1)! };
}

/*
 * While a label picker is open it is modal and hides the sheet from role
 * queries, so the list is found by CSS from here on.
 */
const GRID = '[role=grid][aria-label="Events"]';
/** A popover trigger inside the list: only the row being labelled holds one. */
const listTriggers = (page: Page) => page.locator(`${GRID} [data-slot="popover-trigger"]`);
/** The open label picker's list of labels. */
const pickerList = (page: Page) => page.getByRole("listbox", { name: "Labels" });
/** A row's Tag button (the plain one, or the open picker's trigger). */
const tagButton = (row: Locator) => row.locator('button[title="Labels"]');

/**
 * Labels this spec put on (each was off before). The tests take them off
 * themselves; the afterEach makes sure, in case a test stopped halfway.
 */
const putOn: { matchId: string; eventId: number; labelId: string }[] = [];
test.afterEach(async ({ page }) => {
  for (const { matchId, eventId, labelId } of putOn.splice(0)) {
    await withAppModule(page, "/src/lib/supabase/client.ts", `
      const { error } = await mod.createClient().from("clip_label_assignments").delete()
        .eq("match_id", arg.matchId).eq("event_id", arg.eventId).eq("label_id", arg.labelId);
      if (error) throw new Error("headless: " + error.message);
    `, { matchId, eventId, labelId });
  }
});

/** Opens the row's label picker with its Tag button. */
async function openPicker(page: Page, row: Locator): Promise<void> {
  await tagButton(row).click();
  await expect(pickerList(page), "exactly one label picker is open").toHaveCount(1);
}

/** Closes the open label picker. */
async function closePicker(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(pickerList(page), "Escape closes the picker").toHaveCount(0);
}

/** In the row's open picker, puts on the first label the row doesn't have. Returns the label's name. */
async function putFirstLabelOn(page: Page, row: Locator): Promise<string> {
  const rowKey = (await row.getAttribute("data-row-key"))!;
  const option = pickerList(page).getByRole("option", { selected: false }).first();
  await expect(option, "the test account has a label this play doesn't carry").toBeVisible();
  const name = (await option.innerText()).trim();
  // An option's id ends with its label's id.
  const labelId = (await option.getAttribute("id"))?.match(/[0-9a-f-]{36}$/)?.[0];
  await option.click();
  const [matchId, eventId] = rowKey.split(":");
  if (labelId) putOn.push({ matchId, eventId: Number(eventId), labelId });
  await expect(pickerList(page).getByRole("option", { name, exact: true }).first()).toHaveAttribute("aria-selected", "true");
  return name;
}

/** In the open picker, takes the label off again. */
const takeLabelOff = (page: Page, name: string) => pickerList(page).getByRole("option", { name, exact: true }).first().click();

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
  expect(fit.gridHeight, "every row is 32 px").toBe(count * 32);
  expect(fit.scrollHeight, "the list scrolls as far as every row reaches").toBe(count * 32);
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

test("⌘A selects every play, and Esc lets go before it closes the sheet", async ({ page }) => {
  const { sheet, grid, count } = await openOnFiveGames(page);
  // After a press on a row (it plays), the keys still belong to the sheet.
  await grid.locator("[role=row]").first().locator("span.nums").first().click();
  await page.keyboard.press("Meta+a");
  await expect(selectionPill(sheet)).toContainText(String(count));
  await page.keyboard.press("Escape");
  await expect(selectionPill(sheet)).toBeHidden();
  await expect(sheet, "the first Esc only let go of the selection").toBeVisible();
  // A adds the play on screen, as in the game view.
  await page.keyboard.press("a");
  await expect(grid.locator("[role=row]").first().getByLabel("Already in this playlist")).toBeVisible();
});

test("a row's Tag button opens the one label picker", async ({ page }) => {
  await openOnFiveGames(page);
  const row = page.locator(`${GRID} [role=row][aria-rowindex="2"]`);
  await expect(listTriggers(page), "no row holds a picker while none is open").toHaveCount(0);
  await openPicker(page, row);
  await expect(listTriggers(page), "only the row being labelled holds the picker").toHaveCount(1);
  await expect(tagButton(row), "its Tag button is the picker's trigger").toHaveAttribute("data-state", "open");
  const name = await putFirstLabelOn(page, row);
  await expect(row.getByText(name, { exact: true }), "the row shows the label's chip at once").toBeVisible();
  await closePicker(page);
  await expect(listTriggers(page), "closed, no row holds a picker").toHaveCount(0);
  await expect(row.getByText(name, { exact: true }), "the chip stays").toBeVisible();

  await openPicker(page, row);
  await takeLabelOff(page, name);
  await expect(pickerList(page).getByRole("option", { name, exact: true }).first()).toHaveAttribute("aria-selected", "false");
  await closePicker(page);
  await expect(row.getByText(name, { exact: true }), "the chip is gone").toHaveCount(0);
});

test("the picker closes when its row leaves the list", async ({ page }) => {
  const { sheet, count } = await openOnFiveGames(page);
  const first = page.locator(`${GRID} [role=row][aria-rowindex="1"]`);
  const rowKey = (await first.getAttribute("data-row-key"))!;
  await openPicker(page, first);
  const name = await putFirstLabelOn(page, first);
  await closePicker(page);

  // Only the plays with that label: the row is one of them.
  // The label is a chip in the Filter popover's Labels section; a second press takes it off.
  const filterByLabel = async () => {
    await sheet.getByRole("button", { name: /^Filters/ }).click();
    const popover = page.locator('[data-slot="popover-content"]').filter({ has: page.getByRole("searchbox", { name: "Search filters" }) });
    await popover.getByRole("region", { name: "Labels" }).getByRole("button", { name, exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(popover).toBeHidden();
  };
  await filterByLabel();
  await expect.poll(() => eventCount(sheet), { message: "the label filter narrows the list" }).toBeLessThan(count);
  const labelled = await eventCount(sheet);

  // Taking the label off takes the row out of the list, and its picker with it.
  const row = await sheetRow(sheet, rowKey);
  await openPicker(page, row);
  await takeLabelOff(page, name);
  await expect(pickerList(page), "the picker closes with its row").toHaveCount(0);
  await expect(page.locator(`${GRID} [data-row-key="${rowKey}"]`), "the row has left the list").toHaveCount(0);
  if (labelled === 1) {
    await expect(sheet.getByText(/^No plays match these filters/)).toBeVisible();
  } else {
    // Other plays of these games carry the label too.
    await expect.poll(() => eventCount(sheet)).toBe(labelled - 1);
  }
  console.log(`K label filter: ${labelled} play(s) carried "${name}"`);
  await expect(listTriggers(page)).toHaveCount(0);
  // No error from the keys with the picker gone (the page's errors fail the test).
  await page.keyboard.press("Meta+a");

  // Clear the filter: ⌘A ticks every play, so the keys still belong to the sheet.
  await filterByLabel();
  await expect.poll(() => eventCount(sheet), { message: "the filter is off" }).toBe(count);
  await page.keyboard.press("Meta+a");
  await expect(selectionPill(sheet), "⌘A selects every play").toContainText(String(count));
});

test("closing a row's label picker leaves the list where it was", async ({ page }) => {
  const { grid, count } = await openOnFiveGames(page);
  const first = grid.locator('[role=row][aria-rowindex="1"]');
  await first.click();
  await expect(first, "the first play is playing").toHaveAttribute("aria-current", "true");
  await scrollToBottom(grid);
  const scroller = page.locator(GRID).locator("xpath=..");
  const at = await scroller.evaluate((el) => el.scrollTop);
  expect(at, "the list is scrolled away from the playing row").toBeGreaterThan(0);
  const last = page.locator(`${GRID} [role=row][aria-rowindex="${count}"]`);
  await openPicker(page, last);
  await closePicker(page);
  // Two frames, so a scroll on close would have landed.
  await scroller.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  expect(await scroller.evaluate((el) => el.scrollTop), "the list stays where the coach scrolled it").toBe(at);
});
