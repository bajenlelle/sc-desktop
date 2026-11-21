/**
 * Invite players, moved from Home's engagement strip to the Shared playlists dashboard's toolbar
 * (docs/superpowers/specs/2026-11-21-retire-home-design.md). Pressing it opens the club's invite dialog with the
 * Player role. Nothing is sent: the spec only checks that the dialog opens.
 *
 * The test account has only a personal space, which has no Shared playlists page and cannot invite. So the read of
 * the account's orgs (the get_my_orgs call, a POST) is answered with its own org as a club it administers; the
 * response is rewritten in the browser, and nothing is written to staging.
 */
import type { Route } from "@playwright/test";
import { expect, test } from "../helpers";

test("Invite players on Shared playlists opens the invite dialog", async ({ page }) => {
  await page.route("**/rpc/get_my_orgs*", async (route: Route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const response = await route.fetch();
    const rows = (await response.json()) as Record<string, unknown>[];
    await route.fulfill({ response, json: rows.map((r) => ({ ...r, is_personal: false, role: "admin" })) });
  });

  await page.goto("/my-playlists");
  await expect(page.getByRole("heading", { level: 1, name: "Shared playlists" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Invite players" }).click({ timeout: 10_000 });
  await expect(page).toHaveURL(/\/organization$/);
  const dialog = page.getByRole("dialog", { name: /Invite people to/ });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByRole("button", { name: "Role" })).toContainText("Player");
});
