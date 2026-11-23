/**
 * Sending a report to players' phones from the share sheet
 * (docs/scouting-reports.md, "On players' phones"). The test account has a
 * personal space only, so its report shares by link alone; the club case runs
 * in the second space (addSecondSpace), with the report, the club's teams and
 * members, and the delivery functions answered in the browser: nothing is
 * sent from staging.
 */
import type { Page, Route } from "@playwright/test";
import { OTHER_SPACE, addSecondSpace, createPlaylist, deleteOwnedPlaylists, expect, owned, recordAnalytics, switchSpace, test } from "../helpers";

const NAME = owned("Report to send");
const REPORT_ID = "00000000-0000-4000-8000-0000000a1b2c";
const TEAM = { id: "00000000-0000-4000-8000-0000000a7ea3", org_id: OTHER_SPACE.id, name: "U18 Herr", sport: "basketball", season: null, created_at: "2026-09-01T00:00:00Z" };
const PEDRO = { id: "00000000-0000-4000-8000-0000000b0001", full_name: "Pedro Hook", avatar_url: null, email: "pedro@example.com", role: "player", joined_at: "2026-09-01T00:00:00Z" };
const ERIK = { id: "00000000-0000-4000-8000-0000000b0002", full_name: "Erik Nilsson", avatar_url: null, email: "erik@example.com", role: "player", joined_at: "2026-09-01T00:00:00Z" };

test.afterEach(async ({ page }) => {
  await deleteOwnedPlaylists(page, [NAME]);
});

/** The playlist's report reads as live, so the sheet opens on its link. */
async function liveReport(page: Page, playlistId: string) {
  await page.route(`**/rest/v1/scouting_reports?*playlist_id=eq.${playlistId}*`, (route: Route) =>
    route.request().method() === "GET"
      ? route.fulfill({
          json: {
            id: REPORT_ID,
            title: NAME,
            content_key: "headless",
            created_at: "2026-11-20T10:00:00Z",
            updated_at: "2026-11-20T10:00:00Z",
            expires_at: "2026-12-20T10:00:00Z",
            open_count: 3,
          },
        })
      : route.fallback(),
  );
}

async function openShare(page: Page, playlistId: string) {
  await page.goto(`/reports/${playlistId}`);
  // A new, empty report opens on its player picker: put it away first.
  const picker = page.getByRole("dialog").filter({ hasNotText: "Scouting report" });
  await expect(picker).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press("Escape");
  await expect(picker).toBeHidden();
  await page.getByRole("button", { name: /^(Shared|Changed since sharing)$/ }).click({ timeout: 30_000 });
  await expect(page.getByRole("dialog", { name: "Scouting report" })).toBeVisible();
}

test("a personal space's report shares by link only", async ({ page }) => {
  const playlistId = await createPlaylist(page, NAME);
  await liveReport(page, playlistId);
  await openShare(page, playlistId);
  const dialog = page.getByRole("dialog", { name: "Scouting report" });
  await expect(dialog.getByText("Share from a club space to send reports to players’ phones.")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Send to players" })).toHaveCount(0);
});

test("a club report goes to a team, and Seen by says how far each player got", async ({ page }) => {
  const tracked = await recordAnalytics(page);
  const playlistId = await createPlaylist(page, NAME);
  await addSecondSpace(page);
  await liveReport(page, playlistId);

  // The club's teams and members, and the delivery: before the send nothing, after it the team and its two players.
  let sent = false;
  const sends: unknown[] = [];
  await page.route(`**/rest/v1/teams?*org_id=eq.${OTHER_SPACE.id}*`, (route: Route) => route.fulfill({ json: [TEAM] }));
  await page.route("**/rpc/get_org_members*", async (route: Route) => {
    const body = route.request().postDataJSON() as { p_org_id?: string } | null;
    return body?.p_org_id === OTHER_SPACE.id ? route.fulfill({ json: [PEDRO, ERIK] }) : route.fallback();
  });
  await page.route("**/rpc/get_scouting_report_delivery*", (route: Route) =>
    route.fulfill({
      json: sent
        ? {
            clips: 16,
            targets: [{ teamId: TEAM.id, userId: null, name: TEAM.name, sentAt: "2026-11-23T18:00:00Z" }],
            readers: [
              { userId: ERIK.id, name: ERIK.full_name, role: "player", teamName: TEAM.name, openedAt: null, lastOpenedAt: null, watched: 0 },
              { userId: PEDRO.id, name: PEDRO.full_name, role: "player", teamName: TEAM.name, openedAt: "2026-11-23T19:00:00Z", lastOpenedAt: "2026-11-23T19:05:00Z", watched: 7 },
            ],
          }
        : { clips: 16, targets: [], readers: [] },
    }),
  );
  await page.route("**/rpc/send_scouting_report*", (route: Route) => {
    sends.push(route.request().postDataJSON());
    sent = true;
    return route.fulfill({ json: { reached: 2, notified: 2 } });
  });

  await page.goto("/");
  await switchSpace(page, OTHER_SPACE.name);
  await openShare(page, playlistId);
  const dialog = page.getByRole("dialog", { name: "Scouting report" });
  const players = dialog.getByRole("region", { name: "Players" });

  await players.getByRole("button", { name: "Send to players" }).click();
  await players.getByRole("checkbox", { name: TEAM.name }).click();
  await players.getByRole("button", { name: "Send", exact: true }).click();

  expect(sends).toEqual([{ p_report: REPORT_ID, p_team_ids: [TEAM.id], p_user_ids: [] }]);
  await expect(page.getByText("Sent to 2 people")).toBeVisible();
  await expect(players.getByText("Seen by 1 of 2")).toBeVisible();
  // Furthest first: Pedro watched 7 of the 16 clips, Erik hasn't opened it.
  const rows = players.locator(".nums").filter({ hasText: /of 16|Not yet/ });
  await expect(rows).toHaveText(["7 of 16", "Not yet"]);
  await expect(players.getByRole("button", { name: `Remove ${TEAM.name}` })).toBeVisible();
  // Not after a plain open: Notify players is for a report updated in the sheet.
  await expect(players.getByRole("button", { name: "Notify players" })).toHaveCount(0);
  await expect.poll(async () => (await tracked()).find((e) => e.event === "scouting_report_sent")?.properties).toMatchObject({
    teams: 1,
    people: 0,
    reached: 2,
  });
});
