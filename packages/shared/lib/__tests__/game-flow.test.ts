import { describe, expect, it } from "vitest";
import type { GameMarks, GameTimeout } from "../../types/game-marks";
import type { PlayByPlayEvent } from "../../types/match";
import {
  afterTimeoutPlays,
  clockSeconds,
  flowChart,
  gameFlow,
  gameMoments,
  gameOrder,
  onCourtStints,
  periodLengthSeconds,
  scoreAfter,
  scoreBefore,
} from "../game-flow";

let nextId = 1;
/** A play: eventIds count up in the order plays are written unless one is given. */
function play(
  period: number,
  clock: string,
  type: string,
  team: 1 | 2 | null,
  extra: Partial<PlayByPlayEvent> = {},
): PlayByPlayEvent {
  return {
    eventId: nextId++,
    type,
    subType: "",
    period,
    gameClockTime: clock,
    realWorldTime: "",
    isSuccessful: 1,
    eventTeam: team ? { teamCode: "", teamName: team === 1 ? "Home" : "Away", teamNumber: team } : null,
    qualifiers: [],
    ...extra,
  };
}
const made = (period: number, clock: string, type: "2pt" | "3pt" | "freethrow", team: 1 | 2, extra: Partial<PlayByPlayEvent> = {}) =>
  play(period, clock, type, team, extra);
const miss = (period: number, clock: string, team: 1 | 2) => play(period, clock, "2pt", team, { isSuccessful: 0 });

function timeout(partial: Partial<GameTimeout>): GameTimeout {
  return { eventId: 0, period: 1, clock: "05:00", realWorldTime: "2026-01-10T17:10:00Z", kind: "team", teamNumber: 1, scoreHome: null, scoreAway: null, ...partial };
}
const marksOf = (...timeouts: GameTimeout[]): GameMarks => ({ v: 1, source: "genius", periods: {}, timeouts });

describe("gameOrder", () => {
  it("goes by period, the clock counting down, then action number", () => {
    const a = play(2, "09:00", "2pt", 1, { eventId: 40 });
    const b = play(1, "03:00", "2pt", 1, { eventId: 30 });
    const c = play(1, "08:00", "assist", 1, { eventId: 21 });
    const d = play(1, "08:00", "2pt", 1, { eventId: 20 });
    const { order, byClock } = gameOrder([a, b, c, d]);
    expect(order.map((e) => e.eventId)).toEqual([20, 21, 30, 40]);
    expect(byClock).toBe(true);
  });

  it("goes by the wall clock when a play has no game clock", () => {
    const a = play(1, "", "2pt", 1, { eventId: 3, realWorldTime: "2026-01-10T17:05:00Z" });
    const b = play(1, "", "2pt", 1, { eventId: 2, realWorldTime: "2026-01-10T17:02:00Z" });
    const c = play(1, "08:00", "2pt", 1, { eventId: 1, realWorldTime: "2026-01-10T17:03:00Z" });
    const { order, byClock } = gameOrder([a, b, c]);
    expect(order.map((e) => e.eventId)).toEqual([2, 1, 3]);
    expect(byClock).toBe(false);
  });

  it("reads a clock as seconds left, and a missing one as −1", () => {
    expect(clockSeconds({ gameClockTime: "02:37" })).toBe(157);
    expect(clockSeconds({ gameClockTime: "" })).toBe(-1);
    expect(clockSeconds({ gameClockTime: "soon" })).toBe(-1);
    expect(clockSeconds({})).toBe(-1);
  });
});

