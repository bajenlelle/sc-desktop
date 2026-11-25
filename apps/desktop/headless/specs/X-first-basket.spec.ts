/**
 * Syncing a game whose tip-off isn't in the video (docs/game-view.md, "When
 * the tip-off isn't in the video"): the import's tip-off step sets the first
 * basket the coach can see instead, and the tip-off is worked out from it,
 * before the recording if need be. A hard cut between the two is where the
 * game's footage starts. Nothing is imported: the step is left before Import.
 */
import type { Page } from "@playwright/test";
import { expect, recordAnalytics, shot, test } from "../helpers";

test.use({ viewport: { width: 1280, height: 800 } });

async function openImportWithVideo(page: Page) {
  await page.goto("/upload");
  await expect(page.getByRole("heading", { level: 1, name: "Import game" })).toBeVisible();
  await expect(page.locator('[data-tour="pick"]')).toBeVisible({ timeout: 30_000 });
  const allGames = page.getByRole("tab", { name: "All games" });
  if (await allGames.isVisible()) await allGames.click();
  const row = page.locator('[data-tour="pick"] .max-h-72 button').first();
  await expect(row, "the league has a finished game to pick").toBeVisible({ timeout: 30_000 });
  await row.click();
  await expect(page.getByText(/plays ready to clip\./)).toBeVisible({ timeout: 30_000 });
  await page.locator('[data-tour="video-pick"]').click();
  await expect(page.locator('[data-tour="tipoff-set"]')).toBeEnabled({ timeout: 30_000 });
}

const panel = (page: Page) => page.locator('[data-sync="first-basket"]');

test("the tip-off step can set the first basket instead, and works the tip-off out from it", async ({ page, browserName }) => {
  const tracked = await recordAnalytics(page);
  await openImportWithVideo(page);

  const link = page.locator('[data-sync="first-basket-link"]');
  await expect(link).toHaveText("Tip-off not in the video?");
  // Beside the button that sets the tip-off: where the coach decides.
  const set = await page.locator('[data-tour="tipoff-set"]').boundingBox();
  const at = await link.boundingBox();
  expect(Math.abs(at!.y + at!.height / 2 - (set!.y + set!.height / 2)), "on the set button's row").toBeLessThan(2);
  // Its hover fill covers the whole of it: the words don't run out of the button.
  expect(await link.evaluate((el) => el.scrollWidth - el.clientWidth), "the link's words fit inside it").toBeLessThanOrEqual(0);
  await link.click();
  await expect(page.getByText("Set a basket you can see", { exact: true })).toBeVisible();
  await expect(panel(page), "any of them will do").toContainText("Find one of these baskets in the video and set it.");
  await expect(panel(page), "the basket is named by its score, its player and when it came").toContainText(/s after the tip-off/);
  await expect(panel(page).locator('[data-sync="first-basket-score"]')).toHaveText(/^\d+–\d+$/);
  await expect(panel(page)).toContainText(/^.*1 of \d+/);
  await page.waitForTimeout(400);
  await shot(page, `${browserName}-X-first-basket`);
  await page.locator('[data-tour="tipoff-set"]').scrollIntoViewIfNeeded();
  await shot(page, `${browserName}-X-first-basket-set-row`);

  // Not in the footage either: the next one, and back.
  await panel(page).getByRole("button", { name: "Later basket" }).click();
  await expect(panel(page)).toContainText(/2 of \d+/);
  await panel(page).getByRole("button", { name: "Earlier basket" }).click();
  await expect(panel(page)).toContainText(/1 of \d+/);

  // The basket is in the recording's first frame: the tip-off was before the recording started.
  const after = Number(((await panel(page).textContent()) ?? "").match(/(\d+) s after the tip-off/)![1]);
  await page.locator('[data-tour="tipoff-set"]').click();
  // The quarters' list has the tip-off, before the recording (the short test video reads as one that skips the
  // breaks, so the picker goes on to Q2).
  const q1 = page.getByRole("button", { name: new RegExp(`^Q1 Tip-off Set at −0:${String(after).padStart(2, "0")}\\.0$`) });
  await expect(q1, "the tip-off, before the recording").toBeVisible();
  await expect
    .poll(async () => (await tracked()).find((e) => e.event === "sync_first_basket_set")?.properties)
    .toMatchObject({ surface: "import", basket: 1, footage_start: false });
  expect((await tracked()).find((e) => e.event === "sync_first_basket_opened")?.properties).toMatchObject({ surface: "import", from: "link" });

  // Back on Q1 the basket is where it was set; Use the tip-off goes back to the tip-off.
  await q1.click();
  await expect(page.getByRole("status").filter({ hasText: "Basket set at" })).toContainText("0:00.0");
  await page.locator('[data-sync="tipoff-link"]').click();
  await expect(page.getByText("Set the tip-off", { exact: true })).toBeVisible();
});

test("a hard cut between the tip-off and the basket is where the game's footage starts", async ({ page }) => {
  const tracked = await recordAnalytics(page);
  await openImportWithVideo(page);
  // The recording jumps into the game 12 s in (the warm-up before it, the tip-off lost).
  await page.evaluate(() => (window.__headlessCuts = [12]));
  await page.locator('[data-sync="first-basket-link"]').click();
  await expect(panel(page)).toContainText(/s after the tip-off/);
  const after = Number(((await panel(page).textContent()) ?? "").match(/(\d+) s after the tip-off/)![1]);
  // The basket 30 s into the recording puts the tip-off before the cut (if the feed has it more than 18 s after).
  test.skip(after <= 20, "this game's first basket came too soon after the tip-off for the cut to lie between them");
  await page.getByRole("button", { name: "Forward 10 seconds" }).click();
  await page.getByRole("button", { name: "Forward 10 seconds" }).click();
  await page.getByRole("button", { name: "Forward 10 seconds" }).click();
  await page.locator('[data-tour="tipoff-set"]').click();
  await expect
    .poll(async () => (await tracked()).find((e) => e.event === "sync_first_basket_set")?.properties)
    .toMatchObject({ surface: "import", footage_start: true });
});
