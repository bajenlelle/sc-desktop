/**
 * Home is retired (docs/superpowers/specs/2026-11-21-retire-home-design.md): `/` opens the page the
 * coach left on in this space, else Playlists, and a game that is no longer open falls back to the
 * Library. The sidebar starts with New playlist and Search. Reads only, apart from New playlist's
 * name field, which is named `headless-<port> start …` and swept in case a press outside saves it.
 */
import type { Page } from "@playwright/test";
import { deleteOwnRowsNamed, expect, forgetLastPlaces, owned, recordAnalytics, shot, test, waitForQuiet } from "../helpers";

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

test("the sidebar starts with New playlist and Search, with no Home", async ({ page, browserName }) => {
  await open(page, "/matches", "Games");
  const aside = page.locator("aside");
  const names = await aside.locator("button").evaluateAll((buttons) =>
    buttons.map((b) => b.getAttribute("aria-label") ?? b.textContent?.trim() ?? ""),
  );
  const at = names.indexOf("New playlist");
  expect(at, "the sidebar has New playlist").toBeGreaterThanOrEqual(0);
  expect(names.slice(at, at + 2), "New playlist, then Search").toEqual(["New playlist", "Search"]);
  // Above the pages: nothing in the Main navigation comes before them.
  const newBox = await aside.getByRole("button", { name: "New playlist", exact: true }).boundingBox();
  const navBox = await aside.getByRole("navigation", { name: "Main" }).boundingBox();
  expect(newBox!.y).toBeLessThan(navBox!.y);
  await expect(aside.getByRole("link", { name: "Home", exact: true }), "no Home row").toHaveCount(0);
  await expect(aside.getByRole("button", { name: "New playlist", exact: true })).not.toHaveAttribute("aria-current");
  await shot(page, `${browserName}-L-start-page-sidebar`);
});

test("New playlist in the sidebar starts a playlist from any page", async ({ page, browserName }) => {
  const newPlaylist = page.locator("aside").getByRole("button", { name: "New playlist", exact: true });
  const nameField = page.locator("input:focus");
  for (const [path, title] of [["/matches", "Games"], ["/teams", "Teams"]] as const) {
    await open(page, path, title);
    await newPlaylist.click();
    await expect(page, `New playlist from ${title} opens Playlists`).toHaveURL(/\/playlists$/, { timeout: 30_000 });
    await expect(nameField, `the new playlist's name is asked for, from ${title}`).toHaveValue("New Playlist", { timeout: 30_000 });
    if (title === "Teams") await shot(page, `${browserName}-L-start-page-new-playlist`);
    // Let it go without saving it.
    await nameField.fill(`${PREFIX} ${title}`);
    await nameField.press("Escape");
    await expect(nameField).toHaveCount(0);
  }
});