describe("gameFlow, the score", () => {
  it("adds the score up from the made shots", () => {
    const events = [
      made(1, "09:30", "3pt", 1),
      miss(1, "09:10", 2),
      made(1, "08:50", "2pt", 2),
      made(1, "08:20", "freethrow", 2),
      play(1, "08:00", "rebound", 1),
    ];
    const flow = gameFlow(events);
    expect(flow.source).toBe("plays");
    expect(flow.points.map((p) => [p.team, p.points, p.home, p.away, p.diff])).toEqual([
      [1, 3, 3, 0, 3],
      [2, 2, 3, 2, 1],
      [2, 1, 3, 3, 0],
    ]);
    expect(flow.final).toEqual({ home: 3, away: 3 });
    expect(scoreAfter(flow, events[1].eventId)).toEqual({ home: 3, away: 0 });
    expect(scoreBefore(flow, events[0].eventId)).toEqual({ home: 0, away: 0 });
    expect(scoreBefore(flow, events[3].eventId)).toEqual({ home: 3, away: 2 });
    expect(scoreAfter(flow, 9999)).toBeNull();
  });

  it("is the same whatever order the plays arrive in", () => {
    const events = [made(1, "09:30", "3pt", 1), made(1, "08:50", "2pt", 2), made(2, "09:00", "2pt", 1)];
    const forwards = gameFlow(events);
    const backwards = gameFlow([...events].reverse());
    expect(backwards.points).toEqual(forwards.points);
  });

  it("uses the feed's running score only as the cross-check when it agrees", () => {
    const flow = gameFlow([
      made(1, "09:30", "2pt", 1, { scoreHome: 2, scoreAway: 0 }),
      made(1, "09:00", "2pt", 2, { scoreHome: 2, scoreAway: 2 }),
    ]);
    expect(flow.source).toBe("plays");
  });

  it("falls back to the feed's running score when the made shots don't add up to it", () => {
    const flow = gameFlow([
      made(1, "09:30", "2pt", 1, { scoreHome: 2, scoreAway: 0 }),
      play(1, "09:00", "rebound", 2, { scoreHome: 2, scoreAway: 3 }),
      made(1, "08:00", "2pt", 1, { scoreHome: 4, scoreAway: 3 }),
    ]);
    expect(flow.source).toBe("feed");
    expect(flow.final).toEqual({ home: 4, away: 3 });
    expect(flow.points.map((p) => [p.team, p.points, p.diff])).toEqual([
      [1, 2, 2],
      [2, 3, -1],
      [1, 2, 1],
    ]);
  });

  it("has no score when a made shot names no team and the feed has none", () => {
    const flow = gameFlow([made(1, "09:30", "2pt", 1), play(1, "09:00", "2pt", null)]);
    expect(flow.source).toBe("none");
    expect(flow.final).toBeNull();
    expect(flow.points).toEqual([]);
    expect(flow.periods).toEqual([]);
  });

  it("reads the team off the player when the play has no team of its own", () => {
    const flow = gameFlow([
      play(1, "09:30", "2pt", null, { player: { playerId: 7, pno: 7, firstName: "A", familyName: "B", teamNumber: 2 } }),
    ]);
    expect(flow.final).toEqual({ home: 0, away: 2 });
  });

  it("is 0–0 for a game with plays and no baskets", () => {
    expect(gameFlow([miss(1, "09:00", 1)]).final).toEqual({ home: 0, away: 0 });
  });

  it("gives each period's score and the total at its end, overtime included", () => {
    const flow = gameFlow([
      made(1, "09:00", "3pt", 1),
      made(1, "08:00", "2pt", 2),
      miss(2, "09:00", 1),
      made(4, "00:10", "2pt", 2),
      made(5, "04:00", "freethrow", 1),
    ]);
    expect(flow.periods).toEqual([
      { period: 1, home: 3, away: 2, homeTotal: 3, awayTotal: 2 },
      { period: 2, home: 0, away: 0, homeTotal: 3, awayTotal: 2 },
      { period: 4, home: 0, away: 2, homeTotal: 3, awayTotal: 4 },
      { period: 5, home: 1, away: 0, homeTotal: 4, awayTotal: 4 },
    ]);
  });
});

