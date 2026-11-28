/**
 * Group D, Task 14: several plays picked in the game view's list go to a
 * playlist at once. ⌘-click toggles (Meta in both browsers: the row reads
 * `metaKey || ctrlKey`, and Control-click is the context menu on macOS),
 * Shift+↓ extends and plays, ⌘A selects the listed plays, Esc clears.
 * Makes its own target, `headless-<port>-<slot> target`, and deletes it at the end.
 */
import type { Page } from "@playwright/test";
import {
  addingCount,
  chooseNewTarget,
  deleteOwnedPlaylists,
  expect,
  openLibraryGame,
  owned,
  playlistClips,
  playRows,
  shot,
  showGameView,
  test,
} from "../helpers";

const TARGET = owned("target");

const selectedRows = (page: Page) => page.getByRole("list", { name: "Plays" }).locator("[data-selected]");
/** The selection's bar: the count line over the list while plays are selected. */
const pill = (page: Page) => page.getByRole("toolbar", { name: "Selection" });
/** The bar's count: "3 selected". */
const pillCount = (page: Page) => pill(page).getByRole("status");

test.afterEach(async ({ page }) => {
  await deleteOwnedPlaylists(page, [TARGET]);
});

test("pick plays with ⌘, Shift and ⌘A, and add them in one go", async ({ page, browserName }) => {
  const name = (step: string) => `${browserName}-D-task14-${step}`;
  await page.goto("/matches");
  await deleteOwnedPlaylists(page, [TARGET]);
  const game = await openLibraryGame(page, 0);
  await showGameView(page);
  await chooseNewTarget(page, TARGET);
  const rows = playRows(page);

  // ⌘-click three plays: three rows selected, the pill counts them and offers the target.
  const picked = [rows.nth(1), rows.nth(3), rows.nth(5)];
  for (const row of picked) await row.click({ modifiers: ["Meta"] });
  await expect(selectedRows(page)).toHaveCount(3);
  for (const row of picked) await expect(row).toHaveAttribute("data-selected", "true");
  await expect(pill(page)).toBeVisible();
  // The bar says how many and what Add does; in a list this narrow "Add 3" keeps its words, the rest their icons.
  await expect(pillCount(page)).toHaveText("3 selected");
  const addSelected = pill(page).getByRole("button", { name: `Add 3 plays to ${TARGET}` });
  await expect(addSelected).toBeVisible();
  await expect(addSelected).toContainText("Add 3");
  await expect(pill(page).getByRole("button", { name: "Add to…" })).toBeVisible();
  // The select-all check says some are selected.
  await expect(page.getByRole("checkbox", { name: /^Select all \d+$/ })).toHaveAttribute("aria-checked", "mixed");
  await shot(page, name("pill-narrow"));
  // A wider window with the sidebar hidden gives the list room for the target's name too.
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.getByRole("button", { name: "Hide sidebar" }).click();
  await expect(addSelected).toContainText(`to ${TARGET}`);
  await expect(pill(page).getByText("Add to…")).toBeVisible();
  await page.getByRole("button", { name: "Show sidebar" }).click();
  await page.setViewportSize({ width: 1440, height: 900 });
  // A plain click plays a play and leaves the picked ones picked.
  await rows.nth(9).click();
  await expect(rows.nth(9)).toHaveAttribute("aria-current", "true");
  await expect(selectedRows(page)).toHaveCount(3);
  // ⌘-click toggles: a fourth on and off again.
  await rows.nth(7).click({ modifiers: ["Meta"] });
  await expect(selectedRows(page)).toHaveCount(4);
  await rows.nth(7).click({ modifiers: ["Meta"] });
  await expect(selectedRows(page)).toHaveCount(3);
  await shot(page, name("three-selected"));

  // A right-click on a selected row acts on the whole selection.
  await picked[1].click({ button: "right" });
  await expect(page.getByRole("menu").first().getByRole("menuitem").first()).toHaveText(`Add 3 plays to ${TARGET}`);
  await shot(page, name("menu-on-selection"));
  // Escape closes the menu first; the selection stays.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(selectedRows(page)).toHaveCount(3);

  // The pill's add: three checks, and the selection clears.
  const keys = await Promise.all(picked.map((r) => r.getAttribute("data-row-key")));
  await addSelected.click();
  for (const row of picked) await expect(row.getByRole("button", { name: `In ${TARGET}. Remove`, exact: true })).toBeVisible();
  await expect(selectedRows(page)).toHaveCount(0);
  await expect(pill(page)).toHaveCount(0);
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: `3 clips added to ${TARGET}` })).toBeVisible();
  await expect(addingCount(page, TARGET)).toHaveText("3");
  await expect
    .poll(async () => (await playlistClips(page, TARGET))?.map((c) => `${c.matchId}:${c.eventId}`), { message: "the three plays are in the target, in list order", timeout: 15_000 })
    .toEqual(keys);
  expect(keys.every((k) => k!.startsWith(`${game.id}:`))).toBe(true);
  await shot(page, name("three-added"));

  // Shift+↓ four times from the play that is playing: five selected, and the current row follows the last.
  const start = rows.nth(10);
  await start.click();
  await expect(start).toHaveAttribute("aria-current", "true");
  for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+ArrowDown");
  await expect(selectedRows(page)).toHaveCount(5);
  for (let i = 10; i <= 14; i++) await expect(rows.nth(i)).toHaveAttribute("data-selected", "true");
  await expect(rows.nth(14)).toHaveAttribute("aria-current", "true");
  await expect(pillCount(page)).toHaveText("5 selected");
  await shot(page, name("shift-down"));

  // Esc clears.
  await page.keyboard.press("Escape");
  await expect(selectedRows(page)).toHaveCount(0);
  await expect(pill(page)).toHaveCount(0);

  // The row's check, under the pointer: a press selects without ⌘, and every row then shows its box.
  await rows.nth(7).hover();
  const check = rows.nth(7).locator("[data-row-check]");
  await expect(check).toBeVisible();
  await check.click();
  await expect(rows.nth(7)).toHaveAttribute("data-selected", "true");
  await expect(rows.nth(8).locator('[data-row-check="off"]'), "selecting: the other rows show an empty box").toBeVisible();
  await shot(page, name("check"));
  await rows.nth(7).locator("[data-row-check]").click();
  await expect(selectedRows(page)).toHaveCount(0);

  // ⌘A with one team's plays listed selects exactly the listed plays the target doesn't have yet.
  const total = await rows.count();
  const teams = page.getByRole("radiogroup", { name: "Team" }).getByRole("radio");
  await teams.nth(1).click();
  await expect(teams.nth(1)).toHaveAttribute("aria-checked", "true");
  await expect.poll(() => rows.count()).toBeLessThan(total);
  const listed = await rows.count();
  expect(listed).toBeGreaterThan(0);
  await rows.first().click();
  const inTarget = await rows.filter({ has: page.locator(`[aria-label^="In ${TARGET}"], [aria-label="Already in ${TARGET}"]`) }).count();
  await page.keyboard.press("Meta+A");
  await expect(selectedRows(page)).toHaveCount(listed - inTarget);
  await expect(pillCount(page)).toHaveText(`${listed - inTarget} selected`);
  await expect(page.getByRole("checkbox", { name: "Deselect all" })).toHaveAttribute("aria-checked", "true");
  await shot(page, name("select-all-filtered"));
  // Another team listed: the hidden plays leave the selection.
  await teams.nth(2).click();
  await expect(teams.nth(2)).toHaveAttribute("aria-checked", "true");
  await expect(selectedRows(page)).toHaveCount(0);
  await expect(pill(page)).toHaveCount(0);
  await teams.nth(0).click();
  await expect.poll(() => rows.count()).toBe(total);

  // The select-all check: every listed play the target can take, and again lets them all go.
  await rows.nth(2).click();
  await page.getByRole("checkbox", { name: /^Select all \d+$/ }).click();
  await expect(pill(page)).toBeVisible();
  await page.getByRole("checkbox", { name: "Deselect all" }).click();
  await expect(pill(page)).toHaveCount(0);
});
