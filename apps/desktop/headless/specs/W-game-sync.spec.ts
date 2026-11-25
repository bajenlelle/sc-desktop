/**
 * The game view's sync (docs/game-view.md, "Sync"): the sync row on the
 * timeline, Check sync, Fix sync on the view's own video, and what each of
 * them saves. It opens the sample game, whose video plays from the network,
 * and writes nothing: every save of a game's sync is answered in the browser
 * and read back from the request.
 */
import type { Page, Route } from "@playwright/test";
import { expect, openSampleGame, playRows, recordAnalytics, shot, test, toastWith, videoTime } from "../helpers";

type Sync = {
  syncVideoTime: number;
  checks?: { eventId: number; period: number }[];
  cuts?: { period: number; syncVideoTime: number; eventId?: number }[];
  playTimes?: Record<string, number>;
  periods?: Record<string, { syncVideoTime: number }>;
};

type Row = Record<string, unknown>;

/**
 * The sample game as this spec needs it, in what the page is told (the account is never written to): its one
 * quarter read as two (the plays of the last five minutes are Q2), so the game has two parts to check, and one
 * turnover typed in after the final play, as a scorer's table does with a play it missed. Every save of a game's
 * sync, and every write to a playlist clip that follows one, is answered here; the syncs saved are returned.
 */
