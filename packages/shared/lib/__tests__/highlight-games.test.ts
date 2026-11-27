import { describe, expect, it } from "vitest";
import type { PlayByPlayEvent, SyncPoint } from "../../types/match";
import { bestGameId, candidateWindow, myGames, playersInGames } from "../highlight-games";
import { highlightCandidates } from "../highlight-picks";

let nextId = 1;
const T0 = Date.UTC(2026, 9, 21, 17, 0, 0);
function play(sec: number, type: string, who: [number, number, string, number], over: Partial<PlayByPlayEvent> = {}): PlayByPlayEvent {
  const [playerId, pno, familyName, teamNumber] = who;
  return {
    eventId: nextId++, type, subType: "", period: 1, gameClockTime: "05:00",
    realWorldTime: new Date(T0 + sec * 1000).toISOString(), isSuccessful: 1,
    player: { playerId, pno, firstName: "", familyName, teamNumber }, eventTeam: null, qualifiers: [], ...over,
  };
}
const PLAYER: [number, number, string, number] = [78001, 78, "Berg", 2];
const ELLIOT: [number, number, string, number] = [3001, 3, "Elliot", 2];
const OPP: [number, number, string, number] = [9001, 8, "Davids", 1];
const sync: SyncPoint = { syncVideoTime: 600, syncRealWorldTime: new Date(T0).toISOString() };

const game = (id: string, date: string, events: PlayByPlayEvent[], withSync = true) => ({
  id, date, homeTeam: { name: "Eskilstuna Basket", color: "" }, awayTeam: { name: "Fryshuset", color: "" },
  syncPoint: withSync ? sync : undefined, videoUrl: "/v.mp4", events,
});

describe("playersInGames", () => {
  it("lists everyone once, the most games first", () => {
    const players = playersInGames([
      game("a", "2026-10-21", [play(1, "2pt", PLAYER), play(2, "2pt", OPP), play(3, "rebound", PLAYER)]),
      game("b", "2026-11-01", [play(1, "2pt", PLAYER), play(2, "2pt", ELLIOT)]),
    ]);
    expect(players.map((p) => [p.name, p.number, p.games])).toEqual([["Berg", "78", 2], ["Davids", "8", 1], ["Elliot", "3", 1]]);
    expect(players[0].teamName).toBe("Fryshuset");
  });
});

describe("myGames and bestGameId", () => {
  const a = game("a", "2026-10-21", [
    play(1, "2pt", PLAYER, { subType: "dunk" }), play(2, "3pt", PLAYER),
    ...Array.from({ length: 6 }, (_, i) => play(10 + i, "rebound", PLAYER, { subType: "defensive" })),
  ]);
  const b = game("b", "2026-11-01", [play(1, "2pt", PLAYER)]);
  const c = game("c", "2026-11-05", [play(1, "2pt", ELLIOT)]);
  const games = myGames([a, b, c], "78001");

  it("keeps the player's games, newest first, with their line", () => {
    expect(games.map((g) => g.id)).toEqual(["b", "a"]);
    expect(games[1].line).toBe("5 pts · 6 reb");
    expect(games[0].line).toBe("2 pts");
  });

  it("starts with the game whose plays score best", () => {
    expect(bestGameId(games)).toBe("a");
  });

  it("skips games that can't be found in their video", () => {
    expect(bestGameId(myGames([game("x", "2026-10-21", [play(1, "2pt", PLAYER)], false)], "78001"))).toBeNull();
  });
});

describe("candidateWindow", () => {
  it("runs from 5 s before the first play to 2.5 s after the anchor", () => {
    const [c] = highlightCandidates({ matchId: "a", events: [play(100, "2pt", PLAYER)] }, "78001");
    expect(candidateWindow(c, sync)).toEqual({ start: 695, end: 702.5 });
  });

  it("keeps the end and caps a long steal-and-score at 10.75 s", () => {
    const events = [play(100, "steal", PLAYER), play(109, "2pt", PLAYER)];
    const [c] = highlightCandidates({ matchId: "a", events }, "78001");
    expect(c.events).toHaveLength(2);
    const w = candidateWindow(c, sync)!;
    expect(w.end).toBe(711.5);
    expect(w.end - w.start).toBeCloseTo(10.75, 6);
  });

  it("is null without a sync point", () => {
    const [c] = highlightCandidates({ matchId: "a", events: [play(100, "2pt", PLAYER)] }, "78001");
    expect(candidateWindow(c, undefined)).toBeNull();
  });
});
