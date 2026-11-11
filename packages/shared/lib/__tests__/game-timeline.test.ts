import { describe, expect, it } from "vitest";
import type { GameMarks } from "../../types/game-marks";
import type { PlayByPlayEvent, SyncPoint } from "../../types/match";
import {
  ACTIVE_LEAD_SECONDS,
  activePlay,
  buildGameTimeline,
  gameScale,
  momentAt,
  pinFor,
  playIndexAt,
  visibleOrder,
  type TimedPlay,
} from "../game-timeline";

const TIP = "2026-01-10T17:00:00Z";
/** Tip-off at 2:00 into the video. */
const sync: SyncPoint = { syncVideoTime: 120, syncRealWorldTime: TIP };

/** A wall-clock time `seconds` after tip-off. */
const at = (seconds: number) => new Date(new Date(TIP).getTime() + seconds * 1000).toISOString();

function ev(eventId: number, period: number, seconds: number | null, extra: Partial<PlayByPlayEvent> = {}): PlayByPlayEvent {
  return {
    eventId,
    type: "2pt",
    subType: "",
    period,
    gameClockTime: "05:00",
    realWorldTime: seconds === null ? "" : at(seconds),
    isSuccessful: 1,
    qualifiers: [],
    ...extra,
  };
}

const build = (events: PlayByPlayEvent[], extra: Partial<Parameters<typeof buildGameTimeline>[0]> = {}) =>
  buildGameTimeline({ matchId: "m", events, sync, ...extra });

describe("buildGameTimeline, placing plays", () => {
  it("places each play at its second of the video, with its clip key and where a click starts", () => {
    const tl = build([ev(1, 1, 30), ev(2, 1, 5)]);
    expect(tl.axis).toBe("video");
    expect(tl.plays.map((p) => [p.key, p.time, p.start, p.reach])).toEqual([
      ["m:2", 125, 115, "in"],
      ["m:1", 150, 140, "in"],
    ]);
  });

  it("never starts a play before the start of the file, and takes the pre-roll it is given", () => {
    const tl = buildGameTimeline({ matchId: "m", events: [ev(1, 1, 3)], sync: { syncVideoTime: 2, syncRealWorldTime: TIP }, preRoll: 8 });
    expect(tl.plays[0]).toMatchObject({ time: 5, start: 0 });
    expect(build([ev(1, 1, 30)], { preRoll: 4 }).plays[0].start).toBe(146);
  });

  it("orders plays of the same second by action number, in the list and in the lookup", () => {
    const tl = build([ev(12, 1, 40, { type: "assist" }), ev(11, 1, 40), ev(10, 1, 20)]);
    expect(tl.plays.map((p) => p.event.eventId)).toEqual([10, 11, 12]);
    expect(tl.byTime.map((i) => tl.plays[i].event.eventId)).toEqual([10, 11, 12]);
  });

  it("leaves out plays with no time, timeout rows and dead-ball rebounds", () => {
    const tl = build([
      ev(1, 1, 10),
      ev(2, 1, null),
      ev(3, 1, 20, { type: "timeout" }),
      ev(4, 1, 30, { type: "rebound", subType: "offensivedeadball" }),
    ]);
    expect(tl.plays.map((p) => p.event.eventId)).toEqual([1]);
    expect(tl.unplaced).toBe(1);
  });

  it("tells plays that fall before the file's start or past its end", () => {
    const tl = build([ev(1, 1, -200), ev(2, 1, 10), ev(3, 4, 5000)], { durationSeconds: 3600 });
    expect(tl.plays.map((p) => p.reach)).toEqual(["before", "in", "after"]);
    expect(tl.beforeStart).toBe(1);
    expect(tl.pastEnd).toBe(1);
    expect(tl.domain).toEqual({ start: 0, end: 3600 });
  });

  it("runs to the last play when the file's length isn't known", () => {
    expect(build([ev(1, 1, 10), ev(2, 4, 4000)]).domain).toEqual({ start: 0, end: 4120 });
  });

  it("places a quarter with its own sync from that sync", () => {
    const cut: SyncPoint = { ...sync, periods: { "2": { syncVideoTime: 800, syncRealWorldTime: at(1500) } } };
    const tl = build([ev(1, 1, 600), ev(2, 2, 1560), ev(3, 3, 3000)], { sync: cut });
    expect(tl.plays.map((p) => p.time)).toEqual([720, 860, 2300]);
  });

  it("places plays after a cut inside a quarter from the cut", () => {
    const cut: SyncPoint = { ...sync, cuts: [{ period: 1, syncVideoTime: 300, syncRealWorldTime: at(400) }] };
    const tl = build([ev(1, 1, 100), ev(2, 1, 460)], { sync: cut });
    expect(tl.plays.map((p) => p.time)).toEqual([220, 360]);
  });

  it("flags quarters that overlap on the video", () => {
    const wrong: SyncPoint = { ...sync, periods: { "2": { syncVideoTime: 300, syncRealWorldTime: at(1500) } } };
    const tl = build([ev(1, 1, 0), ev(2, 1, 600), ev(3, 2, 1500), ev(4, 2, 2000)], { sync: wrong });
    expect(tl.overlaps).toBe(true);
    expect(build([ev(1, 1, 0), ev(2, 1, 600), ev(3, 2, 1500)]).overlaps).toBe(false);
  });

  it("uses the wall clock from the first period's start when the game has no sync", () => {
    const marks: GameMarks = { v: 1, source: "genius", periods: { "1": { startRealWorldTime: at(-10), endRealWorldTime: at(700) } }, timeouts: [] };
    const tl = buildGameTimeline({ matchId: "m", events: [ev(1, 1, 5), ev(2, 1, 600)], marks });
    expect(tl.axis).toBe("wall");
    expect(tl.plays.map((p) => [p.time, p.reach])).toEqual([
      [15, "in"],
      [610, "in"],
    ]);
    expect(tl.timeOf(at(50), 1)).toBe(60);
    expect(tl.domain).toEqual({ start: 0, end: 710 });
  });

  it("starts the wall clock at the first play when nothing marks the period", () => {
    const tl = buildGameTimeline({ matchId: "m", events: [ev(1, 1, 30), ev(2, 1, 90)] });
    expect(tl.plays.map((p) => p.time)).toEqual([0, 60]);
  });

  it("treats a sync with no usable time as no sync", () => {
    const tl = buildGameTimeline({ matchId: "m", events: [ev(1, 1, 30)], sync: { syncVideoTime: 10, syncRealWorldTime: "" } });
    expect(tl.axis).toBe("wall");
  });
});

