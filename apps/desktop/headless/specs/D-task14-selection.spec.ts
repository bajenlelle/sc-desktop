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
const pill = (page: Page) => page.getByRole("toolbar", { name: "Selection" });
/** The pill's count on its own: the number, then its "selected" (hidden on a narrow list, still in the text). */
const pillCount = (page: Page) => pill(page).locator("span.nums").first();

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
  // At 1440 wide with the sidebar shown the list is under 30rem, so the pill shows its icons only
  // (PILL_LABEL is `@min-[30rem]`): the buttons are named by their titles.
  await expect(pillCount(page)).toHaveText(/^3\s*selected$/);
  await expect(pill(page).getByRole("button", { name: `Add 3 plays to ${TARGET}` })).toBeVisible();
  const addSelected = pill(page).locator(`[title="Add 3 plays to ${TARGET}"]`);
  await expect(pill(page).getByRole("button", { name: "Add to another playlist" })).toBeVisible();
  await shot(page, name("pill-narrow"));
  // A wider window with the sidebar hidden gives the list room for the words: "3 selected", "Add to {target}",
  // "Another playlist" (at 1440 without the sidebar it would clear 30rem by a few pixels only).
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.getByRole("button", { name: "Hide sidebar" }).click();
  await expect(pill(page).getByText("selected")).toBeVisible();
  await expect(addSelected).toHaveText(`Add to ${TARGET}`);
  await expect(pill(page).getByRole("button", { name: `Add to ${TARGET}`, exact: true })).toBeVisible();
  await expect(pill(page).getByText("Another playlist")).toBeVisible();
  await page.getByRole("button", { name: "Show sidebar" }).click();
  await page.setViewportSize({ width: 1440, height: 900 });
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
    .poll(async () => (await playlistClips(page, TARGET))?.map((c) => `${c.matchId}:${c.eventId}`), { message: "the three plays are in the target, in list order" })
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
  await expect(pillCount(page)).toHaveText(/^5\s*selected$/);
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

  // ⌘A with one team's plays listed selects exactly the listed plays.
  const total = await rows.count();
  const teams = page.getByRole("radiogroup", { name: "Team" }).getByRole("radio");
  await teams.nth(1).click();
  await expect(teams.nth(1)).toHaveAttribute("aria-checked", "true");
  await expect.poll(() => rows.count()).toBeLessThan(total);
  const listed = await rows.count();
  expect(listed).toBeGreaterThan(0);
  await rows.first().click();
  await page.keyboard.press("Meta+A");
  await expect(selectedRows(page)).toHaveCount(listed);
  await expect(pillCount(page)).toHaveText(new RegExp(`^${listed}\\s*selected$`));
  await shot(page, name("select-all-filtered"));
  // Another team listed: the hidden plays leave the selection.
  await teams.nth(2).click();
  await expect(teams.nth(2)).toHaveAttribute("aria-checked", "true");
  await expect(selectedRows(page)).toHaveCount(0);
  await expect(pill(page)).toHaveCount(0);
  await teams.nth(0).click();
  await expect.poll(() => rows.count()).toBe(total);

  // With a selection, the list scrolled away from the current play: "Jump to now" sits above the pill.
  await rows.nth(2).click();
  await expect(rows.nth(2)).toHaveAttribute("aria-current", "true");
  await rows.nth(4).click({ modifiers: ["Meta"] });
  await expect(pill(page)).toBeVisible();
  await page.waitForTimeout(800); // past the list's own-scroll grace after the click
  const scroller = page.getByRole("list", { name: "Plays" });
  await scroller.evaluate((el) => el.scrollTo({ top: el.scrollHeight / 2 }));
  const jump = page.getByRole("button", { name: "Jump to now" });
  await expect(jump).toBeVisible();
  await page.waitForTimeout(500); // both pills risen
  const jumpBox = (await jump.boundingBox())!;
  const pillBox = (await pill(page).boundingBox())!;
  expect(jumpBox.y + jumpBox.height, "Jump to now ends above the selection pill").toBeLessThanOrEqual(pillBox.y);
  await shot(page, name("jump-above-pill"));
  await page.keyboard.press("Escape");
  await expect(pill(page)).toHaveCount(0);
});