describe("gameFlow, leads and runs", () => {
  it("counts lead changes and ties, and not the 0–0 start", () => {
    const events = [
      made(1, "09:50", "2pt", 1), // 2–0
      made(1, "09:40", "2pt", 2), // 2–2 tie
      made(1, "09:30", "3pt", 2), // 2–5 lead change
      made(1, "09:20", "3pt", 1), // 5–5 tie
      made(1, "09:10", "freethrow", 1), // 6–5 lead change
      made(1, "09:00", "2pt", 1), // 8–5
    ];
    const flow = gameFlow(events);
    expect(flow.ties).toEqual([events[1].eventId, events[3].eventId]);
    expect(flow.leadChanges).toEqual([events[2].eventId, events[4].eventId]);
  });

  it("finds each side's largest lead and the basket that made it", () => {
    const events = [
      made(1, "09:50", "3pt", 2), // 0–3
      made(1, "09:40", "3pt", 2), // 0–6
      made(1, "09:30", "3pt", 1),
      made(1, "09:20", "3pt", 1),
      made(1, "09:10", "2pt", 1), // 8–6
    ];
    const flow = gameFlow(events);
    expect(flow.largestLead.away).toEqual({ lead: 6, eventId: events[1].eventId });
    expect(flow.largestLead.home).toEqual({ lead: 2, eventId: events[4].eventId });
  });

  it("finds an 8–0 run and not a 7–0", () => {
    const eight = [made(1, "09:00", "3pt", 1), made(1, "08:30", "3pt", 1), made(1, "08:00", "2pt", 1), made(1, "07:30", "2pt", 2)];
    expect(gameFlow(eight).runs).toEqual([
      { team: 1, points: 8, period: 1, fromEventId: eight[0].eventId, toEventId: eight[2].eventId },
    ]);
    const seven = [made(1, "09:00", "3pt", 1), made(1, "08:30", "3pt", 1), made(1, "08:00", "freethrow", 1), made(1, "07:30", "2pt", 2)];
    expect(gameFlow(seven).runs).toEqual([]);
  });

  it("ends a run at the other side's free throw, and ignores misses in between", () => {
    const events = [
      made(1, "09:00", "3pt", 2),
      miss(1, "08:45", 1),
      made(1, "08:30", "3pt", 2),
      made(1, "08:00", "freethrow", 1),
      made(1, "07:30", "3pt", 2),
    ];
    expect(gameFlow(events).runs).toEqual([]);
  });

  it("lets a run cross a quarter break and still be open at the end", () => {
    const events = [made(1, "00:30", "3pt", 2), made(1, "00:05", "3pt", 2), made(2, "09:40", "2pt", 2), made(2, "09:00", "2pt", 2)];
    expect(gameFlow(events).runs).toEqual([
      { team: 2, points: 10, period: 1, fromEventId: events[0].eventId, toEventId: events[3].eventId },
    ]);
  });

  it("takes the run length it is asked for", () => {
    const events = [made(1, "09:00", "3pt", 1), made(1, "08:30", "3pt", 1)];
    expect(gameFlow(events, { runMinPoints: 6 }).runs).toHaveLength(1);
  });
});

describe("periodLengthSeconds", () => {
  it("snaps the longest clock up to a length in use, quarters and overtimes apart", () => {
    const events = [play(1, "09:41", "2pt", 1), play(2, "08:50", "2pt", 1), play(5, "04:51", "2pt", 1)];
    expect(periodLengthSeconds(events, 2)).toBe(600);
    expect(periodLengthSeconds(events, 5)).toBe(300);
    expect(periodLengthSeconds([play(1, "07:45", "2pt", 1)], 3)).toBe(480);
    expect(periodLengthSeconds([play(1, "11:20", "2pt", 1)], 1)).toBe(720);
  });

  it("is ten minutes for a quarter and five for an overtime when no play has a clock", () => {
    expect(periodLengthSeconds([play(1, "", "2pt", 1)], 1)).toBe(600);
    expect(periodLengthSeconds([], 6)).toBe(300);
  });
});

