import { describe, expect, it } from "vitest";
import type { HostedSeasonPlayer } from "../hosted-stats";
import type { SeasonLine } from "../stat-lines";
import { teamPlayers, whoDoesWhat } from "../team-players";

const line = (over: Partial<SeasonLine> = {}): SeasonLine => ({
  gp: 10,
  gs: null,
  mpg: 20,
  ppg: 8,
  rpg: null,
  orpg: 1,
  drpg: null,
  apg: null,
  spg: null,
  bpg: null,
  topg: null,
  pfpg: null,
  fgPct: null,
  tpm: null,
  tpa: 30,
  tpPct: null,
  ftPct: 70,
  ftaPg: 3,
  pmPg: null,
  ...over,
});

const season = new Map<string, HostedSeasonPlayer>([
  ["1", { personId: "1", name: "Lind", stints: 1, line: line({ mpg: 31, tpa: 71, ftPct: 81, ftaPg: 4.1 }) }],
  ["2", { personId: "2", name: "Berg", stints: 1, line: line({ mpg: 29, tpa: 10, orpg: 2.4, ftPct: 58, ftaPg: 6.4 }) }],
  ["3", { personId: "3", name: "Sand", stints: 2, line: line({ mpg: 24, tpa: 2, orpg: 3.2, ftaPg: 1 }) }], // 10 attempts: under the floor
  ["4", { personId: "4", name: "Falk", stints: 1, line: line({ gp: 2, mpg: 35, tpa: 40 }) }], // two games: never named
]);
const roster = ["1", "2", "3", "4", "5"].map((personId) => ({ personId, shirtNumber: personId }));

describe("teamPlayers", () => {
  it("lists roster members who have played, most minutes first", () => {
    const rows = teamPlayers(roster, season);
    expect(rows.map((r) => r.name)).toEqual(["Falk", "Lind", "Berg", "Sand"]);
    expect(rows[1]).toMatchObject({ personId: "1", number: "1", stints: 1 });
  });
});

describe("whoDoesWhat", () => {
  it("names who does what by volume", () => {
    const w = whoDoesWhat(teamPlayers(roster, season));
    expect(w.threes.map((n) => [n.name, n.value])).toEqual([
      ["Lind", 7.1],
      ["Berg", 1],
    ]);
    expect(w.offensiveGlass.map((n) => n.name)).toEqual(["Sand", "Berg"]);
    expect(w.toTheLine.map((n) => n.name)).toEqual(["Berg", "Lind"]);
    expect(w.freeThrows).toMatchObject({ best: { name: "Lind", value: 81 }, worst: { name: "Berg", value: 58 } });
  });

  it("names no free-throw shooters with fewer than two who qualify", () => {
    expect(whoDoesWhat(teamPlayers(roster.slice(0, 1), season)).freeThrows).toBeNull();
  });

  it("leaves out a line with no one to name", () => {
    const quiet = new Map([["9", { personId: "9", name: "Ek", stints: 1, line: line({ tpa: 0, orpg: 0, ftaPg: 0 }) }]]);
    const w = whoDoesWhat(teamPlayers([{ personId: "9", shirtNumber: null }], quiet));
    expect(w).toEqual({ threes: [], offensiveGlass: [], toTheLine: [], freeThrows: null });
  });
});
