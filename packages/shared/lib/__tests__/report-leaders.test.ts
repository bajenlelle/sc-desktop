import { describe, expect, it } from "vitest";
import type { HostedSeasonPlayer } from "../hosted-stats";
import type { PlayerChoice } from "../player-roster";
import {
  LEADER_MIN_3PA,
  LEADER_STATS,
  formatLeaderValue,
  leaderCompetition,
  leaderRows,
  leaderValue,
  rankBy,
  topN,
  type LeaderRow,
} from "../report-leaders";
import type { SeasonLine } from "../stat-lines";
import type { League } from "../../types/league";
import type { PlayByPlayEvent, PlaylistClipItem, PlaylistItem, StoredMatch } from "../../types/match";

type Person = { pid: number; first: string; family: string; pno: number; team: 1 | 2 };

const ALVA: Person = { pid: 1, first: "Alva", family: "Berg", pno: 7, team: 1 };
const OLA: Person = { pid: 2, first: "Ola", family: "Nilsson", pno: 12, team: 1 };
const INES: Person = { pid: 4, first: "Ines", family: "Ek", pno: 6, team: 2 };

function ev(eventId: number, p: Person): PlayByPlayEvent {
  return {
    eventId,
    type: "2pt",
    subType: "layup",
    period: 1,
    gameClockTime: "08:00:00",
    realWorldTime: "2026-10-12T17:00:00Z",
    isSuccessful: 1,
    qualifiers: [],
    player: { playerId: p.pid, pno: p.pno, firstName: p.first, familyName: p.family, teamNumber: p.team },
    eventTeam: { teamCode: p.team === 1 ? "BB" : "AIK", teamName: p.team === 1 ? "Bajen Basket" : "AIK", teamNumber: p.team },
  } as PlayByPlayEvent;
}

function match(id: string, events: PlayByPlayEvent[], over: Partial<StoredMatch> = {}): StoredMatch {
  return {
    id,
    events,
    homeTeam: { name: "Bajen Basket", color: "#000" },
    awayTeam: { name: "AIK", color: "#fff" },
    leagueId: "superettan-herr",
    seasonId: "2025-26",
    sourceGameId: "2668882",
    ...over,
  } as unknown as StoredMatch;
}

const clip = (matchId: string, eventId: number): PlaylistClipItem => ({ type: "clip", matchId, eventId });

const leagues: League[] = [
  {
    id: "superettan-herr",
    name: "Superettan Herr",
    country: "SE",
    seasons: [
      { id: "2025-26", label: "2025/26", competitionId: 41539, stages: [] },
      { id: "2024-25", label: "2024/25", competitionId: 40000, stages: [] },
      { id: "2023-24", label: "2023/24", stages: [] },
    ],
  },
  {
    id: "profixio-stockholm-div1",
    name: "Division 1",
    country: "SE",
    provider: "profixio",
    seasons: [{ id: "2025-26", label: "2025/26", provider: "profixio", competitionId: 5, stages: [] }],
  },
];

// m1: this season (41539), Alva and Ines play. m2: a Profixio game, no season page; Alva and Ola.
// m3: last season (40000), Alva and Ola. m4: a season without hosted stats; Ola.
const m1 = match("m1", [ev(1, ALVA), ev(2, INES)]);
const m2 = match("m2", [ev(1, ALVA), ev(2, OLA)], { leagueId: "profixio-stockholm-div1", sourceGameId: "profixio:1" });
const m3 = match("m3", [ev(1, ALVA), ev(2, OLA)], { seasonId: "2024-25" });
const m4 = match("m4", [ev(1, OLA)], { seasonId: "2023-24" });
const matches = new Map([m1, m2, m3, m4].map((m) => [m.id, m]));

const choice = (playerId: string, name: string, over: Partial<PlayerChoice> = {}): PlayerChoice => ({
  playerId,
  name,
  number: null,
  teamName: "Bajen Basket",
  clips: 0,
  matchId: "m1",
  taken: false,
  ...over,
});

const EMPTY_LINE: SeasonLine = {
  gp: 10,
  gs: null,
  mpg: null,
  ppg: 0,
  rpg: null,
  orpg: null,
  drpg: null,
  apg: null,
  spg: null,
  bpg: null,
  topg: null,
  pfpg: null,
  fgPct: null,
  tpm: null,
  tpa: null,
  tpPct: null,
  ftPct: null,
  pmPg: null,
};

function seasonPlayer(personId: string, line: Partial<SeasonLine>): HostedSeasonPlayer {
  return { personId, name: `Player ${personId}`, stints: 1, line: { ...EMPTY_LINE, ...line } };
}

function page(...players: HostedSeasonPlayer[]): ReadonlyMap<string, HostedSeasonPlayer> {
  return new Map(players.map((p) => [p.personId, p]));
}

