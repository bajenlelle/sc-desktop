/**
 * The editor's filters (pages/playlists.tsx, usePlaylistFilters): no bar of its own. The toolbar's Filter opens
 * the Filter menu in place, with Event as a field (the editor has no event chips); what is on shows over the
 * list as tokens, only while something is on, and a token opens its field's page. Makes its own playlist,
 * `headless-<port> editor filter`, and deletes it afterwards.
 */
import {
  closeFilters,
  deleteOwnedPlaylists,
  expect,
  filterButton,
  filterList,
  filterPopover,
  newPlaylistWithClips,
  owned,
  shot,
  test,
} from "../helpers";

const NAME = owned("editor filter");

test.afterEach(async ({ page }) => {
  await deleteOwnedPlaylists(page, [NAME]);
});

test("the toolbar's Filter opens the menu; tokens and the count show only while a filter is on", async ({ page, browserName }) => {
  await page.goto("/playlists");
  await deleteOwnedPlaylists(page, [NAME]);
  await newPlaylistWithClips(page, NAME, { count: 6 });
  const rows = page.locator("[role=row][data-row-key]");
  const tokens = page.getByRole("group", { name: "Filters on" });
  await expect(tokens, "nothing on: no tokens, no bar").toHaveCount(0);
  await expect(filterButton(page), "one Filter: the toolbar's").toHaveCount(1);

  // One press opens the menu itself, Event first.
  await filterButton(page).click();
  const menu = filterPopover(page);
  await expect(menu).toBeVisible();
  const fields = await filterList(menu).getByRole("option").evaluateAll((os) => os.map((o) => o.getAttribute("aria-label")));
  expect(fields[0], "Event is a field here").toBe("Event");
  await shot(page, `${browserName}-U-menu`);

  // The first clip's event, from the Event page: the list narrows to its kind.
  await filterList(menu).getByRole("option", { name: "Event" }).click();
  await expect(filterList(menu)).toHaveAttribute("aria-label", "Event");
  const firstRow = (await rows.first().innerText()).replace(/\s+/g, " ");
  const options = await filterList(menu).getByRole("option").evaluateAll((os) => os.map((o) => o.getAttribute("aria-label") ?? ""));
  const kind = options.find((o) => firstRow.includes(o));
  expect(kind, `an Event value names the first clip's kind (${firstRow})`).toBeTruthy();
  await filterList(menu).getByRole("option", { name: kind!, exact: true }).click();
  await expect(filterButton(page)).toHaveAccessibleName("Filters, 1 on");
  await closeFilters(page);

  await expect(tokens.getByRole("group", { name: "Event filter" })).toContainText(kind!);
  await expect(page.getByRole("status").filter({ hasText: /^\d+ of 6 clips$/ })).toBeVisible();
  await shot(page, `${browserName}-U-filtered`);

  // The token's values open the menu on Event's page.
  await tokens.getByRole("group", { name: "Event filter" }).getByRole("button", { name: kind!, exact: true }).click();
  await expect(filterList(filterPopover(page))).toHaveAttribute("aria-label", "Event");
  await closeFilters(page);

  // Clear filters: the tokens and the count line go.
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(tokens).toHaveCount(0);
  await expect(rows).toHaveCount(6);
  await expect(filterButton(page)).toHaveAccessibleName("Filters");
});
