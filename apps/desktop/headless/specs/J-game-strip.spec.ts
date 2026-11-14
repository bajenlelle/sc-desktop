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
import { expect, openLibraryGame, openSampleGame, playRows, recordAnalytics, shot, showGameView, test } from "../helpers";

const timeline = (page: Page) => page.getByRole("region", { name: "Game timeline" });
const track = (page: Page) => page.getByRole("slider", { name: "Position in the game" });
const list = (page: Page) => page.getByRole("list", { name: "Plays" });
const drawn = (page: Page, what: "play-mark" | "run" | "run-score" | "timeout" | "timeout-mark" | "peak" | "playhead") =>
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

/** Gives the strip to one quarter, or to the whole game again. */
async function zoomTo(page: Page, option: string): Promise<void> {
  await page.getByRole("button", { name: "Timeline zoom" }).click();
  await page.getByRole("menuitemradio", { name: option, exact: true }).or(page.getByRole("menuitem", { name: option, exact: true })).click();
  // The zoom is a spring; the marks are drawn once it has come to rest.
  await page.waitForTimeout(900);
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
  await shot(page, `${browserName}-J-strip-filtered`);

  await moment(page, "All plays").click();
  await expect(drawn(page, "play-mark"), "no filter, no marks").toHaveCount(0);
});

test("zoomed into a quarter the strip marks that quarter's plays, and zoomed out they are gone", async ({ page, browserName }) => {
  await openLeagueGame(page);
  // The second quarter's plays: the list's play rows between its header and the next quarter's.
  const inQuarter = await list(page)
    .locator("[data-row-key]")
    .evaluateAll((rows) => {
      const keys = rows.map((row) => ({ key: row.getAttribute("data-row-key") ?? "", play: row.tagName === "DIV" }));
      const from = keys.findIndex((k) => k.key === "period:2");
      const to = keys.findIndex((k) => k.key === "period:3");
      return keys.slice(from + 1, to).filter((k) => k.play && !k.key.startsWith("period:")).length;
    });
  expect(inQuarter, "the second quarter has plays").toBeGreaterThan(20);

  await zoomTo(page, "Q2");
  // A play with no team (a jump ball the feed gives to nobody) has no side to stand on.
  await expect.poll(() => drawn(page, "play-mark").count(), { message: "the quarter's plays are marked" }).toBeGreaterThan(inQuarter * 0.9);
  expect(await drawn(page, "play-mark").count(), "only that quarter's").toBeLessThanOrEqual(inQuarter);
  await shot(page, `${browserName}-J-strip-zoomed`);

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
