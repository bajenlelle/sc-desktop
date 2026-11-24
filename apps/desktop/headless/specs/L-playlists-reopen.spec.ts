/**
 * Playlists opens where the coach left off (docs/superpowers/specs/2026-11-21-retire-home-design.md,
 * "Opening the app"): with no playlist asked for it reopens the one opened last in this space, and it
 * takes New playlist (⌘N, Ctrl+N on Windows, or the list's own New playlist) while it is already shown, showing the
 * playlist browser when the coach had hidden it. With no games of its own the right pane says to import one
 * first. Creates playlists named `headless-<port>-<slot> reopen …` and deletes them. The keys are driven as the
 * Windows build reads them (the native menu is mocked here). The account has one space, so a second one is
 * added in the browser (addSecondSpace): nothing of it is written to staging.
 */
import type { Page, Route } from "@playwright/test";
import { addSecondSpace, createPlaylist, deleteOwnRowsNamed, expect, goViaSidebar, listNewPlaylist, OTHER_SPACE, owned, shot, switchSpace, test, toastWith, waitForQuiet } from "../helpers";

test.use({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36" });

const PREFIX = owned("reopen");
const ALPHA = `${PREFIX} alpha`;
const NEW = `${PREFIX} new`;
const heading = (page: Page) => page.getByRole("heading", { level: 1 });
const nameField = (page: Page) => page.locator("input:focus");

/** Creates ALPHA, opens it from the list on a fresh Playlists page, and returns its id. */
async function openAlpha(page: Page): Promise<string> {
  const id = await createPlaylist(page, ALPHA);
  // createPlaylist may have loaded the app first: let its reads end before the full load below.
  await waitForQuiet(page);
  await page.goto("/playlists");
  const row = page.locator(`[data-playlist-id="${id}"]`).first();
  await expect(row, "the spec's playlist is listed").toBeVisible({ timeout: 30_000 });
  await row.click();
  await expect(heading(page)).toHaveText(ALPHA);
  return id;
}

/** Names the new playlist's field and waits for the saved playlist to be the one shown. */
async function nameNewPlaylist(page: Page): Promise<void> {
  await nameField(page).fill(NEW);
  await nameField(page).press("Enter");
  await expect(heading(page), "the new playlist is the one shown").toHaveText(NEW, { timeout: 15_000 });
}

test.afterEach(async ({ page }) => {
  await deleteOwnRowsNamed(page, "playlists", PREFIX);
});

test("Playlists reopens the playlist opened last", { tag: "@smoke" }, async ({ page, browserName }) => {
  await openAlpha(page);
  await goViaSidebar(page, "Games");
  await expect(heading(page)).toHaveText("Games", { timeout: 30_000 });
  await goViaSidebar(page, "Playlists");
  await expect(heading(page), "the playlist opened last is open again").toHaveText(ALPHA, { timeout: 30_000 });
  await expect(page.getByText("Select a playlist", { exact: true })).toBeHidden();
  await shot(page, `${browserName}-L-playlists-reopen`);
});

test("a deleted remembered playlist opens nothing, quietly", async ({ page }) => {
  await openAlpha(page);
  // The remembered list now has its key: point it at a playlist that isn't there.
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith("scoutable_recent_opens:"));
    if (!key) throw new Error("headless: nothing was remembered");
    localStorage.setItem(key, JSON.stringify([{ kind: "playlist", id: "00000000-0000-4000-8000-000000000000", at: Date.now() }]));
  });
  await goViaSidebar(page, "Games");
  await expect(heading(page)).toHaveText("Games", { timeout: 30_000 });
  await goViaSidebar(page, "Playlists");
  await expect(page).toHaveURL(/\/playlists$/);
  await expect(page.locator("[data-playlist-id]").first(), "the list has loaded").toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Select a playlist", { exact: true })).toBeVisible();
  await expect(heading(page)).toHaveText("Playlists");
  await page.waitForTimeout(500);
  await expect(page.locator("[data-sonner-toast]"), "nothing is said about it").toHaveCount(0);
});

test("New playlist from Playlists itself starts a new one", async ({ page }) => {
  await openAlpha(page);
  await page.keyboard.press("Control+n");
  await expect(nameField(page), "the new playlist's name is asked for").toHaveValue("New Playlist");
  await nameNewPlaylist(page);
});

test("with a playlist open, the list's New playlist starts a new one", async ({ page, browserName }) => {
  await openAlpha(page);
  await expect(listNewPlaylist(page), "the list offers New playlist with a playlist open").toBeVisible();
  await expect(page.getByRole("button", { name: "New Playlist", exact: true }), "no second New at the list's foot").toHaveCount(0);
  await listNewPlaylist(page).click();
  await expect(nameField(page), "the new playlist's name is asked for").toHaveValue("New Playlist");
  await shot(page, `${browserName}-L-playlists-list-new`);
  await nameNewPlaylist(page);
});

test("a fresh page asked to create doesn't reopen the last one", async ({ page }) => {
  await openAlpha(page);
  await goViaSidebar(page, "Games");
  await expect(heading(page)).toHaveText("Games", { timeout: 30_000 });
  await page.keyboard.press("Control+n");
  await expect(page).toHaveURL(/\/playlists$/);
  await expect(nameField(page), "the new playlist's name is asked for").toHaveValue("New Playlist", { timeout: 30_000 });
  await expect(heading(page), "the playlist opened last stays closed").toHaveText("Playlists");
  await nameNewPlaylist(page);
});

