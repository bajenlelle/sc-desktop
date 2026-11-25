/**
 * The window sidebar's edge drags it wider or narrower (lib/use-column-resize.ts): clamped to 180–360, kept
 * across a reload. A click on the edge hides it and brings it back at its width; dragged shut, it comes back at
 * 220. Hidden, its edge is the window's left edge, lit blue under the pointer. The playlist browser's edge, an
 * inner divider, lights up gray and still resizes. Reads only; creates nothing.
 */
import type { Page } from "@playwright/test";
import { expect, goViaSidebar, shot, test } from "../helpers";

const aside = (page: Page) => page.locator("aside").first();
const edge = (page: Page) => page.getByRole("separator", { name: /^(Hide|Show) sidebar$/ });
const browserEdge = (page: Page) => page.getByRole("separator", { name: "Resize the playlist browser" });
const widthOf = async (page: Page) => Math.round((await aside(page).boundingBox())!.width);
const lineOf = (separator: ReturnType<typeof edge>) => separator.locator("[data-edge-line]");

/** Drags a separator's middle by `dx` in steps, holding still before letting go (a moving release is a flick). */
async function dragBy(page: Page, separator: ReturnType<typeof edge>, dx: number, { hold = true } = {}) {
  const box = (await separator.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(x + (dx * i) / 10, y);
    await page.waitForTimeout(16);
  }
  if (hold) await page.waitForTimeout(200);
  await page.mouse.up();
}

test("the sidebar's edge resizes it, within its limits, and the width stays", async ({ page, browserName }) => {
  await goViaSidebar(page, "Games");
  await expect.poll(() => widthOf(page), { message: "220 by default" }).toBe(220);

  // Hovered, the edge shows a blue line.
  await edge(page).hover();
  await expect.poll(() => lineOf(edge(page)).evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
  const blue = await lineOf(edge(page)).evaluate((el) => getComputedStyle(el).backgroundColor);
  await shot(page, `${browserName}-F-sidebar-resize-hover`);

  await dragBy(page, edge(page), 80);
  await expect.poll(() => widthOf(page), { message: "follows the drag" }).toBe(300);

  await dragBy(page, edge(page), 400);
  await expect.poll(() => widthOf(page), { message: "no wider than 360" }).toBe(360);

  await page.reload();
  await expect(edge(page)).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => widthOf(page), { message: "kept across a reload" }).toBe(360);

  // A slow pull to just under the minimum settles at the minimum.
  await dragBy(page, edge(page), -200);
  await expect.poll(() => widthOf(page), { message: "no narrower than 180" }).toBe(180);

  // The keys move it too.
  await edge(page).focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => widthOf(page)).toBe(196);
  await page.keyboard.press("ArrowLeft");
  await expect.poll(() => widthOf(page)).toBe(180);
  await dragBy(page, edge(page), 40);
  await expect.poll(() => widthOf(page)).toBe(220);

  // The playlist browser's edge is an inner divider: gray, not the sidebar's blue, and it still resizes.
  await goViaSidebar(page, "Playlists");
  await expect(browserEdge(page)).toBeVisible({ timeout: 30_000 });
  await browserEdge(page).hover();
  await expect.poll(() => lineOf(browserEdge(page)).evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
  const gray = await lineOf(browserEdge(page)).evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(gray, "the browser's edge isn't the accent").not.toBe(blue);
  await shot(page, `${browserName}-F-sidebar-resize-browser-hover`);
  const before = Number(await browserEdge(page).getAttribute("aria-valuenow"));
  await dragBy(page, browserEdge(page), 40);
  await expect.poll(async () => Number(await browserEdge(page).getAttribute("aria-valuenow"))).toBe(before + 40);
  await dragBy(page, browserEdge(page), -40);
});

test("a click on the edge hides the sidebar and brings it back at its width; dragged shut, it comes back at 220", async ({ page, browserName }) => {
  await goViaSidebar(page, "Games");
  await dragBy(page, edge(page), 40);
  await expect.poll(() => widthOf(page)).toBe(260);

  // A click hides it, keeping the width.
  await edge(page).click();
  await expect.poll(() => widthOf(page), { message: "hidden by a click" }).toBeLessThanOrEqual(1);
  await expect(edge(page)).toHaveAttribute("aria-label", "Show sidebar");

  // Hidden, its edge is the window's left edge, lit blue under the pointer.
  await page.mouse.move(2, 450);
  await expect.poll(() => lineOf(edge(page)).evaluate((el) => getComputedStyle(el).opacity), { message: "the line shows near the window's edge" }).toBe("1");
  const box = (await lineOf(edge(page)).boundingBox())!;
  expect(box.x, "the line is at the window's left edge").toBeLessThanOrEqual(1);
  await shot(page, `${browserName}-F-sidebar-resize-hidden-hover`);

  await edge(page).click();
  await expect.poll(() => widthOf(page), { message: "a click brings it back at the width it had" }).toBe(260);

  // The keyboard: Return hides and shows it.
  await edge(page).focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => widthOf(page)).toBeLessThanOrEqual(1);
  await page.keyboard.press("Enter");
  await expect.poll(() => widthOf(page)).toBe(260);

  // Dragged shut, it comes back at the default width, by the edge or by the toolbar.
  await dragBy(page, edge(page), -240, { hold: false });
  await expect.poll(() => widthOf(page), { message: "hidden by a flick" }).toBeLessThanOrEqual(1);
  await page.locator("header").getByRole("button", { name: "Show sidebar" }).click();
  await expect.poll(() => widthOf(page), { message: "back at 220" }).toBe(220);

  // Hidden, a pull on the window's edge brings it out to where it is pulled.
  await edge(page).click();
  await expect.poll(() => widthOf(page)).toBeLessThanOrEqual(1);
  await dragBy(page, edge(page), 280);
  await expect.poll(() => widthOf(page), { message: "pulled out to 284" }).toBeGreaterThanOrEqual(280);
  await edge(page).focus();
  for (let i = 0; i < 8; i++) await page.keyboard.press("ArrowLeft");
  await expect.poll(() => widthOf(page)).toBe(180);
  await dragBy(page, edge(page), 40);
  await expect.poll(() => widthOf(page)).toBe(220);
});
