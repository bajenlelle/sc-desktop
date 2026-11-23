/**
 * The playlist editor's play rows on the shared play row (docs/superpowers/specs/2026-11-21-play-row-design.md):
 * one line, while its text cards keep their own height, and the drag engine and the checkboxes work as before
 * across rows of both heights. Makes the playlist `headless-<port>-<slot> play row editor` and deletes it.
 */
import type { Locator, Page } from "@playwright/test";
import { deletePlaylistsNamed, expect, newPlaylistWithClips, owned, shot, test } from "../helpers";

const NAME = owned("play row editor");
const rows = (page: Page) => page.locator("[role=row][data-row-key]");
const order = (page: Page) => rows(page).evaluateAll((els) => els.map((el) => el.getAttribute("data-row-key")!));
const row = (page: Page, key: string) => page.locator(`[role=row][data-row-key=${JSON.stringify(key)}]`);

test.beforeEach(async ({ page }) => {
  await deletePlaylistsNamed(page, NAME);
});
test.afterEach(async ({ page }) => {
  await deletePlaylistsNamed(page, NAME);
});

/** A text card above the row with this key; returns the card's row key. */
async function cardAbove(page: Page, key: string): Promise<string> {
  const before = new Set(await order(page));
  await row(page, key).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Insert text card above" }).click();
  await expect(rows(page)).toHaveCount(before.size + 1, { timeout: 15_000 });
  await page.keyboard.press("Escape");
  return (await order(page)).find((k) => !before.has(k))!;
}

/** Drags a row by its middle to `dy` pixels below (or above) where it was, in small steps as a hand would. */
async function drag(page: Page, from: Locator, to: { y: number }): Promise<void> {
  const box = (await from.boundingBox())!;
  const x = box.x + box.width * 0.5;
  await page.mouse.move(x, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, box.y + box.height / 2 + 6, { steps: 3 });
  await page.mouse.move(x, to.y, { steps: 12 });
  // Settle before letting go: a release still moving is a flick, which the engine carries one slot further.
  for (let i = 0; i < 4; i++) {
    await page.waitForTimeout(60);
    await page.mouse.move(x, to.y);
  }
  await page.waitForTimeout(120);
  await page.mouse.up();
}

test("a play row is one line and a text card keeps its height", async ({ page, browserName }) => {
  const keys = await newPlaylistWithClips(page, NAME, { count: 3 });
  const card = await cardAbove(page, keys[1]);
  for (const key of keys) expect(Math.round((await row(page, key).boundingBox())!.height), `play row ${key}`).toBe(32);
  expect((await row(page, card).boundingBox())!.height, "the text card").toBeGreaterThanOrEqual(44);
  await row(page, keys[2]).hover();
  await shot(page, `${browserName}-Q-editor-rows`);
});

test("a play row is a row of the editor's grid with its cell", async ({ page }) => {
  const keys = await newPlaylistWithClips(page, NAME, { count: 1 });
  await expect(row(page, keys[0]).getByRole("gridcell")).toHaveCount(1);
});

test("a play row dragged past a text card lands after it", async ({ page }) => {
  const keys = await newPlaylistWithClips(page, NAME, { count: 3 });
  const card = await cardAbove(page, keys[1]);
  expect(await order(page)).toEqual([keys[0], card, keys[1], keys[2]]);
  // Moved down by the card's height, the row stands where the card stood: past it.
  const cardBox = (await row(page, card).boundingBox())!;
  const first = (await row(page, keys[0]).boundingBox())!;
  await drag(page, row(page, keys[0]), { y: first.y + first.height / 2 + cardBox.height + 2 });
  await expect.poll(() => order(page)).toEqual([card, keys[0], keys[1], keys[2]]);
});

test("a group dragged to the top moves whole", async ({ page }) => {
  const keys = await newPlaylistWithClips(page, NAME, { count: 3 });
  await row(page, keys[1]).getByRole("checkbox", { name: "Select" }).click();
  await row(page, keys[2]).getByRole("checkbox", { name: "Select" }).click();
  await row(page, keys[1]).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Group 2 selected items" }).click();
  await page.keyboard.press("Escape");
  const top = (await row(page, keys[0]).boundingBox())!;
  await drag(page, row(page, keys[1]), { y: top.y + 2 });
  await expect.poll(() => order(page)).toEqual([keys[1], keys[2], keys[0]]);
});

test("a checkbox click selects a play row and doesn't play it", async ({ page }) => {
  const keys = await newPlaylistWithClips(page, NAME, { count: 2 });
  await row(page, keys[1]).getByRole("checkbox", { name: "Select" }).click();
  await expect(row(page, keys[1])).toHaveAttribute("aria-selected", "true");
  await expect(row(page, keys[1]).getByLabel("Playing")).toHaveCount(0);
});
