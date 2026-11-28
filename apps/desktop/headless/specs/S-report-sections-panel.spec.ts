/**
 * The report's Sections panel (docs/scouting-reports.md, "The Sections
 * panel"): the toolbar's button puts it away and back, its + adds clips to a section (and A on the focused row), the
 * section the docked plays add to is marked, a play dropped on a row lands in
 * that section, ⋯ opens the row's menu, the header's + adds a section, and a
 * section's row drags to a new place in the report.
 * Creates "headless-<port>-<slot> Sections panel" and deletes it.
 */
import type { Locator, Page } from "@playwright/test";
import { createPlaylist, deleteOwnedPlaylists, expect, owned, readSheetRows, selectRows, sheetRow, shot, test, waitForPlays, withAppModule } from "../helpers";

const NAME = owned("Sections panel");

test.afterEach(async ({ page }) => {
  await deleteOwnedPlaylists(page, [NAME]);
});

async function openReport(page: Page): Promise<string> {
  const id = await createPlaylist(page, NAME);
  const draft = {
    v: 1,
    title: null,
    opponent: "Opponent",
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
  await page.goto(`/reports/${id}`);
  await expect(page.getByRole("region", { name: "Keys" })).toBeVisible({ timeout: 30_000 });
  return id;
}

async function blockOrder(page: Page, id: string): Promise<string[]> {
  const [row] = await selectRows<{ content: { blocks: { id: string; kind: string; hidden: boolean }[] } }>(page, "scouting_report_drafts", "content", { playlist_id: id });
  return (row?.content.blocks ?? []).map((b) => (b.kind === "custom" ? "custom" : b.hidden ? `${b.id} (hidden)` : b.id));
}

async function placements(page: Page, id: string): Promise<Record<string, string>> {
  const [row] = await selectRows<{ content: { placements: Record<string, string> } }>(page, "scouting_report_drafts", "content", { playlist_id: id });
  return row?.content.placements ?? {};
}

async function clipKeys(page: Page, id: string): Promise<string[]> {
  const rows = await selectRows<{ match_id: string; event_id: number; item_type: string }>(page, "playlist_clips", "match_id, event_id, item_type", { playlist_id: id });
  return rows.filter((r) => r.item_type === "clip").map((r) => `${r.match_id}:${r.event_id}`);
}

/** Presses a row, moves it in steps to just above another and lets go: the list's own drag. */
async function dragRowAbove(page: Page, row: Locator, onto: Locator) {
  const from = (await row.boundingBox())!;
  const to = (await onto.boundingBox())!;
  await page.mouse.move(from.x + 40, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 40, from.y + from.height / 2 + 8, { steps: 4 });
  await page.mouse.move(from.x + 40, to.y - 8, { steps: 12 });
  // Held still before letting go: a release on the move is thrown on past the gap.
  await page.waitForTimeout(300);
  await page.mouse.move(from.x + 41, to.y - 8);
  await page.waitForTimeout(150);
  await page.mouse.up();
}

test("Sections: hidden and shown, + per section, the plays' target marked, ⋯, the header's +, a section dragged, a play dropped on a row", { tag: "@alone:report-clips" }, async ({ page }) => {
  const id = await openReport(page);
  const sections = page.getByRole("navigation", { name: "Sections" });
  await expect(sections.getByRole("heading", { name: "Sections" })).toBeVisible();
  const row = (sectionId: string) => sections.locator(`[data-row-key="section:${sectionId}"]`);

  // Put away and back as the playlist browser is: the toolbar's button, remembered over a reload.
  await page.getByRole("button", { name: "Hide sections" }).click();
  await expect(sections).toBeHidden();
  await page.reload();
  await expect(page.getByRole("region", { name: "Keys" })).toBeVisible({ timeout: 30_000 });
  await expect(sections).toBeHidden();
  await page.getByRole("button", { name: "Show sections" }).click();
  await expect(sections.getByRole("heading", { name: "Sections" })).toBeVisible();

  // + on Keys' row: the plays dock, adding to Keys, and the row says so.
  await row("keys").hover();
  await row("keys").getByRole("button", { name: "Add clips to Keys" }).click();
  const panel = page.getByRole("complementary", { name: "Plays" });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("button", { name: "Section to add to" })).toHaveText(/Keys/);
  await expect(row("keys")).toHaveAttribute("aria-label", /plays are added here/);
  // Docking the plays leaves Sections where the coach left it, on a window as narrow as 1280 too.
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(panel).toBeVisible();
  await expect(sections.getByRole("heading", { name: "Sections" })).toBeVisible();
  await waitForPlays(panel);
  const [a] = [...(await readSheetRows(panel)).keys()];
  await shot(page, "report-sections-panel");

  // A on the focused Their actions row turns the panel there, and the mark goes with it.
  await row("team").focus();
  await page.keyboard.press("a");
  await expect(panel.getByRole("button", { name: "Section to add to" })).toHaveText(/Their actions/);
  await expect(row("team")).toHaveAttribute("aria-label", /plays are added here/);
  await expect(row("keys")).not.toHaveAttribute("aria-label", /plays are added here/);

  // ⋯ is the row's menu: Hide from players.
  await row("keys").hover();
  await row("keys").getByRole("button", { name: "Keys options" }).click();
  await page.getByRole("menuitem", { name: "Hide from players" }).click();
  await expect.poll(() => blockOrder(page, id), { timeout: 15_000 }).toEqual(["keys (hidden)", "players", "team"]);

  // The header's + adds a section of the coach's own.
  await sections.getByRole("button", { name: "Add players or a section" }).click();
  await page.getByRole("menuitem", { name: /Your own section/ }).click();
  await expect.poll(() => blockOrder(page, id), { timeout: 15_000 }).toEqual(["keys (hidden)", "players", "team", "custom"]);
  const custom = sections.locator('[data-row-key^="section:c-"]');
  await expect(custom).toBeVisible();

  // Keys' row dragged down onto the new section's: Keys now reads after Their actions.
  await dragRowAbove(page, row("keys"), custom);
  await expect.poll(() => blockOrder(page, id), { timeout: 15_000 }).toEqual(["players", "team", "keys (hidden)", "custom"]);

  // Last, as a native drag leaves WebKit's pointer pressed for the rest of the page: a play dropped on
  // Keys' row lands in Keys, and the panel adds there from now on.
  await (await sheetRow(panel, a)).dragTo(row("keys"));
  await expect.poll(() => clipKeys(page, id), { timeout: 15_000 }).toEqual([a]);
  await expect.poll(() => placements(page, id), { timeout: 15_000 }).toEqual({ [a]: "keys" });
  await expect(panel.getByRole("button", { name: "Section to add to" })).toHaveText(/Keys/);
  await shot(page, "report-sections-panel-dropped");
});
