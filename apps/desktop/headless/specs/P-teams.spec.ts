/**
 * The Teams pages (docs/teams.md): the league's table and a team's page, on a
 * made-up league (headless/team-league.ts) the genius function's answers are
 * mocked with, so nothing depends on real standings.
 */
import type { Locator, Page } from "@playwright/test";
import { type GameReadPatch, chooseNewTarget, delayPlaysReads, deleteOwnedPlaylists, expect, failPlaysReads, FIXTURE_VIDEO, mockLeague, mockRoster, openLibraryGame, owned, patchGameReads, playlistClips, recordAnalytics, selectRows, shot, test, waitForQuiet, withAppModule } from "../helpers";
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
  await expect(page.getByText("6 games played · none imported yet")).toBeVisible();
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
  await expect(page.getByText("6 games played · 1 imported")).toBeVisible({ timeout: 30_000 });
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
  await again.getByRole("link", { name: "Imported" }).click();
  await expect(page).toHaveURL(new RegExp(`/matches/${mine.id}\\?view=stats`));
});

test("an opponent's name opens that team", async ({ page }) => {
  await mockLeague(page, madeUpLeague());
  await page.goto("/teams");
  await page.getByRole("link", { name: "Alfa", exact: true }).click();
  await page.getByRole("region", { name: "Games" }).getByRole("link", { name: "Beta", exact: true }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Beta" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("main").getByRole("button", { name: "Alfa" }).click(); // Back goes to the team it came from (the sidebar's Open teams has an Alfa too)
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
  // The real team's page reads its players from Genius's hosted pages and its plays: a load cutting those off is a
  // WebKit page error ("… due to access control checks"), so the next load waits for them.
  await expect(page.getByRole("region", { name: "Players" }).locator(".animate-pulse")).toHaveCount(0, { timeout: 30_000 });
  await waitForQuiet(page);
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

/** Teams in the sidebar's page, then a team's row. */
async function openTeam(page: Page, name: string): Promise<void> {
  await page.goto("/teams");
  await page.getByRole("link", { name, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible({ timeout: 30_000 });
}

test("Season shows the coach's games beside the keys and opens their plays", async ({ page, browserName }) => {
  const mine = await aLibraryGame(page);
  await mockLeague(page, madeUpLeague({ libraryGame: mine.sourceGameId }));
  await openTeam(page, "Alfa");
  await expect(page.getByRole("button", { name: /^Watch all \d+ plays$/ })).toBeVisible({ timeout: 30_000 });
  // Alfa's one key is its threes: the line under it counts them in the coach's one game.
  const keys = page.getByRole("region", { name: "What stands out" });
  await expect(keys.getByText(/^In your game: \d+ of \d+ threes$/)).toBeVisible();
  await expect(keys.getByRole("button", { name: "Watch" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Their shots in your games" })).toBeVisible();
  await shot(page, `${browserName}-P-team-season-video`);
});

test("a team with none of your games shows no video lines", async ({ page }) => {
  await mockLeague(page, madeUpLeague());
  await openTeam(page, "Beta");
  await expect(page.getByRole("region", { name: "What stands out" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("region", { name: "Games" })).toBeVisible();
  await expect(page.getByText(/^In your/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Watch all/ })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Their shots in your games" })).toHaveCount(0);
});

/** Alfa's page with the test account's library game as one of Alfa's games. */
async function alfaWithALibraryGame(page: Page): Promise<void> {
  const mine = await aLibraryGame(page);
  await mockLeague(page, madeUpLeague({ libraryGame: mine.sourceGameId }));
  await openTeam(page, "Alfa");
  await expect(page.getByRole("button", { name: /^Watch all \d+ plays$/ })).toBeVisible({ timeout: 30_000 });
}

test("Watch on a key opens Plays with its plays picked", async ({ page, browserName }) => {
  await alfaWithALibraryGame(page);
  const line = page.getByRole("region", { name: "What stands out" }).getByText(/^In your game: \d+ of \d+ threes$/);
  const [, made, attempts] = (await line.innerText()).match(/: (\d+) of (\d+)/)!;
  await page.getByRole("region", { name: "What stands out" }).getByRole("button", { name: /^Watch/ }).click();
  await expect(page).toHaveURL(/view=plays/);
  await expect(page.getByRole("radio", { name: "Plays" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("group", { name: "Picked plays" })).toHaveText(`Threes · ${made} of ${attempts}`);
  await expect(page.getByText(new RegExp(`^${attempts} plays? in 1 game$`))).toBeVisible();
  await shot(page, `${browserName}-P-team-plays`);
});

test("flipping the side swaps a key's pill and clears a zone's", async ({ page }) => {
  await alfaWithALibraryGame(page);
  await page.getByRole("region", { name: "What stands out" }).getByRole("button", { name: /^Watch/ }).click();
  await expect(page.getByRole("group", { name: "Picked plays" })).toContainText("Threes ·");
  await page.getByRole("radio", { name: "Without the ball" }).click();
  await expect(page.getByRole("group", { name: "Picked plays" })).toContainText("Threes against them ·");
  await page.getByRole("radio", { name: "Season" }).click();
  await page.getByRole("button", { name: "Watch their shots: At the rim" }).click();
  await expect(page.getByRole("group", { name: "Picked plays" })).toContainText("At the rim ·");
  await page.getByRole("radio", { name: "Without the ball" }).click();
  await expect(page.getByRole("group", { name: "Picked plays" })).toHaveCount(0);
  await expect(page.getByText(/^\d+ plays? in 1 game$/)).toBeVisible();
});

test("Plays with none of their games offers their latest game", async ({ page }) => {
  await mockLeague(page, madeUpLeague());
  await openTeam(page, "Beta");
  await page.getByRole("radio", { name: "Plays" }).click();
  await expect(page.getByText("None of their games are imported yet.")).toBeVisible();
  await page.getByRole("link", { name: /^Import their latest game: / }).click();
  await expect(page).toHaveURL(/\/upload$/);
});

test("a game without its video is dimmed and says what to do", async ({ page }) => {
  await patchGameReads(page, { videoUrl: null });
  await alfaWithALibraryGame(page);
  await page.getByRole("radio", { name: "Plays" }).click();
  await expect(page.getByText("This game's video isn't on this computer.")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("link", { name: "Locate video" })).toBeVisible();
});

test("a pick that matches nothing says so", async ({ page }) => {
  await alfaWithALibraryGame(page);
  await page.getByRole("radio", { name: "Plays" }).click();
  // A reload whose router state names a player in none of the games (one who left, say).
  await page.evaluate(() => {
    const s = history.state as { usr?: Record<string, unknown> } | null;
    history.replaceState({ ...s, usr: { ...(s?.usr ?? {}), pick: { kind: "player", personId: 999999, name: "Nobody" }, side: "with" } }, "");
  });
  await page.reload();
  await expect(page.getByRole("group", { name: "Picked plays" })).toHaveText("Nobody · 0", { timeout: 30_000 });
  await expect(page.getByText("No plays match.")).toBeVisible();
  // The count line offers Clear filters too; this is the empty state's, the last of the two.
  await expect(page.getByRole("button", { name: "Clear filters" })).toHaveCount(2);
  await page.getByRole("button", { name: "Clear filters" }).last().click();
  await expect(page.getByText(/^\d+ plays in 1 game$/)).toBeVisible();
});

test("another team while plays are reading shows only its own games", async ({ page }) => {
  const mine = await aLibraryGame(page);
  await mockLeague(page, madeUpLeague({ libraryGame: mine.sourceGameId }));
  const release = await delayPlaysReads(page, 4000);
  await openTeam(page, "Alfa");
  await page.getByRole("radio", { name: "Plays" }).click();
  await page.getByRole("button", { name: "Teams" }).click();
  await page.getByRole("link", { name: "Beta", exact: true }).click();
  await page.getByRole("radio", { name: "Plays" }).click();
  await expect(page.getByText("None of their games are imported yet.")).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(5000); // past Alfa's held read
  await expect(page.getByText("None of their games are imported yet.")).toBeVisible();
  await expect(page.getByRole("list", { name: "Plays" })).toHaveCount(0);
  await release();
});

const PLAYS_TARGET = owned("team plays");

/**
 * Alfa's page with the Library's first game as one of Alfa's games, its video the test video (its reads are
 * answered so; the account is never written to: its own video is on another computer).
 */
async function alfaWithAPlayableGame(page: Page, patch: GameReadPatch = {}): Promise<void> {
  await page.goto("/matches");
  await deleteOwnedPlaylists(page, [PLAYS_TARGET]);
  const game = await openLibraryGame(page, 0);
  const [row] = await selectRows<{ source_game_id: string | null }>(page, "matches", "source_game_id", { id: game.id });
  expect(row?.source_game_id ?? "", "the Library's first game is a league game").toMatch(/^\d+$/);
  await patchGameReads(page, { videoUrl: FIXTURE_VIDEO, ...patch });
  await mockLeague(page, madeUpLeague({ libraryGame: Number(row.source_game_id) }));
  await openTeam(page, "Alfa");
  await page.getByRole("radio", { name: "Plays" }).click();
  await expect(page.getByRole("list", { name: "Plays" })).toBeVisible({ timeout: 30_000 });
}

/**
 * Keeps, in `window.drawn`, the key of every Plays row React draws again. Through the hook React tells its
 * developer tools of each commit: a row was drawn when its props are a new object (a memo that holds keeps the
 * old one). Call before the first navigation.
 */
async function countRowDraws(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type Fiber = { type?: { name?: string }; memoizedProps: { row?: { key: string } }; child: Fiber | null; sibling: Fiber | null };
    const drawn = new Set<string>();
    const seen = new WeakSet<object>();
    (window as unknown as { drawn: Set<string> }).drawn = drawn;
    const visit = (first: Fiber | null) => {
      for (let f = first; f; f = f.sibling) {
        // The dev build may rename the row's function ("PlayRow2").
        if (/^PlayRow\d*$/.test(f.type?.name ?? "") && f.memoizedProps?.row && !seen.has(f.memoizedProps)) {
          seen.add(f.memoizedProps);
          drawn.add(f.memoizedProps.row.key);
        }
        visit(f.child);
      }
    };
    const renderers = new Map<number, unknown>();
    (window as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__: unknown }).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true,
      renderers,
      inject(renderer: unknown) {
        renderers.set(renderers.size + 1, renderer);
        return renderers.size;
      },
      onCommitFiberRoot(_id: number, root: { current: Fiber }) {
        visit(root.current.child);
      },
      onCommitFiberUnmount() {},
      onPostCommitFiberRoot() {},
      checkDCE() {},
    };
  });
}

/** The nth play row drawn in Plays (the list draws the rows near the view). */
const playRow = (page: Page, n: number) => page.getByRole("list", { name: "Plays" }).locator("[data-key]").nth(n);

/** Makes this spec's labels in the space of the game behind `key` ("gameId:eventId"), on these plays. */
async function makeLabels(page: Page, key: string, names: readonly string[], on: readonly string[]): Promise<void> {
  await page.evaluate(
    async ({ gameId, names, on }) => {
      const { createClient } = await import("/src/lib/supabase/client.ts" as string);
      const labels = await import("/src/lib/labels-db.ts" as string);
      const { data } = await createClient().from("matches").select("org_id").eq("id", gameId).single();
      const orgId = (data as { org_id: string }).org_id;
      for (const name of names) {
        const label = await labels.createLabel(orgId, name, "violet");
        if (on.length > 0) {
          await labels.bulkAssign(orgId, on.map((k) => ({ matchId: k.split(":")[0], eventId: Number(k.split(":")[1]) })), label.id, "add");
        }
      }
    },
    { gameId: key.split(":")[0], names: [...names], on: [...on] },
  );
}

async function deleteLabels(page: Page, names: readonly string[]): Promise<void> {
  await page.evaluate(async (names) => {
    const { createClient } = await import("/src/lib/supabase/client.ts" as string);
    const sb = createClient();
    const { data: auth } = await sb.auth.getUser();
    const { error } = await sb.from("labels").delete().eq("user_id", auth.user!.id).in("name", names);
    if (error) throw new Error(`headless: label cleanup failed: ${error.message}`);
  }, [...names]);
}

/** Reads the page again into Plays (the routes the page was given stay). */
async function reopenPlays(page: Page): Promise<void> {
  await page.reload();
  await page.getByRole("radio", { name: "Plays" }).click({ timeout: 30_000 });
  await expect(page.getByRole("list", { name: "Plays" })).toBeVisible({ timeout: 30_000 });
}

const opacityOf = (l: Locator) => l.evaluate((el) => Number(getComputedStyle(el).opacity));

const playing = (page: Page) => page.evaluate(() => Array.from(document.querySelectorAll("video")).some((v) => !v.paused));
const litRow = (page: Page) => page.getByRole("list", { name: "Plays" }).locator("[aria-current=true]");

test.describe("playing and collecting", () => {
  test.afterEach(async ({ page }) => {
    await deleteOwnedPlaylists(page, [PLAYS_TARGET]);
  });

  test("Plays plays a play and adds it to a new playlist", async ({ page, browserName }) => {
    await alfaWithAPlayableGame(page);
    await playRow(page, 0).click();
    await expect.poll(() => playing(page), { timeout: 20_000 }).toBe(true);
    await page.keyboard.press("a"); // no target yet: the picker opens, and the play goes in once one is made
    await page.getByPlaceholder("Search or create…").fill(PLAYS_TARGET);
    await page.getByRole("button", { name: `Create “${PLAYS_TARGET}”` }).click();
    await expect.poll(() => playlistClips(page, PLAYS_TARGET).then((c) => c?.length ?? 0), { timeout: 15_000 }).toBe(1);
    await expect(page.getByRole("button", { name: `Adding to ${PLAYS_TARGET}. Change playlist` })).toBeVisible();
    await shot(page, `${browserName}-P-team-plays-playing`);
  });

  test("↓ moves to the next play and G opens the labels", async ({ page }) => {
    await alfaWithAPlayableGame(page);
    const rows = page.getByRole("list", { name: "Plays" }).locator("[data-key]");
    await rows.first().click();
    await expect(litRow(page)).toHaveAttribute("data-key", (await rows.first().getAttribute("data-key"))!);
    const second = (await rows.nth(1).getAttribute("data-key"))!;
    await page.keyboard.press("ArrowDown");
    await expect(litRow(page)).toHaveAttribute("data-key", second);
    await page.keyboard.press("g");
    await expect(page.getByPlaceholder("Search or create…")).toBeVisible();
    await page.keyboard.press("Escape");
  });
});

test("a game whose plays can't be read is said on Season, and Try again reads it", async ({ page }) => {
  const mine = await aLibraryGame(page);
  await mockLeague(page, madeUpLeague({ libraryGame: mine.sourceGameId }));
  const release = await failPlaysReads(page);
  await openTeam(page, "Alfa");
  const said = page.getByText("Couldn't read the plays of your game.");
  await expect(said).toBeVisible({ timeout: 30_000 });
  await release();
  await page.getByRole("region", { name: "Season" }).getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("button", { name: /^Watch all \d+ plays$/ })).toBeVisible({ timeout: 30_000 });
  await expect(said).toHaveCount(0);
});

test("Plays never says none of their games are yours before the library is read", async ({ page }) => {
  const mine = await aLibraryGame(page);
  await mockLeague(page, madeUpLeague({ libraryGame: mine.sourceGameId }));
  await openTeam(page, "Alfa");
  await page.getByRole("radio", { name: "Plays" }).click();
  await expect(page.getByRole("list", { name: "Plays" })).toBeVisible({ timeout: 30_000 });
  // The Library's read held back: a reload into Plays must wait for it, not say the team has none of the coach's games.
  await page.route("**/rest/v1/matches*", async (route) => {
    if (route.request().method() === "GET" && !route.request().url().includes("play_by_play_events")) await new Promise((r) => setTimeout(r, 8000));
    await route.fallback();
  });
  await page.reload();
  const none = page.getByText("None of their games are imported yet.");
  await expect(page.getByRole("radio", { name: "Plays" })).toBeVisible({ timeout: 30_000 });
  for (let i = 0; i < 24; i++) {
    await expect(none).toHaveCount(0);
    await page.waitForTimeout(250);
  }
  await expect(page.getByRole("list", { name: "Plays" })).toBeVisible({ timeout: 30_000 });
});

test("opening a team counts as one view however often its views switch", async ({ page }) => {
  const tracked = await recordAnalytics(page);
  const mine = await aLibraryGame(page);
  await mockLeague(page, madeUpLeague({ libraryGame: mine.sourceGameId }));
  await openTeam(page, "Alfa");
  await expect(page.getByRole("button", { name: /^Watch all \d+ plays$/ })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("radio", { name: "Plays" }).click();
  await expect(page.getByRole("list", { name: "Plays" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("radio", { name: "Without the ball" }).click();
  await page.getByRole("radio", { name: "Season" }).click();
  await page.getByRole("radio", { name: "Plays" }).click();
  await page.waitForTimeout(1000);
  const events = await tracked();
  expect(events.filter((e) => e.event === "team_page_viewed")).toHaveLength(1);
  expect(events.filter((e) => e.event === "team_plays_viewed")).toHaveLength(1);
});

test.describe("collecting from a team", () => {
  test.afterEach(async ({ page }) => {
    await deleteOwnedPlaylists(page, [PLAYS_TARGET]);
  });

  test("another team's Plays starts without the last team's playlist", async ({ page }) => {
    await alfaWithAPlayableGame(page);
    await playRow(page, 0).click();
    await page.keyboard.press("a");
    await page.getByPlaceholder("Search or create…").fill(PLAYS_TARGET);
    await page.getByRole("button", { name: `Create “${PLAYS_TARGET}”` }).click();
    await expect(page.getByRole("button", { name: `Adding to ${PLAYS_TARGET}. Change playlist` })).toBeVisible({ timeout: 15_000 });
    // Zeta played that same game: its page, from Alfa's games, is the same page with another team.
    await page.getByRole("radio", { name: "Season" }).click();
    await page.getByRole("region", { name: "Games" }).getByRole("link", { name: "Zeta", exact: true }).first().click();
    await expect(page.getByRole("heading", { level: 1, name: "Zeta" })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("radio", { name: "Plays" }).click();
    await expect(page.getByRole("list", { name: "Plays" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Choose the playlist to add plays to" })).toBeVisible();
    await expect(page.getByRole("button", { name: `Adding to ${PLAYS_TARGET}. Change playlist` })).toHaveCount(0);
  });

  test("a letter typed in a filter menu doesn't add or label the play", async ({ page }) => {
    await alfaWithAPlayableGame(page);
    await playRow(page, 0).click();
    await page.getByRole("button", { name: "Player" }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("a");
    await page.keyboard.press("g");
    await expect(page.getByPlaceholder("Search or create…")).toHaveCount(0);
    await page.keyboard.press("Escape");
  });
});

test.describe("a play's row", () => {
  const LABELS = [owned("row label one"), owned("row label two"), owned("row label three")];
  test.afterEach(async ({ page }) => {
    await deleteOwnedPlaylists(page, [PLAYS_TARGET]);
    await deleteLabels(page, LABELS);
  });

  test("a play's + adds that play, and its row then says it's in the playlist", async ({ page }) => {
    await alfaWithAPlayableGame(page);
    await chooseNewTarget(page, PLAYS_TARGET);
    const row = playRow(page, 2);
    const key = (await row.getAttribute("data-key"))!;
    await row.hover();
    await row.getByRole("button", { name: `Add to ${PLAYS_TARGET}`, exact: true }).click();
    await expect(row.getByRole("button", { name: `In ${PLAYS_TARGET}. Remove`, exact: true })).toBeVisible();
    await expect.poll(() => playlistClips(page, PLAYS_TARGET).then((c) => c?.map((x) => `${x.matchId}:${x.eventId}`)), { timeout: 15_000 }).toEqual([key]);
  });

  test("Label on a row outside the selection labels that row alone", async ({ page }) => {
    await alfaWithAPlayableGame(page);
    await makeLabels(page, (await playRow(page, 0).getAttribute("data-key"))!, [LABELS[0]], []);
    await reopenPlays(page);
    await playRow(page, 0).click({ modifiers: ["ControlOrMeta"] });
    await playRow(page, 1).click({ modifiers: ["ControlOrMeta"] });
    const fourth = playRow(page, 3);
    await fourth.hover();
    await fourth.getByRole("button", { name: "Label this play" }).click();
    await page.getByRole("listbox", { name: "Labels" }).getByRole("option", { name: LABELS[0], exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(fourth).toContainText(LABELS[0]);
    await expect(playRow(page, 0)).not.toContainText(LABELS[0]);
    await expect(playRow(page, 1)).not.toContainText(LABELS[0]);
    await expect(playRow(page, 0)).toHaveAttribute("aria-pressed", "true");
    await expect(playRow(page, 1)).toHaveAttribute("aria-pressed", "true");
  });

  test("the menu on a selected row adds the selection", async ({ page }) => {
    await alfaWithAPlayableGame(page);
    await chooseNewTarget(page, PLAYS_TARGET);
    await playRow(page, 0).click({ modifiers: ["ControlOrMeta"] });
    await playRow(page, 1).click({ modifiers: ["ControlOrMeta"] });
    await playRow(page, 1).click({ button: "right" });
    await page.getByRole("menuitem", { name: `Add 2 plays to ${PLAYS_TARGET}` }).click();
    await expect.poll(() => playlistClips(page, PLAYS_TARGET).then((c) => c?.length ?? 0), { timeout: 15_000 }).toBe(2);
  });

  test("a long name with three labels fits its row at the narrowest window", async ({ page, browserName }) => {
    await page.setViewportSize({ width: 1024, height: 720 });
    await alfaWithAPlayableGame(page);
    // The drawn row with the longest text gets three labels.
    let longest = { key: "", length: 0 };
    for (let i = 0; i < 12; i++) {
      const r = playRow(page, i);
      const text = (await r.textContent()) ?? "";
      if (text.length > longest.length) longest = { key: (await r.getAttribute("data-key"))!, length: text.length };
    }
    await makeLabels(page, longest.key, LABELS, [longest.key]);
    await reopenPlays(page);
    const row = page.locator(`[data-key="${longest.key}"]`);
    await row.hover();
    const box = (await row.boundingBox())!;
    expect(Math.round(box.height)).toBe(32);
    expect(await row.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    // Every cell keeps to one line: the clock ("Q1 09:47") doesn't break over two.
    const clock = (await row.locator(":scope > span").nth(1).boundingBox())!;
    expect(clock.height).toBeLessThan(24);
    const add = (await row.getByRole("button", { name: /^Add to / }).boundingBox())!;
    expect(add.x + add.width).toBeLessThanOrEqual(box.x + box.width + 0.5);
    await shot(page, `${browserName}-P-team-plays-narrow`);
  });

  test("hovering a row or adding its play never moves its words", async ({ page }) => {
    await alfaWithAPlayableGame(page);
    await chooseNewTarget(page, PLAYS_TARGET);
    await page.mouse.move(5, 5);
    const row = playRow(page, 2);
    const words = row.locator(":scope > span").nth(3);
    const before = (await words.boundingBox())!;
    await row.hover();
    expect(await words.boundingBox()).toEqual(before);
    await row.getByRole("button", { name: `Add to ${PLAYS_TARGET}`, exact: true }).click();
    await expect(row.getByRole("button", { name: `In ${PLAYS_TARGET}. Remove`, exact: true })).toBeVisible();
    expect(await words.boundingBox()).toEqual(before);
  });

  test("an overtime play's clock keeps within its cell", async ({ page }) => {
    await alfaWithAPlayableGame(page, { period: 5 });
    const row = playRow(page, 0);
    const clock = row.locator(":scope > span").nth(1);
    await expect(clock).toHaveText(/^OT1 \d\d:\d\d$/);
    expect(await clock.evaluate((el) => el.scrollWidth <= el.clientWidth), "the clock fits its cell").toBe(true);
    const event = (await row.locator(":scope > span").nth(2).boundingBox())!;
    const box = (await clock.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(event.x);
  });

  test("a click on one play draws that row again and no other", async ({ page }) => {
    await countRowDraws(page);
    await alfaWithAPlayableGame(page);
    const third = playRow(page, 2);
    const key = (await third.getAttribute("data-key"))!;
    await page.evaluate(() => (window as unknown as { drawn: Set<string> }).drawn.clear());
    await third.click({ modifiers: ["ControlOrMeta"] });
    await expect(third).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate(() => [...(window as unknown as { drawn: Set<string> }).drawn])).toEqual([key]);
  });

  test("a row's label picker field takes the pointer as any field does", async ({ page }) => {
    await alfaWithAPlayableGame(page);
    const row = playRow(page, 0);
    await row.hover();
    await row.getByRole("button", { name: "Label this play" }).click();
    const field = page.getByPlaceholder("Search or create…");
    await field.fill("abc");
    // A click at the field's start puts the caret there (the row's press guard must not reach into the picker).
    await field.click({ position: { x: 1, y: 8 } });
    await page.keyboard.type("x");
    await expect(field).toHaveValue("xabc");
    // A right-click in the field keeps the system's Cut, Copy and Paste: nothing cancels its context menu.
    await page.evaluate(() => {
      // Kept from the capture phase and read once the event is done, whoever stops it on the way.
      window.addEventListener("contextmenu", (e) => ((window as unknown as { menuEvent: Event }).menuEvent = e), { capture: true, once: true });
    });
    await field.click({ button: "right" });
    expect(await page.evaluate(() => (window as unknown as { menuEvent?: Event }).menuEvent?.defaultPrevented)).toBe(false);
    await expect(page.getByRole("menuitem")).toHaveCount(0);
    await page.keyboard.press("Escape");
  });

  test("the play on screen shows its actions without the pointer", async ({ page }) => {
    await alfaWithAPlayableGame(page);
    await playRow(page, 0).click();
    await page.keyboard.press("ArrowDown");
    await page.mouse.move(5, 5);
    const current = playRow(page, 1);
    await expect(current).toHaveAttribute("aria-current", "true");
    await expect.poll(() => opacityOf(current.getByRole("button", { name: "Label this play" }))).toBe(1);
    await expect.poll(() => opacityOf(current.getByRole("button", { name: /^Add to / }))).toBe(1);
    await expect.poll(() => opacityOf(playRow(page, 4).getByRole("button", { name: /^Add to / }))).toBe(0);
  });
});

test.describe("labels from the keys, as in the game view", () => {
  const KEYED = owned("keyed label");
  const SLOT = 9;
  /** The label that had the key before this test took it, given it back after. */
  let heldBy: string | null = null;

  test.afterEach(async ({ page }) => {
    await deleteLabels(page, [KEYED]);
    if (heldBy) {
      const id = heldBy;
      await page.evaluate(
        async ({ id, slot }) => {
          const labels = await import("/src/lib/labels-db.ts" as string);
          await labels.setLabelHotkey(id, slot);
        },
        { id, slot: SLOT },
      );
      heldBy = null;
    }
  });

  /** This spec's label on the key, in the space of the game behind `key`. */
  async function keyedLabel(page: Page, key: string): Promise<void> {
    await makeLabels(page, key, [KEYED], []);
    heldBy = await page.evaluate(
      async ({ gameId, name, slot }) => {
        const { createClient } = await import("/src/lib/supabase/client.ts" as string);
        const labels = await import("/src/lib/labels-db.ts" as string);
        const sb = createClient();
        const { data: game } = await sb.from("matches").select("org_id").eq("id", gameId).single();
        const all = (await labels.listLabels((game as { org_id: string }).org_id)) as Array<{ id: string; name: string; hotkey: number | null }>;
        const before = all.find((l) => l.hotkey === slot && l.name !== name)?.id ?? null;
        await labels.setLabelHotkey(all.find((l) => l.name === name)!.id, slot);
        return before;
      },
      { gameId: key.split(":")[0], name: KEYED, slot: SLOT },
    );
  }

  test("Option shows the keys; ⌥digit labels the play on screen into the Now bar; ⇧G puts the last label on the next", async ({ page, browserName }) => {
    await alfaWithAPlayableGame(page);
    await keyedLabel(page, (await playRow(page, 0).getAttribute("data-key"))!);
    await reopenPlays(page);
    await playRow(page, 0).click();
    await expect(litRow(page)).toHaveCount(1);

    // Option held for a moment shows which label each key puts on, over the footage, and goes when let go.
    const keysCard = page.getByText("Label keys", { exact: true });
    await page.keyboard.down("Alt");
    await expect(keysCard).toBeVisible();
    await expect(keysCard.locator("..")).toContainText(KEYED);
    await shot(page, `${browserName}-P-team-plays-label-keys`);
    await page.keyboard.up("Alt");
    await expect(keysCard).toBeHidden();

    // ⌥9 puts the label on the play on screen: in its row, in the bar under the player, and said with Undo.
    const video = page.getByRole("region", { name: "Video" });
    await page.keyboard.press(`Alt+Digit${SLOT}`);
    await expect(page.getByText(`Labelled ${KEYED}`)).toBeVisible();
    await expect(playRow(page, 0)).toContainText(KEYED);
    await expect(video).toContainText(KEYED);
    await shot(page, `${browserName}-P-team-plays-labelled`);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(playRow(page, 0)).not.toContainText(KEYED);

    // ⇧G: the label used last goes on the next play, and the bar then has nothing more to put on.
    await page.keyboard.press("ArrowDown");
    await expect(litRow(page)).toHaveAttribute("data-key", (await playRow(page, 1).getAttribute("data-key"))!);
    await page.keyboard.press("Shift+KeyG");
    await expect(playRow(page, 1)).toContainText(KEYED);
    await expect(video.getByRole("button", { name: `Label this play ${KEYED} again` })).toBeDisabled();
  });
});

test("dragging the divider resizes the list and the player, and the split is kept", async ({ page }) => {
  await alfaWithAPlayableGame(page);
  await playRow(page, 0).click();
  const list = page.getByRole("region", { name: "Their plays" });
  const video = page.getByRole("region", { name: "Video" });
  const divider = page.getByRole("separator");
  await expect(divider).toHaveCount(1);
  const before = (await list.boundingBox())!.width;
  const playerBefore = (await page.locator("video").first().boundingBox())!.width;
  const at = (await divider.boundingBox())!;
  await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
  await page.mouse.down();
  await page.mouse.move(at.x + at.width / 2 + 160, at.y + at.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => Math.round((await list.boundingBox())!.width - before)).toBeGreaterThan(100);
  // A narrower video column: the player gives way, and still fits its column without a scroll.
  await expect.poll(async () => (await page.locator("video").first().boundingBox())!.width).toBeLessThan(playerBefore);
  expect(await video.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
  const after = (await list.boundingBox())!.width;
  await reopenPlays(page);
  await expect.poll(async () => Math.abs((await list.boundingBox())!.width - after)).toBeLessThan(4);
});
