import { describe, expect, it } from "vitest";
import {
  ACTIONABLE_TYPES,
  buildRosters,
  findTipoff,
  fixtureToScheduleGame,
  gameClock,
  globalPeriod,
  homeCompetitor,
  normalizeGeniusActions,
  toIsoUtc,
  type GeniusAction,
  type GeniusFixture,
  type GeniusPlayer,
} from "../genius";
import sample from "./fixtures/genius-sample.json";

// Real Genius Warehouse responses (SBL Herr 2025-26), trimmed — see the
// fixture's _note. Home side of match 2668882 is Norrköping (187007).
const fixture = sample.fixture as GeniusFixture;
const actions = sample.actions as GeniusAction[];
const players = sample.players as GeniusPlayer[];
const HOME_TEAM_ID = 187007;

describe("toIsoUtc", () => {
  it("marks bare Genius timestamps as UTC — the load-bearing conversion for video sync", () => {
    // A bare "YYYY-MM-DD HH:MM:SS" parses as LOCAL time in new Date(); the
    // suffix is what keeps every clip from landing hours off.
    expect(toIsoUtc("2025-09-19 17:06:08")).toBe("2025-09-19T17:06:08Z");
    expect(new Date(toIsoUtc("2025-09-19 17:06:08")).getTime()).toBe(
      Date.UTC(2025, 8, 19, 17, 6, 8),
    );
  });

  it("passes through empty and already-zoned timestamps", () => {
    expect(toIsoUtc("")).toBe("");
    expect(toIsoUtc("2025-09-19T17:06:08Z")).toBe("2025-09-19T17:06:08Z");
    expect(toIsoUtc("2025-09-19T19:06:08+02:00")).toBe("2025-09-19T19:06:08+02:00");
  });
});

describe("gameClock", () => {
  it("drops the centisecond group", () => {
    expect(gameClock("09:48:00")).toBe("09:48");
    expect(gameClock("00:04:60")).toBe("00:04");
  });

  it("leaves anything else untouched", () => {
    expect(gameClock("9:48")).toBe("9:48");
    expect(gameClock("")).toBe("");
  });
});

describe("globalPeriod", () => {
  it("keeps regulation periods as-is", () => {
    expect(globalPeriod(1, "REGULAR")).toBe(1);
    expect(globalPeriod(4, "REGULAR")).toBe(4);
  });

  it("globalizes OT (verified live: OT periods reset to 1)", () => {
    expect(globalPeriod(1, "OVERTIME")).toBe(5);
    expect(globalPeriod(2, "OVERTIME")).toBe(6);
  });

  it("does not double-offset a provider that already globalizes", () => {
    expect(globalPeriod(5, "OVERTIME")).toBe(5);
  });
});

