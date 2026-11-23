/**
 * The Filter menu every list of plays has (components/plays/filter-menu.tsx), on the game view: fields first,
 * each opening a page of values with checkmarks; one search that finds values across every field; ← or Backspace
 * and Esc going back, then closing; a token opening its field's page. Reads only.
 */
import type { Page } from "@playwright/test";
import {
  closeFilters,
  expect,
  filterList,
  filterPopover,
  filterSearch,
  filterToken,
  FIXTURE_VIDEO,
  openFilters,
  openLibraryGame,
  patchGameReads,
  shot,
  showGameView,
  test,
} from "../helpers";

async function gameView(page: Page): Promise<void> {
  await patchGameReads(page, { videoUrl: FIXTURE_VIDEO });
  await page.goto("/matches");
  await openLibraryGame(page, 0);
  await showGameView(page);
}

const count = (page: Page) => page.getByRole("status").filter({ hasText: /^\d+( of \d+)? plays?$/ });

test("the menu lists its fields; a field's page has its values, and a value goes on at once and stays on", { tag: "@smoke" }, async ({ page, browserName }) => {
  await gameView(page);
  const all = await count(page).innerText();
  const menu = await openFilters(page);
  const fields = await filterList(menu).getByRole("option").evaluateAll((os) => os.map((o) => o.getAttribute("aria-label")));
  expect(fields.slice(0, 4), "the fields, in order").toEqual(["Player", "Shot type", "Situation", "When"]);
  await shot(page, `${browserName}-T-fields`);

  await filterList(menu).getByRole("option", { name: "Shot type" }).click();
  await expect(filterList(menu)).toHaveAttribute("aria-label", "Shot type");
  const layup = filterList(menu).getByRole("option", { name: "Layup" });
  await layup.click();
  await expect(layup, "a checkmark: it is on").toHaveAttribute("aria-selected", "true");
  await expect(count(page), "the list narrows at once, the menu still open").not.toHaveText(all);
  await expect(filterPopover(page)).toBeVisible();
  // A second value in the same field: either of them.
  await filterList(menu).getByRole("option", { name: "Jump shot" }).click();
  await expect(filterToken(page, "Shot type"), "both, in the bar's token").toContainText("Layup, Jump shot");
  await shot(page, `${browserName}-T-shot-type`);

  // Back to the fields (Backspace in the empty search): the field says what is on.
  await page.keyboard.press("Backspace");
  await expect(filterList(menu)).toHaveAttribute("aria-label", "Filters");
  await expect(filterList(menu).getByRole("option", { name: "Shot type, 2" })).toBeVisible();
  await closeFilters(page);
});

test("the search on the fields finds a value in any field, and Return puts it on", async ({ page, browserName }) => {
  await gameView(page);
  await openFilters(page);
  await filterSearch(page).fill("clutch");
  const menu = filterPopover(page);
  await expect(menu.getByRole("group", { name: "When" }).getByRole("option", { name: "Clutch" }), "Clutch, under When").toBeVisible();
  await shot(page, `${browserName}-T-search`);
  // Numbers find players: "#" or not.
  await filterSearch(page).fill("#1");
  await expect(menu.getByRole("group", { name: "Player" }).getByRole("option").first()).toHaveAccessibleName(/^#1\d? /);
  await filterSearch(page).fill("layup");
  await page.keyboard.press("Enter");
  await expect(menu.getByRole("option", { name: "Layup" })).toHaveAttribute("aria-selected", "true");
  await closeFilters(page);
  await expect(filterToken(page, "Shot type")).toContainText("Layup");
});

test("Esc goes back from a field's page, then closes; a token opens its field's page", async ({ page }) => {
  await gameView(page);
  const menu = await openFilters(page);
  await filterList(menu).getByRole("option", { name: "Situation" }).click();
  await filterList(menu).getByRole("option", { name: "Fast break" }).click();
  await page.keyboard.press("Escape");
  await expect(filterList(menu), "the first Esc goes back").toHaveAttribute("aria-label", "Filters");
  await page.keyboard.press("Escape");
  await expect(filterPopover(page), "the second closes").toBeHidden();
  // The token's values open the menu on that field's page.
  await filterToken(page, "Situation").getByRole("button", { name: "Fast break" }).click();
  await expect(filterList(filterPopover(page))).toHaveAttribute("aria-label", "Situation");
  await closeFilters(page);
});
