import { describe, expect, it } from "vitest";
import { playerRoster, rosterByTeam, type PlayerChoice } from "../player-roster";
import type { GameStats } from "../stats-card-data";
import type { PlayByPlayEvent, PlaylistClipItem, PlaylistItem, StoredMatch } from "../../types/match";

type Person = { pid: number; first: string; family: string; pno: number; team: 1 | 2 };

const ALVA: Person = { pid: 1, first: "Alva", family: "Berg", pno: 7, team: 1 };
const OLA: Person = { pid: 2, first: "Ola", family: "Nilsson", pno: 12, team: 1 };
const BENNY: Person = { pid: 3, first: "Benny", family: "Holm", pno: 3, team: 1 };
const INES: Person = { pid: 4, first: "Ines", family: "Ek", pno: 6, team: 2 };
const ULF: Person = { pid: 5, first: "Ulf", family: "Sand", pno: 21, team: 2 };

function ev(eventId: number, p: Person | null, over: Partial<PlayByPlayEvent> = {}): PlayByPlayEvent {
  return {
    eventId,
    type: "3pt",
    subType: "jumpshot",
    period: 2,
    gameClockTime: "04:31:00",
    realWorldTime: "2026-10-12T17:00:00Z",
    isSuccessful: 1,
    qualifiers: [],
    player: p ? { playerId: p.pid, pno: p.pno, firstName: p.first, familyName: p.family, teamNumber: p.team } : undefined,
    eventTeam: p ? { teamCode: p.team === 1 ? "BB" : "AIK", teamName: p.team === 1 ? "Bajen Basket" : "AIK", teamNumber: p.team } : undefined,
    ...over,
  } as PlayByPlayEvent;
}

function match(id: string, events: PlayByPlayEvent[]): StoredMatch {
  return { id, events, homeTeam: { name: "Bajen Basket", color: "#000" }, awayTeam: { name: "AIK", color: "#fff" } } as unknown as StoredMatch;
}

function clip(matchId: string, eventId: number, over: Partial<PlaylistClipItem> = {}): PlaylistClipItem {
  return { type: "clip", matchId, eventId, ...over };
}

// Game m1: Alva 2 clips, Ola 1 clip; Benny, Ines and Ulf have plays but no clip in the playlist.
const m1Events = [ev(1, ALVA), ev(2, ALVA), ev(3, OLA), ev(4, BENNY), ev(5, INES), ev(6, ULF)];
const m1 = match("m1", m1Events);
// Game m2: Ola 2 clips, Alva 1; Benny is in it too.
const m2Events = [ev(1, OLA), ev(2, OLA), ev(3, ALVA), ev(4, BENNY)];
const m2 = match("m2", m2Events);
// Game m3 isn't in the playlist.
const m3 = match("m3", [ev(1, { pid: 9, first: "Nils", family: "Far", pno: 9, team: 1 })]);

const eventByKey = new Map<string, PlayByPlayEvent>([
  ...m1Events.map((e): [string, PlayByPlayEvent] => [`m1:${e.eventId}`, e]),
  ...m2Events.map((e): [string, PlayByPlayEvent] => [`m2:${e.eventId}`, e]),
]);
const matches = new Map([m1, m2, m3].map((m) => [m.id, m]));

const names = (r: readonly PlayerChoice[]) => r.map((p) => p.name);