describe("buildGameTimeline, the periods", () => {
  it("takes each band from the league's period times", () => {
    const marks: GameMarks = {
      v: 1,
      source: "genius",
      periods: { "1": { startRealWorldTime: at(0), endRealWorldTime: at(900) }, "2": { startRealWorldTime: at(1020), endRealWorldTime: at(1900) } },
      timeouts: [],
    };
    const tl = build([ev(1, 1, 20), ev(2, 2, 1100)], { marks });
    expect(tl.bands).toEqual([
      { period: 1, label: "Q1", start: 120, end: 1020, exact: true },
      { period: 2, label: "Q2", start: 1140, end: 2020, exact: true },
    ]);
  });

  it("prefers the sync's own marks and fills the rest from the game's", () => {
    const withMarks: SyncPoint = {
      ...sync,
      marks: { "1": { startRealWorldTime: at(-5), anchor: { realWorldTime: at(-5), kind: "period_start", label: "Start of Q1" } } },
    };
    const marks: GameMarks = { v: 1, source: "genius", periods: { "1": { startRealWorldTime: at(0), endRealWorldTime: at(900) } }, timeouts: [] };
    const tl = build([ev(1, 1, 20)], { sync: withMarks, marks });
    expect(tl.bands[0]).toMatchObject({ start: 115, end: 1020, exact: true });
  });

  it("falls back to a period's first and last play, and labels overtime", () => {
    const tl = build([ev(1, 1, 20), ev(2, 1, 500), ev(3, 5, 6000), ev(4, 5, 6200)]);
    expect(tl.bands).toEqual([
      { period: 1, label: "Q1", start: 140, end: 620, exact: false },
      { period: 5, label: "OT1", start: 6120, end: 6320, exact: false },
    ]);
  });

  it("widens a band to hold its own plays", () => {
    const marks: GameMarks = { v: 1, source: "genius", periods: { "1": { startRealWorldTime: at(10), endRealWorldTime: at(600) } }, timeouts: [] };
    const tl = build([ev(1, 1, 0), ev(2, 1, 620)], { marks });
    expect(tl.bands[0]).toMatchObject({ start: 120, end: 740 });
  });
});

/** Plays at the given seconds, already in time order. */
function playsAt(times: number[]): TimedPlay[] {
  return times.map((time, i) => ({ key: `m:${i + 1}`, event: ev(i + 1, 1, 0), time, start: Math.max(0, time - 10), reach: "in" }));
}
const inOrder = (plays: TimedPlay[]) => plays.map((_, i) => i);

