/**
 * The Teams pages (docs/teams.md): the league's table and a team's page, on a
 * made-up league (headless/team-league.ts) the genius function's answers are
 * mocked with, so nothing depends on real standings.
 */
import type { Page } from "@playwright/test";
import { expect, mockLeague, mockRoster, recordAnalytics, shot, test, withAppModule } from "../helpers";
import { madeUpLeague } from "../team-league";

const teamRow = (page: Page, name: string) => page.getByRole("row").filter({ has: page.getByRole("link", { name, exact: true }) });

test("the league table lists every team and opens one", async ({ page, browserName }) => {
  await mockLeague(page, madeUpLeague());
  await page.goto("/teams");
  await expect(page.getByRole("heading", { level: 1, name: "Teams" })).toBeVisible({ timeout: 30_000 });
  const rows = page.getByRole("table").getByRole("row");
  await expect(rows).toHaveCount(7); // the header and six teams
  await expect(rows.nth(1)).toContainText("Alfa");
  await expect(page.getByText("Your next game")).toHaveCount(0); // the made-up league holds no team of the space
  await expect(page.getByText("Your team", { exact: true })).toHaveCount(0);
  await shot(page, `${browserName}-P-teams-league`);
  await page.getByRole("link", { name: "Alfa", exact: true }).click();
  await expect(page).toHaveURL(/\/teams\/\d+\/1$/);
});

test("a click anywhere on a team's row opens that team, not another", async ({ page }) => {
  await mockLeague(page, madeUpLeague());
  await page.goto("/teams");
  const beta = teamRow(page, "Beta");
  await expect(beta).toBeVisible({ timeout: 30_000 });
  await beta.getByRole("cell").filter({ hasText: "5–1" }).click(); // the W–L cell, away from the name
  await expect(page).toHaveURL(/\/teams\/\d+\/2$/);
  await page.goBack();
  await teamRow(page, "Alfa").getByRole("cell").first().click(); // the place, at the row's far left
  await expect(page).toHaveURL(/\/teams\/\d+\/1$/);
});

test("nothing on a team page is positioned against something outside its scroller", async ({ page }) => {
  // An absolutely positioned element whose containing block is outside the page's scroller (an sr-only <thead> did
  // this) left part of the page unpainted after an elastic scroll in the real app. The bounce can't be driven here,
  // so this checks the cause.
  await mockLeague(page, madeUpLeague());
  await page.goto("/teams");
  await page.getByRole("link", { name: "Alfa", exact: true }).click();
  await expect(page.getByRole("region", { name: "Games" })).toBeVisible({ timeout: 30_000 });
  const escaping = await page.evaluate(() => {
    const scroller = document.querySelector("[data-page-scroller]")!;
    return Array.from(scroller.querySelectorAll<HTMLElement>("*"))
      .filter((el) => {
        const position = getComputedStyle(el).position;
        if (position !== "absolute" && position !== "fixed") return false;
        const parent = el.offsetParent;
        return !parent || !scroller.contains(parent);
      })
      .map((el) => `${el.tagName.toLowerCase()}.${el.className}`);
  });
  expect(escaping).toEqual([]);
});

test("Teams is a row in the sidebar", async ({ page }) => {
  await mockLeague(page, madeUpLeague());
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Main" });
  await nav.getByRole("link", { name: "Teams", exact: true }).click();
  await expect(page).toHaveURL(/\/teams$/);
  await expect(nav.getByRole("link", { name: "Teams", exact: true })).toHaveAttribute("aria-current", "page");
});

test("two groups make two titled tables", async ({ page }) => {
  await mockLeague(page, madeUpLeague({ groups: { Norra: [1, 2, 3], Södra: [4, 5, 6] } }));
  await page.goto("/teams");
  await expect(page.getByRole("table")).toHaveCount(2, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Norra" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Södra" })).toBeVisible();
  await expect(teamRow(page, "Delta")).toContainText("1"); // first in Södra
});

