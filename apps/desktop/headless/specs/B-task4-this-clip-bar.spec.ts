/**
 * Task 4: the "This clip" bar drops its Before/After steppers; Trim stays, and
 * "Reset trim" (with a tooltip naming the playlist's seconds) takes a trim back.
 * Creates "headless-<port>-<slot> bar" with two clips from the first minute and a half
 * of a game's footage, links that game to the test video through the player's
 * Locate file… for the trim, and puts both back afterwards.
 */
import {
  deletePlaylistsNamed,
  expect,
  inScratchPage,
  type FixtureLink,
  linkStageGameToFixture,
  newPlaylistWithClips,
  playlistIdNamed,
  owned,
  restoreGameVideo,
  restoreJournalledVideoLink,
  selectRows,
  shot,
  test,
} from "../helpers";

const NAME = owned("bar");
let link: FixtureLink | null = null;

test.beforeEach(async ({ page }) => {
  // What a crashed run left: its link first, then its playlist; in a scratch page, so the test's page starts clean.
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

/** Two Events rows whose plays sit 15 to 100 s into the game's video: inside the two-minute fixture with the clip length around them. */
async function earlyPlays(page: import("@playwright/test").Page, rowKeys: string[]): Promise<string[]> {
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
    .slice(0, 2)
    .map((e) => e.key);
  expect(early.length, "the game has two listed plays 15-100 s into its video").toBe(2);
  return early;
}

test("the This clip bar has no steppers; a trim shows Reset trim, which takes it back", { tag: "@alone" }, async ({ page, browserName }) => {
  const name = (step: string) => `${browserName}-B-task4-${step}`;
  const keys = await newPlaylistWithClips(page, NAME, { pick: (rows) => earlyPlays(page, rows) });
  const matchId = keys[0].slice(0, keys[0].lastIndexOf(":"));
  const [firstEventId] = keys.map((k) => Number(k.slice(k.lastIndexOf(":") + 1)));

  // The playlist's clip length, as the toolbar's Clip length tooltip states it.
  const clipLength = page.getByRole("button", { name: "Clip length" });
  await clipLength.hover();
  const lengthTip = page.getByRole("tooltip").filter({ hasText: "Clip length:" });
  await expect(lengthTip).toBeVisible();
  const [, before, after] = (await lengthTip.innerText()).match(/([\d.]+) s before, ([\d.]+) s after/) ?? [];
  expect(before, "the toolbar names the playlist's clip length").toBeTruthy();
  // Manual check (4): the Clip length popover still holds its two steppers.
  await clipLength.click();
  await expect(page.getByRole("group", { name: "Pre-roll" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Post-roll" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("group", { name: "Pre-roll" })).toBeHidden();

  // Play the first clip. Its game's video is on another computer: link it to the test video.
  await page.locator(`[role=row][data-row-key="${keys[0]}"]`).click();
  const bar = page.getByText("This clip", { exact: true }).locator("..");
  await expect(bar).toBeVisible();
  await linkStageGameToFixture(page, matchId, (l) => (link = l));
  await page.locator(`[role=row][data-row-key="${keys[0]}"]`).click();
  await expect(bar).toBeVisible();

  // Manual check (1): Draw, Slow motion, Trim…, Fix sync…, and no steppers.
  for (const label of ["Draw", "Slow motion", "Trim…", "Fix sync…"]) {
    await expect(bar.getByRole("button", { name: label, exact: true }), `the bar has ${label}`).toBeVisible();
  }
  await expect(bar.getByRole("group"), "no stepper in the bar").toHaveCount(0);
  await expect(page.getByRole("group", { name: /^Seconds (before|after) the play$/ })).toHaveCount(0);
  await expect(bar).not.toContainText(/\b(before|after)\b/i);
  await expect(bar.getByRole("button", { name: "Reset trim" }), "an untrimmed clip has no Reset trim").toHaveCount(0);
  await shot(page, name("bar"));

  // Manual check (2): trim the start 2 s later with the handle's keys, then Done.
  await bar.getByRole("button", { name: "Trim…" }).click();
  const start = page.getByRole("slider", { name: "Start of the clip" });
  await expect(start, "the trim bar is on the player").toBeVisible();
  const from = Number(await start.getAttribute("aria-valuenow"));
  await start.focus();
  await start.press("Shift+ArrowRight");
  await start.press("Shift+ArrowRight");
  await expect(start).toHaveAttribute("aria-valuenow", String(Math.round((from + 2) * 1000) / 1000));
  await shot(page, name("trimming"));
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(start).toBeHidden();

  const reset = bar.getByRole("button", { name: "Reset trim" });
  await expect(reset, "a trimmed clip shows Reset trim").toBeVisible();
  await expect
    .poll(async () => (await selectRows<{ pre_roll_offset: number }>(page, "playlist_clips", "pre_roll_offset", { match_id: matchId, event_id: firstEventId, playlist_id: await playlistIdNamed(page, NAME) }))[0]?.pre_roll_offset)
    .toBeCloseTo(-2, 1);
  await reset.hover();
  const resetTip = page.getByRole("tooltip").filter({ hasText: "Back to the playlist's clip length" });
  await expect(resetTip).toBeVisible();
  await expect(resetTip).toContainText(
    `Back to the playlist's clip length (${before} s before, ${after} s after). Also undoes a Fix sync made for this clip alone.`,
  );
  await shot(page, name("reset-trim"));

  await reset.click();
  await expect(reset, "Reset trim goes once the clip is back to the playlist's length").toBeHidden();
  await expect
    .poll(async () => (await selectRows<{ pre_roll_offset: number; post_roll_offset: number }>(page, "playlist_clips", "pre_roll_offset, post_roll_offset", { match_id: matchId, event_id: firstEventId, playlist_id: await playlistIdNamed(page, NAME) }))[0])
    .toEqual({ pre_roll_offset: 0, post_roll_offset: 0 });
  await shot(page, name("after-reset"));

  // Manual check (4): the Clip length popovers still set a length. The toolbar's is the editor's;
  // Add clips keeps its own for its preview (10 s and 3 s to start), so each is checked on its own.
  const tooltipOf = async (button: import("@playwright/test").Locator) => {
    await page.mouse.move(0, 0);
    await button.hover();
    const tip = page.getByRole("tooltip").filter({ hasText: "Clip length:" });
    await expect(tip).toBeVisible();
    return tip;
  };
  const seconds = async (group: string) => Number((await page.getByRole("group", { name: group }).innerText()).match(/[\d.]+/)![0]);
  await clipLength.click();
  await page.getByRole("button", { name: "Increase Pre-roll" }).click();
  await expect(page.getByRole("group", { name: "Pre-roll" })).toContainText(`${Number(before) + 1} s`);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("group", { name: "Pre-roll" })).toBeHidden();
  await expect(await tooltipOf(clipLength)).toContainText(`${Number(before) + 1} s before, ${after} s after`);

  await page.getByRole("button", { name: "Add clips", exact: true }).first().click();
  const sheet = page.getByRole("dialog");
  const sheetLength = sheet.getByRole("button", { name: "Clip length" });
  await sheetLength.click();
  const pre = await seconds("Pre-roll");
  const post = await seconds("Post-roll");
  await page.getByRole("button", { name: "Increase Post-roll" }).click();
  await expect(page.getByRole("group", { name: "Post-roll" })).toContainText(`${post + 1} s`);
  await shot(page, name("clip-length-add-clips"));
  await page.keyboard.press("Escape");
  await expect(page.getByRole("group", { name: "Post-roll" })).toBeHidden();
  await expect(sheet.getByRole("heading", { name: "Add clips" }), "Esc closes the popover, not the sheet").toBeVisible();
  await expect(await tooltipOf(sheetLength)).toContainText(`${pre} s before, ${post + 1} s after`);
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toBeHidden();
});
