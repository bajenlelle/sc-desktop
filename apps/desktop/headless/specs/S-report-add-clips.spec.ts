/**
 * Adding clips from inside a scouting report (docs/scouting-reports.md,
 * "Adding clips"): + Add clips under a section opens the Add clips sheet
 * adding to that section, the clips land there, a play already in another
 * section moves here, Undo takes an add back, the toolbar's Add clips lets
 * each clip go to its player, and a player's section starts the sheet on
 * that player. Creates "headless-<port>-<slot> Report clips" and deletes it.
 */
import type { Locator, Page } from "@playwright/test";
import { createPlaylist, deleteOwnedPlaylists, expect, filterButton, owned, readSheetRows, selectRows, selectionPill, sheetRow, shot, test, waitForPlays, withAppModule } from "../helpers";

const NAME = owned("Report clips");
// The sheet: a window too narrow for the plays to dock beside the report (S-report-plays-panel covers the docked panel).
test.use({ viewport: { width: 1060, height: 900 } });

test.afterEach(async ({ page }) => {
  await deleteOwnedPlaylists(page, [NAME]);
});

interface Section {
  id: string;
  player: { id: string; name: string; number: string | null; teamId: string | null; teamName: string };
  note: string;
  stats: null;
}

/** A report with Keys, players and Their actions, saved before the page opens, so it opens as it is. */
async function openReport(page: Page, sections: Section[] = []): Promise<string> {
  const id = await createPlaylist(page, NAME);
  const draft = {
    v: 1,
    title: null,
    opponent: "Opponent",
    intro: "",
    sections,
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

/** The report's Add clips sheet (its heading names the report). */
const reportSheet = (page: Page) => page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: /^Add clips to / }) });

async function placements(page: Page, id: string): Promise<Record<string, string>> {
  const [row] = await selectRows<{ content: { placements: Record<string, string> } }>(page, "scouting_report_drafts", "content", { playlist_id: id });
  return row?.content.placements ?? {};
}

async function clipKeys(page: Page, id: string): Promise<string[]> {
  const rows = await selectRows<{ match_id: string; event_id: number; item_type: string }>(page, "playlist_clips", "match_id, event_id, item_type", { playlist_id: id });
  return rows.filter((r) => r.item_type === "clip").map((r) => `${r.match_id}:${r.event_id}`).sort();
}

/** Ticks these rows and adds them with the selection pill. */
async function addRows(sheet: Locator, keys: readonly string[], pillLabel: RegExp) {
  for (const key of keys) {
    const row = await sheetRow(sheet, key);
    await row.locator("span.nums").first().click({ modifiers: ["Meta"] });
    await expect(row).toHaveAttribute("aria-selected", "true");
  }
  await selectionPill(sheet).getByRole("button", { name: pillLabel }).click();
}

