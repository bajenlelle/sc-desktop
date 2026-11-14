/**
 * What the game's timeline draws (docs/game-view.md, "The player and its
 * timeline"): the story of the game (quarters, the score, runs with their
 * score printed, timeouts) and no mark per play, until a filter or a zoom
 * asks for the plays. A click means what is under it: a run, a timeout, a
 * play mark, or the second there. It writes nothing: it opens a league game
 * (four quarters, runs and timeouts on record, no footage on this computer)
 * and the sample game (one quarter, a run, footage from the network).
 */
import type { Locator, Page } from "@playwright/test";
import { PLAY_ROW, expect, openLibraryGame, openSampleGame, playRows, recordAnalytics, shot, showGameView, test, videoTime } from "../helpers";

const timeline = (page: Page) => page.getByRole("region", { name: "Game timeline" });
const track = (page: Page) => page.getByRole("slider", { name: "Position in the game" });
const list = (page: Page) => page.getByRole("list", { name: "Plays" });
const drawn = (page: Page, what: "play-mark" | "run" | "run-score" | "timeout" | "timeout-line" | "timeout-mark" | "peak" | "playhead") =>
  timeline(page).locator(`[data-strip="${what}"]`);
const readout = (page: Page) => timeline(page).locator('[role="presentation"]');
const moment = (page: Page, name: string) => page.getByRole("group", { name: "Moment" }).getByRole("button", { name, exact: true });

type Box = { x: number; y: number; width: number; height: number };

async function boxOf(locator: Locator, what: string): Promise<Box> {
  const box = await locator.boundingBox();
  expect(box, `${what} is on the page`).not.toBeNull();
  return box!;
}

/** The Library's first game on its Game view: a whole league game, with no footage here. */
async function openLeagueGame(page: Page): Promise<void> {
  await openLibraryGame(page, 0);
  await showGameView(page);
  await expect(track(page)).toBeVisible();
  // The game's marks (its timeouts) are read when the view opens.
  await expect(list(page).locator('[data-row-key^="timeout:"]').first(), "the first game has a timeout on record").toBeAttached({ timeout: 30_000 });
}

/** The quarter bands on the strip, as their widths. */
const bandWidths = (page: Page) =>
  timeline(page)
    .locator("svg rect[rx='4']")
    .evaluateAll((rects) => rects.map((r) => Number(r.getAttribute("width"))));

/** Gives the strip to one quarter, or to the whole game again, and waits for the zoom to come to rest. */
async function zoomTo(page: Page, option: string): Promise<void> {
  await page.getByRole("button", { name: "Timeline zoom" }).click();
  await page.getByRole("menuitemradio", { name: option, exact: true }).or(page.getByRole("menuitem", { name: option, exact: true })).click();
  // The zoom is a spring: at rest the strip shows one band, or all of them, and they have stopped changing.
  const one = option !== "Whole game";
  let last = "";
  await expect
    .poll(
      async () => {
        // (While the zoom's menu is open the rest of the page is hidden from roles, and the strip isn't found.)
        const widths = (await bandWidths(page)).join(",");
        const still = widths !== "" && widths === last && (one ? !widths.includes(",") : widths.includes(","));
        last = widths;
        return still;
      },
      { message: `the strip has come to rest on ${option}`, intervals: [120], timeout: 5_000 },
    )
    .toBe(true);
}

