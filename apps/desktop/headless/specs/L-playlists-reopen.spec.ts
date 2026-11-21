/**
 * Playlists opens where the coach left off (docs/superpowers/specs/2026-11-21-retire-home-design.md,
 * "Opening the app"): with no playlist asked for it reopens the one opened last in this space, and it
 * takes New playlist (⌘N, Ctrl+N on Windows) while it is already shown. With no games of its own the
 * right pane says to import one first. Creates playlists named `headless-<port> reopen …` and deletes
 * them. The keys are driven as the Windows build reads them (the native menu is mocked here).
 */
import type { Page, Route } from "@playwright/test";
import { createPlaylist, deleteOwnRowsNamed, expect, goViaSidebar, openPlaylists, owned, shot, test, toastWith } from "../helpers";

test.use({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36" });

const PREFIX = owned("reopen");
const ALPHA = `${PREFIX} alpha`;
const NEW = `${PREFIX} new`;
const heading = (page: Page) => page.getByRole("heading", { level: 1 });
const nameField = (page: Page) => page.locator("input:focus");

/** Creates ALPHA, opens it from the list on a fresh Playlists page, and returns its id. */
async function openAlpha(page: Page): Promise<string> {
  const id = await createPlaylist(page, ALPHA);
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

test("Playlists reopens the playlist opened last", async ({ page, browserName }) => {
  await openAlpha(page);
  await goViaSidebar(page, "Library");
  await expect(heading(page)).toHaveText("Library", { timeout: 30_000 });
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
  await goViaSidebar(page, "Library");
  await expect(heading(page)).toHaveText("Library", { timeout: 30_000 });
  await goViaSidebar(page, "Playlists");
  await openPlaylists(page);
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

test("a fresh page asked to create doesn't reopen the last one", async ({ page }) => {
  await openAlpha(page);
  await goViaSidebar(page, "Library");
  await expect(heading(page)).toHaveText("Library", { timeout: 30_000 });
  await page.keyboard.press("Control+n");
  await expect(page).toHaveURL(/\/playlists$/);
  await expect(nameField(page), "the new playlist's name is asked for").toHaveValue("New Playlist", { timeout: 30_000 });
  await expect(heading(page), "the playlist opened last stays closed").toHaveText("Playlists");
  await nameNewPlaylist(page);
});

test("another space doesn't reopen this space's playlist", async ({ page }) => {
  await openAlpha(page);
  const switcher = page.locator("aside button").filter({ has: page.locator(".lucide-chevrons-up-down") });
  await switcher.click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  // The spaces come first in the menu, up to its first separator; the open one carries the check.
  const other = await menu.evaluate((m) => {
    const spaces: Element[] = [];
    for (const el of m.querySelectorAll('[role="menuitem"], [role="separator"]')) {
      if (el.getAttribute("role") === "separator") break;
      spaces.push(el);
    }
    if (spaces.length < 2) return -1;
    return [...m.querySelectorAll('[role="menuitem"]')].findIndex((el) => spaces.includes(el) && !el.querySelector(".lucide-check"));
  });
  test.skip(other < 0, "the test account is in one space only");
  await menu.getByRole("menuitem").nth(other).click();
  await openPlaylists(page);
  await page.waitForTimeout(500);
  await expect(heading(page), "nothing is open in the other space").toHaveText("Playlists");
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
