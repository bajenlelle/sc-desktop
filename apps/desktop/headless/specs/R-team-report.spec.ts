/**
 * Starting a scouting report from a team (docs/scouting-reports.md, "Starting
 * from a team"): the Team page's New report makes the playlist and the draft
 * and opens the Report view; the same button then opens it; Reports' New
 * report does the same for a typed opponent. On the made-up league
 * (headless/team-league.ts), its teams renamed into this run's own names so
 * the playlists they make can be deleted afterwards.
 */
import type { Page } from "@playwright/test";
import { deleteOwnedPlaylists, expect, mockLeague, mockRoster, owned, recordAnalytics, selectRows, test } from "../helpers";
import { madeUpLeague } from "../team-league";

const ALFA = owned("Alfa");
const TYPED = owned("Typed opponent");

/** The made-up league with every team named `headless-<port> <name>`. */
function ownedLeague() {
  const league = madeUpLeague();
  for (const f of league.fixtures) for (const c of f.competitors) c.teamName = owned(c.teamName);
  return league;
}

async function openAlfa(page: Page) {
  await mockRoster(page, []);
  await mockLeague(page, ownedLeague());
  await page.goto("/teams");
  await page.getByRole("link", { name: ALFA, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: ALFA })).toBeVisible({ timeout: 30_000 });
}

test.afterEach(async ({ page }) => {
  await deleteOwnedPlaylists(page, [ALFA, TYPED]);
});

test("New report on a team's page opens a report that knows the team", async ({ page }) => {
  const tracked = await recordAnalytics(page);
  await openAlfa(page);
  await page.getByRole("button", { name: "New report" }).click();

  // The Report view of a playlist named after the team (no game against the space's team in the made-up league).
  await expect(page.getByRole("textbox", { name: "Opponent" })).toHaveValue(ALFA, { timeout: 30_000 });
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveAttribute("placeholder", ALFA);
  await expect(page.getByPlaceholder("How they play: pace, sets, what to take away")).toHaveValue(
    "What stands out:\n• Shoot a lot of threes: 69% of shots, most in the league.",
  );

  const [row] = await selectRows<{ content: { team: { teamId: number; name: string } | null; game: unknown } }>(
    page,
    "scouting_report_drafts",
    "content, playlists!inner(name)",
    { "playlists.name": ALFA },
  );
  expect(row?.content.team).toMatchObject({ teamId: 1, name: ALFA });
  expect(row?.content.game).toBeNull();
  await expect.poll(async () => (await tracked()).find((e) => e.event === "scouting_report_started")?.properties).toMatchObject({
    from: "team_page",
    opponent: "league",
    players: 0,
    keys: 1,
    game: false,
  });

  // Back on the team, the button opens that report instead of making another.
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: ALFA })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Open report" })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Open report" }).click();
  await expect(page.getByRole("textbox", { name: "Opponent" })).toHaveValue(ALFA, { timeout: 30_000 });
  expect(await selectRows(page, "playlists", "id", { name: ALFA })).toHaveLength(1);
});

test("the team's Plays adds into the report it started", async ({ page }) => {
  await openAlfa(page);
  await page.getByRole("button", { name: "New report" }).click();
  await expect(page.getByRole("textbox", { name: "Opponent" })).toHaveValue(ALFA, { timeout: 30_000 });
  const key = await page.evaluate(() => Object.keys(localStorage).find((k) => k.startsWith("scoutable_collect_target:team:")) ?? null);
  expect(key).toMatch(/:1$/);
  const [playlist] = await selectRows<{ id: string }>(page, "playlists", "id", { name: ALFA });
  expect(await page.evaluate((k) => localStorage.getItem(k), key!)).toBe(playlist.id);
});

test("Reports' New report starts an empty report for a typed opponent", async ({ page }) => {
  const tracked = await recordAnalytics(page);
  await page.goto("/reports");
  await expect(page.getByRole("heading", { level: 1, name: "Reports" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "New report" }).first().click();
  const field = page.getByRole("searchbox", { name: "Opponent" });
  await field.fill(TYPED);
  await page.getByRole("option", { name: `New report for “${TYPED}”` }).click();
  await expect(page.getByRole("textbox", { name: "Opponent" })).toHaveValue(TYPED, { timeout: 30_000 });
  await expect.poll(async () => (await tracked()).find((e) => e.event === "scouting_report_started")?.properties).toMatchObject({
    from: "reports",
    opponent: "typed",
  });
});
