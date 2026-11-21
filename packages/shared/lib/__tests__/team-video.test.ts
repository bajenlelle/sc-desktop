import { describe, expect, it } from "vitest";
import { flipPick, keyStatOf, pickKeys, playability, teamLibraryGames, type GamePlays } from "../team-video";
import { ev, row, tgame, who } from "./helpers/plays";

describe("teamLibraryGames", () => {
  it("keeps played games in the library, newest first, with the team's side", () => {
    const rows = [
      row({ matchId: 1, at: "2026-11-01T18:00:00Z", home: true }),
      row({ matchId: 2, at: "2026-11-08T18:00:00Z", home: false }),
      row({ matchId: 3, at: "2026-11-15T18:00:00Z", home: true, status: "upcoming" }),
      row({ matchId: 4, at: "2026-11-02T18:00:00Z" }),
    ];
    const got = teamLibraryGames(rows, new Map([[1, "g1"], [2, "g2"], [3, "g3"]]));
    expect(got.map((g) => [g.gameId, g.side])).toEqual([["g2", 2], ["g1", 1]]);
    expect(got[0]).toMatchObject({ leagueMatchId: 2, home: false, opponentName: "Beta", result: "W" });
  });

  it("finals count as well as the regular season", () => {
    const got = teamLibraryGames([row({ matchId: 5, regular: false })], new Map([[5, "g5"]]));
    expect(got.map((g) => g.gameId)).toEqual(["g5"]);
  });
});

const away: GamePlays = {
  game: tgame({ gameId: "g1", side: 2 }),
  events: [ev(1, "turnover", 2), ev(2, "turnover", 1), ev(3, "turnover", 2)],
};

describe("pickKeys", () => {
  it("turnovers with and without the ball", () => {
    expect(pickKeys({ kind: "stat", stat: "tov", side: "with" }, "with", [away])).toEqual(["g1:1", "g1:3"]);
    expect(pickKeys({ kind: "stat", stat: "tov", side: "without" }, "without", [away])).toEqual(["g1:2"]);
  });

  it("team rows count on their side", () => {
    const g: GamePlays = {
      game: tgame({ gameId: "g1", side: 1 }),
      events: [ev(1, "turnover", 1, { player: null }), ev(2, "rebound", 1, { player: null, subType: "offensive" })],
    };
    expect(pickKeys({ kind: "stat", stat: "tov", side: "with" }, "with", [g])).toEqual(["g1:1"]);
    expect(pickKeys({ kind: "stat", stat: "oreb", side: "with" }, "with", [g])).toEqual(["g1:2"]);
  });

  it("threes are every attempt, made or missed", () => {
    const g: GamePlays = {
      game: tgame({ gameId: "g1", side: 1 }),
      events: [ev(1, "3pt", 1), ev(2, "3pt", 1, { isSuccessful: 0 }), ev(3, "2pt", 1), ev(4, "3pt", 2)],
    };
    expect(pickKeys({ kind: "stat", stat: "threes", side: "with" }, "with", [g])).toEqual(["g1:1", "g1:2"]);
  });

  it("a shot zone and a player's plays", () => {
    const g: GamePlays = {
      game: tgame({ gameId: "g1", side: 1 }),
      events: [
        ev(1, "2pt", 1, { x: 6, y: 50, player: who(7, 1) }),
        ev(2, "2pt", 1, { x: 20, y: 50, player: who(8, 1) }),
        ev(3, "turnover", 1, { player: who(7, 1) }),
        ev(4, "2pt", 2, { x: 6, y: 50, player: who(9, 2) }),
      ],
    };
    expect(pickKeys({ kind: "zone", zone: "rim" }, "with", [g])).toEqual(["g1:1"]);
    expect(pickKeys({ kind: "zone", zone: "mid" }, "with", [g])).toEqual(["g1:2"]);
    expect(pickKeys({ kind: "player", personId: 7, name: "P" }, "with", [g])).toEqual(["g1:1", "g1:3"]);
  });

  it("a zone or a player gives nothing without the ball", () => {
    expect(pickKeys({ kind: "zone", zone: "rim" }, "without", [away])).toEqual([]);
    expect(pickKeys({ kind: "player", personId: 102, name: "Away" }, "without", [away])).toEqual([]);
  });

  it("null is every play on that side, bookkeeping left out", () => {
    const g: GamePlays = {
      game: tgame({ gameId: "g1", side: 1 }),
      events: [ev(1, "2pt", 1), ev(2, "rebound", 1, { player: null, subType: "offensivedeadball" }), ev(3, "foul", 2), ev(4, "steal", 1)],
    };
    expect(pickKeys(null, "with", [g])).toEqual(["g1:1", "g1:4"]);
    expect(pickKeys(null, "without", [g])).toEqual(["g1:3"]);
  });

  it("a pick that matches nothing gives []", () => {
    expect(pickKeys({ kind: "player", personId: 999, name: "Gone" }, "with", [away])).toEqual([]);
    expect(pickKeys({ kind: "stat", stat: "oreb", side: "with" }, "with", [])).toEqual([]);
  });

  it("keys run game by game in the order given", () => {
    const second: GamePlays = { game: tgame({ gameId: "g2", side: 1 }), events: [ev(5, "turnover", 1)] };
    expect(pickKeys({ kind: "stat", stat: "tov", side: "with" }, "with", [away, second])).toEqual(["g1:1", "g1:3", "g2:5"]);
  });
});

describe("flipPick", () => {
  it("swaps a stat to the other side and clears a zone or a player", () => {
    expect(flipPick({ kind: "stat", stat: "tov", side: "with" }, "without")).toEqual({ kind: "stat", stat: "tov", side: "without" });
    expect(flipPick({ kind: "zone", zone: "mid" }, "without")).toBeNull();
    expect(flipPick({ kind: "player", personId: 7, name: "Lind" }, "without")).toBeNull();
    expect(flipPick(null, "with")).toBeNull();
  });
});

describe("keyStatOf", () => {
  it("maps the keys with plays and leaves the rest", () => {
    expect(keyStatOf("allowed", "tovRate")).toEqual({ stat: "tov", side: "without" });
    expect(keyStatOf("own", "threeRate")).toEqual({ stat: "threes", side: "with" });
    expect(keyStatOf("own", "orebPct")).toEqual({ stat: "oreb", side: "with" });
    expect(keyStatOf("own", "ppp")).toBeNull();
    expect(keyStatOf("allowed", "ppp")).toBeNull();
    expect(keyStatOf("own", "pace")).toBeNull();
  });
});

describe("playability", () => {
  it("sync first, then the video", () => {
    expect(playability({ videoUrl: "/v.mp4", syncPoint: null }, "ok")).toBe("sync");
    expect(playability({ videoUrl: "/v.mp4", syncPoint: {} }, "missing")).toBe("video");
    expect(playability({ videoUrl: "/v.mp4", syncPoint: {} }, "unreadable")).toBe("video");
    expect(playability({ videoUrl: null, syncPoint: {} }, undefined)).toBe("video");
    expect(playability({ videoUrl: "/v.mp4", syncPoint: {} }, undefined)).toBe("ok");
  });
});
