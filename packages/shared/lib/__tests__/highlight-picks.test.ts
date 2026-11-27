import { describe, expect, it } from "vitest";
import type { PlayByPlayEvent } from "../../types/match";
import { HIGHLIGHT_WEIGHTS as W, highlightCandidates, highlightOrder, pickHighlights } from "../highlight-picks";

const PEDRO = 78001;
const OTHER = 99;
let nextId = 1;

/** A play at `sec` seconds after 19:00:00 UTC, by Pedro (home) unless another player is given. */
function play(sec: number, type: string, over: Partial<PlayByPlayEvent> = {}, playerId = PEDRO, team = 1): PlayByPlayEvent {
  const t = new Date(Date.UTC(2026, 9, 21, 19, 0, 0) + sec * 1000).toISOString();
  return {
    eventId: nextId++,
    type,
    subType: "",
    period: 1,
    gameClockTime: "05:00",
    realWorldTime: t,
    isSuccessful: 1,
    player: { playerId, pno: playerId === PEDRO ? 78 : 5, firstName: "P", familyName: "L", teamNumber: team },
    eventTeam: null,
    qualifiers: [],
    ...over,
  };
}

const game = (events: PlayByPlayEvent[]) => ({ matchId: "m1", events });

describe("highlightCandidates", () => {
  it("keeps only the player's made baskets, blocks and steals", () => {
    const cs = highlightCandidates(game([
      play(10, "2pt", { subType: "layup" }),
      play(20, "2pt", { isSuccessful: 0 }),
      play(30, "rebound", { subType: "defensive" }),
      play(40, "3pt", { subType: "jumpshot" }, OTHER),
      play(50, "block"),
      play(60, "freethrow", { subType: "1of2" }),
    ]), PEDRO);
    expect(cs.map((c) => c.kind)).toEqual(["two", "block"]);
  });

  it("scores dunks above threes above twos", () => {
    const cs = highlightCandidates(game([
      play(10, "2pt", { subType: "jumpshot" }),
      play(20, "3pt", { subType: "jumpshot" }),
      play(30, "2pt", { subType: "dunk" }),
      play(40, "2pt", { subType: "alleyoopdunk" }),
    ]), PEDRO);
    expect(cs.map((c) => [c.kind, c.score])).toEqual([["two", W.two], ["three", W.three], ["dunk", W.dunk], ["dunk", W.dunk]]);
  });

  it("joins a steal and the player's own basket right after into one clip", () => {
    const steal = play(100, "steal");
    const dunk = play(104, "2pt", { subType: "dunk" });
    const cs = highlightCandidates(game([steal, dunk, play(200, "steal")]), PEDRO);
    expect(cs).toHaveLength(2);
    expect(cs[0].events.map((e) => e.eventId)).toEqual([steal.eventId, dunk.eventId]);
    expect(cs[0].anchor.eventId).toBe(dunk.eventId);
    expect(cs[0].kind).toBe("dunk");
    expect(cs[0].score).toBe(W.dunk + W.stealToScore);
    expect(cs[0].key).toBe(`m1:${steal.eventId}`);
    expect(cs[1].kind).toBe("steal");
  });

  it("keeps a steal on its own when a teammate scores, or the basket comes too late", () => {
    const cs = highlightCandidates(game([
      play(100, "steal"), play(103, "2pt", {}, OTHER),
      play(200, "steal"), play(215, "2pt"),
    ]), PEDRO);
    expect(cs.map((c) => c.kind)).toEqual(["steal", "steal", "two"]);
  });

  it("finds an and-one from the foul drawn at the same clock", () => {
    const cs = highlightCandidates(game([
      play(10, "2pt", { gameClockTime: "05:00" }),
      play(11, "foulon", { gameClockTime: "05:00" }),
      play(30, "freethrow", { subType: "1of1", gameClockTime: "05:00", isSuccessful: 0 }),
      play(90, "2pt", { gameClockTime: "03:39" }),
    ]), PEDRO);
    expect(cs.map((c) => c.andOne)).toEqual([true, false]);
    expect(cs[0].score).toBe(W.two + W.andOne);
  });

  it("adds clutch and go-ahead from the running score", () => {
    // Pedro's team is home; 88–90 before, 91–90 after a three with 0:40 left in Q4
    const three = play(10, "3pt", { period: 4, gameClockTime: "00:40", scoreHome: 91, scoreAway: 90 });
    const early = play(20, "3pt", { period: 1, gameClockTime: "00:40", scoreHome: 3, scoreAway: 2 });
    const [first, late] = highlightCandidates(game([three, early]), PEDRO); // game order: Q1 before Q4
    expect(late.clutch).toBe(true);
    expect(late.goAhead).toBe(true);
    expect(late.score).toBe(W.three + W.clutch + W.goAhead);
    expect(first.clutch).toBe(false);
    expect(first.goAhead).toBe(true);
  });

  it("reads the lead from the away side for an away player", () => {
    const tie = play(10, "2pt", { period: 4, gameClockTime: "02:00", scoreHome: 80, scoreAway: 80 }, PEDRO, 2);
    const [c] = highlightCandidates(game([tie]), PEDRO);
    expect(c.goAhead).toBe(false);
    expect(c.score).toBe(W.two + W.clutch + W.tie);
  });

  it("leaves out plays the video can't place", () => {
    const cs = highlightCandidates(game([play(10, "2pt", { realWorldTime: "" })]), PEDRO);
    expect(cs).toEqual([]);
  });

  it("returns candidates in game order whatever order the rows come in", () => {
    const a = play(10, "2pt", { period: 1 });
    const b = play(5, "3pt", { period: 2 });
    const c = play(1, "block", { period: 1 });
    expect(highlightCandidates(game([b, a, c]), PEDRO).map((x) => x.anchor.eventId)).toEqual([c.eventId, a.eventId, b.eventId]);
  });
});

describe("pickHighlights and highlightOrder", () => {
  const plays = [
    play(10, "2pt"), // two
    play(20, "3pt"), // three
    play(30, "2pt", { subType: "dunk" }), // dunk: best
    play(40, "block"),
    play(50, "2pt"),
    play(60, "3pt"), // three, later: second best on the tie
    play(70, "steal"),
  ];
  const cs = highlightCandidates(game(plays), PEDRO);

  it("ticks the best plays until the target length, at least min", () => {
    const picked = pickHighlights(cs, { targetSeconds: 10, min: 2 });
    // 3.5 s each: dunk, then the later three, then the earlier three reaches 10.5 s
    expect([...picked]).toEqual([cs[2].key, cs[5].key, cs[1].key]);
  });

  it("stops at max", () => {
    expect(pickHighlights(cs, { targetSeconds: 999, max: 4 }).size).toBe(4);
  });

  it("orders the best first, the rest in game order and the second best last", () => {
    const picked = cs.filter((c) => pickHighlights(cs, { targetSeconds: 999 }).has(c.key));
    const order = highlightOrder(picked).map((c) => c.anchor.eventId);
    expect(order[0]).toBe(plays[2].eventId);
    expect(order[order.length - 1]).toBe(plays[5].eventId);
    expect(order.slice(1, -1)).toEqual([plays[0], plays[1], plays[3], plays[4], plays[6]].map((p) => p.eventId));
  });

  it("orders two plays best first", () => {
    expect(highlightOrder([cs[0], cs[2]]).map((c) => c.kind)).toEqual(["dunk", "two"]);
  });
});
