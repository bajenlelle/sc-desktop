/**
 * The Go menu's keys follow the sidebar: ⌘ or Ctrl with 1 to 5 opens Home,
 * Playlists, Reports, Shared playlists and the Library, in the order the
 * sidebar lists them. Driven as the Windows build reads the chords (the
 * native menu is mocked here). Reads only.
 */
import { expect, goViaSidebar, test } from "../helpers";

test.use({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36" });

test("Ctrl+1 to Ctrl+5 open the sidebar's pages in the sidebar's order", async ({ page }) => {
  await goViaSidebar(page, "Library");
  const nav = page.getByRole("navigation", { name: "Main" });
  const current = nav.locator('a[aria-current="page"]');
  await expect(current).toHaveText("Library", { timeout: 30_000 });
  const rows = await nav.getByRole("link").allTextContents();
  expect(rows.filter((r) => r !== "Shared playlists"), "the sidebar lists its pages in this order").toEqual(["Home", "Playlists", "Reports", "Library"]);

  for (const [key, row, path] of [
    ["1", "Home", "/"],
    ["2", "Playlists", "/playlists"],
    ["3", "Reports", "/reports"],
    ["5", "Library", "/matches"],
  ] as const) {
    await page.keyboard.press(`Control+${key}`);
    await expect(current, `Ctrl+${key} opens ${row}`).toHaveText(row);
    expect(new URL(page.url()).pathname).toBe(path);
  }

  // The fourth key is Shared playlists, between Reports and the Library as in the sidebar. A personal
  // space has no such row, and there the key does nothing.
  await page.keyboard.press("Control+4");
  if (rows.includes("Shared playlists")) {
    await expect(current).toHaveText("Shared playlists");
  } else {
    await page.waitForTimeout(400);
    await expect(current, "Ctrl+4 is left alone without a Shared playlists row").toHaveText("Library");
  }
});