describe("afterTimeoutPlays", () => {
  it("is the first shot, turnover or foul after the timeout, in its period", () => {
    const events = [
      made(1, "05:20", "2pt", 1, { eventId: 90 }),
      play(1, "04:50", "rebound", 2, { eventId: 93 }),
      play(1, "04:40", "assist", 2, { eventId: 94 }),
      play(1, "04:40", "turnover", 2, { eventId: 95 }),
      made(1, "04:20", "2pt", 1, { eventId: 96 }),
    ];
    const flow = gameFlow(events);
    const [first] = afterTimeoutPlays(flow, marksOf(timeout({ eventId: 92, clock: "05:00" })));
    expect(first.eventId).toBe(95);
  });

  it("orders a play at the timeout's own clock by action number", () => {
    const events = [made(1, "05:00", "2pt", 1, { eventId: 90 }), made(1, "05:00", "2pt", 2, { eventId: 94 })];
    const flow = gameFlow(events);
    expect(afterTimeoutPlays(flow, marksOf(timeout({ eventId: 92, clock: "05:00" })))[0].eventId).toBe(94);
  });

  it("is null when the period ends first, and lists the officials' timeouts too", () => {
    const events = [made(1, "05:20", "2pt", 1, { eventId: 90 }), made(2, "09:30", "2pt", 1, { eventId: 120 })];
    const flow = gameFlow(events);
    const found = afterTimeoutPlays(flow, marksOf(timeout({ eventId: 92, clock: "00:03" }), timeout({ eventId: 100, period: 2, clock: "10:00", kind: "officials", teamNumber: null })));
    expect(found.map((f) => f.eventId)).toEqual([null, 120]);
  });

  it("goes by the wall clock, from the restart, when plays have no game clock", () => {
    const events = [
      play(1, "", "2pt", 1, { eventId: 1, realWorldTime: "2026-01-10T17:09:00Z" }),
      play(1, "", "2pt", 2, { eventId: 2, realWorldTime: "2026-01-10T17:10:30Z" }),
      play(1, "", "turnover", 1, { eventId: 3, realWorldTime: "2026-01-10T17:11:40Z" }),
    ];
    const flow = gameFlow(events);
    const marks = marksOf(timeout({ eventId: 50, clock: "", realWorldTime: "2026-01-10T17:10:00Z", resumeRealWorldTime: "2026-01-10T17:11:00Z" }));
    expect(afterTimeoutPlays(flow, marks)[0].eventId).toBe(3);
  });

  it("is empty without marks", () => {
    expect(afterTimeoutPlays(gameFlow([]), null)).toEqual([]);
  });
});

