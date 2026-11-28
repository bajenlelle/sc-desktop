/**
 * Starting a scouting report from a team (docs/scouting-reports.md, "Starting
 * from a team"): the Team page's New report makes the playlist and the draft
 * and opens the Report view; the same button then opens it; Reports' New
 * report does the same for a typed opponent, and Blank report makes one on no
 * team, named in its Title field and renamed from the Reports list. On the made-up league
 * (headless/team-league.ts), its teams renamed into this run's own names so
 * the playlists they make can be deleted afterwards.
 */
import type { Page } from "@playwright/test";
import { createPlaylist, deleteOwnedPlaylists, expect, mockLeague, mockRoster, owned, recordAnalytics, selectRows, shot, test, withAppModule } from "../helpers";
import { madeUpLeague } from "../team-league";

const ALFA = owned("Alfa");
const TYPED = owned("Typed opponent");
const OLD = owned("Report from before sections");
const BLANK = owned("Blank named");
const RENAMED = owned("Blank renamed");

/** The made-up league with every team named `headless-<port>-<slot> <name>`. */
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
  await deleteOwnedPlaylists(page, [ALFA, TYPED, OLD, BLANK, RENAMED]);
});

test("New report on a team's page opens a report that knows the team", { tag: "@alone:team-report" }, async ({ page }) => {
  const tracked = await recordAnalytics(page);
  await openAlfa(page);
  await page.getByRole("button", { name: "New report" }).click();

  // The report's own page, for a playlist named after the team (no game against the space's team in the made-up league).
  await expect(page).toHaveURL(/\/reports\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await expect(page.getByRole("textbox", { name: "Opponent" })).toHaveValue(ALFA, { timeout: 30_000 });
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveAttribute("placeholder", ALFA);
  await expect(page.getByRole("textbox", { name: "Keys text" })).toHaveValue("Shoot a lot of threes: 69% of shots, most in the league.");
  // Back names the team it came from.
  const backToAlfa = page.getByRole("button", { name: ALFA, exact: true }).filter({ has: page.locator("svg.lucide-chevron-left") });
  await expect(backToAlfa).toBeVisible();
  // The season's sections are there, hidden from players until the coach shows them.
  await expect(page.getByRole("region", { name: "How they play" }).getByText("Hidden from players")).toBeVisible();

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
  await backToAlfa.click();
  await expect(page.getByRole("heading", { level: 1, name: ALFA })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Open report" })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Open report" }).click();
  await expect(page.getByRole("textbox", { name: "Opponent" })).toHaveValue(ALFA, { timeout: 30_000 });
  expect(await selectRows(page, "playlists", "id", { name: ALFA })).toHaveLength(1);
});

test("the team's Plays adds into the report it started", { tag: "@alone:team-report" }, async ({ page }) => {
  await openAlfa(page);
  await page.getByRole("button", { name: "New report" }).click();
  await expect(page.getByRole("textbox", { name: "Opponent" })).toHaveValue(ALFA, { timeout: 30_000 });
  const key = await page.evaluate(() => Object.keys(localStorage).find((k) => k.startsWith("scoutable_collect_target:team:")) ?? null);
  expect(key).toMatch(/:1$/);
  const [playlist] = await selectRows<{ id: string }>(page, "playlists", "id", { name: ALFA });
  expect(await page.evaluate((k) => localStorage.getItem(k), key!)).toBe(playlist.id);
});