test("the whole game shows its story: quarters, runs with their score, timeouts, and no mark per play", async ({ page, browserName }) => {
  await openLeagueGame(page);
  const runsListed = await list(page).locator('[data-row-key^="run:"]').count();
  const timeoutsListed = await list(page).locator('[data-row-key^="timeout:"]').count();
  expect(runsListed, "the first game has a run on record").toBeGreaterThan(0);

  await expect(drawn(page, "play-mark"), "no mark per play for the whole unfiltered game").toHaveCount(0);
  await expect(drawn(page, "run"), "each of the largest runs is a stretch on the graph").toHaveCount(Math.min(6, runsListed));
  const scores = await drawn(page, "run-score").allTextContents();
  expect(scores.length, "a run's score is printed on it").toBeGreaterThan(0);
  for (const score of scores) expect(score, "a run reads as its score").toMatch(/^\d+–0$/);
  await expect(drawn(page, "timeout"), "every timeout has its mark").toHaveCount(timeoutsListed);
  // The words on the graph stand clear of the timeouts' marks: the largest lead's figure and every run's score.
  const words = [...(await drawn(page, "peak").all()), ...(await drawn(page, "run-score").all())];
  const marks = await Promise.all((await drawn(page, "timeout-mark").all()).map((m) => boxOf(m, "a timeout's mark")));
  for (const word of words) {
    const w = await boxOf(word, "a figure on the graph");
    const under = marks.filter((m) => w.x < m.x + m.width && m.x < w.x + w.width && w.y < m.y + m.height && m.y < w.y + w.height);
    expect(under.length, `"${await word.textContent()}" isn't under a timeout's mark`).toBe(0);
  }
  // And a timeout's hairline is painted under them, so their rim breaks it and it doesn't strike them through.
  const lineOverWord = await timeline(page).evaluate((el) => {
    const lines = [...el.querySelectorAll('[data-strip="timeout-line"]')];
    const figures = [...el.querySelectorAll('[data-strip="peak"], [data-strip="run-score"]')];
    return lines.length === 0 || lines.some((line) => figures.some((word) => !!(word.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING)));
  });
  expect(lineOverWord, "every timeout's hairline is drawn before the figures").toBe(false);
  // Nor on each other.
  const boxes = await Promise.all(words.map(async (word) => ({ text: await word.textContent(), box: await boxOf(word, "a figure on the graph") })));
  for (const [i, a] of boxes.entries()) {
    for (const b of boxes.slice(i + 1)) {
      const meet = a.box.x < b.box.x + b.box.width && b.box.x < a.box.x + a.box.width && a.box.y < b.box.y + b.box.height && b.box.y < a.box.y + a.box.height;
      expect(meet, `"${a.text}" and "${b.text}" don't stand on each other`).toBe(false);
    }
  }
  expect(await timeline(page).locator("pattern[id$='-notch']").count(), "the breaks are gaps, not hatched fields").toBe(0);
  expect((await boxOf(track(page), "the timeline's track")).height, "the strip is 12 px lower than it was").toBe(104);

  for (const scheme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await shot(page, `${browserName}-J-strip-whole-${scheme}`);
  }
});

test("a filter brings out the plays it leaves, in one colour, and they go when it is cleared", async ({ page, browserName }) => {
  await openLeagueGame(page);
  await moment(page, "After timeouts").click();
  const listed = await playRows(page).count();
  expect(listed, "the filter leaves some plays").toBeGreaterThan(0);
  await expect(drawn(page, "play-mark"), "the strip marks the plays the list shows").toHaveCount(listed);
  const fills = await drawn(page, "play-mark").evaluateAll((els) => [...new Set(els.map((el) => getComputedStyle(el).fill))]);
  expect(fills.length, "the marks are one colour").toBe(1);
  for (const scheme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await shot(page, `${browserName}-J-strip-filtered-${scheme}`);
  }

  await moment(page, "All plays").click();
  await expect(drawn(page, "play-mark"), "no filter, no marks").toHaveCount(0);
});