const row = (player: PlayerChoice, line: Partial<SeasonLine> | null, competitionId: number | null = 41539): LeaderRow => ({
  player,
  competitionId,
  line: line === null ? null : { ...EMPTY_LINE, ...line },
});

const names = (rows: readonly LeaderRow[]) => rows.map((r) => r.player.name);

describe("LEADER_STATS", () => {
  it("names the six picker columns in order", () => {
    expect(LEADER_STATS.map((s) => s.label)).toEqual(["PPG", "RPG", "APG", "SPG", "BPG", "3P%"]);
    expect(LEADER_STATS.map((s) => s.key)).toEqual(["ppg", "rpg", "apg", "spg", "bpg", "tpPct"]);
  });
});

describe("leaderCompetition", () => {
  it("takes the season of the game the player's clips come from", () => {
    const alva = choice("1", "Alva Berg", { matchId: "m1", clips: 3 });
    expect(leaderCompetition(alva, [clip("m3", 1), clip("m1", 1)], matches, leagues)).toBe(41539);
    expect(leaderCompetition({ ...alva, matchId: "m3" }, [clip("m3", 1), clip("m1", 1)], matches, leagues)).toBe(40000);
  });

  it("falls back to the first playlist game that lists the player and has a season", () => {
    // Alva's clips are from the Profixio game: no page for it, but m1 lists her.
    const alva = choice("1", "Alva Berg", { matchId: "m2", clips: 2 });
    expect(leaderCompetition(alva, [clip("m2", 1), clip("m1", 1)], matches, leagues)).toBe(41539);
    // First appearance in the items decides, not the matches map.
    expect(leaderCompetition(alva, [clip("m2", 1), clip("m3", 1), clip("m1", 1)], matches, leagues)).toBe(40000);
    expect(leaderCompetition(alva, [clip("m1", 1), clip("m3", 1), clip("m1", 2)], matches, leagues)).toBe(41539);
  });

  it("skips playlist games that don't list the player, or have no season", () => {
    // Ola isn't in m1; m4's season has no hosted stats; m3 lists him.
    const ola = choice("2", "Ola Nilsson", { matchId: "m2", clips: 1 });
    expect(leaderCompetition(ola, [clip("m1", 1), clip("m4", 1), clip("m3", 2)], matches, leagues)).toBe(40000);
  });

  it("is null when no game with a season lists the player", () => {
    const ola = choice("2", "Ola Nilsson", { matchId: "m2", clips: 1 });
    expect(leaderCompetition(ola, [clip("m2", 2), clip("m1", 1)], matches, leagues)).toBeNull();
    expect(leaderCompetition(ola, [clip("m2", 2)], matches, leagues)).toBeNull();
    expect(leaderCompetition(choice("7", "Nobody", { matchId: "" }), [], matches, leagues)).toBeNull();
    // A game the store doesn't have, or a league the catalogue doesn't know.
    expect(leaderCompetition(choice("1", "Alva Berg", { matchId: "gone" }), [clip("gone", 1)], matches, leagues)).toBeNull();
    expect(leaderCompetition(choice("1", "Alva Berg"), [clip("m1", 1)], matches, [])).toBeNull();
  });
});

describe("leaderRows", () => {
  const alva = choice("1", "Alva Berg", { clips: 3 });
  const ola = choice("2", "Ola Nilsson", { matchId: "m3", clips: 1 });
  const ines = choice("4", "Ines Ek");
  const seasons = new Map([
    [41539, page(seasonPlayer("1", { ppg: 13.3, tpa: 40 }), seasonPlayer("9", { ppg: 30 }))],
    [40000, page(seasonPlayer("2", { ppg: 8.1 }))],
  ]);
  const competitionOf = (p: PlayerChoice) => (p.matchId === "m3" ? 40000 : p.matchId === "m1" ? 41539 : null);

  it("joins each player with their line on their competition's page, keeping roster order", () => {
    const rows = leaderRows([ola, alva], competitionOf, seasons);
    expect(names(rows)).toEqual(["Ola Nilsson", "Alva Berg"]);
    expect(rows[0]).toMatchObject({ competitionId: 40000, line: { ppg: 8.1 } });
    expect(rows[1]).toMatchObject({ competitionId: 41539, line: { ppg: 13.3, tpa: 40 } });
  });

  it("leaves the line null for a player the page doesn't list, a page not loaded, or no competition", () => {
    const rows = leaderRows([ines, { ...alva, matchId: "m2" }, { ...ola, matchId: "m1" }], competitionOf, seasons);
    expect(rows[0]).toEqual({ player: ines, competitionId: 41539, line: null });
    expect(rows[1]).toMatchObject({ competitionId: null, line: null });
    expect(rows[2]).toMatchObject({ competitionId: 41539, line: null });
    expect(leaderRows([alva], competitionOf, new Map())).toEqual([{ player: alva, competitionId: 41539, line: null }]);
  });
});