test("Reports' New report starts an empty report for a typed opponent", { tag: ["@alone:team-report", "@smoke"] }, async ({ page }) => {
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

test("Blank report opens on its Title field; its name is the report's everywhere, renamed on the page or in the list", { tag: "@alone:team-report" }, async ({ page }) => {
  const tracked = await recordAnalytics(page);
  await page.goto("/reports");
  await expect(page.getByRole("heading", { level: 1, name: "Reports" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "New report" }).first().click();
  // First in the list, and Enter on the empty field picks it.
  await expect(page.getByRole("option").first()).toContainText("Blank report");
  await page.waitForTimeout(300); // the popover's entrance, for the shot
  await shot(page, "reports-new-blank");
  await page.getByRole("searchbox", { name: "Opponent" }).press("Enter");

  // The report opens on its Title field, with no opponent and no picker.
  const title = page.getByRole("textbox", { name: "Title" });
  await expect(title).toBeFocused({ timeout: 30_000 });
  await expect(page.getByRole("textbox", { name: "Opponent" })).toHaveValue("");
  await expect.poll(async () => (await tracked()).find((e) => e.event === "scouting_report_started")?.properties).toMatchObject({ from: "reports", opponent: "none" });

  // Typing its name names the report: the draft's title and its playlist.
  await title.fill(BLANK);
  await title.press("Enter");
  await expect.poll(async () => (await selectRows<{ id: string }>(page, "playlists", "id", { name: BLANK })).length, { timeout: 15_000 }).toBe(1);
  const [{ id }] = await selectRows<{ id: string }>(page, "playlists", "id", { name: BLANK });

  // Rename… in the Reports list: the row's name becomes a field.
  await page.goto("/reports");
  const row = page.getByRole("button", { name: `More for ${BLANK}` });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();
  await page.getByRole("menuitem", { name: "Rename…" }).click();
  const field = page.getByRole("textbox", { name: "Report name" });
  await expect(field).toBeFocused();
  await shot(page, "reports-rename-field");
  await field.fill(RENAMED);
  await field.press("Enter");
  await expect(page.getByRole("button", { name: `More for ${RENAMED}` })).toBeVisible();
  await expect.poll(async () => (await selectRows<{ name: string }>(page, "playlists", "name", { id }))[0]?.name, { timeout: 15_000 }).toBe(RENAMED);
  const [stored] = await selectRows<{ content: { title: string | null } }>(page, "scouting_report_drafts", "content", { playlist_id: id });
  expect(stored.content.title).toBe(RENAMED);

  // The page reads the same name.
  await page.goto(`/reports/${id}`);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue(RENAMED, { timeout: 30_000 });
});

test("a report's sections can be shown, added and taken out, and players see only the shown ones", { tag: "@alone:team-report" }, async ({ page }) => {
  await openAlfa(page);
  await page.getByRole("button", { name: "New report" }).click();
  const profile = page.getByRole("region", { name: "How they play" });
  await expect(profile).toBeVisible({ timeout: 30_000 });

  // Show How they play to players.
  await profile.hover();
  await profile.getByRole("button", { name: "Options for How they play" }).click();
  await page.getByRole("menuitem", { name: "Show to players" }).click();
  await expect(profile.getByText("Hidden from players")).toHaveCount(0);

  // Add a section of your own and name it.
  await page.getByRole("button", { name: "Add section" }).click();
  await page.getByRole("menuitem", { name: /Your own section/ }).click();
  const name = page.getByRole("textbox", { name: "Section name" });
  await name.fill("Out of bounds");
  await name.press("Enter");
  const own = page.getByRole("region", { name: "Out of bounds" });
  await expect(own).toBeVisible();

  // Take it out again; Undo brings it back.
  await own.hover();
  await own.getByRole("button", { name: "Options for Out of bounds" }).click();
  await page.getByRole("menuitem", { name: "Remove section" }).click();
  await expect(own).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("region", { name: "Out of bounds" })).toBeVisible();

  // What is saved: How they play shown, Their games still hidden, the coach's section there.
  await expect
    .poll(async () => {
      const [row] = await selectRows<{ content: { blocks: { kind: string; hidden: boolean; title?: string }[] } }>(
        page,
        "scouting_report_drafts",
        "content, playlists!inner(name)",
        { "playlists.name": ALFA },
      );
      return row?.content.blocks.map((b) => [b.kind, b.hidden, b.title ?? null]);
    }, { timeout: 10_000 })
    .toEqual([
      ["keys", false, null],
      ["players", false, null],
      ["actions", false, null],
      ["profile", false, null],
      ["games", true, null],
      ["custom", false, "Out of bounds"],
    ]);
});

test("a report opened from Reports goes back there, and owns its clips: no playlist, no Edit clips", { tag: "@alone:team-report" }, async ({ page }) => {
  await openAlfa(page);
  await page.getByRole("button", { name: "New report" }).click();
  await expect(page.getByRole("textbox", { name: "Opponent" })).toHaveValue(ALFA, { timeout: 30_000 });
  await page.goto("/reports");
  const row = page.getByRole("main").getByText(ALFA, { exact: true }).first();
  await row.click();
  await expect(page).toHaveURL(/\/reports\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await page.getByRole("button", { name: "Reports", exact: true }).filter({ has: page.locator("svg.lucide-chevron-left") }).click();
  await expect(page).toHaveURL(/\/reports$/);
  await page.getByRole("main").getByText(ALFA, { exact: true }).first().click();
  // The report's clips are its own: added here, never a playlist in Playlists (docs/scouting-reports.md, "The report's clips").
  await expect(page.getByRole("button", { name: "Add clips", exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Edit clips" })).toHaveCount(0);
  const [made] = await selectRows<{ kind: string }>(page, "playlists", "kind", { name: ALFA });
  expect(made?.kind).toBe("report");
  await page.goto("/playlists");
  // The list has loaded (the test account has playlists of its own).
  await expect(page.locator("[data-playlist-id]").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("[data-playlist-id]").filter({ hasText: ALFA })).toHaveCount(0);
});

test("a report from before sections has the same section controls, and takes on sections with the first change", { tag: "@alone:team-report" }, async ({ page }) => {
  const id = await createPlaylist(page, OLD);
  await withAppModule(
    page,
    "/src/lib/report-drafts-db.ts",
    `await mod.saveReportDraft(arg, { v: 1, title: null, opponent: "IK Eos", intro: "They press after makes.", sections: [], placements: {}, order: [] });`,
    id,
  );
  await page.goto(`/reports/${id}`);
  const summary = page.getByRole("textbox", { name: "Summary" });
  await expect(summary).toHaveValue("They press after makes.", { timeout: 30_000 });
  await expect(page.getByRole("region", { name: "Their actions" })).toBeVisible();
  await page.getByRole("button", { name: "Add section" }).click();
  await page.getByRole("menuitem", { name: /^Keys/ }).click();
  await expect(page.getByRole("region", { name: "Keys" })).toBeVisible();
  await expect
    .poll(async () => {
      const [row] = await selectRows<{ content: { blocks?: { kind: string }[]; intro: string } }>(page, "scouting_report_drafts", "content", { playlist_id: id });
      return [row?.content.blocks?.map((b) => b.kind), row?.content.intro];
    }, { timeout: 10_000 })
    .toEqual([["actions", "players", "keys"], "They press after makes."]);
});