test("zoomed into a quarter the strip marks that quarter's plays, and zoomed out they are gone", async ({ page, browserName }) => {
  await openLeagueGame(page);
  // The second quarter's plays: the list's play rows between its header and the next quarter's.
  const inQuarter = await list(page)
    .locator("[data-row-key]")
    .evaluateAll((rows, playRow) => {
      const keys = rows.map((row) => ({ key: row.getAttribute("data-row-key") ?? "", play: row.matches(playRow) }));
      const from = keys.findIndex((k) => k.key === "period:2");
      const to = keys.findIndex((k) => k.key === "period:3");
      return keys.slice(from + 1, to).filter((k) => k.play).length;
    }, PLAY_ROW);
  expect(inQuarter, "the second quarter has plays").toBeGreaterThan(20);

  // Each frame from here: how many quarter bands the strip shows, and how many play marks.
  await page.evaluate(() => {
    const w = window as unknown as { __frames: { bands: number; widest: number; marks: number }[] };
    w.__frames = [];
    const until = performance.now() + 1500;
    const tick = () => {
      const region = document.querySelector('[aria-label="Game timeline"]');
      const widths = [...(region?.querySelectorAll("svg rect[rx='4']") ?? [])].map((r) => Number(r.getAttribute("width")));
      w.__frames.push({ bands: widths.length, widest: Math.max(0, ...widths), marks: region?.querySelectorAll('[data-strip="play-mark"]').length ?? 0 });
      if (performance.now() < until) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const before = Math.max(...(await bandWidths(page)));
  await zoomTo(page, "Q2");
  const after = Math.max(...(await bandWidths(page)));
  const frames = await page.evaluate(() => (window as unknown as { __frames: { bands: number; widest: number; marks: number }[] }).__frames);
  // The quarter grows to fill the strip: it is seen on the way, not only before and after.
  const onTheWay = frames.filter((f) => f.widest > before + (after - before) * 0.1 && f.widest < after - (after - before) * 0.1);
  expect(onTheWay.length, "the zoom moves from the whole game to the quarter").toBeGreaterThan(2);
  // The quarter's marks ride along: there from the zoom's first frame, and never the whole game's.
  const moving = frames.filter((f) => f.widest > before + 1);
  expect(moving.length, "the zoom was seen").toBeGreaterThan(0);
  expect(moving.filter((f) => f.marks === 0).length, "the marks come with the quarter, not a moment after it").toBe(0);
  expect(Math.max(...frames.map((f) => f.marks)), "only the quarter's plays are ever marked").toBeLessThanOrEqual(inQuarter);
  // Every play the list shows in the quarter has its mark (one with no team stands on the lane's middle).
  await expect(drawn(page, "play-mark"), "the quarter's plays are marked").toHaveCount(inQuarter);
  for (const scheme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await shot(page, `${browserName}-J-strip-zoomed-${scheme}`);
  }

  // A quarter shows its own runs only: one from another quarter is not on the strip, nor its score.
  const runsInThird = await list(page)
    .locator("[data-row-key]")
    .evaluateAll((rows) => {
      const keys = rows.map((row) => row.getAttribute("data-row-key") ?? "");
      return keys.slice(keys.indexOf("period:3") + 1, keys.indexOf("period:4")).filter((k) => k.startsWith("run:")).length;
    });
  await zoomTo(page, "Q3");
  await expect(drawn(page, "run"), "only the third quarter's runs are on its strip").toHaveCount(runsInThird);
  await expect(drawn(page, "run-score")).toHaveCount(runsInThird);

  await zoomTo(page, "Whole game");
  await expect(drawn(page, "play-mark"), "the whole game again: no marks").toHaveCount(0);
});

test("the line under the track names the run or the timeout the pointer is on", async ({ page }) => {
  await openLeagueGame(page);
  const run = await boxOf(drawn(page, "run").first(), "a run's stretch");
  await page.mouse.move(run.x + run.width / 2, run.y + run.height / 2);
  await expect(readout(page), "over a run").toContainText("Run");
  await expect(readout(page), "with its score").toContainText(/\d+–0/);

  const timeout = await boxOf(drawn(page, "timeout").last(), "a timeout's mark");
  await page.mouse.move(timeout.x + timeout.width / 2, run.y + run.height / 2);
  await expect(readout(page), "over a timeout").toContainText("Timeout");
});

test("a click on a timeout shows it in the list", async ({ page }) => {
  await openLeagueGame(page);
  const mark = drawn(page, "timeout").last();
  const id = await mark.getAttribute("data-id");
  const row = list(page).locator(`[data-row-key="timeout:${id}"]`);
  await expect(row, "the game's last timeout is far down the list").not.toBeInViewport();
  const box = await boxOf(mark, "the timeout's mark");
  const chart = await boxOf(drawn(page, "run").first(), "the graph");
  await page.mouse.click(box.x + box.width / 2, chart.y + chart.height / 2);
  await expect(row, "its row is brought into view").toBeInViewport();
});

test("a click on a run plays it from where it starts", async ({ page }) => {
  const tracked = await recordAnalytics(page);
  await openSampleGame(page);
  const seeks = async () =>
    (await tracked()).filter((e) => e.event === "game_view_seeked").map((e) => `${String(e.properties?.via)}/${String(e.properties?.kind)}`);
  const run = await boxOf(drawn(page, "run").first(), "the sample game's run");
  expect(run.width, "the run is a stretch wide enough to tell its start from its end").toBeGreaterThan(14);
  const row = list(page).locator('[data-row-key^="run:"]').first();

  // Near the run's end: the video goes to its start, not to the pointer.
  await page.mouse.click(run.x + run.width - 3, run.y + run.height / 2);
  await expect.poll(async () => (await seeks()).at(-1), { message: "the click is reported as a jump to a run" }).toBe("timeline/run");
  await expect(row, "the run's row is brought into view").toBeInViewport();
  await expect
    .poll(async () => (await boxOf(drawn(page, "playhead"), "the playhead")).x, { message: "the playhead stands at the run's start", timeout: 10_000 })
    .toBeLessThan(run.x + 4);
  await expect.poll(() => page.evaluate(() => document.querySelector("video")?.paused ?? true), { message: "and the run plays" }).toBe(false);
});

test("with no marks on the strip a click goes to the second under the pointer, never to a play", async ({ page }) => {
  const tracked = await recordAnalytics(page);
  await openSampleGame(page);
  await expect(drawn(page, "play-mark")).toHaveCount(0);
  const t = await boxOf(track(page), "the timeline's track");
  const run = await boxOf(drawn(page, "run").first(), "the sample game's run");
  // Along the graph, clear of the run: each is a click on a time.
  const xs = [0.12, 0.2, 0.28, 0.36, 0.44, 0.52, 0.6, 0.68, 0.76, 0.84].map((f) => t.x + t.width * f).filter((x) => x < run.x - 8 || x > run.x + run.width + 8);
  for (const x of xs) {
    await page.mouse.click(x, run.y + run.height / 2);
    await page.waitForTimeout(150);
  }
  const kinds = (await tracked()).filter((e) => e.event === "game_view_seeked" && e.properties?.via === "timeline").map((e) => String(e.properties?.kind));
  expect(kinds.length, "every click is reported").toBe(xs.length);
  expect(kinds.filter((k) => k !== "time"), "none of them jumped to a play").toEqual([]);
});

test("with marks on the strip, a click on one plays that play", async ({ page }) => {
  const tracked = await recordAnalytics(page);
  await openSampleGame(page);
  await moment(page, "Runs").click();
  await expect.poll(() => drawn(page, "play-mark").count(), { message: "the filter's plays are marked" }).toBeGreaterThan(0);
  const mark = await boxOf(drawn(page, "play-mark").first(), "a play's mark");
  await page.mouse.click(mark.x + mark.width / 2, mark.y + mark.height / 2);
  await expect
    .poll(async () => (await tracked()).filter((e) => e.event === "game_view_seeked").map((e) => `${String(e.properties?.via)}/${String(e.properties?.kind)}`).at(-1), {
      message: "the click is reported as a play chosen on the timeline",
    })
    .toBe("timeline/play");
});

test("the line under the track is about the second the pointer is on, whatever the list is filtered to", async ({ page }) => {
  await openSampleGame(page);
  const t = await boxOf(track(page), "the timeline's track");
  const run = await boxOf(drawn(page, "run").first(), "the sample game's run");
  // A point on the graph well clear of the run, so it is a time and nothing else.
  const x = run.x - t.x > t.width / 2 ? t.x + t.width * 0.2 : t.x + t.width * 0.85;
  const y = run.y + run.height / 2;
  const said = async () => {
    await page.mouse.move(x - 40, y);
    await page.mouse.move(x, y);
    await expect(readout(page)).toBeVisible();
    return (await readout(page).innerText()).replace(/\s+/g, " ").trim();
  };
  const unfiltered = await said();
  expect(unfiltered, "the line names a quarter and a clock").toMatch(/Q\d/);

  await moment(page, "Runs").click();
  await expect.poll(() => drawn(page, "play-mark").count()).toBeGreaterThan(0);
  expect(await said(), "the same second, the same words, with a filter on").toBe(unfiltered);
});


test("a click on a run starts its first basket, exactly as its row in the list does", async ({ page }) => {
  await openSampleGame(page);
  const chosen = async () => `${await page.locator('[data-now="where"]').innerText()} ${await page.locator('[data-now="name"]').innerText()}`;
  const mark = drawn(page, "run").first();
  const id = await mark.getAttribute("data-id");

  // What the run's row in the list starts: its first basket, held as the play on screen through its run-up.
  await list(page).locator(`[data-row-key="run:${id}"]`).click();
  await page.keyboard.press("k");
  const fromRow = await chosen();
  // Another play, then the run on the strip: the same play is on screen again.
  await playRows(page).nth(6).click();
  await page.keyboard.press("k");
  await expect.poll(chosen, { message: "another play is on screen" }).not.toBe(fromRow);
  const run = await boxOf(mark, "the run's stretch");
  await page.mouse.click(run.x + run.width / 2, run.y + run.height / 2);
  await page.keyboard.press("k");
  await expect.poll(chosen, { message: "the run on the strip starts what its row does" }).toBe(fromRow);
});

test("the line under the track says where a click on a run will go, and a double-click goes there once", async ({ page }) => {
  const tracked = await recordAnalytics(page);
  await openSampleGame(page);
  const run = await boxOf(drawn(page, "run").first(), "the sample game's run");
  const x = run.x + run.width - 3;
  const y = run.y + run.height / 2;
  await page.mouse.move(x - 20, y);
  await page.mouse.move(x, y);
  await expect(readout(page)).toContainText("in the video");
  const said = /(\d+):(\d\d) in the video/.exec(await readout(page).innerText());
  expect(said, "the line gives a time in the video").not.toBeNull();
  const saidSeconds = Number(said![1]) * 60 + Number(said![2]);

  await page.mouse.dblclick(x, y);
  await expect.poll(() => videoTime(page), { message: "the video is where the line said the click would go", timeout: 10_000 }).toBeGreaterThan(saidSeconds - 1.5);
  expect(await videoTime(page), "at the run's start, not at the pointer").toBeLessThan(saidSeconds + 4);
  await page.waitForTimeout(600);
  const jumps = (await tracked()).filter((e) => e.event === "game_view_seeked" && e.properties?.kind === "run");
  expect(jumps.length, "the two clicks of a double-click are one jump").toBe(1);
});

test("the line under the track keeps clear of the zoom", async ({ page }) => {
  await openLeagueGame(page);
  const t = await boxOf(track(page), "the timeline's track");
  const zoom = await boxOf(page.getByRole("button", { name: "Timeline zoom" }), "the zoom");
  const run = await boxOf(drawn(page, "run").first(), "the graph");
  for (const at of [0.9, 0.97, 0.995]) {
    await page.mouse.move(t.x + t.width * at - 10, run.y + run.height / 2);
    await page.mouse.move(t.x + t.width * at, run.y + run.height / 2);
    await expect(readout(page)).toBeVisible();
    const r = await boxOf(readout(page), "the line under the track");
    expect(r.x + r.width, `pointing ${at} of the way along, the line ends before the zoom`).toBeLessThanOrEqual(zoom.x);
  }
});
