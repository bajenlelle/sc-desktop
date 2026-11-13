/**
 * The harness's proof (docs/headless-ui.md): signed in, the Library lists
 * games, the first game's Game view draws its play list and timeline, and a
 * playlist's Add clips lists events. Reads only; creates nothing.
 */
import { expect, openFirstGame, shot, test } from "../helpers";

test("library, game view and Add clips render against staging", async ({ page, browserName }) => {
  const name = (step: string) => `smoke-${browserName}-${step}`;

  // Asserts the Library heading and a game row, and screenshots the Library on the way.
  const title = await openFirstGame(page, { shotLibraryAs: name("library") });
  expect(title, "the first Library row has a title").not.toBe("");

  // A game whose video isn't on this computer opens on Details; the Game view draws without footage.
  await page.getByRole("radio", { name: "Game" }).click();
  await expect(page.getByRole("radio", { name: "Game" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(title);
  await expect(page.getByRole("list", { name: "Plays" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("region", { name: "Game timeline" })).toBeVisible();
  await shot(page, name("game"));

  await page.goto("/playlists");
  const playlist = page.locator("[data-playlist-id]").first();
  await expect(playlist, "the test account has a playlist").toBeVisible({ timeout: 30_000 });
  await playlist.click();
  await page.getByRole("button", { name: "Add clips", exact: true }).first().click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("heading", { name: "Add clips" })).toBeVisible();
  await expect(sheet.getByRole("grid", { name: "Events" }).getByRole("row").first()).toBeVisible({ timeout: 30_000 });
  await shot(page, name("add-clips"));
});
