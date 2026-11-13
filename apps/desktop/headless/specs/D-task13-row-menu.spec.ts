/**
 * Group D, Task 13: a play goes to any playlist from its row's menu, and
 * "Adding to" doesn't change. Makes two playlists of its own through the
 * game view's picker (`headless-<port> target`, `headless-<port> other`) and
 * deletes them at the end, however the test ends.
 */
import {
  chooseNewTarget,
  deletePlaylistsNamed,
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
const OTHER = owned("other");

test.afterEach(async ({ page }) => {
  await deletePlaylistsNamed(page, [TARGET, OTHER]);
});

test("a row's menu adds to the target or once to another playlist", async ({ page, browserName }) => {
  const name = (step: string) => `${browserName}-D-task13-${step}`;
  await page.goto("/matches");
  // A run that died before its cleanup leaves these behind; they are this spec's own.
  await deletePlaylistsNamed(page, [TARGET, OTHER]);

  const game = await openLibraryGame(page, 0);
  await showGameView(page);

  // Both made through the picker; the last one made is the target.
  await chooseNewTarget(page, OTHER);
  await chooseNewTarget(page, TARGET);
  const adding = page.getByRole("button", { name: `Adding to ${TARGET}. Change playlist` });
  await expect(adding).toBeVisible();
  await expect(adding).toContainText("0");

  // Unshared playlists hold nothing for players: "Open playlist", no Send.
  await expect(page.getByRole("button", { name: "Open playlist" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Send \d+ clips?…/ })).toHaveCount(0);
  await shot(page, name("toolbar"));

  // Right-click a play: the target first, then the other playlists.
  const rows = playRows(page);
  const first = rows.nth(0);
  await first.click({ button: "right" });
  const menu = page.getByRole("menu").first();
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem").first()).toHaveText(`Add to ${TARGET}`);
  const another = menu.getByRole("menuitem", { name: "Add to another playlist" });
  await expect(another).toBeVisible();
  await another.click();
  const sub = page.getByRole("menu").nth(1);
  await expect(sub.getByRole("menuitem", { name: OTHER, exact: true })).toBeVisible();
  // The target isn't offered again under "another playlist".
  await expect(sub.getByRole("menuitem", { name: TARGET, exact: true })).toHaveCount(0);
  await shot(page, name("menu"));
  await sub.getByRole("menuitem", { name: OTHER, exact: true }).click();

  // "Added to other" with Undo; "Adding to" still names the target, with nothing in it.
  const toast = page.locator("[data-sonner-toast]").filter({ hasText: `Added to ${OTHER}` });
  await expect(toast).toBeVisible();
  await expect(toast.getByRole("button", { name: "Undo" })).toBeVisible();
  await expect(adding).toBeVisible();
  await expect(adding).toContainText("0");
  // The row's mark is about the target: it still offers the add, and no row is checked.
  await expect(first.getByRole("button", { name: `Add to ${TARGET}`, exact: true })).toBeAttached();
  await expect(page.getByRole("button", { name: `In ${TARGET}. Remove`, exact: true })).toHaveCount(0);
  await shot(page, name("added-to-other"));
  const firstKey = (await first.getAttribute("data-row-key"))!;
  const firstEvent = Number(firstKey.slice(firstKey.lastIndexOf(":") + 1));
  await expect.poll(() => playlistClips(page, OTHER), { message: "the other playlist holds the play" }).toEqual([
    { matchId: game.id, eventId: firstEvent },
  ]);
  await expect.poll(() => playlistClips(page, TARGET), { message: "the target holds nothing" }).toEqual([]);

  // Undo takes it out of the other playlist again.
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: `Removed from ${OTHER}` })).toBeVisible();
  await expect.poll(() => playlistClips(page, OTHER), { message: "Undo emptied the other playlist" }).toEqual([]);

  // The menu's first item adds to the target: the row gets its check and the count goes to 1.
  const second = rows.nth(1);
  await second.click({ button: "right" });
  await page.getByRole("menu").first().getByRole("menuitem", { name: `Add to ${TARGET}`, exact: true }).click();
  await expect(second.getByRole("button", { name: `In ${TARGET}. Remove`, exact: true })).toBeVisible();
  await expect(adding).toContainText("1");
  // Right-clicked again, the item says the play is in already.
  await second.click({ button: "right" });
  await expect(page.getByRole("menu").first().getByRole("menuitem").first()).toHaveText(`In ${TARGET}`);
  await expect(page.getByRole("menu").first().getByRole("menuitem").first()).toHaveAttribute("data-disabled", "");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await shot(page, name("added-to-target"));

  // A timeout marker and a quarter header open no menu.
  const marker = page.getByRole("list", { name: "Plays" }).locator('button[data-row-key^="timeout:"]').first();
  await expect(marker, "the first game has a timeout on record").toBeAttached();
  await marker.scrollIntoViewIfNeeded();
  await marker.click({ button: "right" });
  await page.waitForTimeout(400);
  await expect(page.getByRole("menu")).toHaveCount(0);
  await shot(page, name("marker-no-menu"));
  const header = page.getByRole("list", { name: "Plays" }).locator('[data-row-key^="period:"]').first();
  await header.click({ button: "right" });
  await page.waitForTimeout(400);
  await expect(page.getByRole("menu")).toHaveCount(0);
});