test("+ Add clips under a section adds there, moves a play from another section, and Undo takes an add back", { tag: "@alone:report-clips" }, async ({ page }) => {
  const id = await openReport(page);
  const keysRegion = page.getByRole("region", { name: "Keys" });
  await keysRegion.getByRole("button", { name: "Add clips" }).click();

  const sheet = reportSheet(page);
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Section to add to" })).toHaveText(/Keys/);
  await waitForPlays(sheet);
  const [a, b, c] = [...(await readSheetRows(sheet)).keys()];
  expect(c, "the sheet lists at least three plays").toBeTruthy();

  // Two plays to Keys: they are in the report, pinned to Keys.
  await addRows(sheet, [a, b], /Add to section/);
  await expect(page.getByText("2 clips added to Keys")).toBeVisible();
  await expect.poll(() => clipKeys(page, id), { timeout: 15_000 }).toEqual([a, b].sort());
  await expect.poll(() => placements(page, id), { timeout: 10_000 }).toEqual({ [a]: "keys", [b]: "keys" });
  // The rows say so: ✓ takes a play out of this section.
  await expect((await sheetRow(sheet, a)).getByRole("button", { name: "In Keys. Remove" })).toBeAttached();
  await shot(page, "report-add-clips-sheet");

  // Change the section: a play in Keys moves to Their actions with one press.
  await sheet.getByRole("button", { name: "Section to add to" }).click();
  await page.getByRole("menuitemradio", { name: /Their actions/ }).click();
  const move = (await sheetRow(sheet, a)).getByRole("button", { name: "In Keys. Move to Their actions" });
  await move.click();
  // Their actions holds it, pinned or by default; the other stays in Keys.
  await expect.poll(async () => (await placements(page, id))[a] ?? "team", { timeout: 10_000 }).toBe("team");
  expect((await placements(page, id))[b]).toBe("keys");

  // A third play, then Undo: it leaves the report again.
  await addRows(sheet, [c], /Add to section/);
  await expect.poll(() => clipKeys(page, id), { timeout: 15_000 }).toEqual([a, b, c].sort());
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => clipKeys(page, id), { timeout: 15_000 }).toEqual([a, b].sort());

  // Closed, the report shows what was added.
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(keysRegion.locator(`[data-clip-key="${b}"]`)).toBeVisible();
  await expect(page.getByRole("region", { name: "Their actions" }).locator(`[data-clip-key="${a}"]`)).toBeVisible();
  await shot(page, "report-add-clips-document");
});

test("the toolbar's Add clips lets each clip go to its player, and a player's section starts on that player", { tag: "@alone:report-clips" }, async ({ page }) => {
  // A play by someone in the sheet's first game, for a player section.
  const id0 = await openReport(page);
  await page.getByRole("button", { name: "Add clips", exact: true }).first().click();
  const sheet = reportSheet(page);
  await expect(sheet.getByRole("button", { name: "Section to add to" })).toHaveText(/Sorted by player/);
  await waitForPlays(sheet);
  const keys = [...(await readSheetRows(sheet)).keys()];
  const matchId = keys[0].split(":")[0];
  const play = await withAppModule<{ matchId: string; keys: string[] }, { eventId: number; id: string; name: string; number: string | null; teamName: string } | null>(
    page,
    "/src/lib/matches-db.ts",
    `
      const { byMatch } = await mod.listEventsForMatchesChecked([arg.matchId]);
      const shown = new Set(arg.keys);
      const e = (byMatch[arg.matchId] ?? []).find((x) => x.player && x.player.playerId > 0 && shown.has(arg.matchId + ":" + x.eventId));
      if (!e) return null;
      const p = e.player;
      return { eventId: e.eventId, id: String(p.playerId), name: (p.firstName + " " + p.familyName).trim(), number: p.shirtNumber ?? null, teamName: e.eventTeam?.teamName ?? "" };
    `,
    { matchId, keys },
  );
  expect(play, "the first game has a play by a player").not.toBeNull();

  // Sorted by player: no placement is written.
  const key = `${matchId}:${play!.eventId}`;
  await addRows(sheet, [key], /Add to report/);
  await expect.poll(() => clipKeys(page, id0), { timeout: 15_000 }).toEqual([key]);
  await page.waitForTimeout(1000); // the draft's save after 600 ms
  expect(await placements(page, id0)).toEqual({});
  await page.keyboard.press("Escape");
  await deleteOwnedPlaylists(page, [NAME]);

  // A report with that player's section: its + Add clips starts the sheet on them.
  await openReport(page, [{ id: "p1", player: { id: play!.id, name: play!.name, number: play!.number, teamId: null, teamName: play!.teamName }, note: "", stats: null }]);
  const region = page.getByRole("region", { name: play!.name });
  await region.getByRole("button", { name: "Add clips" }).click();
  const forPlayer = reportSheet(page);
  await expect(forPlayer.getByRole("button", { name: "Section to add to" })).toHaveText(new RegExp(play!.name.split(" ").at(-1)!));
  await expect(filterButton(forPlayer)).toHaveAccessibleName(/^Filters, \d+ on$/, { timeout: 30_000 });
});