describe("playIndexAt", () => {
  const plays = playsAt([10, 20, 20, 20, 35]);
  const order = inOrder(plays);

  it("is −1 before the first play and for a game with none", () => {
    expect(playIndexAt(plays, order, 5)).toBe(-1);
    expect(playIndexAt([], [], 100)).toBe(-1);
  });

  it("counts a play as now a moment before its second", () => {
    expect(playIndexAt(plays, order, 10 - ACTIVE_LEAD_SECONDS)).toBe(0);
    expect(playIndexAt(plays, order, 10 - ACTIVE_LEAD_SECONDS - 0.01)).toBe(-1);
    expect(playIndexAt(plays, order, 34, 2)).toBe(4);
  });

  it("is the first of the plays logged in the same second", () => {
    expect(playIndexAt(plays, order, 20)).toBe(1);
    expect(playIndexAt(plays, order, 30)).toBe(1);
  });

  it("stays on the last play after it", () => {
    expect(playIndexAt(plays, order, 9999)).toBe(4);
  });

  it("agrees with a plain scan over 500 plays", () => {
    // A small fixed generator, so the test reads the same every run.
    let seed = 42;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const times = Array.from({ length: 500 }, () => Math.round(next() * 7000)).sort((a, b) => a - b);
    const many = playsAt(times);
    const all = inOrder(many);
    for (let i = 0; i < 400; i++) {
      const t = next() * 7200 - 50;
      let scan = -1;
      for (let j = 0; j < many.length; j++) {
        if (many[j].time <= t + ACTIVE_LEAD_SECONDS) scan = j;
        else break;
      }
      while (scan > 0 && many[scan - 1].time === many[scan].time) scan--;
      expect(playIndexAt(many, all, t)).toBe(scan);
    }
  });
});

describe("visibleOrder", () => {
  it("keeps the time order of the plays a filter lets through", () => {
    const tl = build([ev(1, 1, 10), ev(2, 1, 20, { type: "rebound" }), ev(3, 1, 30)]);
    const order = visibleOrder(tl, (p) => p.event.type === "2pt");
    expect(order.map((i) => tl.plays[i].event.eventId)).toEqual([1, 3]);
    expect(playIndexAt(tl.plays, order, 145)).toBe(0);
  });
});

describe("activePlay and the pin", () => {
  const plays = playsAt([100, 130, 130, 160]);
  const order = inOrder(plays);

  it("follows playback when nothing is pinned", () => {
    expect(activePlay(plays, order, 110, null)).toEqual({ index: 0, pin: null });
  });

  it("holds a clicked play through its pre-roll, though the play before it is nearer", () => {
    const pin = pinFor(plays[3]);
    expect(pin).toEqual({ key: "m:4", from: 150, time: 160 });
    expect(activePlay(plays, order, 150, pin)).toEqual({ index: 3, pin });
    expect(activePlay(plays, order, 161, pin)).toEqual({ index: 3, pin });
  });

  it("keeps a clicked assist current, not the shot of the same second", () => {
    const pin = pinFor(plays[2]);
    expect(activePlay(plays, order, 131, pin)).toEqual({ index: 2, pin });
  });

  it("lets go once a later play has happened", () => {
    const pin = pinFor(plays[1]);
    expect(activePlay(plays, order, 160, pin)).toEqual({ index: 3, pin: null });
  });

  it("lets go when the coach seeks back before the play's start", () => {
    const pin = pinFor(plays[3]);
    expect(activePlay(plays, order, 120, pin)).toEqual({ index: 0, pin: null });
    expect(activePlay(plays, order, 149.5, pin)).toEqual({ index: 3, pin });
  });

  it("lets go of a play the filter no longer shows", () => {
    const pin = pinFor(plays[3]);
    expect(activePlay(plays, [0, 1], 155, pin)).toEqual({ index: 1, pin: null });
  });
});

describe("momentAt", () => {
  const tl = {
    bands: [
      { period: 1, label: "Q1", start: 100, end: 900, exact: true },
      { period: 2, label: "Q2", start: 1000, end: 1800, exact: true },
    ],
  };

  it("tells warm-up, play, a break and the time after the final whistle apart", () => {
    expect(momentAt(tl, 50)).toEqual({ phase: "before", period: null, next: 1 });
    expect(momentAt(tl, 100)).toEqual({ phase: "live", period: 1, next: 2 });
    expect(momentAt(tl, 950)).toEqual({ phase: "break", period: 1, next: 2 });
    expect(momentAt(tl, 1800)).toEqual({ phase: "live", period: 2, next: null });
    expect(momentAt(tl, 1900)).toEqual({ phase: "after", period: 2, next: null });
  });

  it("has no period for a game with no bands", () => {
    expect(momentAt({ bands: [] }, 10)).toEqual({ phase: "live", period: null, next: null });
  });
});