describe("gameMoments", () => {
  const has = (map: Map<number, ReadonlySet<string>>, e: PlayByPlayEvent, moment: string) => map.get(e.eventId)?.has(moment) ?? false;

  it("marks the first and last two minutes of a period", () => {
    const start = play(1, "08:00", "rebound", 1);
    const justIn = play(1, "07:59", "rebound", 1);
    const end = play(1, "02:00", "rebound", 1);
    const tipoff = play(1, "10:00", "rebound", 1);
    const moments = gameMoments(gameFlow([start, justIn, end, tipoff]));
    expect(has(moments, start, "quarter_start")).toBe(true);
    expect(has(moments, tipoff, "quarter_start")).toBe(true);
    expect(has(moments, justIn, "quarter_start")).toBe(false);
    expect(has(moments, end, "quarter_end")).toBe(true);
    expect(has(moments, justIn, "quarter_end")).toBe(false);
    expect(moments.has(justIn.eventId)).toBe(false);
  });

  it("marks clutch plays: late in the fourth or overtime, within five before the play", () => {
    const lead = [made(1, "09:00", "3pt", 1), made(1, "08:00", "3pt", 1)]; // 6–0
    const tooEarly = miss(4, "05:01", 2);
    const tooFar = miss(4, "05:00", 2); // margin 6 before it
    const closer = made(4, "04:30", "2pt", 2); // margin 6 before, 4 after
    const clutch = miss(4, "04:00", 1); // margin 4 before
    const third = miss(3, "01:00", 1);
    const overtime = miss(5, "03:00", 1);
    const moments = gameMoments(gameFlow([...lead, third, tooEarly, tooFar, closer, clutch, overtime]));
    expect(has(moments, tooEarly, "clutch")).toBe(false);
    expect(has(moments, tooFar, "clutch")).toBe(false);
    expect(has(moments, closer, "clutch")).toBe(false);
    expect(has(moments, clutch, "clutch")).toBe(true);
    expect(has(moments, third, "clutch")).toBe(false);
    expect(has(moments, overtime, "clutch")).toBe(true);
  });

  it("marks every play inside a run, both sides'", () => {
    const before = miss(1, "09:30", 2);
    const first = made(1, "09:00", "3pt", 1);
    const between = miss(1, "08:45", 2);
    const second = made(1, "08:30", "3pt", 1);
    const last = made(1, "08:00", "2pt", 1);
    const after = made(1, "07:30", "2pt", 2);
    const moments = gameMoments(gameFlow([before, first, between, second, last, after]));
    expect([before, first, between, second, last, after].map((e) => has(moments, e, "run"))).toEqual([false, true, true, true, true, false]);
  });

  it("marks fast breaks from the feed's qualifier", () => {
    const fast = made(2, "06:00", "2pt", 1, { qualifiers: ["fastbreak", "pointsinthepaint"] });
    const slow = made(2, "05:30", "2pt", 1, { qualifiers: ["pointsinthepaint"] });
    const moments = gameMoments(gameFlow([fast, slow]));
    expect(has(moments, fast, "fast_break")).toBe(true);
    expect(has(moments, slow, "fast_break")).toBe(false);
  });

  it("marks the play after a team's timeout, not after the officials'", () => {
    const one = made(2, "05:40", "2pt", 1, { eventId: 200 });
    const two = play(2, "05:20", "turnover", 2, { eventId: 210 });
    const three = made(2, "03:00", "2pt", 1, { eventId: 230 });
    const marks = marksOf(timeout({ eventId: 205, period: 2, clock: "05:30" }), timeout({ eventId: 220, period: 2, clock: "04:00", kind: "officials", teamNumber: null }));
    const moments = gameMoments(gameFlow([one, two, three]), marks);
    expect(has(moments, two, "after_timeout")).toBe(true);
    expect(has(moments, three, "after_timeout")).toBe(false);
    expect(has(moments, one, "after_timeout")).toBe(false);
  });
});

