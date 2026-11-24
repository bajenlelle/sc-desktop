/**
 * Task 5: Add clips closes on a click on the dim scrim (as the game's filters
 * close on a press outside), with Esc or with its Close button, and stays open
 * on a press anywhere else outside; the Fix sync sheet closes on a scrim click; with a
 * sheet open, a childless strip of the title bar's height sits above the scrim:
 * a click on it closes the sheet (the toolbar behind is scrim too), a drag on it
 * moves the window and leaves the sheet open. Real window drag and resize stay
 * manual. Creates "headless-<port>-<slot> sheet" with one clip and deletes it.
 */
import type { Locator, Page } from "@playwright/test";
import { deletePlaylistsNamed, expect, inScratchPage, newPlaylistWithClips, owned, sheetScrimPoint, shot, test } from "../helpers";

const NAME = owned("sheet");

test.beforeEach(async ({ page }) => {
  // A crashed run's playlist, swept in a scratch page so the test's page starts clean.
  await inScratchPage(page, (scratch) => deletePlaylistsNamed(scratch, NAME));
});

test.afterEach(async ({ page }) => {
  await deletePlaylistsNamed(page, NAME);
});

const STRIP = "body > [data-sheet-title-strip]";

/**
 * The open sheet's title strip: one fixed, childless [data-sheet-title-strip]
 * across the top, as tall as --titlebar-inset. On macOS (WebKit's Safari user
 * agent) that is the overlay title bar's 52 px and the strip is on top at its
 * own points; on Windows (Playwright's Desktop Chrome user agent says Windows)
 * the inset is 0 and the strip disappears. Returns its height.
 */
async function expectDragStrip(page: Page) {
  const strip = page.locator(STRIP);
  await expect(strip, "one title strip while a sheet is open").toHaveCount(1);
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

/** The window commands the page sends from here on (the strip's drag is `plugin:window|start_dragging`). */
async function recordWindowCommands(page: Page): Promise<() => Promise<string[]>> {
  await page.evaluate(() => {
    const w = window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string, ...rest: unknown[]) => unknown }; __windowCommands: string[] };
    w.__windowCommands = [];
    const invoke = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = (cmd, ...rest) => {
      if (cmd.startsWith("plugin:window|")) w.__windowCommands.push(cmd);
      return invoke(cmd, ...rest);
    };
  });
  return () => page.evaluate(() => (window as unknown as { __windowCommands: string[] }).__windowCommands);
}

/** Presses the strip, moves 30 px along it and lets go: a window drag. */
async function dragStrip(page: Page, stripHeight: number) {
  const x = page.viewportSize()!.width / 2;
  await page.mouse.move(x, stripHeight / 2);
  await page.mouse.down();
  await page.mouse.move(x + 30, stripHeight / 2, { steps: 6 });
  await page.mouse.up();
}

/** Clicks the dim scrim beside or under the sheet, after checking that is what lies there. */
async function clickScrim(page: Page) {
  const point = await sheetScrimPoint(page);
  const slot = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.getAttribute("data-slot"), point);
  expect(slot, "the click lands on the scrim").toBe("sheet-overlay");
  await page.mouse.click(point.x, point.y);
}

test("Add clips closes on the scrim, a click on the title strip, Esc and Close, and stays open through a drag on the strip; Fix sync too", async ({ page, browserName }) => {
  const name = (step: string) => `${browserName}-B-task5-${step}`;
  const [key] = await newPlaylistWithClips(page, NAME, { count: 1 });
  const addClips = page.getByRole("button", { name: "Add clips", exact: true }).first();
  const sheet = page.getByRole("dialog");
  const heading = sheet.getByRole("heading", { name: "Add clips" });

  await addClips.click();
  await expect(heading).toBeVisible();
  const stripHeight = await expectDragStrip(page);
  await shot(page, name("add-clips-open"));
  if (stripHeight > 0) {
    // A drag on the strip moves the window and leaves the sheet open.
    const windowCommands = await recordWindowCommands(page);
    await dragStrip(page, stripHeight);
    // Nothing should close: give a dismissal the sheet's exit time to show, then look.
    await page.waitForTimeout(600);
    await expect(heading, "Add clips stays open after a drag on the strip").toBeVisible();
    expect(await windowCommands(), "the drag moves the window").toContain("plugin:window|start_dragging");
    // A click on it, over the toolbar behind, closes it.
    await page.mouse.click(page.viewportSize()!.width / 2, stripHeight / 2);
    await expect(heading, "a click on the strip closes Add clips").toBeHidden();
    expect(await windowCommands(), "a click moves nothing").toEqual(["plugin:window|start_dragging"]);
    await addClips.click();
    await expect(heading).toBeVisible();
  }
  // A scrim click closes it, and the strip goes with the sheet.
  await clickScrim(page);
  await expect(heading, "a scrim click closes Add clips").toBeHidden();
  await expect(page.locator(STRIP)).toHaveCount(0);
  await shot(page, name("add-clips-after-scrim"));

  // Esc closes it.
  await addClips.click();
  await expect(heading).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(heading, "Esc closes Add clips").toBeHidden();
  await expect(page.locator(STRIP)).toHaveCount(0);

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
    await dragStrip(page, stripHeight);
    await page.waitForTimeout(600);
    await expect(fixSync, "a drag on the strip leaves Fix sync open").toBeVisible();
    await page.mouse.click(page.viewportSize()!.width / 2, stripHeight / 2);
    await expect(fixSync, "a click on the strip closes Fix sync").toBeHidden();
    await bar.getByRole("button", { name: "Fix sync…" }).click();
    await expect(fixSync).toBeVisible();
  }
  await shot(page, name("fix-sync-open"));
  await clickScrim(page);
  await expect(fixSync, "a scrim click closes Fix sync").toBeHidden();
  await expect(page.locator(STRIP)).toHaveCount(0);
  await shot(page, name("fix-sync-closed"));
});

/** Drags a panel divider `dx` px sideways and returns where it then stands. */
async function dragSeparator(page: Page, sep: Locator, dx: number): Promise<number> {
  await expect(sep).toHaveCount(1);
  const at = (await sep.boundingBox())!;
  const x = at.x + at.width / 2;
  const y = at.y + at.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => Math.abs((await sep.boundingBox())!.x - at.x)).toBeGreaterThan(Math.abs(dx) / 2);
  return (await sep.boundingBox())!.x;
}

test("the editor's split and Add clips' split are kept after a reload", async ({ page }) => {
  await newPlaylistWithClips(page, NAME, { count: 1 });
  // The panel dividers (not the sidebar's): the editor's, and the one inside the sheet.
  const editorSep = page.locator("[data-separator]").first();
  const sheetSep = page.getByRole("dialog").locator("[data-separator]");
  const editorAt = await dragSeparator(page, editorSep, 120);
  const addClips = page.getByRole("button", { name: "Add clips", exact: true }).first();
  await addClips.click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Add clips" })).toBeVisible();
  const sheetAt = await dragSeparator(page, sheetSep, -120);
  await page.keyboard.press("Escape");
  await page.reload();
  await expect.poll(async () => Math.abs(((await editorSep.boundingBox())?.x ?? 0) - editorAt), { timeout: 30_000 }).toBeLessThan(4);
  await addClips.click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Add clips" })).toBeVisible();
  await expect.poll(async () => Math.abs(((await sheetSep.boundingBox())?.x ?? 0) - sheetAt)).toBeLessThan(4);
});
