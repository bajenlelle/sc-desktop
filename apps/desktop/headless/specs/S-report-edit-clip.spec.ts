/**
 * Edit clip inside a report that owns its clips (docs/scouting-reports.md,
 * "The report's clips"): a tile's Edit clip opens a sheet over the report
 * with the clip on its own stage; its note, a trim and slow motion save to
 * the report's clip as they are made, › steps to the next clip in reading
 * order, and Done puts the sheet away. Creates "headless-<port>-<slot> Edit in report"
 * (a playlist and the report made from it), links their game to the test
 * video for the stage, and puts both back afterwards.
 */
import type { Page } from "@playwright/test";
import {
  deletePlaylistsNamed,
  expect,
  inScratchPage,
  type FixtureLink,
  linkStageGameToFixture,
  newPlaylistWithClips,
  owned,
  restoreGameVideo,
  restoreJournalledVideoLink,
  selectRows,
  shot,
  test,
} from "../helpers";

const NAME = owned("Edit in report");
let link: FixtureLink | null = null;

test.beforeEach(async ({ page }) => {
  await inScratchPage(page, async (scratch) => {
    await restoreJournalledVideoLink(scratch);
    await deletePlaylistsNamed(scratch, NAME);
  });
});

test.afterEach(async ({ page }) => {
  if (link) await restoreGameVideo(page, link);
  link = null;
  await deletePlaylistsNamed(page, NAME);
});

/** Two listed plays 15 to 100 s into their game's video: inside the two-minute test video with the clip length around them. */
async function earlyPlays(page: Page, rowKeys: string[]): Promise<string[]> {
  const matchId = rowKeys[0].slice(0, rowKeys[0].lastIndexOf(":"));
  const [match] = await selectRows<{ sync_point: { syncVideoTime: number; syncRealWorldTime: string } | null }>(page, "matches", "sync_point", { id: matchId });
  const sync = match?.sync_point;
  expect(sync, "the Add clips game is synced").toBeTruthy();
  const events = await selectRows<{ event_id: number; real_world_time: string | null; period: number }>(page, "play_by_play_events", "event_id, real_world_time, period", { match_id: matchId });
  const syncMs = new Date(sync!.syncRealWorldTime).getTime();
  const listed = new Set(rowKeys);
  const early = events
    .filter((e) => e.period === 1 && e.real_world_time)
    .map((e) => ({ key: `${matchId}:${e.event_id}`, t: sync!.syncVideoTime + (new Date(e.real_world_time!).getTime() - syncMs) / 1000 }))
    .filter((e) => e.t >= 15 && e.t <= 100 && listed.has(e.key))
    .sort((a, b) => a.t - b.t)
    .slice(0, 2)
    .map((e) => e.key);
  expect(early.length, "the game has two listed plays 15-100 s into its video").toBe(2);
  return early;
}

async function reportClip(page: Page, id: string, key: string) {
  const [matchId, eventId] = [key.slice(0, key.lastIndexOf(":")), Number(key.slice(key.lastIndexOf(":") + 1))];
  const [row] = await selectRows<{ note: string | null; pre_roll_offset: number; slow_motion: unknown[] | null }>(page, "playlist_clips", "note, pre_roll_offset, slow_motion", {
    playlist_id: id,
    match_id: matchId,
    event_id: eventId,
  });
  return row;
}

