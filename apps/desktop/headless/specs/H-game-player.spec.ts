/**
 * The game view's player as one unit (docs/game-view.md): the footage with
 * its controls docked under it (never over it), the Now bar, and the game's timeline
 * directly under them at the footage's width, with the play list beside all
 * of it. It writes nothing itself: it opens the sample game, whose video plays
 * from the network, and for the switch a league game (whose Game view may fill
 * that game's marks once, as any visit does).
 */
import type { Locator, Page } from "@playwright/test";
import { filterSection, expect, filterButton, filterPopover, openLibraryGame, openSampleGame, patchGameReads, playRows, recordAnalytics, shot, showGameView, test, videoTime } from "../helpers";

const SIZES = [
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
  { width: 1024, height: 640 },
] as const;

const stage = (page: Page) => page.locator('div[style*="aspect-ratio"]').filter({ has: page.locator("video") });
const timeline = (page: Page) => page.getByRole("region", { name: "Game timeline" });
const track = (page: Page) => page.getByRole("slider", { name: "Position in the game" });
const scrubber = (page: Page) => page.getByRole("slider", { name: "Position in the video" });
/** The player's controls, docked under the footage. */
const dock = (page: Page) => page.getByRole("group", { name: "Player controls" });
/** Where a broadcast keeps its score and clock: the footage's bottom quarter. */
const scoreStrip = (s: Box): Box => ({ x: s.x, y: s.y + s.height * 0.75, width: s.width, height: s.height * 0.25 });
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
    const d = await boxOf(dock(page), "the player's controls");
    expect(Math.abs(d.x - s.x) <= 1 && Math.abs(d.width - s.width) <= 2, `the controls are as wide as the footage ${at}`).toBe(true);
    expect(d.y, `the controls are under the footage, not over it ${at}`).toBeGreaterThanOrEqual(s.y + s.height - 0.5);
    expect(t.y - (s.y + s.height), `only the controls and the Now bar are between the footage and the timeline ${at}`).toBeLessThanOrEqual(64 + 44);
    // The list is on the left (as in Teams' Plays, Add clips and the editor), the footage and its timeline right of it.
    expect(t.x, `the timeline is in the footage's column, right of the list ${at}`).toBeGreaterThanOrEqual(l.x + l.width - 1);
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

