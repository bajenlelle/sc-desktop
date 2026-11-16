/**
 * The game view's player as one unit (docs/game-view.md): the footage with
 * its own scrubber over the whole file, the Now bar, and the game's timeline
 * directly under them at the footage's width, with the play list beside all
 * of it. It writes nothing itself: it opens the sample game, whose video plays
 * from the network, and for the switch a league game (whose Game view may fill
 * that game's marks once, as any visit does).
 */
import type { Locator, Page } from "@playwright/test";
import { expect, openLibraryGame, openSampleGame, playRows, recordAnalytics, shot, showGameView, test, videoDuration, videoTime } from "../helpers";

const SIZES = [
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
  { width: 1024, height: 640 },
] as const;

const stage = (page: Page) => page.locator('div[style*="aspect-ratio"]').filter({ has: page.locator("video") });
const timeline = (page: Page) => page.getByRole("region", { name: "Game timeline" });
const track = (page: Page) => page.getByRole("slider", { name: "Position in the game" });
const scrubber = (page: Page) => page.getByRole("slider", { name: "Position in the video" });
const plays = (page: Page) => page.getByRole("list", { name: "Plays" });

type Box = { x: number; y: number; width: number; height: number };

async function boxOf(locator: Locator, what: string): Promise<Box> {
  const box = await locator.boundingBox();
  expect(box, `${what} is on the page`).not.toBeNull();
  return box!;
}

const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** Waits for the video to stand still on a frame. */
async function settled(page: Page): Promise<number> {
  await expect.poll(() => page.evaluate(() => document.querySelector("video")?.seeking ?? true), { timeout: 15_000 }).toBe(false);
  return videoTime(page);
}


test("the timeline sits under the footage at its width, and the list has the column's whole height", async ({ page, browserName }) => {
  await openSampleGame(page);

  for (const size of SIZES) {
    await page.setViewportSize(size);
    // The stage is measured again when its column changes: wait until the two have settled on each other.
    const settledOnEachOther = async () => {
      const [a, b] = [await boxOf(stage(page), "the stage"), await boxOf(timeline(page), "the timeline")];
      return Math.abs(a.x - b.x) <= 1 && Math.abs(a.width - b.width) <= 2 && b.y + b.height <= size.height + 0.5 && a.width <= size.width;
    };
    await expect.poll(settledOnEachOther, { message: `the player has settled at ${size.width}×${size.height}`, timeout: 5_000 }).toBe(true);
    await page.waitForTimeout(150);

    const s = await boxOf(stage(page), "the stage");
    const t = await boxOf(timeline(page), "the timeline");
    const l = await boxOf(plays(page), "the play list");
    const at = `at ${size.width}×${size.height}`;

    expect(Math.abs(t.x - s.x), `the timeline starts where the footage starts ${at}`).toBeLessThanOrEqual(1);
    expect(Math.abs(t.width - s.width), `the timeline is as wide as the footage ${at}`).toBeLessThanOrEqual(2);
    expect(t.y, `the timeline is under the footage ${at}`).toBeGreaterThanOrEqual(s.y + s.height);
    expect(t.y - (s.y + s.height), `only the Now bar is between the footage and the timeline ${at}`).toBeLessThanOrEqual(64);
    expect(t.x + t.width, `the timeline is in the footage's column, not under the list ${at}`).toBeLessThanOrEqual(l.x + 1);
    expect(l.y + l.height, `the list runs to the bottom of the window ${at}`).toBeGreaterThanOrEqual(size.height - 1);
    expect(s.y, `the footage is clear of the toolbar ${at}`).toBeGreaterThanOrEqual(52);
    expect(s.width, `the footage keeps a usable size ${at}`).toBeGreaterThanOrEqual(320);

    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await shot(page, `${browserName}-H-player-${size.width}-${scheme}`);
    }
    await page.emulateMedia({ colorScheme: "light" });
  }
});

test("the player has its own scrubber over the whole video, and says where the game is only once", async ({ page }) => {
  const duration = await openSampleGame(page);

  await expect(scrubber(page), "paused in a window, the player shows its scrubber").toBeVisible();
  expect(Number(await scrubber(page).getAttribute("aria-valuemax")), "the scrubber spans the whole file").toBeCloseTo(duration, 0);

  const bar = await boxOf(scrubber(page), "the scrubber");
  await page.mouse.click(bar.x + bar.width / 2, bar.y + bar.height / 2);
  const middle = await settled(page);
  expect(Math.abs(middle - duration / 2), "a click in the middle of the scrubber goes to the middle of the video").toBeLessThan(duration * 0.03);

  // A play on screen: the Now bar under the footage names its quarter, clock and score. A play well into the
  // quarter: the game's first play starts its run-up before tip-off, where the Now bar says "Before tip-off".
  await playRows(page).nth(6).click();
  await page.keyboard.press("k");
  const where = /Q\d · \d\d:\d\d/;
  await expect(page.getByText(where).first(), "the Now bar says where the game is").toBeVisible();
  await expect(scrubber(page), "paused, the controls are showing").toBeVisible();
  await expect(stage(page).getByText(where), "the controls over the footage don't repeat it").toHaveCount(0);
});

