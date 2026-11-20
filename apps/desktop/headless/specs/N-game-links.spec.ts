/**
 * Ways into the game from a playlist (docs/game-view.md, "Ways into the
 * game"): the editor's subtitle names the playlist's game and opens it, a
 * clip row's Show in Game and Go → Show Clip in Game open the game at that
 * play, and the game's back button names the playlist and returns to it.
 * Makes one playlist of its own (`headless-<port> links`) and deletes it at
 * the end.
 */
import { deleteOwnedPlaylists, expect, newPlaylistWithClips, owned, shot, test } from "../helpers";

const NAME = owned("links");

test.afterEach(async ({ page }) => {
  await deleteOwnedPlaylists(page, [NAME]);
});

test("the editor names its game, a clip shows in its game at its play, and the game goes back to the playlist", async ({ page, browserName }) => {
  const name = (step: string) => `${browserName}-N-links-${step}`;
  await page.goto("/playlists");
  await deleteOwnedPlaylists(page, [NAME]);
  const keys = await newPlaylistWithClips(page, NAME, { count: 2 });
  const [matchId, eventId] = [keys[0].slice(0, keys[0].lastIndexOf(":")), keys[0].slice(keys[0].lastIndexOf(":") + 1)];

  // The subtitle: "2 items · {game}", the game a reference that opens it.
  const header = page.locator("header");
  const reference = header.getByRole("link", { name: /.+/ }).and(header.locator('a[title^="Open "]'));
  await expect(reference, "the playlist's game is named in the subtitle").toBeVisible({ timeout: 15_000 });
  const gameTitle = (await reference.innerText()).trim();
  await shot(page, name("subtitle"));
  await reference.click();
  await expect(page).toHaveURL(new RegExp(`/matches/${matchId}$`));
  const back = header.getByRole("button", { name: NAME, exact: true });
  await expect(back, "the game's back button names the playlist").toBeVisible({ timeout: 30_000 });
  await expect(header.getByRole("button", { name: "Library", exact: true }), "instead of the Library").toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(gameTitle);
  await shot(page, name("game-from-playlist"));

  // Back the way it came: the editor, on the playlist.
  await back.click();
  await expect(page).toHaveURL(/\/playlists$/);
  await expect(header.locator("button[title='Rename playlist']")).toHaveText(NAME, { timeout: 15_000 });

  // A clip's own menu: Show in Game opens the game at that play.
  const rowOf = page.locator(`[role=row][data-row-key="${keys[0]}"]`);
  await rowOf.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Show in game", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/matches/${matchId}\\?play=${eventId}$`));
  await expect(page.getByRole("radio", { name: "Game" }), "a link to a play opens the Game view").toHaveAttribute("aria-checked", "true", { timeout: 30_000 });
  await expect(header.getByRole("button", { name: NAME, exact: true })).toBeVisible();
  await shot(page, name("show-in-game"));

  // The Details switch keeps the way back.
  await page.getByRole("radio", { name: "Details" }).click();
  await expect(header.getByRole("button", { name: NAME, exact: true })).toBeVisible();

  // Go → Show Clip in Game, for the row the keys are on.
  await header.getByRole("button", { name: NAME, exact: true }).click();
  await expect(header.locator("button[title='Rename playlist']")).toHaveText(NAME, { timeout: 15_000 });
  const second = page.locator(`[role=row][data-row-key="${keys[1]}"]`);
  await second.click();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("menu-show-clip-in-game")));
  const [secondMatch, secondEvent] = [keys[1].slice(0, keys[1].lastIndexOf(":")), keys[1].slice(keys[1].lastIndexOf(":") + 1)];
  await expect(page).toHaveURL(new RegExp(`/matches/${secondMatch}\\?play=${secondEvent}$`), { timeout: 15_000 });

  // Opened from the Library instead, the game's way back is the Library's again.
  await page.goto("/matches");
  await page.locator(`main a[href="/matches/${matchId}"]`).click();
  await expect(header.getByRole("button", { name: "Library", exact: true })).toBeVisible({ timeout: 30_000 });
});
