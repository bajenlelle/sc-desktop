import { describe, expect, it } from "vitest";
import type { PlayByPlayEvent, SyncPoint } from "../../types/match";
import { buildGameTimeline } from "../game-timeline";
import { normalizeSyncPoint, sameSyncPoint } from "../period-sync";
import { atCut, firstScoreAfterS, footageStartFromCuts, inFootage, q1Baskets, tipoffFromBasket } from "../sync-anchor";
import { syncFixes, withoutFix, withoutFixes } from "../sync-check";

// The start of a real game (Basketettan Dam, 2026-11-22): tip-off 13:00:17, the first points a layup 34 s in.
const T = (hms: string) => `2026-11-22T${hms}Z`;
const TIP = T("13:00:17");
let id = 0;
const play = (type: string, hms: string, clock: string, made: number, score: [number, number], period = 1): PlayByPlayEvent => ({
  eventId: ++id,
  type,
  subType: "",
  period,
  gameClockTime: clock,
  realWorldTime: T(hms),
  isSuccessful: made,
  qualifiers: [],
  scoreHome: score[0],
  scoreAway: score[1],
});
const events: PlayByPlayEvent[] = [
  play("2pt", "13:00:23", "09:56", 0, [0, 0]),
  play("rebound", "13:00:26", "09:51", 0, [0, 0]),
  play("3pt", "13:00:31", "09:48", 0, [0, 0]),
  play("rebound", "13:00:34", "09:43", 0, [0, 0]),
  play("2pt", "13:00:51", "09:27", 1, [2, 0]),
  play("foul", "13:01:04", "09:19", 0, [2, 0]),
  play("freethrow", "13:02:18", "09:19", 1, [2, 1]),
  play("3pt", "13:03:40", "07:40", 1, [2, 4]),
  play("2pt", "13:22:30", "09:40", 1, [20, 15], 2),
];

describe("q1Baskets", () => {
  it("lists the first quarter's made baskets from the field in order, with how long after the tip-off each came", () => {
    const list = q1Baskets(events, TIP);
    expect(list.map((b) => b.event.gameClockTime)).toEqual(["09:27", "07:40"]);
    expect(list[0].afterTipoffS).toBe(34);
    expect(list[0].score).toEqual({ home: 2, away: 0 });
  });

  it("leaves out a play the table logged late", () => {
    // A basket at 8:30 typed in two minutes after 7:40 was.
    const late = play("2pt", "13:05:40", "08:30", 1, [4, 4]);
    expect(q1Baskets([...events, late], TIP).map((b) => b.event.eventId)).not.toContain(late.eventId);
  });

  it("the tip-off lies as long before the basket as the feed says, and can be before the recording", () => {
    const [first] = q1Baskets(events, TIP);
    expect(tipoffFromBasket(95.3, first)).toBeCloseTo(61.3);
    expect(tipoffFromBasket(12, first)).toBeCloseTo(-22);
  });
});

describe("firstScoreAfterS", () => {
  it("is the first points on the board, free throws too", () => {
    expect(firstScoreAfterS(events, TIP)).toBe(34);
    const ftFirst = [play("freethrow", "13:00:40", "09:35", 1, [0, 1]), ...events];
    expect(firstScoreAfterS(ftFirst, TIP)).toBe(23);
  });
  it("is null with no score in the feed", () => {
    expect(firstScoreAfterS(events.map((e) => ({ ...e, scoreHome: null, scoreAway: null })), TIP)).toBeNull();
  });
});

describe("footageStartFromCuts", () => {
  it("is the last hard cut between the tip-off and the basket found", () => {
    // The warm-up until 85 s, then the game: the tip-off at 61 s is in what was lost.
    expect(footageStartFromCuts([12, 85.1, 386], 61.3, 95.3)).toBe(85.1);
  });
  it("is null when the footage runs unbroken to the basket, and for a cut at the basket itself", () => {
    expect(footageStartFromCuts([386], 61.3, 95.3)).toBeNull();
    expect(footageStartFromCuts([94.5], 61.3, 95.3)).toBeNull();
  });
  it("a recording that starts after the tip-off can still jump into the game later", () => {
    expect(footageStartFromCuts([20], -15, 60)).toBe(20);
  });
  it("atCut: a moment by a hard cut", () => {
    expect(atCut([85.1], 85)).toBe(true);
    expect(atCut([85.1], 90)).toBe(false);
  });
});

describe("footageStart", () => {
  const sync: SyncPoint = { syncVideoTime: 61.3, syncRealWorldTime: TIP, footageStart: 85.1 };

  it("a play the sync puts before it is not in the video", () => {
    expect(inFootage(80, sync)).toBe(false);
    expect(inFootage(90, sync)).toBe(true);
    expect(inFootage(0, {})).toBe(true);
    const timeline = buildGameTimeline({ matchId: "m", events, sync });
    const reach = timeline.plays.filter((p) => p.event.period === 1).map((p) => [p.event.gameClockTime, p.reach]);
    expect(reach.slice(0, 5)).toEqual([
      ["09:56", "before"],
      ["09:51", "before"],
      ["09:48", "before"],
      ["09:43", "before"],
      ["09:27", "in"],
    ]);
  });

  it("is kept by the normaliser and compared, and dropped when it isn't a time", () => {
    expect(normalizeSyncPoint(sync).footageStart).toBe(85.1);
    expect(normalizeSyncPoint({ ...sync, footageStart: -3 }).footageStart).toBeUndefined();
    expect(sameSyncPoint(sync, { ...sync, footageStart: undefined })).toBe(false);
  });

  it("is listed first among the fixes, with the plays it leaves out, and can be taken back", () => {
    const fixes = syncFixes(sync, events);
    expect(fixes[0]).toEqual({ kind: "start", seconds: 85.1, plays: 4 });
    expect(withoutFix(sync, fixes[0]).footageStart).toBeUndefined();
    expect(withoutFixes(sync).footageStart).toBeUndefined();
  });
});
