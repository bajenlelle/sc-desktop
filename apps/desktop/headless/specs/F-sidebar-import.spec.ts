/**
 * The sidebar's Import game action: visible on Playlists, the Library and
 * Teams, it opens the same Import game page the Library's toolbar button
 * opens. Reads only; creates nothing.
 */
import { expect, goViaSidebar, shot, test } from "../helpers";

const sidebarImport = (page: Parameters<typeof goViaSidebar>[0]) =>
  page.locator("aside").getByRole("link", { name: "Import game", exact: true });

test("the sidebar's Import game opens the import page from Playlists, the Library and Teams", async ({ page, browserName }) => {
  const name = (step: string) => `${browserName}-F-sidebar-import-${step}`;
  const importTitle = page.getByRole("heading", { level: 1, name: "Import game" });

  for (const from of ["Playlists", "Library", "Teams"] as const) {
    await goViaSidebar(page, from);
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: from, exact: true })).toHaveAttribute("aria-current", "page");
    await expect(sidebarImport(page), `the sidebar's Import game is visible on ${from}`).toBeVisible();
    await sidebarImport(page).click();
    await expect(importTitle, `Import game opens from ${from}`).toBeVisible();
    await expect(page).toHaveURL(/\/upload$/);
    if (from === "Teams") await shot(page, name("from-teams"));
  }

  // The Library's own button lands on the same page.
  await goViaSidebar(page, "Library");
  await expect(page.getByRole("heading", { level: 1, name: "Library" })).toBeVisible();
  await page.getByRole("link", { name: "Import game", exact: true }).and(page.locator(":not(aside *)")).click();
  await expect(importTitle, "the Library's Import game opens the same page").toBeVisible();
  await expect(page).toHaveURL(/\/upload$/);

  // Back to the Library; nothing was created.
  await goViaSidebar(page, "Library");
  await expect(page.getByRole("heading", { level: 1, name: "Library" })).toBeVisible();
});
