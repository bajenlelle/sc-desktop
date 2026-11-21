/**
 * The Go menu's number keys follow the sidebar: ⌘ or Ctrl with n opens the
 * nth row the sidebar shows (docs/desktop-design-audit.md). Driven as the
 * Windows build reads the chords (the native menu is mocked here). Reads only.
 */
import { expect, goViaSidebar, test } from "../helpers";

test.use({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36" });

test("Ctrl with a number opens that row of the sidebar, and a number past the last row does nothing", async ({ page }) => {
  await goViaSidebar(page, "Library");
  const nav = page.getByRole("navigation", { name: "Main" });
  const current = nav.locator('a[aria-current="page"]');
  await expect(current).toHaveText("Library", { timeout: 30_000 });
  const rows = await nav.getByRole("link").allTextContents();
  expect(rows.length, "the sidebar lists the coach's pages").toBeGreaterThanOrEqual(4);

  // Each row by its own number, last row first so every press changes the page.
  for (let n = rows.length; n >= 1; n--) {
    await page.keyboard.press(`Control+${n}`);
    await expect(current, `Ctrl+${n} opens row ${n}, ${rows[n - 1]}`).toHaveText(rows[n - 1]);
  }
  expect(new URL(page.url()).pathname, "the first row is Home").toBe("/");

  // The number after the last row belongs to a page this sidebar doesn't show: nothing happens.
  if (rows.length < 6) {
    await page.keyboard.press(`Control+${rows.length + 1}`);
    await page.waitForTimeout(400);
    await expect(current, "a number past the last row is left alone").toHaveText(rows[0]);
  }
});
