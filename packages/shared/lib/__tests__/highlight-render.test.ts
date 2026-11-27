import { describe, expect, it } from "vitest";
import type { PlayByPlayEvent, SyncPoint } from "../../types/match";
import { highlightCandidates } from "../highlight-picks";
import { finalScore, highlightRenderPlan, playLabel, playScore, type HighlightPlanGame } from "../highlight-render";

const T0 = Date.UTC(2026, 8, 19, 14, 0, 0);
let id = 1;
function play(sec: number, type: string, over: Partial<PlayByPlayEvent> = {}, team = 2): PlayByPlayEvent {
  return {
    eventId: id++, type, subType: "", period: 1, gameClockTime: "02:23", realWorldTime: new Date(T0 + sec * 1000).toISOString(),
    isSuccessful: 1, player: { playerId: 2001, pno: 2, firstName: "Alex", familyName: "Berg", teamNumber: team },
    eventTeam: null, qualifiers: [], ...over,
  };
}
const sync: SyncPoint = { syncVideoTime: 100, syncRealWorldTime: new Date(T0).toISOString() };
const game: HighlightPlanGame = {
  id: "g1", homeTeam: "Huddinge Basketklubb", awayTeam: "Fryshuset Basketbollklubb", videoPath: "/v.mp4", syncPoint: sync,
  line: "22 pts · 6 reb", finalScore: "59–76",
};

describe("labels", () => {
  it("names the play", () => {
    const [dunk, three, steal] = highlightCandidates({ matchId: "g1", events: [
      play(10, "2pt", { subType: "dunk" }), play(20, "3pt"), play(30, "steal"),
    ] }, 2001);
    expect([playLabel(dunk), playLabel(three), playLabel(steal)]).toEqual(["Dunk", "3PT made", "Steal"]);
  });

  it("joins a steal and its basket, and says and one", () => {
    const [c] = highlightCandidates({ matchId: "g1", events: [play(10, "steal"), play(13, "2pt", { subType: "dunk" })] }, 2001);
    expect(playLabel(c)).toBe("Steal + dunk");
    const [a] = highlightCandidates({ matchId: "g1", events: [play(40, "2pt"), play(41, "foulon")] }, 2001);
    expect(playLabel(a)).toBe("2PT made, and one");
  });

  it("puts the player's team first in the score", () => {
    expect(playScore(play(1, "2pt", { scoreHome: 17, scoreAway: 19 }))).toBe("19–17");
    expect(playScore(play(1, "2pt", { scoreHome: 17, scoreAway: 19 }, 1))).toBe("17–19");
    expect(playScore(play(1, "2pt"))).toBeNull();
  });

  it("reads the final score from the last scoring row", () => {
    expect(finalScore([play(1, "2pt", { scoreHome: 2, scoreAway: 0 }), play(2, "rebound"), play(3, "3pt", { scoreHome: 59, scoreAway: 76 }), play(4, "foul")])).toBe("59–76");
  });
});

describe("highlightRenderPlan", () => {
  const [a, b] = highlightCandidates({ matchId: "g1", events: [play(60, "3pt", { scoreHome: 10, scoreAway: 13 }), play(90, "2pt", { scoreHome: 12, scoreAway: 15 })] }, 2001);
  const games = new Map([["g1", game]]);

  it("starts with the hook, then labels, with windows as offsets around the play", () => {
    const plan = highlightRenderPlan([
      { candidate: b, window: { start: 186, end: 191.5 }, cropKeyframes: [{ t: 186, cx: 0.4 }] },
      { candidate: a, window: { start: 155, end: 162.5 }, cropKeyframes: [] },
    ], games, { name: "Alex Berg", number: "2" });
    expect(plan.map((p) => p.overlay.kind)).toEqual(["hook", "label"]);
    expect(plan[0].overlay).toEqual({ kind: "hook", line: "22 pts · 6 reb", who: "#2 Alex Berg · Huddinge 59–76 Fryshuset" });
    expect(plan[0].preRollOffset).toBeCloseTo(4, 6); // play at 190
    expect(plan[0].postRollOffset).toBeCloseTo(1.5, 6);
    expect(plan[1].overlay).toEqual({ kind: "label", clock: "Q1 02:23", play: "3PT made", score: "13–10", kindOf: "three" });
    expect(plan[0].cropKeyframes).toEqual([{ t: 186, cx: 0.4 }]);
  });

  it("leaves out plays it can't place", () => {
    const plan = highlightRenderPlan([
      { candidate: { ...a, matchId: "other" }, window: { start: 155, end: 162.5 }, cropKeyframes: [] },
      { candidate: b, window: { start: 186, end: 186 }, cropKeyframes: [] },
      { candidate: a, window: { start: 155, end: 162.5 }, cropKeyframes: [] },
    ], games, { name: "Alex Berg", number: null });
    expect(plan).toHaveLength(1);
    expect(plan[0].overlay.kind).toBe("hook");
  });
});
