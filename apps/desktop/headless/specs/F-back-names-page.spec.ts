/**
 * The back button names the page it returns to, never the page left
 * (lib/nav-history.ts, docs/navigation.md): a report left for Reports from the
 * sidebar and opened again from there goes back to "Reports". A navigation
 * renders as a transition, so the page left is still on screen for a moment
 * after the history has moved on; it must not name the new page after itself.
 * Creates "headless-<port>-<slot> Back names" (a report) and deletes it.
 */
import { deleteOwnedPlaylists, expect, owned, test, withAppModule } from "../helpers";

const NAME = owned("Back names");

test.afterEach(async ({ page }) => {
  await deleteOwnedPlaylists(page, [NAME]);
});

test("a report reopened from Reports goes back to Reports, not to itself", async ({ page }) => {
  await page.goto("/reports");
  const id = await withAppModule<string, string>(page, "/src/lib/team-report.ts", `return await mod.createNamedReport(arg, { orgId: null });`, NAME);
  const nav = page.getByRole("navigation", { name: "Main" });
  const row = page.getByRole("main").getByText(NAME, { exact: true }).first();
  // The toolbar's back button is named by the page it returns to ("Back to …" is its tooltip).
  const backTo = (label: string) => page.getByRole("main").getByRole("button", { name: label, exact: true });

  // Reports → the report (Back: Reports) → Reports from the sidebar → the report again.
  await page.goto("/reports");
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();
  await expect(page).toHaveURL(new RegExp(`/reports/${id}$`), { timeout: 30_000 });
  const picker = page.getByRole("dialog");
  if (await picker.isVisible().catch(() => false)) await page.keyboard.press("Escape");
  await expect(backTo("Reports")).toBeVisible({ timeout: 30_000 });

  await nav.getByRole("link", { name: "Reports", exact: true }).click();
  await expect(page).toHaveURL(/\/reports$/);
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();
  await expect(page).toHaveURL(new RegExp(`/reports/${id}$`), { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: NAME }).first()).toBeVisible({ timeout: 30_000 });
  await expect(backTo("Reports")).toBeVisible();
  await expect(backTo(NAME)).toHaveCount(0);

  // And Back goes there.
  await backTo("Reports").click();
  await expect(page).toHaveURL(/\/reports$/);
});
