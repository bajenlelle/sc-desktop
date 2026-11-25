/**
 * Names open what they name, and Back is the page before (docs/navigation.md): a game's header in a team's
 * plays opens the game (its day and result) and the opponent (their name); Back, by the toolbar or ⌘←, comes
 * back to the plays as they were left; a page the sidebar opens has no back button, and ⌘← still goes back;
 * ⌘-click puts a game in Open games and leaves the page as it is. On the made-up league (headless/team-league.ts),
 * with the test account's library game as one of Alfa's.
 */
import type { Page } from "@playwright/test";
import { expect, goViaSidebar, mockLeague, test, withAppModule } from "../helpers";
import { madeUpLeague } from "../team-league";

/** One of the test account's Genius games in the space on screen. */
async function aLibraryGame(page: Page): Promise<{ id: string; sourceGameId: number; title: string }> {
  await page.goto("/matches");
  await expect(page.getByRole("heading", { level: 1, name: "Games" })).toBeVisible({ timeout: 30_000 });
  const game = await withAppModule<null, { id: string; sourceGameId: number; title: string } | null>(
    page,
    "/src/lib/supabase/client.ts",
    `
    const c = mod.createClient();
    const { data: { user } } = await c.auth.getUser();
    const { data, error } = await c.from("matches").select("id, source_game_id, org_id, title").eq("user_id", user.id);
    if (error) throw new Error("headless: " + error.message);
    const space = Object.keys(localStorage).map((k) => localStorage.getItem(k)).find((v) => v && data.some((m) => m.org_id === v));
    const row = data.find((m) => /^\\d+$/.test(m.source_game_id ?? "") && (!space || m.org_id === space));
    return row ? { id: row.id, sourceGameId: Number(row.source_game_id), title: row.title } : null;
  `,
    null,
  );
  if (!game) throw new Error("headless: the test account has no Genius game");
  return game;
}

/** Alfa's plays, from the Teams page: the library game is one of Alfa's. */
async function alfaPlays(page: Page) {
  const mine = await aLibraryGame(page);
  await mockLeague(page, madeUpLeague({ libraryGame: mine.sourceGameId }));
  await page.goto("/teams");
  await page.getByRole("link", { name: "Alfa", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Alfa" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: /^Watch all \d+ plays$/ }).click({ timeout: 30_000 });
  await expect(page).toHaveURL(/view=plays/);
  const list = page.getByRole("list", { name: "Plays" });
  await expect(list.locator("[data-key]").first()).toBeVisible({ timeout: 30_000 });
  return { mine, list };
}

/** The toolbar's back button, by the page it names. */
const backTo = (page: Page, name: string) =>
  page.locator("header").getByRole("button", { name, exact: true }).filter({ has: page.locator("svg.lucide-chevron-left") });

test("a game's header opens the game, and Back comes back to the plays as they were left", async ({ page }) => {
  const { mine, list } = await alfaPlays(page);
  // Two plays selected (⌘-click), so there is something of the page's own to find again.
  const rows = list.locator("[data-key]");
  await rows.nth(0).click({ modifiers: ["Meta"] });
  await rows.nth(1).click({ modifiers: ["Meta"] });
  await expect(list.locator("[data-key][aria-pressed=true]")).toHaveCount(2);

  // The header's day and result: the game.
  await list.locator(`a[href="/matches/${mine.id}"]`).first().click();
  await expect(page).toHaveURL(new RegExp(`/matches/${mine.id}`));
  // Back names the team the game was opened from.
  await expect(backTo(page, "Alfa")).toBeVisible({ timeout: 30_000 });
  await backTo(page, "Alfa").click();

  await expect(page).toHaveURL(/view=plays/);
  await expect(page.getByRole("radio", { name: "Plays" })).toHaveAttribute("aria-checked", "true");
  await expect(list.locator("[data-key][aria-pressed=true]"), "the selection is as it was left").toHaveCount(2, { timeout: 30_000 });
});

test("a game header's opponent opens their page, and ⌘← comes back", async ({ page }) => {
  const { list } = await alfaPlays(page);
  const opponent = list.locator('a[href^="/teams/"]').first();
  const name = (await opponent.innerText()).trim();
  await opponent.click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible({ timeout: 30_000 });
  await expect(backTo(page, "Alfa")).toBeVisible();
  await page.locator("body").click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.keyboard.press("Meta+ArrowLeft");
  await expect(page.getByRole("heading", { level: 1, name: "Alfa" })).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveURL(/view=plays/);
});

test("a page the sidebar opens has no back button, and ⌘← still goes back", async ({ page }) => {
  await alfaPlays(page);
  await goViaSidebar(page, "Games");
  await expect(page.getByRole("heading", { level: 1, name: "Games" })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("header").locator("svg.lucide-chevron-left")).toHaveCount(0);
  await page.keyboard.press("Meta+ArrowLeft");
  await expect(page.getByRole("heading", { level: 1, name: "Alfa" })).toBeVisible({ timeout: 30_000 });
});

test("⌘-click on a game's name puts it in Open games and leaves the page as it is", async ({ page }) => {
  const { mine, list } = await alfaPlays(page);
  const openGames = page.getByRole("navigation", { name: "Open games" });
  const before = page.url();
  await list.locator(`a[href="/matches/${mine.id}"]`).first().click({ modifiers: ["Meta"] });
  await expect(page.getByText("Added to Open games")).toBeVisible();
  expect(page.url()).toBe(before);
  await expect(openGames.getByRole("button", { name: mine.title, exact: true })).toBeVisible({ timeout: 30_000 });
});
