/**
 * Fix round, change 3: Esc leaves the vertical (9:16) crop in the editor and
 * does nothing else. Makes "headless-<port> crop" with one clip from the
 * first minute and a half of a game's footage, links that game to the test
 * video through the player's Locate file… (the crop sits on a playing clip),
 * and puts both back afterwards.
 */
import {
  deletePlaylistsNamed,
  expect,
  inScratchPage,
  type FixtureLink,
  linkStageGameToFixture,
  newPlaylistWithClips,
  PORT,
  restoreGameVideo,
  restoreJournalledVideoLink,
  selectRows,
  shot,
  test,
} from "../helpers";

const NAME = `headless-${PORT} crop`;
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

/** One Events row whose play sits 15 to 100 s into the game's video: inside the two-minute fixture with the clip length around it. */
async function earlyPlay(page: import("@playwright/test").Page, rowKeys: string[]): Promise<string[]> {
  const matchId = rowKeys[0].slice(0, rowKeys[0].lastIndexOf(":"));
  const [match] = await selectRows<{ sync_point: { syncVideoTime: number; syncRealWorldTime: string } | null }>(
    page, "matches", "sync_point", { id: matchId },
  );
  const sync = match?.sync_point;
  expect(sync, "the Add clips game is synced").toBeTruthy();
  const events = await selectRows<{ event_id: number; real_world_time: string | null; period: number }>(
    page, "play_by_play_events", "event_id, real_world_time, period", { match_id: matchId },
  );
  const syncMs = new Date(sync!.syncRealWorldTime).getTime();
  const listed = new Set(rowKeys);
  const early = events
    .filter((e) => e.period === 1 && e.real_world_time)
    .map((e) => ({ key: `${matchId}:${e.event_id}`, t: sync!.syncVideoTime + (new Date(e.real_world_time!).getTime() - syncMs) / 1000 }))
    .filter((e) => e.t >= 15 && e.t <= 100 && listed.has(e.key))
    .sort((a, b) => a.t - b.t)
    .slice(0, 1)
    .map((e) => e.key);
  expect(early.length, "the game has a listed play 15-100 s into its video").toBe(1);
  return early;
}

test("Esc leaves the vertical crop and only that", async ({ page, browserName }) => {
  const name = (step: string) => `${browserName}-F-esc-crop-${step}`;
  const keys = await newPlaylistWithClips(page, NAME, { pick: (rows) => earlyPlay(page, rows) });
  const matchId = keys[0].slice(0, keys[0].lastIndexOf(":"));
  const row = page.locator(`[role=row][data-row-key="${keys[0]}"]`);

  // Play the clip. Its game's video is on another computer: link it to the test video.
  await row.click();
  const bar = page.getByText("This clip", { exact: true }).locator("..");
  await expect(bar).toBeVisible();
  await linkStageGameToFixture(page, matchId, (l) => (link = l));
  await row.click();
  await expect(bar).toBeVisible();

  // Into the crop: the bar grows its Preview control while the crop is on.
  const crop = page.getByRole("button", { name: "Vertical crop", exact: true });
  await expect(crop).toBeVisible();
  await crop.click();
  const preview = page.getByRole("button", { name: "Preview", exact: true });
  await expect(preview).toBeVisible();
  await shot(page, name("crop-on"));

  // Esc: the normal stage is back; the clip stays on the stage, the bar stays.
  await page.keyboard.press("Escape");
  await expect(preview).toBeHidden();
  await expect(crop).toBeVisible();
  await expect(bar).toBeVisible();
  await expect(row).toBeVisible();
  await shot(page, name("crop-off"));

  // A second Esc has nothing to leave: the stage and the bar are as they were.
  await page.keyboard.press("Escape");
  await expect(bar).toBeVisible();
  await expect(crop).toBeVisible();
  await expect(preview).toBeHidden();
});