test("New playlist while Playlists is still loading doesn't reopen the last one", async ({ page }) => {
  await openAlpha(page);
  await goViaSidebar(page, "Games");
  await expect(heading(page)).toHaveText("Games", { timeout: 30_000 });
  // The page's read of its list held back, so the ask comes while it loads.
  await page.route("**/rest/v1/playlists*", async (route) => {
    if (route.request().method() === "GET" && route.request().url().includes("playlist_clips")) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    await route.fallback();
  });
  await goViaSidebar(page, "Playlists");
  await expect(heading(page)).toHaveText("Playlists");
  await expect(listNewPlaylist(page), "the list is still loading").toBeDisabled();
  await page.keyboard.press("Control+n");
  await expect(nameField(page), "the new playlist's name is asked for").toHaveValue("New Playlist", { timeout: 30_000 });
  await expect(listNewPlaylist(page), "the list has loaded").toBeEnabled();
  await expect(heading(page), "the playlist opened last stays closed").toHaveText("Playlists");
  await nameNewPlaylist(page);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("another space doesn't reopen this space's playlist", async ({ page }) => {
  // The account has one space: the page is told of a second (a club it coaches), whose writes are answered here.
  const answered = await addSecondSpace(page);
  await openAlpha(page);
  await switchSpace(page, OTHER_SPACE.name);
  await expect(page.locator("aside").getByText(OTHER_SPACE.name), "the other space is the open one").toBeVisible();
  await expect(page.getByText("No playlists yet", { exact: true }), "the other space's (empty) list has loaded").toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(500);
  await expect(heading(page), "nothing is open in the other space").toHaveText("Playlists");
  await expect(page.getByText(ALPHA)).toHaveCount(0);
  expect(answered.filter((w) => !w.includes("/rpc/seed_demo_match")), "nothing else the club was written").toEqual([]);
});

test("New playlist with the playlist browser hidden shows it, with the name field", async ({ page, browserName }) => {
  // The coach hid the browser (kept per machine): read when the app loads, so set before a load.
  await page.goto("/matches");
  await expect(heading(page)).toHaveText("Games", { timeout: 30_000 });
  await page.evaluate(() => localStorage.setItem("scoutable_playlist_browser_collapsed", "1"));
  await waitForQuiet(page);
  await page.reload();
  await expect(heading(page)).toHaveText("Games", { timeout: 30_000 });
  await page.keyboard.press("Control+n");
  await expect(page).toHaveURL(/\/playlists$/, { timeout: 30_000 });
  await expect(nameField(page), "the new playlist's name is asked for").toHaveValue("New Playlist", { timeout: 30_000 });
  // A hidden browser keeps its rows laid out at full width inside a column of no width, marked aria-hidden.
  await expect(nameField(page).locator("xpath=ancestor::*[@aria-hidden='true']"), "the browser is shown").toHaveCount(0);
  await expect(nameField(page), "and the field is on screen").toBeInViewport({ ratio: 1 });
  await expect(nameField(page)).toBeFocused();
  // The browser springs open (a motion value, not a CSS animation): let it settle for the picture.
  await page.waitForTimeout(800);
  await shot(page, `${browserName}-L-playlists-new-browser-hidden`);
  await nameNewPlaylist(page);
});

test("no games: the right pane says to import first", async ({ page, browserName }) => {
  // An empty space, as the page is told it: no playlists or folders, and of the games only the sample.
  let demoId: string | null = null;
  const keep = (filter: (rows: Record<string, unknown>[]) => Record<string, unknown>[]) => async (route: Route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return route.fulfill({ response });
    }
    await route.fulfill({ response, json: Array.isArray(body) ? filter(body as Record<string, unknown>[]) : body });
  };
  await page.route("**/rest/v1/playlists*", keep(() => []));
  await page.route("**/rest/v1/playlist_folders*", keep(() => []));
  await page.route(
    "**/rest/v1/matches*",
    keep((rows) => {
      const demos = rows.filter((r) => r.is_demo === true);
      if (demos.length > 0 && typeof demos[0].id === "string") demoId = demos[0].id;
      return demos;
    }),
  );
  await page.goto("/playlists");
  await expect(page.getByText("No playlists yet", { exact: true })).toBeVisible({ timeout: 30_000 });
  const pane = page.locator("div").filter({ has: page.getByText("Import your first game", { exact: true }) }).last();
  await expect(pane).toBeVisible();
  await expect(pane.getByText("Every clip is generated automatically from the play-by-play.")).toBeVisible();
  await expect(pane.getByRole("link", { name: "Import game" })).toHaveAttribute("href", "/upload");
  const sample = pane.getByRole("link", { name: "Browse the sample game" });
  if (demoId) await expect(sample).toHaveAttribute("href", `/matches/${demoId}`);
  else await expect(sample).toHaveCount(0);
  await expect(page.getByText("Select a playlist", { exact: true })).toBeHidden();
  await expect(toastWith(page, /./)).toHaveCount(0);
  await shot(page, `${browserName}-L-playlists-import-first`);
});