test("a drag on the player's scrubber is reported once, not once a frame", async ({ page }) => {
  const tracked = await recordAnalytics(page);
  await openSampleGame(page);
  await expect(scrubber(page)).toBeVisible();
  const seeks = async () => (await tracked()).filter((e) => e.event === "game_view_seeked").map((e) => e.properties?.via);
  expect(await tracked(), "the page reports through the recorded module").not.toEqual([]);
  expect(await seeks(), "nothing sought yet").toEqual([]);

  const bar = await boxOf(scrubber(page), "the scrubber");
  const y = bar.y + bar.height / 2;
  await page.mouse.move(bar.x + bar.width * 0.2, y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(bar.x + bar.width * (0.2 + 0.04 * i), y);
    await page.waitForTimeout(40);
  }
  await page.mouse.up();
  await settled(page);

  await expect.poll(seeks, { message: "one drag, one report" }).toEqual(["scrubber"]);

  // The drag left the scrubber focused. A key held down on it is one report too, not one per repeat.
  for (let i = 0; i < 6; i++) await page.keyboard.down("ArrowRight");
  await page.keyboard.up("ArrowRight");
  await settled(page);
  await expect.poll(seeks, { message: "a held key, one report" }).toEqual(["scrubber", "scrubber"]);

  // The same on the game's timeline: a drag along it is one report, when it is let go.
  const t = await boxOf(track(page), "the timeline's track");
  await page.mouse.move(t.x + t.width * 0.3, t.y + 40);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(t.x + t.width * (0.3 + 0.03 * i), t.y + 40);
    await page.waitForTimeout(40);
  }
  await page.mouse.up();
  await settled(page);
  await expect.poll(seeks, { message: "one drag on the timeline, one more report" }).toEqual(["scrubber", "scrubber", "timeline_drag"]);

  // A click on the timeline where no play is (the stretch before tip-off) is a seek like any other.
  await page.mouse.click(t.x + 6, t.y + 40);
  await settled(page);
  await expect.poll(seeks, { message: "a click on the timeline is reported" }).toEqual(["scrubber", "scrubber", "timeline_drag", "timeline"]);
});

test("a sideways swipe over the timeline or the footage moves the video, and a scroll doesn't", async ({ page }) => {
  const tracked = await recordAnalytics(page);
  const swipes = async () => (await tracked()).filter((e) => e.event === "game_view_seeked" && e.properties?.via === "wheel").length;
  await openSampleGame(page);
  const t = await boxOf(track(page), "the timeline's track");
  // Somewhere in the game, standing still: a click on the timeline may start the play it lands on.
  await page.mouse.click(t.x + t.width * 0.3, t.y + 8);
  await page.keyboard.press("k");
  await expect.poll(() => page.evaluate(() => document.querySelector("video")?.paused ?? false)).toBe(true);
  const from = await settled(page);

  for (const [where, box] of [
    ["the timeline", t],
    ["the footage", await boxOf(stage(page), "the stage")],
  ] as const) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3);

    await page.mouse.wheel(0, 240);
    await page.waitForTimeout(600);
    expect(await settled(page), `a scroll over ${where} leaves the video where it is`).toBeCloseTo(from, 1);

    await page.mouse.wheel(90, 0);
    await page.waitForTimeout(600);
    const later = await settled(page);
    expect(later, `a swipe over ${where} moves the video on`).toBeGreaterThan(from + 0.5);

    await page.mouse.wheel(-90, 0);
    await page.waitForTimeout(600);
    expect(Math.abs((await settled(page)) - from), `the same swipe back over ${where} returns it`).toBeLessThan(0.5);
  }
  expect(await swipes(), "each of the four swipes was reported once, and no scroll was").toBe(4);

  // A swipe holds a playing video still and lets it go on once the fingers have rested. What the coach does
  // next comes first: a press on the timeline right after a swipe holds the video for as long as it is held.
  const paused = () => page.evaluate(() => document.querySelector("video")?.paused ?? true);
  await page.keyboard.press("Space");
  await expect.poll(paused, { message: "the video plays" }).toBe(false);
  await page.mouse.move(t.x + t.width / 2, t.y + 40);
  await page.mouse.wheel(40, 0);
  await page.mouse.down();
  await page.waitForTimeout(900);
  expect(await paused(), "held on the timeline after a swipe, the video stays still").toBe(true);
  await page.mouse.up();
  await expect.poll(paused, { message: "let go, it plays on" }).toBe(false);

  // And a pause asked for right after a swipe stays a pause.
  await page.mouse.wheel(40, 0);
  await page.keyboard.press("k");
  await page.waitForTimeout(900);
  expect(await paused(), "paused with K after a swipe, the video stays paused").toBe(true);
});