test("the controls sit under the footage, the timeline is the scrubber, and where the game is is said once", async ({ page }) => {
  const duration = await openSampleGame(page);

  await expect(dock(page), "the player's controls are showing").toBeVisible();
  await expect(scrubber(page), "the game's timeline is the scrubber: the player has no second one").toHaveCount(0);
  const whole = Math.round(duration);
  const total = `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
  await expect(dock(page).getByText(new RegExp(`/ ${total}$`)), "the controls say the video's time out of its length").toBeVisible();

  // A play on screen: the Now bar under the footage names its quarter, clock and score. A play well into the
  // quarter: the game's first play starts its run-up before tip-off, where the Now bar says "Before tip-off".
  await playRows(page).nth(6).click();
  await page.keyboard.press("k");
  const where = /Q\d · \d\d:\d\d/;
  await expect(page.getByText(where).first(), "the Now bar says where the game is").toBeVisible();
  await expect(stage(page).getByText(where), "nothing over the footage repeats it").toHaveCount(0);
  await expect(dock(page).getByText(where), "nor do the controls").toHaveCount(0);
});

test("nothing covers the score and clock: not paused, not on a pointer move, not while playing", async ({ page, browserName }) => {
  await openSampleGame(page);
  /** Every visible control that reaches into the footage's bottom quarter. */
  const covering = async () => {
    // Half a pixel shy of the footage's foot: the dock starts exactly there, and rounding mustn't count it in.
    const foot = scoreStrip(await boxOf(stage(page), "the stage"));
    const strip = { ...foot, height: foot.height - 0.5 };
    const hits: string[] = [];
    for (const control of await page.locator('button, [role="slider"], [role="group"][aria-label="Player controls"]').all()) {
      if (!(await control.isVisible())) continue;
      const box = await control.boundingBox();
      if (box && box.width > 0 && overlaps(box, strip)) hits.push((await control.getAttribute("aria-label")) ?? (await control.innerText()));
    }
    return hits;
  };
  // Past tip-off, so the start button over the middle of the footage has gone.
  await page.keyboard.press("2");
  await page.evaluate(() => document.querySelector("video")?.pause());
  await settled(page);
  expect(await covering(), "paused").toEqual([]);

  const s = await boxOf(stage(page), "the stage");
  await page.mouse.move(s.x + s.width / 2, s.y + s.height * 0.85);
  await page.mouse.move(s.x + s.width / 3, s.y + s.height * 0.9);
  expect(await covering(), "with the pointer moving over the footage's foot").toEqual([]);

  await dock(page).getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.querySelector("video")?.paused ?? true), { message: "Play in the controls plays it" }).toBe(false);
  await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
  await page.waitForTimeout(3_200);
  await expect(dock(page).getByRole("button", { name: "Pause" }), "after a while of playing the controls are still there").toBeVisible();
  expect(await covering(), "while playing").toEqual([]);
  await shot(page, `${browserName}-H-player-docked`);
});

test("after the speed menu, the volume or the scrubber is used with the pointer, the keys are the player's again", async ({ page }) => {
  await openSampleGame(page);
  const paused = () => page.evaluate(() => document.querySelector("video")?.paused ?? true);
  const speedMenu = page.getByRole("menu");
  await page.evaluate(() => document.querySelector("video")?.pause());

  // Speed: picked from its menu with the pointer.
  await dock(page).getByRole("button", { name: "Playback speed" }).click();
  await page.getByRole("menuitemradio", { name: "1.5×" }).click();
  await expect(speedMenu).toHaveCount(0);
  await expect(dock(page).getByRole("button", { name: "Playback speed" })).toHaveText("1.5×");
  const before = await paused();
  await page.keyboard.press("Space");
  await expect(speedMenu, "Space doesn't open the speed menu again").toHaveCount(0);
  await expect.poll(paused, { message: "Space plays and pauses" }).toBe(!before);
  await page.keyboard.press("ArrowDown");
  await expect(speedMenu, "nor does an arrow").toHaveCount(0);
  await page.keyboard.press("k");
  await page.evaluate(() => document.querySelector("video")?.pause());

  // Volume: dragged with the pointer.
  const speaker = dock(page).getByRole("button", { name: /^(Mute|Unmute)$/ });
  await speaker.hover();
  const level = dock(page).getByRole("slider", { name: "Volume" }).first();
  await expect(level).toBeVisible();
  const lb = (await level.boundingBox())!;
  await page.mouse.click(lb.x + lb.width / 2, lb.y + lb.height / 2);
  const focusedIn = () => page.evaluate(() => !!document.activeElement?.closest('[aria-label="Player controls"]'));
  expect(await focusedIn(), "the level doesn't keep the keys").toBe(false);
  const was = await paused();
  await page.keyboard.press("Space");
  await expect.poll(paused, { message: "Space plays and pauses after the volume" }).toBe(!was);
  await page.evaluate(() => document.querySelector("video")?.pause());
});

test("a drag on the game's timeline is reported once, not once a frame", async ({ page }) => {
  const tracked = await recordAnalytics(page);
  await openSampleGame(page);
  const seeks = async () => (await tracked()).filter((e) => e.event === "game_view_seeked").map((e) => e.properties?.via);
  expect(await tracked(), "the page reports through the recorded module").not.toEqual([]);
  expect(await seeks(), "nothing sought yet").toEqual([]);

  // A drag along the timeline is one report, when it is let go.
  const t = await boxOf(track(page), "the timeline's track");
  await page.mouse.move(t.x + t.width * 0.3, t.y + 40);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(t.x + t.width * (0.3 + 0.03 * i), t.y + 40);
    await page.waitForTimeout(40);
  }
  await page.mouse.up();
  await settled(page);
  await expect.poll(seeks, { message: "one drag on the timeline, one more report" }).toEqual(["timeline_drag"]);

  // A click on the timeline where no play is (the stretch before tip-off) is a seek like any other.
  await page.mouse.click(t.x + 6, t.y + 40);
  await settled(page);
  await expect.poll(seeks, { message: "a click on the timeline is reported" }).toEqual(["timeline_drag", "timeline"]);
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

test("the event chips fade at the edge where more of them wait", async ({ page }) => {
  await openSampleGame(page);
  const row = page.getByRole("group", { name: "Event type" });
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
  const plain = await filterButton(page).evaluate((el) => getComputedStyle(el).backgroundColor);
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
  await filterButton(page).click();
  const sheet = filterPopover(page);
  // One player chosen on Player's page: its foot offers "While on the floor".
  await (await filterSection(sheet, "Player")).getByRole("option", { name: /^#\d+ / }).first().click();
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
  await filterButton(page).focus();
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


test("in full screen the controls say where the video is between plays too", { tag: "@smoke" }, async ({ page }) => {
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
  // The divider between the list and the footage, as far right as it goes: the footage's column at its narrowest.
  const stageBefore = (await boxOf(page.locator("video").first(), "the footage")).width;
  const divider = await boxOf(page.locator('[role="separator"]:not([aria-label$="sidebar"])').first(), "the divider");
  await page.mouse.move(divider.x + divider.width / 2, divider.y + divider.height / 2);
  await page.mouse.down();
  await page.mouse.move(divider.x + 400, divider.y + divider.height / 2, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  expect((await boxOf(page.locator("video").first(), "the footage")).width, "the drag narrowed the footage's column").toBeLessThan(stageBefore);
  expect((await boxOf(name, "the player's name")).width, "the name is not cut down to its number sign").toBeGreaterThanOrEqual(64);
});

test("with both teams listed every play row says its team, and with one team none do", async ({ page }) => {
  await openSampleGame(page);
  const rows = playRows(page);
  await expect(rows.first()).toBeVisible({ timeout: 30_000 });
  for (let i = 0; i < 6; i++) {
    await expect(rows.nth(i).locator(":scope > span").nth(2), `row ${i} names its team`).toHaveText(/^[A-ZÅÄÖ0-9]{2,4}$/);
  }
  await page.getByRole("radiogroup", { name: "Team" }).getByRole("radio").nth(1).click();
  await expect(rows.first().locator(":scope > span").nth(2)).not.toHaveText(/^[A-ZÅÄÖ0-9]{2,4}$/);
});

test("a team's code shows whole, and every row's event starts at the same place", async ({ page }) => {
  await patchGameReads(page, { teamCodes: ["MMMM", "WWW"] });
  await openSampleGame(page);
  const rows = playRows(page);
  await expect(rows.first()).toBeVisible({ timeout: 30_000 });
  const starts = new Set<number>();
  for (let i = 0; i < 8; i++) {
    const cells = rows.nth(i).locator(":scope > span");
    const code = cells.nth(2);
    await expect(code, `row ${i} names its team`).toHaveText(/^(MMMM|WWW)$/);
    expect(await code.evaluate((el) => [el, ...el.querySelectorAll("*")].every((n) => n.scrollWidth <= n.clientWidth)), `row ${i}'s code shows whole`).toBe(true);
    starts.add(Math.round((await cells.nth(3).boundingBox())!.x));
  }
  expect(starts.size, "every row's event starts where the others' do").toBe(1);
});