async function twoQuarterGame(page: Page): Promise<Sync[]> {
  const saved: Sync[] = [];
  const reshape = (events: Row[]) => {
    if (events.length === 0) return;
    const last = events.reduce((a, b) => (String(a.real_world_time) > String(b.real_world_time) ? a : b));
    const late = events.find((e) => e.type === "turnover" && e.period === 1 && String(e.game_clock_time) > "07:00");
    for (const e of events) if (e.period === 1 && String(e.game_clock_time) < "05:00") e.period = 2;
    if (late) {
      late.event_id = Math.max(...events.map((e) => Number(e.event_id))) + 1;
      late.real_world_time = new Date(new Date(String(last.real_world_time)).getTime() + 240_000).toISOString();
    }
  };
  const walk = (node: unknown) => {
    if (Array.isArray(node)) {
      if (node.length > 0 && node.every((n) => n && typeof n === "object" && "game_clock_time" in (n as Row))) return reshape(node as Row[]);
      return node.forEach(walk);
    }
    if (node && typeof node === "object") Object.values(node as Row).forEach(walk);
  };
  const handle = async (route: Route) => {
    const request = route.request();
    if (request.method() === "PATCH" && request.url().includes("/rest/v1/matches")) {
      const body = request.postDataJSON() as { sync_point?: Sync };
      if (body.sync_point) saved.push(body.sync_point);
      return route.fulfill({ status: 204, body: "" });
    }
    if (request.method() !== "GET") return route.fallback();
    const response = await route.fetch();
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return route.fulfill({ response });
    }
    walk(body);
    await route.fulfill({ response, json: body });
  };
  await page.route("**/rest/v1/matches*", handle);
  await page.route("**/rest/v1/play_by_play_events*", handle);
  await page.route("**/rest/v1/playlist_clips*", async (route) => {
    if (route.request().method() === "GET" || route.request().method() === "HEAD") return route.fallback();
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  return saved;
}

const bar = (page: Page) => page.getByRole("group", { name: "Sync" });
const label = (page: Page) => bar(page).locator('[data-sync="label"]');
const parts = (page: Page) => page.locator('[data-strip="sync-part"]');
const status = (page: Page) => page.locator('[data-sync="status"]');
const findStrip = (page: Page) => page.getByRole("region", { name: "Find the play" });
const timeline = (page: Page) => page.getByRole("region", { name: "Game timeline" });
const nowBarFix = (page: Page) => page.getByRole("button", { name: "Fix sync", exact: true });
const states = (page: Page) => parts(page).evaluateAll((els) => els.map((el) => el.getAttribute("data-state")));
const paused = (page: Page) => page.evaluate(() => document.querySelector("video")?.paused ?? true);

/** Whether the video is inside the clip of the play being asked about. */
async function inClip(page: Page): Promise<boolean> {
  const [from, to] = [Number(await bar(page).getAttribute("data-clip-start")), Number(await bar(page).getAttribute("data-clip-end"))];
  const t = await videoTime(page);
  return t >= from - 0.5 && t <= to + 0.5;
}

/** Steps the paused video with the arrow keys and waits for it to arrive. */
async function step(page: Page, key: "ArrowLeft" | "ArrowRight", times: number): Promise<number> {
  const from = await videoTime(page);
  for (let i = 0; i < times; i++) {
    await page.keyboard.press(key);
    const to = from + (key === "ArrowLeft" ? -1 : 1) * (i + 1);
    await expect.poll(() => videoTime(page), { message: `the video stepped to ${to.toFixed(1)}` }).toBeCloseTo(to, 1);
  }
  return videoTime(page);
}

test("the timeline has a sync row of the game's parts, and Check sync asks about one play of each", { tag: "@smoke" }, async ({ page, browserName }) => {
  const tracked = await recordAnalytics(page);
  const saved = await twoQuarterGame(page);
  await openSampleGame(page);

  await expect(parts(page), "one part a quarter").toHaveCount(2);
  expect(await states(page), "nothing is checked yet").toEqual(["open", "open"]);
  await expect(status(page)).toHaveText("Check sync");
  await shot(page, `${browserName}-W-sync-row`);

  await status(page).click();
  await expect(label(page), "the first part is asked about first").toHaveText("Check 1 of 2 · Q1");
  await expect(bar(page).locator('[data-sync="change"]'), "the play is named by what it does to the score").toBeVisible();
  await expect(page.locator('[data-sync="cue"]'), "the app's own score is over the footage").toBeVisible();
  await expect.poll(() => paused(page), { message: "the play's clip plays" }).toBe(false);
  await expect.poll(() => inClip(page), { message: "the video is on the play's clip" }).toBe(true);
  expect(await states(page), "the part being checked is marked on the row").toEqual(["current", "open"]);
  await expect(page.locator("[inert]").filter({ has: page.locator('[aria-label="Plays"]') }), "the list stands back while a play is checked").toHaveCount(1);
  // The cue changes to the play's score at the moment the sync has the play at.
  await expect(page.locator('[data-sync="cue"]')).toHaveAttribute("data-phase", /now|after/, { timeout: 12_000 });
  await shot(page, `${browserName}-W-ask`);
  await expect.poll(() => paused(page), { message: "the clip stops a little after the play", timeout: 12_000 }).toBe(true);

  await bar(page).getByRole("button", { name: "Looks right" }).click();
  await expect(label(page)).toHaveText("Check 2 of 2 · Q2");
  expect(saved, "the answer is saved as a checked play").toHaveLength(1);
  expect(saved[0].checks).toHaveLength(1);
  expect(saved[0].checks![0].period).toBe(1);
  expect(await states(page)).toEqual(["checked", "current"]);

  await page.keyboard.press("Enter");
  await expect(bar(page), "the last part checked ends the check").toHaveCount(0);
  await expect(toastWith(page, "Sync checked")).toBeVisible();
  expect(saved[1].checks?.map((c) => c.period)).toEqual([1, 2]);
  expect(saved[1].cuts, "a check moves nothing").toBeUndefined();
  expect(await states(page)).toEqual(["checked", "checked"]);
  await expect(status(page)).toHaveText("Sync checked");
  await expect(page.locator("[inert]"), "the list is back").toHaveCount(0);
  await shot(page, `${browserName}-W-checked`);

  const events = (await tracked()).filter((e) => e.event.startsWith("sync_check"));
  expect(events.map((e) => e.event)).toEqual(["sync_check_started", "sync_check_answered", "sync_check_answered", "sync_check_finished"]);
  expect(events[0].properties).toMatchObject({ entry: "button", parts: 2, left: 2 });
  expect(events[1].properties).toMatchObject({ answer: "right", purpose: "check", period: 1 });
});

test("Escape ends a check where it stands, and a click on a part of the sync row checks that part", async ({ page }) => {
  const saved = await twoQuarterGame(page);
  await openSampleGame(page);
  await status(page).click();
  await expect(label(page)).toHaveText("Check 1 of 2 · Q1");
  await page.keyboard.press("Escape");
  await expect(bar(page)).toHaveCount(0);
  expect(saved, "nothing was answered, so nothing is saved").toHaveLength(0);
  await expect(status(page)).toHaveText("Check sync");

  // The second part's stretch of the row.
  const box = await parts(page).nth(1).locator("line").boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await expect(timeline(page).getByText("Sync not checked yet"), "the row says what it is under the pointer").toBeVisible();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await expect(label(page)).toHaveText("Check 2 of 2 · Q2");
  await bar(page).getByRole("button", { name: "Skip" }).click();
  await expect(label(page), "a part passed on is not asked about again; the other one is").toHaveText("Check 1 of 2 · Q1");
  await page.getByRole("button", { name: "Stop checking" }).click();
  await expect(bar(page)).toHaveCount(0);
});

test("a play that is off is found on the game's own video, the plays after it move with it, and where it starts is narrowed down", async ({ page, browserName }) => {
  const tracked = await recordAnalytics(page);
  const saved = await twoQuarterGame(page);
  await openSampleGame(page);
  await status(page).click();
  await bar(page).getByRole("button", { name: "Looks right" }).click();
  await expect(label(page)).toHaveText("Check 2 of 2 · Q2");

  await bar(page).getByRole("button", { name: "It’s off" }).click();
  await expect(findStrip(page), "a close-up of the video around the play takes the timeline's place").toBeVisible();
  await expect(timeline(page)).toHaveCount(0);
  await expect(label(page)).toHaveText("Find the play");
  expect(await paused(page), "the video waits where the sync has the play").toBe(true);
  const mapped = await videoTime(page);
  const found = await step(page, "ArrowLeft", 8);
  await expect(findStrip(page).locator('[data-find="moved"]'), "the strip says how far the play has come").toContainText("8 s earlier");
  await shot(page, `${browserName}-W-find`);

  await bar(page).getByRole("button", { name: "The play is here" }).click();
  await expect(label(page)).toHaveText("8 s earlier");
  await expect(bar(page).locator('[data-sync="main"]')).toContainText("from this play to the end of the game");
  const move = bar(page).getByRole("button", { name: /^Move \d+ plays/ });
  await expect(move, "a shift this large is proposed for the plays after it too").toHaveAttribute("data-variant", "default");
  await shot(page, `${browserName}-W-confirm`);
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, `${browserName}-W-confirm-dark`);
  await page.emulateMedia({ colorScheme: "light" });
  await move.click();

  await expect(toastWith(page, /plays moved 8 s earlier/)).toBeVisible();
  const cut = saved.at(-1)!;
  expect(cut.cuts, "the move starts at the play").toHaveLength(1);
  expect(cut.cuts![0].period).toBe(2);
  expect(found - cut.cuts![0].syncVideoTime, "the cut starts where the play's clip does").toBeGreaterThan(2);
  expect(found - cut.cuts![0].syncVideoTime).toBeLessThan(25);
  expect(cut.checks?.map((c) => c.eventId), "the found play is a check").toContain(cut.cuts![0].eventId);
  expect(Math.abs(mapped - found - 8)).toBeLessThan(0.2);

  // Where does it start? The part's first basket is asked about first.
  await expect(label(page)).toHaveText("Where it starts · Q2");
  await expect(timeline(page), "the timeline is back").toBeVisible();
  await expect.poll(() => inClip(page), { message: "the video is on the earlier play's clip" }).toBe(true);
  await page.waitForTimeout(1500);
  await shot(page, `${browserName}-W-narrow`);
  await bar(page).getByRole("button", { name: "It’s off" }).click();

  // Off at the part's first basket too: the whole quarter moves, from its start.
  await expect(bar(page)).toHaveCount(0);
  const whole = saved.at(-1)!;
  expect(whole.cuts, "no cut is left: the quarter moved as one").toBeUndefined();
  expect(whole.periods?.["2"], "the quarter has its own sync").toBeDefined();
  expect(whole.checks?.map((c) => c.period)).toEqual([1, 2]);
  expect(whole.syncVideoTime, "the first quarter, checked, stays").toBe(saved[0].syncVideoTime);
  expect(await states(page)).toEqual(["checked", "checked"]);
  await expect(toastWith(page, "Sync checked")).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo" }), "the move can still be undone").toBeVisible();

  const applied = (await tracked()).filter((e) => e.event === "sync_fix_applied").map((e) => e.properties);
  expect(applied).toHaveLength(2);
  expect(applied[0]).toMatchObject({ scope: "play", period: 2, surface: "game_view", suggested: true, delta_s: -8 });
  expect(applied[1]).toMatchObject({ scope: "start", narrowed: true });
});

