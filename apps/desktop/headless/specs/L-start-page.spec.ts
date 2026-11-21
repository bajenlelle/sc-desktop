/**
 * Home is retired (docs/superpowers/specs/2026-11-21-retire-home-design.md): `/` opens the page the
 * coach left on in this space, else Playlists, and a game that is no longer open falls back to the
 * Library. The sidebar starts with Search (New playlist lives in the playlist list's header and on ⌘N).
 * Reads only, apart from New playlist's name field, which is named `headless-<port> start …` and swept
 * in case a press outside saves it.
 * The account has one space, so a second one is added in the browser for the space switch
 * (addSecondSpace): nothing of it is written to staging.
 */
import type { Page } from "@playwright/test";
import { addSecondSpace, deleteOwnRowsNamed, expect, forgetLastPlaces, openLibraryGame, OTHER_SPACE, owned, recordAnalytics, shot, switchSpace, test, waitForQuiet } from "../helpers";

const PREFIX = owned("start");
const heading = (page: Page) => page.getByRole("heading", { level: 1 });
const pathname = (page: Page) => new URL(page.url()).pathname;

/** Loads `path` afresh and waits for its page to be up. */
async function open(page: Page, path: string, title: string): Promise<void> {
  await waitForQuiet(page);
  await page.goto(path);
  await expect(heading(page)).toHaveText(title, { timeout: 30_000 });
}

/** Loads the app at `/`, as a launch does. */
async function launch(page: Page): Promise<void> {
  await waitForQuiet(page);
  await page.goto("/");
}

test.afterEach(async ({ page }) => {
  await deleteOwnRowsNamed(page, "playlists", PREFIX);
});

test("the app opens on Playlists the first time", async ({ page, browserName }) => {
  const tracked = await recordAnalytics(page);
  await open(page, "/matches", "Games");
  await forgetLastPlaces(page);
  await launch(page);
  await expect(page).toHaveURL(/\/playlists$/, { timeout: 30_000 });
  await expect(page.getByRole("navigation", { name: "Main" }).locator('a[aria-current="page"]')).toHaveText("Playlists");
  await shot(page, `${browserName}-L-start-page-first`);
  await expect
    .poll(async () => (await tracked()).filter((e) => e.event === "start_page_opened").map((e) => e.properties))
    .toEqual([{ page: "/playlists", restored: false }]);
  const viewed = (await tracked()).filter((e) => e.event === "page_viewed").map((e) => e.properties?.path);
  expect(viewed, "`/` is never counted as a page view").not.toContain("/");
});

test("it reopens the last page", async ({ page }) => {
  const tracked = await recordAnalytics(page);
  await open(page, "/reports", "Reports");
  await launch(page);
  await expect(heading(page)).toHaveText("Reports", { timeout: 30_000 });
  expect(pathname(page)).toBe("/reports");
  await expect
    .poll(async () => (await tracked()).filter((e) => e.event === "start_page_opened").map((e) => e.properties))
    .toEqual([{ page: "/reports", restored: true }]);
});

test("it reopens a game that is still open", async ({ page }) => {
  // The game joins Open games when it opens; the coach then leaves it for another page.
  const game = await openLibraryGame(page, 0);
  await open(page, "/reports", "Reports");
  await page.evaluate((path) => {
    const key = Object.keys(localStorage).find((k) => k.startsWith("scoutable_last_page:"));
    if (!key) throw new Error("headless: no page was remembered");
    localStorage.setItem(key, path);
  }, `/matches/${game.id}`);
  await launch(page);
  await expect(page).toHaveURL(new RegExp(`/matches/${game.id}$`), { timeout: 30_000 });
  await expect(page.getByRole("radiogroup", { name: "View" }), "the game's page is up").toBeVisible({ timeout: 30_000 });
});

