import { describe, expect, it } from "vitest";
import { computeLeaders, LEADER_METRICS } from "../leaders";
import type { PlayByPlayEvent } from "../../types/match";

/** Player object whose display name (playerName) is "<first> Berg". */
function player(first: string): NonNullable<PlayByPlayEvent["player"]> {
  return { playerId: 10, pno: 4, firstName: first, familyName: "Berg", teamNumber: 1 };
}

/** Fully-populated event, defaulting to a made 2pt by Alva Berg (Bajen). */
function ev(partial: Partial<PlayByPlayEvent>): PlayByPlayEvent {
  return {
    eventId: 1,
    type: "2pt",
    subType: "jumpshot",
    period: 1,
    gameClockTime: "09:45:00",
    realWorldTime: "2026-01-10T18:05:00Z",
    isSuccessful: 1,
    player: player("Alva"),
    eventTeam: { teamCode: "BJN", teamName: "Bajen", teamNumber: 1 },
    qualifiers: [],
    ...partial,
  };
}

describe("computeLeaders", () => {
  it("derives points from made shots: 2pt = 2, 3pt = 3, freethrow = 1, accumulated per player", () => {
    const rows = computeLeaders(
      [
        ev({ type: "2pt" }),
        ev({ type: "3pt" }),
        ev({ type: "freethrow", subType: "" }),
        ev({ type: "2pt", player: player("Nils") }),
      ],
      "points",
    );
    expect(rows).toEqual([
      { name: "Alva Berg", teamName: "Bajen", value: 6 },
      { name: "Nils Berg", teamName: "Bajen", value: 2 },
    ]);
  });

  it("gives no points for missed shots (isSuccessful 0)", () => {
    const rows = computeLeaders(
      [
        ev({ type: "2pt" }),
        ev({ type: "3pt", isSuccessful: 0 }),
        ev({ type: "freethrow", subType: "", isSuccessful: 0 }),
      ],
      "points",
    );
    expect(rows).toEqual([{ name: "Alva Berg", teamName: "Bajen", value: 2 }]);
  });

  it("ignores isSuccessful for non-shot metrics — every real feed row carries 1", () => {
    const turnover = ev({ type: "turnover", subType: "badpass", isSuccessful: 1 });
    const rebound = ev({ type: "rebound", subType: "defensive", isSuccessful: 1 });
    const steal = ev({ type: "steal", subType: "", isSuccessful: 0 }); // even 0 still counts
    expect(computeLeaders([turnover, rebound, steal], "turnovers")).toEqual([
      { name: "Alva Berg", teamName: "Bajen", value: 1 },
    ]);
    expect(computeLeaders([turnover, rebound, steal], "rebounds")).toEqual([
      { name: "Alva Berg", teamName: "Bajen", value: 1 },
    ]);
    expect(computeLeaders([turnover, rebound, steal], "steals")).toEqual([
      { name: "Alva Berg", teamName: "Bajen", value: 1 },
    ]);
  });

  it("maps assists, steals and blocks each to their own event type only", () => {
    const events = [
      ev({ type: "assist", subType: "" }),
      ev({ type: "steal", subType: "" }),
      ev({ type: "block", subType: "" }),
    ];
    expect(computeLeaders(events, "assists")).toEqual([
      { name: "Alva Berg", teamName: "Bajen", value: 1 },
    ]);
    expect(computeLeaders(events, "steals")).toEqual([
      { name: "Alva Berg", teamName: "Bajen", value: 1 },
    ]);
    expect(computeLeaders(events, "blocks")).toEqual([
      { name: "Alva Berg", teamName: "Bajen", value: 1 },
    ]);
    expect(computeLeaders(events, "turnovers")).toEqual([]);
  });

  it("skips team-level rows (player: null)", () => {
    const rows = computeLeaders(
      [
        ev({ type: "rebound", subType: "defensive", player: null }), // team rebound
        ev({ type: "rebound", subType: "defensive" }),
      ],
      "rebounds",
    );
    expect(rows).toEqual([{ name: "Alva Berg", teamName: "Bajen", value: 1 }]);
  });

  it("skips offensivedeadball rebounds (bookkeeping) even when a player is attached", () => {
    const rows = computeLeaders(
      [ev({ type: "rebound", subType: "offensivedeadball" })],
      "rebounds",
    );
    expect(rows).toEqual([]);
  });

  it("counts both offensive and defensive rebounds", () => {
    const rows = computeLeaders(
      [
        ev({ type: "rebound", subType: "offensive" }),
        ev({ type: "rebound", subType: "defensive" }),
      ],
      "rebounds",
    );
    expect(rows).toEqual([{ name: "Alva Berg", teamName: "Bajen", value: 2 }]);
  });

  it("ranks by value desc, ties broken by name asc", () => {
    const rows = computeLeaders(
      [
        ev({ type: "turnover", subType: "badpass", player: player("Erik") }),
        ev({ type: "turnover", subType: "travel", player: player("Nils") }),
        ev({ type: "turnover", subType: "badpass" }), // Alva
        ev({ type: "turnover", subType: "24sec", player: player("Nils") }),
      ],
      "turnovers",
    );
    expect(rows.map((r) => [r.name, r.value])).toEqual([
      ["Nils Berg", 2],
      ["Alva Berg", 1],
      ["Erik Berg", 1],
    ]);
  });

  it("omits zero-value players entirely — a player with only misses has no points row", () => {
    const rows = computeLeaders(
      [
        ev({ type: "2pt", isSuccessful: 0 }), // Alva, all misses
        ev({ type: "3pt", isSuccessful: 0 }),
        ev({ type: "2pt", player: player("Nils") }),
      ],
      "points",
    );
    expect(rows).toEqual([{ name: "Nils Berg", teamName: "Bajen", value: 2 }]);
  });

  it("returns [] for no events", () => {
    expect(computeLeaders([], "points")).toEqual([]);
  });

  it("takes teamName from the player's first COUNTED event", () => {
    const alvik = { teamCode: "ALV", teamName: "Alvik", teamNumber: 2 };
    const rows = computeLeaders(
      [
        ev({ type: "2pt", isSuccessful: 0, eventTeam: alvik }), // miss — not counted
        ev({ type: "2pt" }), // first counted: Bajen
        ev({ type: "freethrow", subType: "", eventTeam: alvik }), // later team never overwrites
      ],
      "points",
    );
    expect(rows).toEqual([{ name: "Alva Berg", teamName: "Bajen", value: 3 }]);
  });

  it("falls back to an empty teamName when eventTeam is missing", () => {
    const rows = computeLeaders([ev({ eventTeam: null })], "points");
    expect(rows).toEqual([{ name: "Alva Berg", teamName: "", value: 2 }]);
  });
});

describe("LEADER_METRICS", () => {
  it("exposes exactly the six metrics in display order with their units", () => {
    expect(LEADER_METRICS).toEqual([
      { id: "points", label: "Points", unit: "pts" },
      { id: "assists", label: "Assists", unit: "ast" },
      { id: "rebounds", label: "Rebounds", unit: "reb" },
      { id: "steals", label: "Steals", unit: "stl" },
      { id: "blocks", label: "Blocks", unit: "blk" },
      { id: "turnovers", label: "Turnovers", unit: "TO" },
    ]);
  });
});
