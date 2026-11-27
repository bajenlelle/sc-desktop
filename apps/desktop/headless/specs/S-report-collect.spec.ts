/**
 * A report owns its clips (docs/scouting-reports.md, "The report's clips";
 * docs/game-view.md, "Collecting"): the game view's play menu adds a play to
 * a report's section, the target picker lists reports apart, the playlist
 * editor's New report makes a report from a copy of its clips, and Delete
 * report takes a report and its own clips away. Creates
 * "headless-<port>-<slot> Report target", "… Kept playlist" and deletes them.
 */
import type { Page } from "@playwright/test";
import { deleteOwnedPlaylists, expect, newPlaylistWithClips, openLibraryGame, owned, playRows, selectRows, showGameView, test, withAppModule } from "../helpers";

const REPORT = owned("Report target");
const KEPT = owned("Kept playlist");

test.afterEach(async ({ page }) => {
  await deleteOwnedPlaylists(page, [REPORT, KEPT]);
});

/** A report that owns its clips (as New report makes one), with Keys, players and Their actions. */
async function makeReport(page: Page): Promise<string> {
  const id = await withAppModule<string, string>(page, "/src/lib/team-report.ts", `return await mod.createNamedReport(arg, { orgId: null });`, REPORT);
  const draft = {
    v: 1,
    title: null,
    opponent: REPORT,
    intro: "",
    sections: [],
    placements: {},
    order: [],
    blocks: [
      { id: "keys", kind: "keys", hidden: false, text: "Box out" },
      { id: "players", kind: "players", hidden: false },
      { id: "team", kind: "actions", hidden: false, text: "" },
    ],
  };
  await withAppModule(page, "/src/lib/report-drafts-db.ts", `await mod.saveReportDraft(arg.id, arg.draft);`, { id, draft });
  return id;
}

async function placements(page: Page, id: string): Promise<Record<string, string>> {
  const [row] = await selectRows<{ content: { placements: Record<string, string> } }>(page, "scouting_report_drafts", "content", { playlist_id: id });
  return row?.content.placements ?? {};
}

test("the game view's play menu adds a play to a report's section, and the picker lists reports apart", { tag: "@alone:report-clips" }, async ({ page }) => {
  await page.goto("/matches");
  const id = await makeReport(page);
  const [made] = await selectRows<{ kind: string; org_id: string | null }>(page, "playlists", "kind, org_id", { id });
  expect(made?.kind).toBe("report");

  await openLibraryGame(page, 0);
  await showGameView(page);
  const first = playRows(page).nth(0);
  const key = await first.getAttribute("data-row-key");
  await first.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Add to report" }).click();
  await page.getByRole("menuitem", { name: REPORT }).click();
  await page.getByRole("menuitem", { name: "Keys", exact: true }).click();
  await expect(page.getByText(`Added to ${REPORT} · Keys`)).toBeVisible();

  // The clip is the report's, pinned to Keys (unless Keys is where it lands by itself, which it never is).
  await expect.poll(async () => (await selectRows<{ match_id: string; event_id: number }>(page, "playlist_clips", "match_id, event_id", { playlist_id: id })).map((r) => `${r.match_id}:${r.event_id}`), { timeout: 15_000 }).toEqual([key]);
  await expect.poll(() => placements(page, id), { timeout: 15_000 }).toEqual({ [key!]: "keys" });

  // The target picker: the report under Reports, apart from the playlists.
  await page.getByRole("button", { name: /^(Choose the playlist to add plays to|Adding to .*\. Change playlist)$/ }).click();
  await page.getByPlaceholder("Search or create…").fill(REPORT);
  await expect(page.getByRole("dialog").getByText("Reports", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: REPORT }).click();
  await expect(page.getByRole("button", { name: "Open report" })).toBeVisible();
  await page.getByRole("button", { name: "Open report" }).click();
  await expect(page).toHaveURL(new RegExp(`/reports/${id}$`), { timeout: 30_000 });
  await expect(page.getByRole("region", { name: "Keys" }).locator(`[data-clip-key="${key}"]`)).toBeVisible({ timeout: 30_000 });
});

test("the editor's New report makes a report from a copy of the playlist's clips, and Delete report takes it away", { tag: "@alone:report-clips" }, async ({ page }) => {
  const keys = await newPlaylistWithClips(page, KEPT, { count: 2 });
  await page.getByRole("button", { name: "New report" }).click();
  await expect(page).toHaveURL(/\/reports\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  const id = new URL(page.url()).pathname.split("/").at(-1)!;
  // A new report opens on its player picker: put it away.
  const picker = page.getByRole("dialog");
  await expect(picker).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press("Escape");
  await expect(picker).toBeHidden();

  const rows = await selectRows<{ id: string; kind: string }>(page, "playlists", "id, kind", { name: KEPT });
  expect(rows.map((r) => r.kind).sort()).toEqual(["playlist", "report"]);
  const copied = await selectRows<{ match_id: string; event_id: number }>(page, "playlist_clips", "match_id, event_id", { playlist_id: id });
  expect(copied.map((r) => `${r.match_id}:${r.event_id}`).sort()).toEqual([...keys].sort());
  await expect(page.getByRole("button", { name: "Edit clips" })).toHaveCount(0);

  // Delete report: asked first; then on to Reports, the report's own clips gone, the playlist kept.
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Delete report…" }).click();
  const dialog = page.getByRole("dialog").filter({ hasText: "This can’t be undone." });
  await expect(dialog.getByText("Its clips go with it.")).toBeVisible();
  await dialog.getByRole("button", { name: "Delete report" }).click();
  await expect(page).toHaveURL(/\/reports$/, { timeout: 30_000 });
  await expect.poll(async () => (await selectRows<{ kind: string }>(page, "playlists", "kind", { name: KEPT })).map((r) => r.kind), { timeout: 15_000 }).toEqual(["playlist"]);
});