describe("onCourtStints", () => {
  const on = (period: number, clock: string, team: 1 | 2, home: number[], away: number[], extra: Partial<PlayByPlayEvent> = {}) =>
    play(period, clock, "rebound", team, { onCourtHome: home, onCourtAway: away, ...extra });

  it("follows a player who starts, sits and comes back", () => {
    const events = [
      on(1, "10:00", 1, [7, 8], [20]),
      on(1, "08:00", 1, [7, 8], [20]),
      on(1, "06:00", 1, [9, 8], [20]),
      on(1, "04:00", 1, [7, 9], [20]),
    ];
    const stints = onCourtStints(gameFlow(events), 7);
    expect(stints.map((s) => [s.period, s.team, s.fromEventId, s.toEventId])).toEqual([
      [1, 1, events[0].eventId, events[1].eventId],
      [1, 1, events[3].eventId, events[3].eventId],
    ]);
  });

  it("is empty for a player who never plays", () => {
    expect(onCourtStints(gameFlow([on(1, "10:00", 1, [7], [20])]), 99)).toEqual([]);
  });

  it("never crosses a period break", () => {
    const events = [on(1, "00:30", 1, [7], [20]), on(2, "09:30", 1, [7], [20])];
    expect(onCourtStints(gameFlow(events), 7).map((s) => s.period)).toEqual([1, 2]);
  });

  it("is not ended by a play that lists nobody", () => {
    const events = [on(1, "09:00", 1, [7], [20]), play(1, "08:00", "foul", 2), on(1, "07:00", 1, [7], [20])];
    const stints = onCourtStints(gameFlow(events), 7);
    expect(stints).toHaveLength(1);
    expect(stints[0].toEventId).toBe(events[2].eventId);
  });

  it("gives each stint the score's change for the player's own side", () => {
    const events = [
      made(1, "09:30", "3pt", 1, { onCourtHome: [8], onCourtAway: [20] }), // 3–0, before 20's side scores
      made(1, "09:00", "2pt", 2, { onCourtHome: [7], onCourtAway: [20] }), // 3–2
      made(1, "08:30", "3pt", 2, { onCourtHome: [7], onCourtAway: [20] }), // 3–5
      made(1, "08:00", "2pt", 1, { onCourtHome: [7], onCourtAway: [21] }), // 5–5
    ];
    const flow = gameFlow(events);
    expect(onCourtStints(flow, 7).map((s) => s.plusMinus)).toEqual([-3]);
    expect(onCourtStints(flow, 20).map((s) => s.plusMinus)).toEqual([2]);
    expect(onCourtStints(flow, 21).map((s) => s.plusMinus)).toEqual([-2]);
  });

  it("leaves the score change out when the game has no score", () => {
    const events = [play(1, "09:00", "2pt", null, { onCourtHome: [7], onCourtAway: [20] })];
    expect(onCourtStints(gameFlow(events), 7)[0].plusMinus).toBeNull();
  });
});

describe("flowChart", () => {
  it("draws a stepped line around the zero line, home above", () => {
    const chart = flowChart({
      points: [
        { x: 10, diff: 5 },
        { x: 30, diff: -5 },
      ],
      x0: 0,
      x1: 40,
      height: 44,
      pad: 2,
    });
    expect(chart.maxAbs).toBe(10);
    expect(chart.zeroY).toBe(22);
    expect(chart.yOf(10)).toBe(2);
    expect(chart.yOf(-10)).toBe(42);
    expect(chart.line).toBe("M0 22L10 22L10 12L30 12L30 32L40 32");
    expect(chart.home).toBe("M0 22L10 22L10 12L30 12L30 22L40 22L40 22L0 22Z");
    expect(chart.away).toBe("M0 22L10 22L10 22L30 22L30 32L40 32L40 22L0 22Z");
  });

  it("scales to the largest lead rounded up to five, and keeps baskets inside the strip", () => {
    const chart = flowChart({ points: [{ x: -5, diff: 13 }, { x: 500, diff: 2 }], x0: 0, x1: 100, height: 60 });
    expect(chart.maxAbs).toBe(15);
    expect(chart.line.startsWith("M0 30L0 30L0 ")).toBe(true);
    expect(chart.line.endsWith("L100 26.3")).toBe(true);
  });

  it("opens a zoomed stretch on the difference it starts with, at the whole game's scale", () => {
    const chart = flowChart({ points: [{ x: 20, diff: -6 }], x0: 0, x1: 40, height: 44, pad: 2, startDiff: -8, minScale: 20 });
    expect(chart.maxAbs).toBe(20);
    expect(chart.line).toBe("M0 30L20 30L20 28L40 28");
    expect(chart.home).toBe("M0 22L20 22L20 22L40 22L40 22L0 22Z");
  });

  it("is a flat line for a game without baskets", () => {
    expect(flowChart({ points: [], x0: 0, x1: 50, height: 40 }).line).toBe("M0 20L50 20");
  });
});