test("pointing at the timeline never covers the footage", async ({ page, browserName }) => {
  await openSampleGame(page);
  const t = await boxOf(track(page), "the timeline's track");
  const readout = timeline(page).locator('[role="presentation"]');

  let shown = false;
  for (let i = 1; i < 40 && !shown; i++) {
    await page.mouse.move(t.x + (t.width * i) / 40, t.y + t.height - 12);
    shown = await readout.isVisible();
  }
  expect(shown, "a play on the timeline shows what it is").toBe(true);

  // Further along, on a play, for the screenshot.
  await page.mouse.move(t.x + t.width * 0.62, t.y + t.height - 12);
  await expect(readout).toBeVisible();
  await shot(page, `${browserName}-H-player-readout`);

  const box = await boxOf(readout, "the timeline's readout");
  expect(overlaps(box, await boxOf(stage(page), "the stage")), "the readout is clear of the footage").toBe(false);
  expect(box.y, "the readout hangs under the track").toBeGreaterThanOrEqual(t.y + t.height);

  // A wide, low window: the footage is as tall as the window allows and the timeline ends at the window's edge.
  const low = { width: 1440, height: 700 };
  await page.setViewportSize(low);
  // The player takes a few passes to settle on a resize: the timeline is at the window's foot, and has stopped moving.
  let last = "";
  await expect
    .poll(
      async () => {
        const b = await boxOf(timeline(page), "the timeline");
        const now = `${b.x},${b.y},${b.width},${b.height}`;
        const still = now === last && b.y + b.height > low.height - 12;
        last = now;
        return still;
      },
      { message: "the timeline has come to rest at the window's foot", intervals: [150], timeout: 8_000 },
    )
    .toBe(true);
  const tl = await boxOf(timeline(page), "the timeline");
  const tr = await boxOf(track(page), "the timeline's track");
  for (const at of [0.03, 0.3, 0.5, 0.75, 0.97]) {
    await page.mouse.move(tr.x + tr.width * at, tr.y + tr.height - 12);
    await expect(readout).toBeVisible();
    const r = await boxOf(readout, "the timeline's readout");
    expect(r.y + r.height, `the readout is inside the window, pointing ${at} of the way along`).toBeLessThanOrEqual(low.height);
    expect(r.x, `the readout starts inside the timeline, pointing ${at} of the way along`).toBeGreaterThanOrEqual(tl.x - 1);
    expect(r.x + r.width, `the readout ends inside the timeline, pointing ${at} of the way along`).toBeLessThanOrEqual(tl.x + tl.width + 1);
    expect(overlaps(r, await boxOf(stage(page), "the stage")), "and still clear of the footage").toBe(false);
  }
  const scrolls = await timeline(page).evaluate((el) => {
    for (let node = el.parentElement; node; node = node.parentElement) {
      const overflow = getComputedStyle(node).overflowY;
      if ((overflow === "auto" || overflow === "scroll") && node.scrollHeight > node.clientHeight + 1) return true;
    }
    return false;
  });
  expect(scrolls, "showing the readout doesn't make the player's column scroll").toBe(false);
});

test("the moment chips fade at the edge where more of them wait", async ({ page }) => {
  await openSampleGame(page);
  const row = page.getByRole("group", { name: "Moment" });
  const fits = await row.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
  expect(fits, "at the window's usual width the chips don't all fit").toBe(false);

  const faded = () => row.evaluate((el) => getComputedStyle(el).maskImage || getComputedStyle(el).webkitMaskImage);
  await expect(row).toHaveAttribute("data-more", "end");
  expect(await faded(), "the row fades out where it is cut").toContain("gradient");

  await row.evaluate((el) => (el.scrollLeft = el.scrollWidth));
  await expect(row).toHaveAttribute("data-more", "start");

  await row.evaluate((el) => (el.scrollLeft = 20));
  await expect(row).toHaveAttribute("data-more", "both");
});