describe("gameScale", () => {
  const band = (period: number, start: number, end: number) => ({ period, label: `Q${period}`, start, end, exact: true });
  const game = {
    bands: [band(1, 600, 1800), band(2, 1920, 3120), band(3, 4020, 5220), band(4, 5340, 6540)],
    domain: { start: 0, end: 7000 },
  };

  it("folds warm-up, breaks, half-time and the end into fixed notches", () => {
    const scale = gameScale(game, 1000);
    expect(scale.segments.map((s) => [s.kind, Math.round(s.x1 - s.x0)])).toEqual([
      ["pre", 20],
      ["period", 229],
      ["break", 12],
      ["period", 229],
      ["break", 20],
      ["period", 229],
      ["break", 12],
      ["period", 229],
      ["post", 20],
    ]);
    expect(scale.segments[scale.segments.length - 1].x1).toBe(1000);
    expect(scale.segments[4]).toMatchObject({ kind: "break", period: 2, next: 3 });
  });

  it("gives each period a width in step with its length", () => {
    const scale = gameScale({ bands: [band(1, 0, 1000), band(2, 1000, 4000)], domain: { start: 0, end: 4000 } }, 402);
    const [first, divider, second] = scale.segments;
    expect(divider).toMatchObject({ kind: "break", x0: 100, x1: 102 });
    expect(first.x1 - first.x0).toBe(100);
    expect(second.x1 - second.x0).toBe(300);
  });

  it("maps seconds to pixels and back, moving at one speed inside a period", () => {
    const scale = gameScale(game, 1000);
    const q1 = scale.segments[1];
    expect(scale.xOf(600)).toBe(q1.x0);
    expect(scale.xOf(1200)).toBeCloseTo((q1.x0 + q1.x1) / 2, 6);
    for (const t of [0, 300, 600, 1500, 1860, 3500, 5000, 6540, 6900, 7000]) {
      expect(scale.tOf(scale.xOf(t))).toBeCloseTo(t, 6);
    }
    expect(scale.xOf(-50)).toBe(0);
    expect(scale.xOf(9000)).toBe(1000);
    expect(scale.tOf(-5)).toBe(0);
    expect(scale.tOf(2000)).toBe(7000);
  });

  it("never runs backwards", () => {
    const scale = gameScale(game, 1000);
    let last = -1;
    for (let t = 0; t <= 7000; t += 37) {
      const x = scale.xOf(t);
      expect(x).toBeGreaterThanOrEqual(last);
      last = x;
    }
  });

  it("draws a break the video skips as a divider", () => {
    const cut = { bands: [band(1, 10, 1210), band(2, 1210.5, 2410)], domain: { start: 0, end: 2411 } };
    const scale = gameScale(cut, 500);
    expect(scale.segments.map((s) => s.kind)).toEqual(["pre", "period", "break", "period"]);
    expect(scale.segments[2].x1 - scale.segments[2].x0).toBe(2);
  });

  it("gives one period the whole strip when zoomed", () => {
    const scale = gameScale(game, 800, { zoomPeriod: 3 });
    expect(scale.segments).toEqual([{ kind: "period", period: 3, next: undefined, t0: 4020, t1: 5220, x0: 0, x1: 800 }]);
    expect(scale.xOf(4620)).toBe(400);
    expect(scale.xOf(100)).toBe(0);
    expect(scale.tOf(800)).toBe(5220);
  });

  it("falls back to the whole game when asked to zoom to a period it doesn't have", () => {
    expect(gameScale(game, 800, { zoomPeriod: 9 }).segments).toHaveLength(9);
  });

  it("is one plain stretch for a game with no periods", () => {
    const scale = gameScale({ bands: [], domain: { start: 0, end: 100 } }, 200);
    expect(scale.xOf(50)).toBe(100);
    expect(scale.tOf(150)).toBe(75);
  });

  it("stays in order when a wrong sync makes two periods overlap", () => {
    const scale = gameScale({ bands: [band(1, 0, 1000), band(2, 600, 1500)], domain: { start: 0, end: 1500 } }, 300);
    const [first, , second] = scale.segments;
    expect(second.t0).toBe(1000);
    expect(first.x1).toBeLessThanOrEqual(second.x0);
    expect(scale.xOf(1500)).toBe(300);
  });

  it("keeps the notches to two fifths of a narrow strip", () => {
    const scale = gameScale(game, 100);
    const notches = scale.segments.filter((s) => s.kind !== "period").reduce((sum, s) => sum + (s.x1 - s.x0), 0);
    expect(notches).toBeCloseTo(40, 6);
  });
});