test("a space switch notes the page for the new space", async ({ page }) => {
  // The account has one space: the page is told of a second (a club it coaches), whose writes are answered here.
  const answered = await addSecondSpace(page);
  await open(page, "/reports", "Reports");
  await switchSpace(page, OTHER_SPACE.name);
  await expect(page.locator("aside").getByText(OTHER_SPACE.name), "the other space is the open one").toBeVisible();
  expect(pathname(page), "a switch leaves the page where it is").toBe("/reports");
  await expect
    .poll(() => page.evaluate((club) => Object.entries(localStorage).find(([k]) => k.startsWith("scoutable_last_page:") && k.endsWith(`:${club}`))?.[1] ?? null, OTHER_SPACE.id))
    .toBe("/reports");
  // Opened again in that space, the app comes back to it.
  await launch(page);
  await expect(page.locator("aside").getByText(OTHER_SPACE.name)).toBeVisible({ timeout: 30_000 });
  await expect(heading(page)).toHaveText("Reports", { timeout: 30_000 });
  expect(pathname(page)).toBe("/reports");
  expect(answered.filter((w) => !w.includes("/rpc/seed_demo_match")), "nothing else the club was written").toEqual([]);
});

test("a game no longer open falls back to Games", async ({ page }) => {
  await open(page, "/reports", "Reports");
  // The page is remembered under this user and space: point it at a game that isn't among the open ones.
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith("scoutable_last_page:"));
    if (!key) throw new Error("headless: no page was remembered");
    localStorage.setItem(key, "/matches/00000000-0000-4000-8000-000000000000");
  });
  await launch(page);
  await expect(heading(page)).toHaveText("Games", { timeout: 30_000 });
  expect(pathname(page)).toBe("/matches");
});

test("Back never returns to /", async ({ page }) => {
  await open(page, "/matches", "Games");
  await forgetLastPlaces(page);
  await launch(page);
  await expect(page).toHaveURL(/\/playlists$/, { timeout: 30_000 });
  await waitForQuiet(page);
  await page.goBack();
  // `/` was replaced by Playlists, so Back is the page before it, not `/` sending the coach on again.
  await expect(page).toHaveURL(/\/matches$/, { timeout: 30_000 });
  await expect(heading(page)).toHaveText("Games", { timeout: 30_000 });
});

test("the sidebar starts with Search, with no Home and no New playlist", async ({ page, browserName }) => {
  await open(page, "/matches", "Games");
  const aside = page.locator("aside");
  // Above the pages: nothing in the Main navigation comes before it.
  const searchBox = await aside.getByRole("button", { name: "Search", exact: true }).boundingBox();
  const navBox = await aside.getByRole("navigation", { name: "Main" }).boundingBox();
  expect(searchBox!.y).toBeLessThan(navBox!.y);
  await expect(aside.getByRole("link", { name: "Home", exact: true }), "no Home row").toHaveCount(0);
  await expect(aside.getByRole("button", { name: "New playlist", exact: true }), "New playlist lives with the playlists").toHaveCount(0);
  await shot(page, `${browserName}-L-start-page-sidebar`);
});

test.describe("the keys, as the Windows build reads them (the native menu is mocked here)", () => {
  test.use({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36" });

  test("Ctrl+N starts a playlist from any page", async ({ page, browserName }) => {
    const nameField = page.locator("input:focus");
    for (const [path, title] of [["/matches", "Games"], ["/teams", "Teams"]] as const) {
      await open(page, path, title);
      await page.keyboard.press("Control+n");
      await expect(page, `New playlist from ${title} opens Playlists`).toHaveURL(/\/playlists$/, { timeout: 30_000 });
      await expect(nameField, `the new playlist's name is asked for, from ${title}`).toHaveValue("New Playlist", { timeout: 30_000 });
      if (title === "Teams") await shot(page, `${browserName}-L-start-page-new-playlist`);
      // Let it go without saving it.
      await nameField.fill(`${PREFIX} ${title}`);
      await nameField.press("Escape");
      await expect(nameField).toHaveCount(0);
    }
  });
});
