/**
 * Adding many plays at once in Add clips, docked beside a report (docs/game-view.md, "Picking plays"; the same
 * rules as the game view and Teams' Plays): the count line's check selects every listed play the section can
 * take, the line becomes the selection's bar with "Add {n} to {section}", a plain click plays a play and keeps
 * the picked ones, the Now bar's Add says how many it adds, a right-click on a selected row adds them all, and a
 * filter that hides picked plays lets go of them. Creates "headless-<port>-<slot> Bulk add" and deletes it.
 */
import type { Page } from "@playwright/test";
import { createPlaylist, deleteOwnedPlaylists, eventCount, expect, owned, readSheetRows, selectRows, sheetRow, shot, test, waitForPlays, withAppModule } from "../helpers";

const NAME = owned("Bulk add");

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

test("select all, the bar, a plain click, the Now bar, right-click and a filter, in Add clips beside a report", { tag: "@alone:report-clips" }, async ({ page }) => {
  const id = await openReport(page);
  await page.getByRole("region", { name: "Keys" }).getByRole("button", { name: "Add clips" }).click();
  const panel = page.getByRole("complementary", { name: "Plays" });
  await expect(panel).toBeVisible();
  await waitForPlays(panel);
  const types = panel.getByRole("group", { name: "Event type" });
  await types.getByRole("button", { name: "2PT made" }).click();
  await expect.poll(() => eventCount(panel)).toBeGreaterThan(2);
  const listed = await eventCount(panel);
  const bar = panel.getByRole("toolbar", { name: "Selection" });

  // The count line's check selects every listed play, and the line becomes the bar.
  await panel.getByRole("checkbox", { name: `Select all ${listed}` }).click();
  await expect(bar.getByRole("status")).toHaveText(`${listed} selected`);
  const addAll = bar.getByRole("button", { name: `Add ${listed} plays to Keys` });
  await expect(addAll).toContainText(`Add ${listed}`);
  await expect(panel.getByRole("checkbox", { name: "Deselect all" })).toHaveAttribute("aria-checked", "true");
  // Every listed row shows it is picked: its check on, its row filled.
  const first = panel.locator("[role=row][data-row-key]").first();
  await expect(first).toHaveAttribute("aria-selected", "true");
  await expect(first.locator('[data-row-check="on"]')).toBeVisible();
  await shot(page, "plays-bulk-add-bar");

  // A plain click plays a play and keeps the picked ones; the Now bar's Add says how many it adds.
  const [a, b] = [...(await readSheetRows(panel)).keys()];
  await (await sheetRow(panel, b)).locator("span.nums").first().click();
  await expect(bar.getByRole("status")).toHaveText(`${listed} selected`);
  await expect(panel.getByRole("button", { name: `Add ${listed} plays to Keys` }).last()).toHaveText(new RegExp(`Add ${listed}`));

  // × lets them go; ⌘-click two, and a right-click on one of them adds both.
  await bar.getByRole("button", { name: "Deselect all" }).click();
  await expect(bar).toHaveCount(0);
  for (const key of [a, b]) await (await sheetRow(panel, key)).locator("span.nums").first().click({ modifiers: ["Meta"] });
  await expect(bar.getByRole("status")).toHaveText("2 selected");
  await (await sheetRow(panel, a)).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Add 2 plays to Keys" }).click();
  await expect.poll(() => placements(page, id), { timeout: 15_000 }).toEqual({ [a]: "keys", [b]: "keys" });
  await expect(bar).toHaveCount(0);

  // Select all now leaves out the two Keys has.
  await panel.getByRole("checkbox", { name: `Select all ${listed - 2}` }).click();
  await expect(bar.getByRole("status")).toHaveText(`${listed - 2} selected`);

  // A filter that hides the picked plays lets go of them: what is selected is always what is listed.
  await types.getByRole("button", { name: "2PT made" }).click();
  await types.getByRole("button", { name: "3PT made" }).click();
  await expect(bar).toHaveCount(0);
});