describe("playerRoster", () => {
  it("lists the players with clips first, then everyone else in the games", () => {
    const items: PlaylistItem[] = [clip("m1", 1), clip("m1", 2), clip("m1", 3)];
    const roster = playerRoster({ items, eventByKey, matches });
    // Alva (2) and Ola (1) have clips; Benny and the AIK players only played.
    expect(names(roster)).toEqual(["Alva Berg", "Ola Nilsson", "Benny Holm", "Ines Ek", "Ulf Sand"]);
    expect(roster.map((p) => p.clips)).toEqual([2, 1, 0, 0, 0]);
  });

  it("puts the team with the clips first, then orders by shirt number", () => {
    const extra = ev(7, { pid: 6, first: "Zed", family: "Low", pno: 1, team: 1 });
    const game = match("m1", [...m1Events, extra]);
    const roster = playerRoster({
      items: [clip("m1", 1)],
      eventByKey,
      matches: new Map([["m1", game]]),
    });
    // Rest of Bajen (the clipped team) by number: Zed #1, Benny #3, Ola #12; then AIK: Ines #6, Ulf #21.
    expect(names(roster).slice(1)).toEqual(["Zed Low", "Benny Holm", "Ola Nilsson", "Ines Ek", "Ulf Sand"]);
  });

  it("reads each player's numbers from the game they have the most clips in", () => {
    const items: PlaylistItem[] = [clip("m1", 3), clip("m2", 1), clip("m2", 2), clip("m2", 3)];
    const roster = playerRoster({ items, eventByKey, matches });
    expect(roster.find((p) => p.name === "Ola Nilsson")).toMatchObject({ clips: 3, matchId: "m2" });
    expect(roster.find((p) => p.name === "Alva Berg")).toMatchObject({ clips: 1, matchId: "m2" });
  });

  it("lists a player who is in several games once, with the first game as theirs when they have no clips", () => {
    const roster = playerRoster({ items: [clip("m1", 1), clip("m2", 3)], eventByKey, matches });
    const benny = roster.filter((p) => p.name === "Benny Holm");
    expect(benny).toHaveLength(1);
    expect(benny[0]).toMatchObject({ clips: 0, matchId: "m1" });
  });

  it("leaves out games the playlist has no clips from", () => {
    const roster = playerRoster({ items: [clip("m1", 1)], eventByKey, matches });
    expect(names(roster)).not.toContain("Nils Far");
  });

  it("adds players the box score has and the plays don't", () => {
    const boxScores = new Map<string, GameStats>([
      [
        "m1",
        {
          source: "genius_hosted",
          score: { home: 0, away: 0 },
          players: [
            { side: "home", line: {} as never, player: { id: "99", name: "Bo Bänk", number: "14", teamId: null, teamName: "Bajen Basket" } },
            // Already known from the plays: not listed twice.
            { side: "home", line: {} as never, player: { id: "3", name: "Benny Holm", number: "3", teamId: null, teamName: "Bajen Basket" } },
          ],
        },
      ],
    ]);
    const roster = playerRoster({ items: [clip("m1", 1)], eventByKey, matches, boxScores });
    expect(names(roster).filter((n) => n === "Benny Holm")).toHaveLength(1);
    expect(roster.find((p) => p.playerId === "99")).toMatchObject({ name: "Bo Bänk", number: "14", clips: 0, matchId: "m1" });
  });

  it("marks the players who already have a report section", () => {
    const items: PlaylistItem[] = [clip("m1", 1), clip("m1", 3)];
    const roster = playerRoster({ items, eventByKey, matches, taken: new Set(["1"]) });
    expect(roster.find((p) => p.name === "Alva Berg")?.taken).toBe(true);
    expect(roster.find((p) => p.name === "Ola Nilsson")?.taken).toBe(false);
    // A section is allowed for someone with no clips too.
    expect(roster.find((p) => p.name === "Benny Holm")?.taken).toBe(false);
  });

  it("takes nobody when no sections are given", () => {
    const roster = playerRoster({ items: [clip("m1", 1), clip("m1", 3)], eventByKey, matches });
    expect(roster.every((p) => !p.taken)).toBe(true);
  });

  it("takes a blank team name from the game data", () => {
    const noTeam = new Map(eventByKey);
    noTeam.set("m1:1", ev(1, ALVA, { eventTeam: undefined }));
    const roster = playerRoster({ items: [clip("m1", 1)], eventByKey: noTeam, matches });
    expect(roster[0]).toMatchObject({ name: "Alva Berg", teamName: "Bajen Basket" });
  });

  it("is empty for a playlist with no clips", () => {
    expect(playerRoster({ items: [], eventByKey, matches })).toEqual([]);
  });
});

describe("rosterByTeam", () => {
  const choice = (name: string, teamName: string, clips: number): PlayerChoice => ({
    playerId: name,
    name,
    number: null,
    teamName,
    clips,
    matchId: "m1",
    taken: false,
  });

  it("groups the roster by team, the team with most clips first, players in roster order", () => {
    const roster = playerRoster({ items: [clip("m1", 5), clip("m1", 6), clip("m1", 1)], eventByKey, matches });
    const teams = rosterByTeam(roster);
    expect(teams.map((t) => t.teamName)).toEqual(["AIK", "Bajen Basket"]);
    // Ines (1 clip) and Ulf (1 clip) stay in roster order; the rest of Bajen keep theirs too.
    expect(names(teams[0].players)).toEqual(["Ines Ek", "Ulf Sand"]);
    expect(names(teams[1].players)).toEqual(["Alva Berg", "Benny Holm", "Ola Nilsson"]);
  });

  it("orders teams with the same clips by name", () => {
    const teams = rosterByTeam([choice("b", "Zebras", 1), choice("a", "Antelopes", 1), choice("c", "Zebras", 0)]);
    expect(teams.map((t) => t.teamName)).toEqual(["Antelopes", "Zebras"]);
    expect(names(teams[1].players)).toEqual(["b", "c"]);
  });

  it("puts players with no team name in a nameless team after the named ones with as many clips", () => {
    const teams = rosterByTeam([choice("x", "", 1), choice("a", "Antelopes", 1), choice("y", "", 0)]);
    expect(teams.map((t) => t.teamName)).toEqual(["Antelopes", ""]);
    expect(names(teams[1].players)).toEqual(["x", "y"]);
    // More clips still wins: the nameless group is a data gap, not a ranking.
    expect(rosterByTeam([choice("x", "", 2), choice("a", "Antelopes", 1)]).map((t) => t.teamName)).toEqual(["", "Antelopes"]);
  });

  it("is empty for an empty roster", () => {
    expect(rosterByTeam([])).toEqual([]);
  });
});