test("a play's details are under the video, and its row is one line", async ({ page }) => {
  await openSampleGame(page);
  const rows = playRows(page);
  await expect(rows.first()).toBeVisible({ timeout: 30_000 });
  for (let i = 0; i < 6; i++) expect(Math.round((await rows.nth(i).boundingBox())!.height), `row ${i} is one line`).toBe(32);
  // The sample game's third play tied it at 2; its row says nothing of that, the Now bar does.
  let found = false;
  for (let i = 0; i < 8 && !found; i++) {
    await rows.nth(i).click();
    found = /Tied at \d+/.test((await page.locator('[data-now="where"]').textContent()) ?? "");
    if (found) await expect(rows.nth(i)).not.toContainText("Tied at");
  }
  expect(found, "one of the first plays tied the game, and the Now bar says so").toBe(true);
});

test("at the usual window a play row gives the player's name room", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openSampleGame(page);
  const row = playRows(page).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  // A usual name ("#5 Oliver Gehrke", the sample game's first play) shows whole at the list's default width.
  const name = row.locator(":scope > span").nth(4).locator(":scope > span").first();
  await expect(name).toHaveText(/^#\d+ \S+ \S+/);
  expect(await name.evaluate((el) => el.scrollWidth <= el.clientWidth), "the name isn't cut short").toBe(true);
});
