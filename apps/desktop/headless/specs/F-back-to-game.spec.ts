/**
 * Fix round, change 2: a game page's "Open playlist" opens the editor with
 * the way back, "‹ {game title}" leading the toolbar, and that button
 * returns to the game as it was left (no reload, both open games still in
 * the sidebar). Arriving from the sidebar shows no such button. Makes one
 * playlist of its own (`headless-<port>-<slot> back`) and deletes it at the end.
 */
import {
  chooseNewTarget,
  deleteOwnedPlaylists,
  expect,
  goViaSidebar,
  openLibraryGame,
  owned,
  shot,
  showGameView,
  test,
} from "../helpers";

const TARGET = owned("back");

test.afterEach(async ({ page }) => {
  await deleteOwnedPlaylists(page, [TARGET]);
});

test("Open playlist leads to the editor with a way back to the game", async ({ page, browserName }) => {
  const name = (step: string) => `${browserName}-F-back-${step}`;
  await page.goto("/matches");
  await deleteOwnedPlaylists(page, [TARGET]);

  // Two games open: the way back must find both still open.
  await openLibraryGame(page, 0);
  const game = await openLibraryGame(page, 1);
  const openGames = page.getByRole("navigation", { name: "Open games" });
  await expect(openGames).toBeVisible();
  await showGameView(page);

  await chooseNewTarget(page, TARGET);
  await expect(page.getByRole("button", { name: "Open playlist" })).toBeVisible();
  await page.getByRole("button", { name: "Open playlist" }).click();

  // The editor, on the target, with "‹ {game title}" leading its toolbar.
  await expect(page).toHaveURL(/\/playlists$/);
  await expect(page.locator("header button[title='Rename playlist']")).toHaveText(TARGET, { timeout: 15_000 });
  const back = page.locator("header").getByRole("button", { name: game.title, exact: true });
  await expect(back).toBeVisible();
  await shot(page, name("editor"));

  // Back to that game: its page at once, with both tabs still open.
  await back.click();
  await expect(page).toHaveURL(new RegExp(`/matches/${game.id}`));
  await expect(page.getByRole("radiogroup", { name: "View" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Loading the game…")).toHaveCount(0);
  await expect(page.locator("header").getByRole("heading", { level: 1 })).toHaveText(game.title);
  await expect(openGames.locator("button[data-open-game]")).toHaveCount(2);
  await expect(openGames.getByRole("button", { name: game.title, exact: true })).toHaveAttribute("aria-current", "page");
  await shot(page, name("game-again"));

  // From the sidebar, the editor has no game behind it: no back button.
  await goViaSidebar(page, "Playlists");
  await expect(page).toHaveURL(/\/playlists$/);
  await expect(page.locator("header").getByRole("heading", { level: 1 })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("header").getByRole("button", { name: game.title, exact: true })).toHaveCount(0);
  await shot(page, name("sidebar-no-back"));
});