test("narrowing down keeps the earlier plays seen right, and Stop here saves what is known", async ({ page }) => {
  const saved = await twoQuarterGame(page);
  await openSampleGame(page);
  const box = await parts(page).nth(1).locator("line").boundingBox();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await expect(label(page)).toHaveText("Check 2 of 2 · Q2");
  await bar(page).getByRole("button", { name: "It’s off" }).click();
  await step(page, "ArrowRight", 6);
  await page.keyboard.press("Enter");
  await expect(label(page), "Return answers for the bar's main button").toHaveText("6 s later");
  await page.keyboard.press("Enter");
  await expect(label(page)).toHaveText("Where it starts · Q2");
  expect(saved.at(-1)!.cuts).toHaveLength(1);
  const fixed = saved.at(-1)!.cuts![0].eventId;

  // The part's first basket is right: the shift starts somewhere after it.
  await bar(page).getByRole("button", { name: "Looks right" }).click();
  await expect(label(page), "another play between the two is asked about").toHaveText("Where it starts · Q2");
  await bar(page).getByRole("button", { name: "Stop here" }).click();
  // The check goes on with the part that hasn't been asked about; the quarter is two parts now, either side of the cut.
  await expect(label(page)).toHaveText("Check 1 of 3 · Q1");
  await page.keyboard.press("Escape");
  await expect(bar(page)).toHaveCount(0);
  const last = saved.at(-1)!;
  expect(last.cuts, "the move still starts at the found play").toHaveLength(1);
  expect(last.cuts![0].eventId).toBe(fixed);
  expect(last.checks, "the play seen right is a check, with the found one").toHaveLength(2);
  expect(await parts(page).count()).toBe(3);
  expect(await states(page)).toEqual(["open", "checked", "checked"]);
});