describe("leaderValue", () => {
  it("reads the stat off the line, null without a line or a published value", () => {
    const r = row(choice("1", "Alva Berg"), { ppg: 13.3, rpg: null, tpPct: 33.9 });
    expect(leaderValue(r, "ppg")).toBe(13.3);
    expect(leaderValue(r, "rpg")).toBeNull();
    expect(leaderValue(r, "tpPct")).toBe(33.9);
    expect(leaderValue(row(choice("1", "Alva Berg"), null), "ppg")).toBeNull();
  });
});

describe("rankBy", () => {
  const alva = row(choice("1", "Alva Berg", { clips: 3 }), { ppg: 13.3, apg: 2 });
  const ola = row(choice("2", "Ola Nilsson", { clips: 1 }), { ppg: 20.5, apg: 2 });
  const ines = row(choice("4", "Ines Ek", { clips: 5 }), { ppg: 13.3, apg: null });
  const benny = row(choice("3", "Benny Holm", { clips: 9 }), null);
  const abel = row(choice("5", "Abel Öst", { clips: 3 }), { ppg: 13.3, apg: 2 });

  it("sorts by the stat, highest first, with players without a value last", () => {
    expect(names(rankBy([benny, alva, ola], "ppg"))).toEqual(["Ola Nilsson", "Alva Berg", "Benny Holm"]);
    expect(names(rankBy([ines, alva, ola], "apg"))).toEqual(["Alva Berg", "Ola Nilsson", "Ines Ek"]);
  });

  it("breaks ties by clips in the playlist, then name", () => {
    expect(names(rankBy([alva, abel, ola, ines], "ppg"))).toEqual(["Ola Nilsson", "Ines Ek", "Abel Öst", "Alva Berg"]);
    // Among those without a value too, so the tail reads the same way.
    const nobody = row(choice("6", "Nobody Null", { clips: 0 }), null);
    expect(names(rankBy([nobody, benny], "ppg"))).toEqual(["Benny Holm", "Nobody Null"]);
  });

  it("leaves the input alone", () => {
    const input = [benny, alva, ola];
    rankBy(input, "ppg");
    expect(names(input)).toEqual(["Benny Holm", "Alva Berg", "Ola Nilsson"]);
  });
});

describe("topN", () => {
  const alva = row(choice("1", "Alva Berg", { clips: 3 }), { ppg: 13.3, tpPct: 50, tpa: 4 });
  const ola = row(choice("2", "Ola Nilsson", { clips: 1 }), { ppg: 20.5, tpPct: 33.9, tpa: 59 });
  const ines = row(choice("4", "Ines Ek", { clips: 5 }), { ppg: 9.8, tpPct: 40, tpa: 20 });
  const benny = row(choice("3", "Benny Holm", { clips: 9 }), null);
  const ulf = row(choice("5", "Ulf Sand"), { ppg: 4, tpPct: null, tpa: 12 });

  it("takes the first n of the ranking, never a player without a value", () => {
    expect(names(topN([benny, alva, ola, ines, ulf], "ppg", 2))).toEqual(["Ola Nilsson", "Alva Berg"]);
    expect(names(topN([benny, alva, ola, ines, ulf], "ppg", 10))).toEqual(["Ola Nilsson", "Alva Berg", "Ines Ek", "Ulf Sand"]);
    expect(topN([benny], "ppg", 3)).toEqual([]);
    expect(topN([alva], "ppg", 0)).toEqual([]);
  });

  it("ranks 3P% only with enough attempts for the season", () => {
    expect(LEADER_MIN_3PA).toBe(20);
    // Alva's 50% on 4 attempts doesn't count; Ines sits exactly on the line.
    expect(names(topN([alva, ola, ines, ulf, benny], "tpPct", 3))).toEqual(["Ines Ek", "Ola Nilsson"]);
    expect(names(topN([alva, ola, ines], "tpPct", 3, { minAttempts: 1 }))).toEqual(["Alva Berg", "Ines Ek", "Ola Nilsson"]);
    expect(names(topN([alva, ola, ines], "tpPct", 3, { minAttempts: 50 }))).toEqual(["Ola Nilsson"]);
    // Attempts never gate another stat.
    expect(names(topN([alva, ola], "ppg", 3, { minAttempts: 50 }))).toEqual(["Ola Nilsson", "Alva Berg"]);
  });
});

describe("formatLeaderValue", () => {
  it("prints one decimal, and an en dash for no value", () => {
    expect(formatLeaderValue("ppg", 13.3)).toBe("13.3");
    expect(formatLeaderValue("tpPct", 33.94)).toBe("33.9");
    expect(formatLeaderValue("rpg", 7)).toBe("7.0");
    expect(formatLeaderValue("apg", 0)).toBe("0.0");
    expect(formatLeaderValue("bpg", null)).toBe("–");
  });
});
