/**
 * Task 5: Add clips stays open on a click on the dim scrim and closes with Esc
 * or its Close button; the Fix sync sheet still closes on a scrim click; with a
 * sheet open, a childless drag strip of the title bar's height sits above the
 * scrim, and a press on it never dismisses a sheet. Real window drag and resize
 * stay manual. Creates "headless-<port> sheet" with one clip and deletes it.
 */
import type { Page } from "@playwright/test";
import { deletePlaylistsNamed, expect, inScratchPage, newPlaylistWithClips, PORT, sheetScrimPoint, shot, test } from "../helpers";

const NAME = `headless-${PORT} sheet`;

test.beforeEach(async ({ page }) => {
  // A crashed run's playlist, swept in a scratch page so the test's page starts clean.
  await inScratchPage(page, (scratch) => deletePlaylistsNamed(scratch, NAME));
});

test.afterEach(async ({ page }) => {
  await deletePlaylistsNamed(page, NAME);
});

/**
 * The open sheet's drag strip: one fixed, childless [data-tauri-drag-region]
 * across the top, as tall as --titlebar-inset. On macOS (WebKit's Safari user
 * agent) that is the overlay title bar's 52 px and the strip is on top at its
 * own points; on Windows (Playwright's Desktop Chrome user agent says Windows)
 * the inset is 0 and the strip disappears. Returns its height.
 */
async function expectDragStrip(page: Page) {
  const strip = page.locator("body > [data-tauri-drag-region][aria-hidden]");
  await expect(strip, "one drag strip while a sheet is open").toHaveCount(1);
  const viewport = page.viewportSize()!;
  const facts = await strip.evaluate((el, width) => {
    const style = getComputedStyle(el);
    const inset = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--titlebar-inset")) *
      (getComputedStyle(document.documentElement).getPropertyValue("--titlebar-inset").trim().endsWith("rem")
        ? parseFloat(getComputedStyle(document.documentElement).fontSize)
        : 1);
    const box = el.getBoundingClientRect();
    return {
      platform: document.documentElement.dataset.platform,
      position: style.position,
      pointerEvents: style.pointerEvents,
      top: box.top,
      width: box.width,
      height: box.height,
      inset,
      children: el.childElementCount,
      onTop: document.elementFromPoint(width / 2, Math.max(1, box.height / 2)) === el,
    };
  }, viewport.width);
  expect(facts).toMatchObject({ position: "fixed", pointerEvents: "auto", top: 0, width: viewport.width, children: 0 });
  expect(facts.height, "the strip is the title bar's height").toBeCloseTo(facts.inset, 0);
  if (facts.platform === "macos") {
    expect(facts.inset, "macOS has an overlay title bar").toBeGreaterThan(0);
    expect(facts.onTop, "the strip is above the scrim").toBe(true);
  } else {
    expect(facts.platform).toBe("windows");
    expect(facts.height, "no strip on Windows").toBe(0);
  }
  return facts.height;
}

/** Clicks the dim scrim beside or under the sheet, after checking that is what lies there. */
async function clickScrim(page: Page) {
  const point = await sheetScrimPoint(page);
  const slot = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.getAttribute("data-slot"), point);
  expect(slot, "the click lands on the scrim").toBe("sheet-overlay");
  await page.mouse.click(point.x, point.y);
}

test("Add clips stays open on the scrim and the strip; Esc and Close close it; Fix sync still closes on the scrim", async ({ page, browserName }) => {
  const name = (step: string) => `${browserName}-B-task5-${step}`;
  const [key] = await newPlaylistWithClips(page, NAME, { count: 1 });
  const addClips = page.getByRole("button", { name: "Add clips", exact: true }).first();
  const sheet = page.getByRole("dialog");
  const heading = sheet.getByRole("heading", { name: "Add clips" });

  // Manual check (3): a scrim click leaves Add clips open.
  await addClips.click();
  await expect(heading).toBeVisible();
  const stripHeight = await expectDragStrip(page);
  await shot(page, name("add-clips-open"));
  await clickScrim(page);
  // Nothing should happen: give a dismissal the sheet's exit time to show, then look.
  await page.waitForTimeout(600);
  await expect(heading, "Add clips stays open after a scrim click").toBeVisible();
  // A press on the drag strip (where the window drag starts in the app) doesn't close it either.
  if (stripHeight > 0) {
    await page.mouse.click(page.viewportSize()!.width / 2, stripHeight / 2);
    await page.waitForTimeout(600);
    await expect(heading, "Add clips stays open after a press on the drag strip").toBeVisible();
  }
  await shot(page, name("add-clips-after-scrim"));

  // Esc closes it, and the strip goes with the sheet.
  await page.keyboard.press("Escape");
  await expect(heading, "Esc closes Add clips").toBeHidden();
  await expect(page.locator("body > [data-tauri-drag-region][aria-hidden]")).toHaveCount(0);

  // Its Close button closes it.
  await addClips.click();
  await expect(heading).toBeVisible();
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(heading, "Close closes Add clips").toBeHidden();
  await shot(page, name("add-clips-closed"));

  // Manual check (5), the part the harness reaches: Fix sync from the This clip bar.
  await page.locator(`[role=row][data-row-key="${key}"]`).click();
  const bar = page.getByText("This clip", { exact: true }).locator("..");
  await bar.getByRole("button", { name: "Fix sync…" }).click();
  const fixSync = sheet.getByRole("heading", { name: "Fix sync" });
  await expect(fixSync).toBeVisible();
  await expectDragStrip(page);
  if (stripHeight > 0) {
    await page.mouse.click(page.viewportSize()!.width / 2, stripHeight / 2);
    await page.waitForTimeout(600);
    await expect(fixSync, "a press on the drag strip leaves Fix sync open").toBeVisible();
  }
  await shot(page, name("fix-sync-open"));
  await clickScrim(page);
  await expect(fixSync, "a scrim click closes Fix sync").toBeHidden();
  await expect(page.locator("body > [data-tauri-drag-region][aria-hidden]")).toHaveCount(0);
  await shot(page, name("fix-sync-closed"));
});
