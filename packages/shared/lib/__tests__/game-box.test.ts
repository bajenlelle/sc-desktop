import { describe, expect, it } from "vitest";
import type { PlayByPlayEvent } from "../../types/match";
import { gameFlow } from "../game-flow";
import { gameBox, statSetName, type BoxStat } from "../game-box";

let nextId = 1;
type Who = { id: number; no: number; first: string; last: string; side: 1 | 2 };
const P = (id: number, no: number, last: string, side: 1 | 2): Who => ({ id, no, first: "A", last, side });

/** A play; `who` is a player, or a side for a team stat. */
function play(type: string, who: Who | 1 | 2, extra: Partial<PlayByPlayEvent> = {}): PlayByPlayEvent {
  const side = typeof who === "number" ? who : who.side;
  return {
    eventId: nextId++,
    type,
    subType: "",
    period: 1,
    gameClockTime: "10:00",
    realWorldTime: "",
    isSuccessful: 1,
    player:
      typeof who === "number"
        ? null
        : { playerId: who.id, pno: who.no, firstName: who.first, familyName: who.last, teamNumber: who.side },
    eventTeam: { teamCode: "", teamName: side === 1 ? "Home" : "Away", teamNumber: side },
    qualifiers: [],
    ...extra,
  };
}
const miss = { isSuccessful: 0 };
/** Plays one second apart, counting down from 10:00 in period 1. */
function clocked(plays: PlayByPlayEvent[]): PlayByPlayEvent[] {
  return plays.map((p, i) => {
    const s = 600 - i;
    return { ...p, gameClockTime: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` };
  });
}

const lind = P(1, 4, "Lind", 1);
const berg = P(2, 7, "Berg", 1);
const olsson = P(3, 9, "Olsson", 2);

const ALL: BoxStat[] = ["pts", "fg", "tp", "ft", "oreb", "dreb", "reb", "ast", "tov", "stl", "blk", "pf"];

describe("gameBox", () => {
  it("counts a player's line from their plays", () => {
    const box = gameBox(
      clocked([
        play("2pt", lind),
        play("2pt", lind),
        play("3pt", lind, miss),
        play("freethrow", lind),
        play("freethrow", lind, miss),
        play("assist", lind),
        play("rebound", lind, { subType: "defensive" }),
      ]),
    );
    const c = box.home.players.find((p) => p.personId === 1)!.cells;
    expect(c.pts.value).toBe(5);
    expect([c.fg.value, c.fg.attempts]).toEqual([2, 3]);
    expect([c.tp.value, c.tp.attempts]).toEqual([0, 1]);
    expect([c.ft.value, c.ft.attempts]).toEqual([1, 2]);
    expect(c.ast.value).toBe(1);
    expect(c.dreb.value).toBe(1);
    expect(c.reb.value).toBe(1);
  });

  it("each cell's plays are exactly what it counts", () => {
    const events = clocked([
      play("2pt", lind),
      play("3pt", lind),
      play("3pt", berg, miss),
      play("freethrow", berg),
      play("freethrow", berg, miss),
      play("rebound", berg, { subType: "offensive" }),
      play("turnover", lind),
      play("steal", olsson),
      play("block", olsson),
      play("foul", olsson),
      play("foulon", lind),
      play("assist", berg),
    ]);
    const box = gameBox(events);
    const byId = new Map(events.map((e) => [e.eventId, e]));
    for (const p of [...box.home.players, ...box.away.players]) {
      for (const stat of ALL) {
        const cell = p.cells[stat];
        for (const id of cell.eventIds) expect(byId.get(id)!.player!.playerId).toBe(p.personId);
        if (stat === "pts") {
          expect(cell.eventIds.every((id) => byId.get(id)!.isSuccessful === 1)).toBe(true);
        } else if (stat === "fg" || stat === "tp" || stat === "ft") {
          expect(cell.eventIds.length).toBe(cell.attempts);
          expect(cell.eventIds.filter((id) => byId.get(id)!.isSuccessful === 1).length).toBe(cell.value);
        } else {
          expect(cell.eventIds.length).toBe(cell.value);
        }
      }
    }
    expect(box.home.players.find((p) => p.personId === 1)!.cells.pts.value).toBe(5);
    expect(box.away.players.find((p) => p.personId === 3)!.cells.pf.value).toBe(1);
  });

  it("team points equal gameFlow's final", () => {
    const events: PlayByPlayEvent[] = [];
    for (let q = 1; q <= 4; q++) {
      events.push(
        play("2pt", lind, { period: q, gameClockTime: "09:00" }),
        play("3pt", berg, { period: q, gameClockTime: "08:00" }),
        play("freethrow", olsson, { period: q, gameClockTime: "07:00" }),
        play("3pt", olsson, { period: q, gameClockTime: "06:00", isSuccessful: 0 }),
        play("2pt", olsson, { period: q, gameClockTime: "05:00" }),
      );
    }
    const box = gameBox(events);
    const final = gameFlow(events).final!;
    const sum = (t: typeof box.home) => t.players.reduce((n, p) => n + p.cells.pts.value, 0);
    expect(sum(box.home)).toBe(final.home);
    expect(sum(box.away)).toBe(final.away);
    expect(box.home.totals.pts.value).toBe(final.home);
  });

  it("team rebounds and turnovers go to the team row", () => {
    const box = gameBox(
      clocked([
        play("rebound", 2, { subType: "offensive" }),
        play("turnover", 2),
        play("rebound", olsson, { subType: "defensive" }),
      ]),
    );
    expect(box.away.teamRow.oreb.value).toBe(1);
    expect(box.away.teamRow.tov.value).toBe(1);
    expect(box.away.teamRow.reb.value).toBe(1);
    expect(box.away.totals.reb.value).toBe(2);
    expect(box.away.totals.tov.value).toBe(1);
  });

  it("bookkeeping rows are skipped", () => {
    const box = gameBox(clocked([play("rebound", lind, { subType: "offensivedeadball" }), play("2pt", lind)]));
    const c = box.home.players[0].cells;
    expect(c.oreb.value).toBe(0);
    expect(c.reb.value).toBe(0);
    expect(box.home.totals.reb.value).toBe(0);
  });

  it("starters are the first five on the floor", () => {
    const five = [11, 12, 13, 14, 15];
    const starters = five.map((id, i) => P(id, i + 1, `S${i}`, 1));
    const sub = P(16, 20, "Bench", 1);
    const box = gameBox(
      clocked([
        ...starters.map((s) => play("2pt", s, { onCourtHome: five, onCourtAway: [] })),
        play("3pt", sub, { onCourtHome: [16, 12, 13, 14, 15], onCourtAway: [] }),
        play("3pt", sub, { onCourtHome: [16, 12, 13, 14, 15], onCourtAway: [] }),
        play("rebound", starters[4], { subType: "defensive", onCourtHome: [16, 12, 13, 14, 15], onCourtAway: [] }),
      ]),
    );
    expect(box.hasFives).toBe(true);
    expect([...box.starters.home].sort()).toEqual(five);
    expect(box.home.players.slice(0, 5).map((p) => p.personId).sort()).toEqual(five);
    expect(box.home.players.slice(0, 5).every((p) => p.starter)).toBe(true);
    expect(box.home.players.find((p) => p.personId === 16)!.starter).toBe(false);
    expect(box.home.players[5].personId).toBe(16);
  });

  it("without fives players sort by points", () => {
    const box = gameBox(clocked([play("2pt", lind), play("3pt", berg), play("2pt", lind, miss)]));
    expect(box.hasFives).toBe(false);
    expect(box.home.players.map((p) => p.personId)).toEqual([2, 1]);
    expect(box.home.players.some((p) => p.starter)).toBe(false);
  });

  it("a game with no misses reports it", () => {
    expect(gameBox(clocked([play("2pt", lind), play("3pt", olsson)])).hasMisses).toBe(false);
    expect(gameBox(clocked([play("2pt", lind, miss)])).hasMisses).toBe(true);
  });

  it("names a player's set of plays", () => {
    expect(statSetName("Lind", "tp")).toBe("Lind: three-point attempts");
  });
});