describe("normalizeGeniusActions", () => {
  const events = normalizeGeniusActions(actions, HOME_TEAM_ID);
  const byId = new Map(events.map((e) => [e.eventId, e]));

  it("keeps only actionable types", () => {
    expect(events.every((e) => ACTIONABLE_TYPES.has(e.type))).toBe(true);
    // game/period/clock/jumpball/substitution/timeout rows are all in the
    // sample and must all be gone.
    for (const e of events) {
      expect(["game", "period", "clock", "jumpball", "substitution", "timeout"]).not.toContain(e.type);
    }
  });

  it("uses actionNumber as eventId, including across OT (no offset hack)", () => {
    const made3 = byId.get(17)!;
    expect(made3.type).toBe("3pt");
    const ot2pt = byId.get(803)!;
    expect(ot2pt.period).toBe(6); // OT2 → global 6
  });

  it("maps a made 3pt completely", () => {
    const e = byId.get(17)!;
    expect(e).toMatchObject({
      type: "3pt",
      subType: "jumpshot",
      period: 1,
      gameClockTime: "09:11",
      realWorldTime: expect.stringMatching(/Z$/),
      isSuccessful: 1,
      x: 32,
      y: 25,
      area: "outsideleft",
      qualifiers: ["fastbreak"],
      scoreHome: 3,
      scoreAway: 0,
    });
    expect(e.player).toEqual({
      playerId: 1692933,
      pno: 94,
      firstName: "Nathan",
      familyName: "Dawit",
      teamNumber: 1, // Norrköping is home
    });
    expect(e.eventTeam).toMatchObject({ teamName: "Norrköping Dolphins", teamNumber: 1 });
  });

  it("splits semicolon qualifiers", () => {
    const secondChance = byId.get(25)!;
    expect(secondChance.qualifiers).toEqual(["2ndchance", "pointsinthepaint"]);
  });

  it("assigns away players teamNumber 2", () => {
    const awayMiss = byId.get(19)!; // Högsbo drivinglayup
    expect(awayMiss.player?.teamNumber).toBe(2);
    expect(awayMiss.isSuccessful).toBe(0);
  });

  it("handles team-only attribution (team rebound: no player, team kept)", () => {
    const teamRebound = byId.get(29)!;
    expect(teamRebound.player).toBeNull();
    expect(teamRebound.eventTeam).toMatchObject({ teamNumber: 2 });
    expect(teamRebound.qualifiers).toEqual(["team"]);
  });

  it("parses on-court lineups as home/away personId arrays (team1 = home, verified)", () => {
    const e = byId.get(17)!;
    expect(e.onCourtHome).toContain(1692933); // the shooter is on court
    expect(e.onCourtHome).toHaveLength(5);
    expect(e.onCourtAway).toHaveLength(5);
  });

  it("nulls degenerate values instead of storing zeros", () => {
    const rebound = byId.get(10)!; // no coords, no area, shot clock all-zeros
    expect(rebound.x).toBeNull();
    expect(rebound.y).toBeNull();
    expect(rebound.area).toBeNull();
    expect(rebound.shotClock).toBeNull();
  });
});

describe("findTipoff", () => {
  it("returns the regulation Q1 start as ISO UTC", () => {
    expect(findTipoff(actions)).toBe("2025-09-19T17:06:08Z");
  });

  it("never matches an OT period start, even though OT resets period to 1", () => {
    // Action 700 is period=1, subType=start, actionType=period — but OVERTIME.
    const otOnly = actions.filter((a) => (a.periodType ?? "").includes("OVERTIME"));
    expect(otOnly.some((a) => a.actionType === "period" && a.period === 1)).toBe(true);
    expect(findTipoff(otOnly)).toBeNull();
  });
});

describe("buildRosters", () => {
  it("splits participants by teamId and sorts by jersey number", () => {
    const { home, away } = buildRosters(players, HOME_TEAM_ID);
    expect(home.length + away.length).toBe(players.length); // all isPlayer=1 in sample
    expect(away.map((p) => p.playerName)).toContain("Anes Zekovic");
    const numbers = home.map((p) => Number(p.jerseyNumber) || 0);
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
  });

  it("drops non-players", () => {
    const staff = [{ ...players[0], isPlayer: 0 }];
    const { home, away } = buildRosters(staff, HOME_TEAM_ID);
    expect(home).toEqual([]);
    expect(away).toEqual([]);
  });
});

describe("fixtureToScheduleGame", () => {
  const game = fixtureToScheduleGame(fixture);

  it("keys the schedule row on the Genius matchId", () => {
    expect(game.uuid).toBe("2668882");
  });

  it("orients home/away from isHomeCompetitor regardless of array order", () => {
    // The raw payload lists the away side first.
    expect(homeCompetitor(fixture)?.teamName).toBe("Norrköping Dolphins");
    expect(game.homeTeamInfo.names.short).toBe("Norrköping Dolphins");
    expect(game.homeTeamInfo.score).toBe(89);
    expect(game.awayTeamInfo.names.short).toBe("Högsbo Basket");
    expect(game.awayTeamInfo.score).toBe(77);
  });

  it("emits an ISO-UTC start time the UI can hand to new Date()", () => {
    expect(game.rawStartDateTime).toBe("2025-09-19T17:04:00Z");
  });
});
