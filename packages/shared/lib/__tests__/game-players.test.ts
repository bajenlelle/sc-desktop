import { describe, expect, it } from "vitest";
import type { PlayByPlayEvent } from "../../types/match";
import { gameBox } from "../game-box";
import { playerRows, type LeaguePerson } from "../game-players";

let nextId = 1;
function play(type: string, playerId: number, extra: Partial<PlayByPlayEvent> = {}): PlayByPlayEvent {
  return {
    eventId: nextId++,
    type,
    subType: "",
    period: 1,
    gameClockTime: `0${9 - (nextId % 9)}:00`,
    realWorldTime: "",
    isSuccessful: 1,
    player: { playerId, pno: playerId, firstName: "P", familyName: String(playerId), teamNumber: 1 },
    eventTeam: { teamCode: "", teamName: "Home", teamNumber: 1 },
    qualifiers: [],
    ...extra,
  };
}

const FIVE = [1, 2, 3, 4, 5];
const events = [...FIVE.map((id) => play("2pt", id, { onCourtHome: FIVE, onCourtAway: [9] })), play("3pt", 6, { onCourtHome: [6, 2, 3, 4, 5], onCourtAway: [9] })];
const box = gameBox(events);
const floor = (personId: number) => ({ eventIds: [personId * 100], plusMinus: personId === 6 ? 3 : -1 });
const league = (entries: Array<[number, Partial<LeaguePerson>]>): Map<number, LeaguePerson> =>
  new Map(entries.map(([id, p]) => [id, { min: null, pm: null, number: String(id), name: `P ${id}`, side: 1, ...p }]));

describe("playerRows", () => {
  it("a player the box score lists with no play of their own gets a row with zeros and the box score's minutes", () => {
    const rows = playerRows({ team: box.home, starters: box.starters.home, league: league([[7, { min: 125, pm: 2, name: "A. Zekovic", number: "6" }]]), source: "box", lineupSeconds: new Map(), floor });
    const row = rows.find((r) => r.personId === 7)!;
    expect(row).toMatchObject({ name: "A. Zekovic", number: "6", min: 125, pm: 2, starter: false });
    expect(row.cells.pts).toMatchObject({ value: 0, eventIds: [] });
    expect(row.cells.fg).toMatchObject({ value: 0, attempts: 0 });
  });

  it("a player the box score lists for the other team gets no row here", () => {
    const rows = playerRows({ team: box.home, starters: box.starters.home, league: league([[9, { side: 2 }]]), source: "box", lineupSeconds: new Map(), floor });
    expect(rows.some((r) => r.personId === 9)).toBe(false);
  });

  it("an unreadable box score counts minutes from the lineups and +/- from the stints", () => {
    const rows = playerRows({ team: box.home, starters: box.starters.home, league: new Map(), source: "stints", lineupSeconds: new Map([[6, 240]]), floor });
    expect(rows.find((r) => r.personId === 6)).toMatchObject({ min: 240, pm: 3, floorIds: [600] });
    expect(rows.find((r) => r.personId === 1)).toMatchObject({ min: null, pm: -1 });
  });

  it("a box score without +/- takes it from the stints", () => {
    const rows = playerRows({ team: box.home, starters: box.starters.home, league: league([[6, { min: 300, pm: null }]]), source: "box", lineupSeconds: new Map(), floor });
    expect(rows.find((r) => r.personId === 6)).toMatchObject({ min: 300, pm: 3 });
  });

  it("with no box score and no fives, minutes and +/- are unknown", () => {
    const none = () => ({ eventIds: [], plusMinus: null });
    const rows = playerRows({ team: box.home, starters: [], league: new Map(), source: "none", lineupSeconds: new Map(), floor: none });
    expect(rows.every((r) => r.min === null && r.pm === null)).toBe(true);
  });

  it("starters come first, then the bench by minutes", () => {
    const rows = playerRows({
      team: box.home,
      starters: box.starters.home,
      league: league([
        [6, { min: 600 }],
        [7, { min: 900 }],
        [1, { min: 100 }],
      ]),
      source: "box",
      lineupSeconds: new Map(),
      floor,
    });
    expect(rows.slice(0, 5).every((r) => r.starter)).toBe(true);
    expect(rows.slice(5).map((r) => r.personId)).toEqual([7, 6]);
  });
});