test("Fix sync on the play on screen: a small shift moves that play alone, on the game, and Undo puts it back", async ({ page, browserName }) => {
  const tracked = await recordAnalytics(page);
  const saved = await twoQuarterGame(page);
  await openSampleGame(page);
  // A made basket well into the quarter.
  const row = playRows(page).filter({ hasText: "3PT made" }).first();
  await row.click();
  await expect(nowBarFix(page), "the Now bar offers it for the play on screen").toBeVisible();
  await nowBarFix(page).click();
  await expect(findStrip(page)).toBeVisible();
  const found = await step(page, "ArrowRight", 2);
  await bar(page).getByRole("button", { name: "The play is here" }).click();
  await expect(label(page)).toHaveText("2 s later");
  const only = bar(page).getByRole("button", { name: "Only this play" });
  await expect(only, "a small shift is proposed for the play alone").toHaveAttribute("data-variant", "default");
  await shot(page, `${browserName}-W-only-this-play`);
  await only.click();

  await expect(toastWith(page, "This play moved 2 s later")).toBeVisible();
  const own = saved.at(-1)!;
  expect(Object.values(own.playTimes ?? {}), "the play has its own place on the game").toHaveLength(1);
  expect(Object.values(own.playTimes!)[0]).toBeCloseTo(found, 1);
  expect(own.cuts, "nothing else moved").toBeUndefined();
  await expect(bar(page), "back to watching").toHaveCount(0);
  await expect(playRows(page).locator('[data-row="placed"]'), "the row is marked as placed by hand, with the late one").toHaveCount(2);

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(toastWith(page, "Moved back")).toBeVisible();
  expect(saved.at(-1)!.playTimes).toBeUndefined();
  const names = (await tracked()).map((e) => e.event);
  expect(names).toContain("sync_fix_opened");
  expect(names).toContain("sync_fix_undone");
  expect((await tracked()).find((e) => e.event === "sync_fix_applied")?.properties).toMatchObject({ scope: "play_only", suggested: true, surface: "game_view" });
});

test("a play the table logged late is listed where it happened, marked, and Fix sync moves it alone", async ({ page, browserName }) => {
  const saved = await twoQuarterGame(page);
  await openSampleGame(page);
  const mark = playRows(page).locator('[data-row="placed"]');
  await expect(mark, "one play was typed in after the final play").toHaveCount(1);
  const texts = await playRows(page).evaluateAll((rows) => rows.map((r) => ({ text: r.textContent ?? "", late: !!r.querySelector('[data-row="placed"]') })));
  const at = texts.findIndex((t) => t.late);
  const clock = (text: string) => /\d\d:\d\d/.exec(text)?.[0] ?? "";
  expect(at, "it is not at the end of the game, where its stamp would put it").toBeLessThan(texts.length - 10);
  expect(clock(texts[at - 1].text) >= clock(texts[at].text), "the play before it is earlier on the game clock").toBe(true);
  expect(clock(texts[at + 1].text) <= clock(texts[at].text), "the play after it is later on the game clock").toBe(true);

  await playRows(page).nth(at).click();
  await expect(page.locator('[data-now="where"]')).toContainText("Logged late");
  await shot(page, `${browserName}-W-logged-late`);

  // From the row's menu this time.
  await playRows(page).nth(at).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Fix sync…" }).click();
  await expect(findStrip(page)).toBeVisible();
  await step(page, "ArrowRight", 5);
  await bar(page).getByRole("button", { name: "The play is here" }).click();
  await expect(bar(page).locator('[data-sync="main"]')).toHaveText("This play was logged late, so only it should move.");
  await page.keyboard.press("Enter");
  await expect(toastWith(page, "This play moved 5 s later")).toBeVisible();
  expect(Object.keys(saved.at(-1)!.playTimes ?? {})).toHaveLength(1);
  expect(saved.at(-1)!.cuts).toBeUndefined();
});
