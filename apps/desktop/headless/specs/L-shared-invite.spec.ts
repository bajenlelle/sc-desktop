/**
 * Invite players, moved from Home's engagement strip to the Shared playlists dashboard's toolbar
 * (docs/superpowers/specs/2026-11-21-retire-home-design.md). Pressing it opens the club's invite dialog with the
 * Player role. Nothing is sent: the spec only checks that the dialog opens.
 *
 * The test account's own space is personal, which has no Shared playlists page, so the spec makes a club the
 * account coaches or administers its active space (the app's own storage key) before the first load.
 */
import { expect, test, withAppModule } from "../helpers";

test("Invite players on Shared playlists opens the invite dialog", async ({ page }) => {
  await page.goto("/");
  const clubId = await withAppModule<null, string | null>(page, "/src/lib/supabase/client.ts", `
    const { data, error } = await mod.createClient().rpc("get_my_orgs");
    if (error) throw new Error("headless: " + error.message);
    const club = (data ?? []).find((o) => !o.is_personal && (o.role === "coach" || o.role === "admin"));
    return club ? club.org_id : null;
  `, null);
  test.skip(!clubId, "the headless account is not a coach or admin of a club, so it cannot invite");
  await page.evaluate((id) => localStorage.setItem("scoutable_active_org_id", id as string), clubId);

  await page.goto("/my-playlists");
  await expect(page.getByRole("heading", { level: 1, name: "Shared playlists" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Invite players" }).click({ timeout: 10_000 });
  await expect(page).toHaveURL(/\/organization$/);
  const dialog = page.getByRole("dialog", { name: /Invite people to/ });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByRole("button", { name: "Role" })).toContainText("Player");
});