test("Edit clip in the report: note, trim and slow motion save to the report's clip, › steps on, Done closes", { tag: "@alone" }, async ({ page, browserName }) => {
  const name = (step: string) => `${browserName}-S-report-edit-clip-${step}`;
  const keys = await newPlaylistWithClips(page, NAME, { pick: (rows) => earlyPlays(page, rows) });
  const matchId = keys[0].slice(0, keys[0].lastIndexOf(":"));

  // The game's video is on another computer: link it to the test video from the editor's stage.
  await page.locator(`[role=row][data-row-key="${keys[0]}"]`).click();
  await linkStageGameToFixture(page, matchId, (l) => (link = l));

  // A report from these clips: it owns a copy of them.
  await page.getByRole("button", { name: "New report" }).click();
  await expect(page).toHaveURL(/\/reports\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  const id = new URL(page.url()).pathname.split("/").at(-1)!;
  const picker = page.getByRole("dialog");
  await expect(picker).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press("Escape");
  await expect(picker).toBeHidden();

  // Edit clip from the tile's menu: a sheet over the report, the clip on its stage.
  const tile = page.locator(`[data-clip-key="${keys[0]}"]`).first();
  await tile.scrollIntoViewIfNeeded();
  await tile.hover();
  await tile.getByRole("button", { name: "Clip options" }).click();
  await page.getByRole("menuitem", { name: "Edit clip" }).click();
  // The sheet: the dialog with the clip's stage (its "This clip" row stands aside while a bar is open).
  const sheet = page.getByRole("dialog").filter({ has: page.getByRole("group", { name: "Player controls" }) });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText("This clip", { exact: true })).toBeVisible();
  await expect(sheet.locator("video")).toBeVisible();
  await expect(sheet.getByText("1 of 2")).toBeVisible();
  await shot(page, name("sheet"));

  // The note, on the report's own clip.
  await sheet.getByPlaceholder("Note for players, shown on the clip…").fill("Help side early");
  await expect.poll(async () => (await reportClip(page, id, keys[0]))?.note, { timeout: 10_000 }).toBe("Help side early");

  // Trim the start 2 s later, then Done on the trim bar.
  await sheet.getByRole("button", { name: "Trim…" }).click();
  const start = page.getByRole("slider", { name: "Start of the clip" });
  await expect(start).toBeVisible();
  const from = Number(await start.getAttribute("aria-valuenow"));
  await start.focus();
  await start.press("Shift+ArrowRight");
  await start.press("Shift+ArrowRight");
  await expect(start).toHaveAttribute("aria-valuenow", String(Math.round((from + 2) * 1000) / 1000));
  // Esc belongs to the trim while it is open: the sheet stays.
  await sheet.getByRole("button", { name: "Done", exact: true }).last().click();
  await expect(start).toBeHidden();
  await expect(sheet).toBeVisible();
  await expect.poll(async () => (await reportClip(page, id, keys[0]))?.pre_roll_offset, { timeout: 10_000 }).toBeCloseTo(-2, 1);
  await expect(sheet.getByRole("button", { name: "Reset trim" })).toBeVisible();

  // Slow motion from the playhead: marked on the scrubber and saved.
  await sheet.getByRole("button", { name: "Slow motion", exact: true }).click();
  await expect(sheet.getByRole("group", { name: "Player controls" }).getByRole("button", { name: /^Slow motion, / })).toBeVisible();
  await sheet.getByRole("button", { name: "Done", exact: true }).last().click();
  await expect.poll(async () => (await reportClip(page, id, keys[0]))?.slow_motion?.length ?? 0, { timeout: 10_000 }).toBe(1);
  await shot(page, name("edited"));

  // › steps to the next clip in reading order; its own (empty) note comes in.
  await sheet.getByRole("button", { name: "Next clip" }).click();
  await expect(sheet.getByText("2 of 2")).toBeVisible();
  await expect(sheet.getByPlaceholder("Note for players, shown on the clip…")).toHaveValue("");
  await expect(sheet.getByRole("button", { name: "Reset trim" })).toHaveCount(0);

  // Done puts the sheet away; the report is still here, the playlist it came from untouched.
  await sheet.getByRole("button", { name: "Done", exact: true }).first().click();
  await expect(sheet).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/reports/${id}$`));
  const [source] = (await selectRows<{ id: string; kind: string }>(page, "playlists", "id, kind", { name: NAME })).filter((r) => r.kind === "playlist");
  expect((await reportClip(page, source.id, keys[0]))?.note ?? null, "the playlist the report came from keeps its own clip").toBeNull();
});