test("a team's page leads with what stands out", async ({ page, browserName }) => {
  await mockLeague(page, madeUpLeague());
  await page.goto("/teams");
  await page.getByRole("link", { name: "Alfa", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Alfa" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("6 games played · none in your library yet")).toBeVisible();
  const keys = page.getByRole("region", { name: "What stands out" });
  await expect(keys.getByText("Shoot a lot of threes: 69% of shots, most in the league.", { exact: true })).toBeVisible();
  await expect(keys.getByRole("listitem")).toHaveCount(1);
  await expect(keys.getByText("Nothing stands out.", { exact: true })).toBeVisible(); // without the ball
  const play = page.getByRole("region", { name: "How they play" });
  await expect(play.getByText("Share of shots from three")).toBeVisible();
  await expect(play.getByRole("button")).toHaveCount(0); // season numbers open nothing
  await expect(play.locator("[data-season-mark]").first()).toBeAttached();
  await shot(page, `${browserName}-P-team-top`);
  await page.getByRole("button", { name: "Teams" }).click();
  await expect(page).toHaveURL(/\/teams$/);
});

test("too early to say with fewer than five games", async ({ page }) => {
  await mockLeague(page, madeUpLeague({ gamesEach: 3 }));
  await page.goto("/teams");
  await page.getByRole("link", { name: "Alfa", exact: true }).click();
  await expect(page.getByText("Too early to say what stands out: 3 games played.")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Places appear after 5 games.")).toBeVisible();
});

test("a team the season doesn't list says so", async ({ page }) => {
  await mockLeague(page, madeUpLeague());
  await page.goto("/teams/48974/999");
  await expect(page.getByText("This team isn't in this season.")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("link", { name: "Go to Teams" }).click();
  await expect(page).toHaveURL(/\/teams$/);
});

/** One of the test account's own Genius games, in the space the app opens on. */
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
  expect(game, "the test account has a Genius game of its own").not.toBeNull();
  return game!;
}

test("games link to the library and to import", async ({ page, browserName }) => {
  const mine = await aLibraryGame(page);
  await mockLeague(page, madeUpLeague({ libraryGame: mine.sourceGameId }));
  await page.goto("/teams");
  await expect(teamRow(page, "Alfa")).toContainText("1 game", { timeout: 30_000 });
  await page.getByRole("link", { name: "Alfa", exact: true }).click();
  await expect(page.getByText("6 games played · 1 in your library")).toBeVisible({ timeout: 30_000 });
  const games = page.getByRole("region", { name: "Games" });
  await expect(games.getByRole("row")).toHaveCount(1 + 1 + 5); // the header, one still to play, five played
  await games.getByRole("button", { name: "Show all 6" }).click();
  await expect(games.getByRole("row")).toHaveCount(1 + 1 + 6);
  await shot(page, `${browserName}-P-team-games`);
  await games.getByRole("link", { name: "Import" }).first().click();
  await expect(page).toHaveURL(/\/upload$/);
  await expect(page.getByText(/Alfa/).first()).toBeVisible({ timeout: 30_000 }); // the import page opened on that game
  await page.goBack();
  // The library game is the oldest: WebKit folds it away again under "Show all" on the way back, Chrome keeps it open.
  const again = page.getByRole("region", { name: "Games" });
  await expect(again.getByRole("button", { name: /^Show (all 6|fewer)$/ })).toBeVisible({ timeout: 30_000 });
  const showAll = again.getByRole("button", { name: "Show all 6" });
  if (await showAll.isVisible()) await showAll.click();
  await again.getByRole("link", { name: "In your library" }).click();
  await expect(page).toHaveURL(new RegExp(`/matches/${mine.id}\\?view=stats`));
});

test("an opponent's name opens that team", async ({ page }) => {
  await mockLeague(page, madeUpLeague());
  await page.goto("/teams");
  await page.getByRole("link", { name: "Alfa", exact: true }).click();
  await page.getByRole("region", { name: "Games" }).getByRole("link", { name: "Beta", exact: true }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Beta" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Alfa" }).click(); // Back goes to the team it came from
  await expect(page.getByRole("heading", { level: 1, name: "Alfa" })).toBeVisible();
});

test("a team without a roster says so", async ({ page }) => {
  await mockRoster(page, []);
  await mockLeague(page, madeUpLeague());
  await page.goto("/teams");
  await page.getByRole("link", { name: "Alfa", exact: true }).click();
  await expect(page.getByRole("region", { name: "Players" }).getByText("No roster for this team yet.")).toBeVisible({ timeout: 30_000 });
});

test("a game's team name opens the team, and Back returns to the game", async ({ page }) => {
  const mine = await aLibraryGame(page);
  // One answer for both pages: the made-up season lists the library game as Alfa's, so its Stats view reads it too.
  await mockLeague(page, madeUpLeague({ libraryGame: mine.sourceGameId }));
  await page.goto(`/matches/${mine.id}?view=stats`);
  const home = page.getByRole("rowheader").getByRole("link").first();
  await expect(home).toBeVisible({ timeout: 30_000 });
  await home.click();
  await expect(page).toHaveURL(/\/teams\/\d+\/1$/);
  await expect(page.getByRole("heading", { level: 1, name: "Alfa" })).toBeVisible({ timeout: 30_000 });
  // Back names the game it returns to (the sidebar's Open games has a row of that name too).
  await page.getByRole("button", { name: mine.title, exact: true }).filter({ has: page.locator("svg.lucide-chevron-left") }).click();
  await expect(page).toHaveURL(new RegExp(`/matches/${mine.id}`));
});

test("a stable team id finds this season's page", async ({ page }) => {
  await page.goto("/teams");
  await expect(page.getByRole("heading", { level: 1, name: "Teams" })).toBeVisible({ timeout: 30_000 });
  const teams = await withAppModule<null, { id: string }[]>(
    page,
    "/src/lib/my-team.tsx",
    "return (await mod.teamCatalog()).slice(0, 1).map((t) => ({ id: t.id }));",
    null,
  );
  await page.goto(`/teams/find/${teams[0].id}`);
  await expect(page).toHaveURL(/\/teams\/\d+\/\d+$/, { timeout: 30_000 });
  await page.goto("/teams/find/00000000-0000-0000-0000-000000000000");
  await expect(page.getByText("This team isn't in a league we follow.")).toBeVisible({ timeout: 30_000 });
});

test("a team page says how it was opened", async ({ page }) => {
  const tracked = await recordAnalytics(page);
  await mockLeague(page, madeUpLeague());
  await page.goto("/teams");
  await page.getByRole("link", { name: "Alfa", exact: true }).click();
  await expect(page.getByRole("region", { name: "What stands out" })).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => (await tracked()).filter((e) => e.event === "team_page_viewed").length).toBe(1);
  const shown = await page.getByRole("region", { name: "What stands out" }).getByRole("listitem").count();
  expect(shown).toBeGreaterThan(0);
  const viewed = (await tracked()).find((e) => e.event === "team_page_viewed")!;
  expect(viewed.properties).toMatchObject({ games: 6, library_games: 0, keys: shown, own_team: false, from: "teams" });
  await page.getByRole("region", { name: "Games" }).getByRole("button", { name: "Show all 6" }).click();
  await expect.poll(async () => (await tracked()).some((e) => e.event === "team_page_action" && e.properties?.action === "show_all_games")).toBe(true);
  await page.goto("/teams");
  await page.getByRole("button", { name: /· 2026\/27/ }).click();
  await page.getByRole("menuitemradio").nth(1).click();
  await expect.poll(async () => (await tracked()).some((e) => e.event === "teams_league_changed")).toBe(true);
});

test("a game with play-by-play offers Import even when the league isn't in the catalogue", async ({ page }) => {
  await mockLeague(page, madeUpLeague());
  await page.goto("/teams/99999/1"); // a competition the league catalogue doesn't list
  const games = page.getByRole("region", { name: "Games" });
  await expect(games.getByRole("link", { name: "Import" }).first()).toBeVisible({ timeout: 30_000 });
  await expect(games.getByText("No play-by-play")).toHaveCount(0);
});

test("a failed read and an older function say so", async ({ page }) => {
  await mockLeague(page, { season: "fail", fixtures: [] });
  await page.goto("/teams");
  await expect(page.getByText("Couldn't load the league.")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await mockLeague(page, { season: "unknown", fixtures: [] });
  await page.reload();
  await expect(page.getByText("This league has no team statistics.")).toBeVisible({ timeout: 30_000 });
});