test("the first visit's playlist chooser is tinted, not ringed like keyboard focus", async ({ page }) => {
  await openSampleGame(page);
  const chooser = page.getByRole("button", { name: "Choose the playlist to add plays to" });
  await expect(chooser).toBeVisible();
  const { shadow, background } = await chooser.evaluate((el) => {
    const style = getComputedStyle(el);
    return { shadow: style.boxShadow, background: style.backgroundColor };
  });
  expect(shadow, "no 2px ring, which is how focus is drawn").not.toMatch(/0px 0px 0px 2px/);
  const plain = await page.getByRole("button", { name: "Filters" }).evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(background, "it is tinted to draw the eye").not.toBe(plain);
});

test("a switch's thumb stays in its track while the page around it settles", async ({ page }) => {
  // A league game's Details has the quarter switch (the sample game's doesn't).
  await openLibraryGame(page, 0);
  await page.getByRole("radio", { name: "Details" }).click();
  await expect(page.locator("#breaks-cut")).toBeVisible({ timeout: 30_000 });
  await showGameView(page);

  // Back to Details, watching the switch every frame from the moment it is there: the page is still loading around it.
  const watching = page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let out = 0;
        let until = 0;
        const giveUp = performance.now() + 30_000;
        const look = () => {
          const el = document.getElementById("breaks-cut");
          const thumb = el?.firstElementChild;
          if (el && thumb) {
            if (!until) until = performance.now() + 1_500;
            const outer = el.getBoundingClientRect();
            const inner = thumb.getBoundingClientRect();
            out = Math.max(out, outer.left - inner.left, inner.right - outer.right, outer.top - inner.top, inner.bottom - outer.bottom);
          }
          if (until ? performance.now() < until : performance.now() < giveUp) requestAnimationFrame(look);
          else resolve(until ? out : -1);
        };
        look();
      }),
  );
  await page.getByRole("radio", { name: "Details" }).click();
  const worst = await watching;
  expect(worst, "the switch came back").not.toBe(-1);
  expect(worst, "how far (px) the thumb was ever outside its track").toBeLessThanOrEqual(0.5);

  // And a switch still crosses its whole track when it is switched: on the game's filter sheet, which writes nothing.
  await showGameView(page);
  await page.getByRole("button", { name: "Filters" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.locator("button[aria-pressed]").filter({ hasText: /^#\d+/ }).first().click();
  const onFloor = sheet.getByRole("switch");
  await expect(onFloor).toHaveAttribute("aria-checked", "false");
  /** The thumb's gap to the track's left and right edges. */
  const gaps = () =>
    onFloor.evaluate((el) => {
      const outer = el.getBoundingClientRect();
      const inner = el.firstElementChild!.getBoundingClientRect();
      return { left: Math.round(inner.left - outer.left), right: Math.round(outer.right - inner.right) };
    });
  expect(await gaps(), "off: the thumb rests at the left").toEqual({ left: 2, right: 16 });
  await onFloor.click();
  await expect(onFloor).toHaveAttribute("aria-checked", "true");
  await expect.poll(gaps, { message: "on: the thumb comes to rest at the right" }).toEqual({ left: 16, right: 2 });
  await onFloor.click();
  await expect.poll(gaps, { message: "off again: back at the left" }).toEqual({ left: 2, right: 16 });
});

test("a picked play stays the current one while its run-up is stepped or scrubbed through", async ({ page }) => {
  await openSampleGame(page);
  const rows = playRows(page);
  /** Which listed play is lit. */
  const current = () => rows.evaluateAll((all) => all.findIndex((row) => row.getAttribute("aria-current") === "true"));
  const paused = () => page.evaluate(() => document.querySelector("video")?.paused ?? false);
  // A play with others logged in the ten seconds before it: its run-up shows them happening.
  const PICK = 10;
  const pick = async () => {
    await rows.nth(PICK).click();
    await expect(rows.nth(PICK)).toHaveAttribute("aria-current", "true");
    await page.keyboard.press("k");
    await expect.poll(paused).toBe(true);
    await settled(page);
  };

  // → steps two seconds on: still inside the run-up, so still the play that was picked.
  await pick();
  const start = await videoTime(page);
  await page.keyboard.press("ArrowRight");
  await settled(page);
  expect(await videoTime(page), "→ moved the video on").toBeGreaterThan(start + 1);
  expect(await current(), "one step into the run-up, the picked play is still the current one").toBe(PICK);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await settled(page);
  expect(await current(), "three steps in, still the picked play").toBe(PICK);

  // ← inside the run-up keeps it too; back out of the run-up lets go of it.
  await page.keyboard.press("ArrowLeft");
  await settled(page);
  expect(await current(), "a step back inside the run-up keeps it").toBe(PICK);
  for (let i = 0; i < 8; i++) await page.keyboard.press("ArrowLeft");
  await settled(page);
  expect(await current(), "stepped back before the run-up, the list shows the play that is on then").toBeLessThan(PICK);

  // A sideways swipe is the same kind of move.
  await pick();
  const t = await boxOf(track(page), "the timeline's track");
  await page.mouse.move(t.x + t.width / 2, t.y + 40);
  await page.mouse.wheel(4, 0);
  await page.waitForTimeout(600);
  await settled(page);
  expect(await current(), "a short swipe forward never lights a play above the picked one").toBeGreaterThanOrEqual(PICK);

  // So is a drag on the player's own scrubber.
  await pick();
  const bar = await boxOf(scrubber(page), "the scrubber");
  const at = bar.x + (bar.width * (await videoTime(page))) / (await videoDuration(page));
  await page.mouse.move(at, bar.y + bar.height / 2);
  await page.mouse.down();
  await page.mouse.move(at + 2, bar.y + bar.height / 2);
  await page.mouse.up();
  await settled(page);
  expect(await current(), "a nudge on the scrubber inside the run-up keeps the picked play").toBe(PICK);

  // A jump to another moment of the game is not a step: the quarter's start shows what is there.
  await pick();
  await page.keyboard.press("1");
  await expect.poll(current, { message: "a jump to the quarter's start lets go of the picked play" }).not.toBe(PICK);
});

test("a click on a play doesn't leave the keyboard's focus ring on it", async ({ page }) => {
  await openSampleGame(page);
  const rows = playRows(page);
  /** The listed play that wears the keyboard's focus ring; −1 when none does. */
  const ringed = () => rows.evaluateAll((all) => all.findIndex((row) => row.matches(":focus-visible")));
  const current = () => rows.evaluateAll((all) => all.findIndex((row) => row.getAttribute("aria-current") === "true"));

  // A click, then a key, as a coach who picks a play and steps on with the arrows does.
  await rows.nth(10).click();
  await expect(rows.nth(10)).toHaveAttribute("aria-current", "true");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("k");
  expect(await ringed(), "no play is ringed: the click didn't take the keyboard's focus").toBe(-1);

  // The game moves on: the lit row is the only mark in the list.
  await page.evaluate(() => {
    document.querySelector("video")!.currentTime += 75;
  });
  await expect.poll(current, { message: "the lit row has moved on" }).toBeGreaterThan(10);
  expect(await ringed(), "and still no play is ringed").toBe(-1);

  // The keyboard keeps its ring: Tab reaches a play, the ring shows where it is, and Return plays it.
  await page.getByRole("button", { name: "Filters" }).focus();
  let reached = -1;
  for (let i = 0; i < 30 && reached < 0; i++) {
    await page.keyboard.press("Tab");
    reached = await rows.evaluateAll((all) => all.findIndex((row) => row === document.activeElement));
  }
  expect(reached, "Tab reaches a play in the list").toBeGreaterThanOrEqual(0);
  expect(await ringed(), "the play Tab reached wears the ring").toBe(reached);
  await page.keyboard.press("Enter");
  await expect(rows.nth(reached)).toHaveAttribute("aria-current", "true");
});


test("in full screen the controls say where the video is between plays too", async ({ page }) => {
  await openSampleGame(page);
  // The sample game opens before its tip-off: no play is on.
  await expect(page.getByText("Before tip-off").first(), "the Now bar says the video is before tip-off").toBeVisible();
  await page.keyboard.press("f");
  const full = page.locator("div.fixed.inset-0").filter({ has: page.locator("video") });
  await expect(full, "the player has the window").toBeVisible();
  await expect(full.getByText("Before tip-off").first(), "the full-screen controls say so as well: the Now bar is behind them").toBeVisible();
  await page.keyboard.press("f");
  await expect(full).toHaveCount(0);
});

test("the Now bar keeps room for the player's name in the narrowest column", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openSampleGame(page);
  await playRows(page).nth(6).click();
  await page.keyboard.press("k");
  const name = page.locator('[data-now="name"]');
  await expect(name).toBeVisible();
  // The divider between the footage and the list, as far left as it goes.
  const divider = await boxOf(page.getByRole("separator").first(), "the divider");
  await page.mouse.move(divider.x + divider.width / 2, divider.y + divider.height / 2);
  await page.mouse.down();
  await page.mouse.move(divider.x - 400, divider.y + divider.height / 2, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  expect((await boxOf(name, "the player's name")).width, "the name is not cut down to its number sign").toBeGreaterThanOrEqual(64);
});
