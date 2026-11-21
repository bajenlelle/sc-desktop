/**
 * A press anywhere outside closes what is open on top of a page, the window's
 * title zone included. In the real app a press on the title bar
 * or a toolbar's empty part starts a window drag and the page never sees the
 * click it would have closed on; `emulateWindowDragRegions` reproduces that.
 * Reads only.
 */
import type { Page } from "@playwright/test";
import { emulateWindowDragRegions, expect, goViaSidebar, openLibraryGame, showGameView, test } from "../helpers";

const heading = (page: Page) => page.getByRole("heading", { level: 1 });
const filterButton = (page: Page) => page.getByRole("button", { name: /^Filters/ });
const filterPanel = (page: Page) => page.getByRole("dialog").filter({ has: page.getByPlaceholder("Player name or number") });
const searchPanel = (page: Page) => page.getByRole("dialog", { name: "Search", exact: true });

/** The middle of the drag region under a point, after checking that a drag region is what lies there. */
async function pressDragRegion(page: Page, at: { x: number; y: number }, what: string): Promise<void> {
  const isRegion = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.hasAttribute("data-tauri-drag-region") ?? false, at);
  expect(isRegion, `${what} is a window drag region`).toBe(true);
  await page.mouse.click(at.x, at.y);
}

test("the game's filter closes on a press on the title zone: the toolbar and the sidebar's top", async ({ page }) => {
  await emulateWindowDragRegions(page);
  await openLibraryGame(page, 0);
  await showGameView(page);

  const title = (await heading(page).boundingBox())!;
  const spots: [string, { x: number; y: number }][] = [
    ["the toolbar's title", { x: title.x + title.width / 2, y: title.y + title.height / 2 }],
    ["the toolbar beside the title", { x: title.x + title.width + 60, y: title.y + title.height / 2 }],
  ];
  // The sidebar's top strip is the title bar's height: there only where the title bar lies over the page (macOS).
  const strip = await page.locator("aside [data-tauri-drag-region]").first().boundingBox();
  if (strip && strip.height >= 16) spots.push(["the sidebar's top strip", { x: strip.x + strip.width / 2, y: strip.y + strip.height / 2 }]);
  for (const [what, at] of spots) {
    await filterButton(page).click();
    await expect(filterPanel(page)).toBeVisible();
    await pressDragRegion(page, at, what);
    await expect(filterPanel(page), `a press on ${what} closes the filter`).toBeHidden();
  }

  // And anywhere else still does: the footage.
  await filterButton(page).click();
  await expect(filterPanel(page)).toBeVisible();
  const stage = (await page.getByRole("region", { name: "Game timeline" }).boundingBox())!;
  await page.mouse.click(stage.x + stage.width / 2, stage.y - 200);
  await expect(filterPanel(page)).toBeHidden();
});

test("the search closes on a press on the window's title strip", async ({ page }) => {
  await emulateWindowDragRegions(page);
  await goViaSidebar(page, "Games");
  await expect(heading(page)).toHaveText("Games", { timeout: 30_000 });
  await page.locator("aside").getByRole("button", { name: "Search", exact: true }).click();
  await expect(searchPanel(page)).toBeVisible();
  // The strip is the title bar's height, kept so the window can be moved with the panel open.
  const strip = await page.locator("body > [data-tauri-drag-region][aria-hidden]").boundingBox();
  test.skip(!strip || strip.height < 8, "no title bar lies over the page on this platform, so there is no strip to press");
  await pressDragRegion(page, { x: strip!.x + strip!.width / 2, y: strip!.y + strip!.height / 2 }, "the title strip over the scrim");
  await expect(searchPanel(page)).toBeHidden();
});
