/**
 * The plays docked beside a report (docs/scouting-reports.md, "Adding clips"):
 * on a wide window + Add clips opens the plays as a panel at the report's
 * side, not a sheet over it; the panel adds to the section last asked for, a
 * play dragged onto a section lands there, Esc in the panel and the
 * toolbar's Add clips put it away, and a narrow window gets the sheet.
 * Creates "headless-<port>-<slot> Plays panel" and deletes it.
 */
import type { Locator, Page } from "@playwright/test";
import { createPlaylist, deleteOwnedPlaylists, expect, owned, readSheetRows, selectRows, selectionPill, sheetRow, shot, test, waitForPlays, withAppModule } from "../helpers";

const NAME = owned("Plays panel");

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

async function placements(page: Page, id: string): Promise<Record<string, string>> {
  const [row] = await selectRows<{ content: { placements: Record<string, string> } }>(page, "scouting_report_drafts", "content", { playlist_id: id });
  return row?.content.placements ?? {};
}

async function clipKeys(page: Page, id: string): Promise<string[]> {
  const rows = await selectRows<{ match_id: string; event_id: number; item_type: string }>(page, "playlist_clips", "match_id, event_id, item_type", { playlist_id: id });
  return rows.filter((r) => r.item_type === "clip").map((r) => `${r.match_id}:${r.event_id}`).sort();
}

const plays = (page: Page) => page.getByRole("complementary", { name: "Plays" });

async function addRow(panel: Locator, key: string) {
  const row = await sheetRow(panel, key);
  await row.locator("span.nums").first().click({ modifiers: ["Meta"] });
  await expect(row).toHaveAttribute("aria-selected", "true");
  // The pill in a narrow panel is icons only: its Add is named by its title.
  await selectionPill(panel).getByRole("button", { name: /^Add 1 play to / }).click();
}

test("on a wide window the plays dock beside the report: add, drag onto a section, put away; narrow, the sheet", { tag: "@alone:report-clips" }, async ({ page }) => {
  const id = await openReport(page);
  const keysRegion = page.getByRole("region", { name: "Keys" });
  await keysRegion.getByRole("button", { name: "Add clips" }).click();

  // Docked, not a sheet: the report stays in reach beside it.
  const panel = plays(page);
  await expect(panel).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Section to add to" })).toHaveText(/Keys/);
  await expect(page.getByRole("button", { name: "Add clips", exact: true }).first()).toHaveAttribute("aria-pressed", "true");
  await waitForPlays(panel);
  const [a, b] = [...(await readSheetRows(panel)).keys()];
  expect(b, "the panel lists at least two plays").toBeTruthy();

  // A play added from the panel goes to Keys.
  await addRow(panel, a);
  await expect(page.getByText("1 clip added to Keys")).toBeVisible();
  await expect.poll(() => placements(page, id), { timeout: 15_000 }).toEqual({ [a]: "keys" });
  await expect(keysRegion.locator(`[data-clip-key="${a}"]`)).toBeVisible();
  await shot(page, "report-plays-panel");

  // A play dragged onto Their actions lands there, and the panel adds there from now on.
  const theirs = page.getByRole("region", { name: "Their actions" });
  await theirs.scrollIntoViewIfNeeded();
  await (await sheetRow(panel, b)).dragTo(theirs);
  await expect.poll(() => clipKeys(page, id), { timeout: 15_000 }).toEqual([a, b].sort());
  await expect(theirs.locator(`[data-clip-key="${b}"]`)).toBeVisible();
  await expect(panel.getByRole("button", { name: "Section to add to" })).toHaveText(/Their actions/);

  // Esc with the keyboard in the panel puts it away; the toolbar's Add clips brings it back, and away again.
  await panel.getByRole("heading", { name: "Plays" }).click();
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/reports/${id}$`));
  const toolbarAdd = page.getByRole("button", { name: "Add clips", exact: true }).first();
  await toolbarAdd.click();
  await expect(panel).toBeVisible();
  await toolbarAdd.click();
  await expect(panel).toBeHidden();

  // A narrow window: Add clips is the sheet over the report.
  await page.setViewportSize({ width: 1000, height: 900 });
  await toolbarAdd.click();
  await expect(page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: /^Add clips to / }) })).toBeVisible();
  await expect(panel).toHaveCount(0);
});
