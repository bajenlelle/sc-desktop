import { describe, expect, it } from "vitest";
import { eventLabel } from "../events";
import { mapEventType, mapPublicEvent, mapPublicLineup, type ProfixioMatchResponse } from "../profixio-wire";
import {
  FOUL_SUBTYPE_BY_TYPE_ID,
  assignGlobalPeriods,
  buildProfixioRosters,
  categoriesToStages,
  categoryLabel,
  classifyEvent,
  findProfixioTipoff,
  normalizeProfixioEvents,
  parseProfixioSourceGameId,
  profixioRowToScheduleGame,
  profixioSourceGameId,
  resolveSides,
  sortProfixioEvents,
  splitName,
} from "../profixio";
import sample from "./fixtures/profixio-sample.json";

// Anonymised Profixio public payload mapped to the wire shape (see the
// fixture's _note). Upstream order is newest-first.
const wireEvents = (sample.events as Array<Record<string, unknown>>).map(mapPublicEvent);
const lineup = (sample.lineup as Array<Record<string, unknown>>).map(mapPublicLineup);
const eventTypes = (sample.eventtypes as Array<Record<string, unknown>>).map(mapEventType);

function match(partial: Partial<ProfixioMatchResponse> = {}): ProfixioMatchResponse {
  return {
    schemaVersion: 1,
    leagueId: 17550,
    categoryId: 1172071,
    matchId: 11111111,
    schedule: {
      matchId: 11111111, kickoff: "2026-02-15T14:00:00Z", homeName: "Hemma BK", awayName: "Borta BK",
      homeScore: 79, awayScore: 76, hasResult: true, hasLivescore: false, winner: "H", venue: "",
      matchUrl: "", homeLogo: "", awayLogo: "",
    },
    homeWebId: 1001,
    awayWebId: 1002,
    matchPeriods: 4,
    useMatchClock: false,
    state: "full_time",
    final: true,
    eventTypes,
    events: wireEvents,
    lineup,
    pbpStatus: "ok",
    source: "public",
    fetchedAt: "2026-10-02T12:00:00Z",
    ...partial,
  };
}

const ctx = { homeName: "Hemma BK", awayName: "Borta BK" };
const normalized = normalizeProfixioEvents(match(), ctx);
const byId = (id: number) => normalized.find((e) => e.eventId === id)!;

describe("splitName", () => {
  it("splits on the first space, keeping compound family names together", () => {
    expect(splitName("Martin Lind")).toEqual({ firstName: "Martin", familyName: "Lind" });
    expect(splitName("Carl Johan Berg")).toEqual({ firstName: "Carl", familyName: "Johan Berg" });
    expect(splitName("Cher")).toEqual({ firstName: "Cher", familyName: "" });
    expect(splitName("  padded  name ")).toEqual({ firstName: "padded", familyName: "name" });
  });
});

describe("sortProfixioEvents", () => {
  it("orders oldest first and never mutates the input", () => {
    const copy = [...wireEvents];
    const sorted = sortProfixioEvents(wireEvents);
    expect(wireEvents).toEqual(copy);
    expect(sorted[0].startsMatch).toBe(true);
  });
});

describe("resolveSides", () => {
  it("trusts the page's home/away ids when present", () => {
    expect(resolveSides(match())).toEqual({ homeWebId: 1001, awayWebId: 1002 });
  });

  it("derives the sides from the scoreboard when the ids are missing (API driver)", () => {
    expect(resolveSides(match({ homeWebId: null, awayWebId: null }))).toEqual({ homeWebId: 1001, awayWebId: 1002 });
  });

  it("falls back to the lineup order when nobody has scored", () => {
    const markers = wireEvents.filter((e) => e.goals == null);
    const sides = resolveSides(match({ homeWebId: null, awayWebId: null, events: markers }));
    expect(new Set([sides.homeWebId, sides.awayWebId])).toEqual(new Set([1001, 1002]));
  });
});

describe("classifyEvent", () => {
  it("maps goals by points", () => {
    expect(classifyEvent(wireEvents.find((e) => e.goals === 1)!)).toEqual({ type: "freethrow", subType: "" });
    expect(classifyEvent(wireEvents.find((e) => e.goals === 2)!)).toEqual({ type: "2pt", subType: "" });
    expect(classifyEvent(wireEvents.find((e) => e.goals === 3)!)).toEqual({ type: "3pt", subType: "" });
  });

  it("maps every known foul id to a subType and unknown fouls to personal", () => {
    const base = wireEvents.find((e) => e.typeId === 109)!;
    for (const [id, subType] of Object.entries(FOUL_SUBTYPE_BY_TYPE_ID)) {
      expect(classifyEvent({ ...base, typeId: Number(id) })).toEqual({ type: "foul", subType });
    }
    expect(classifyEvent({ ...base, typeId: 999 })).toEqual({ type: "foul", subType: "personal" });
  });

  it("maps timeouts and drops markers, substitutions and lineup events", () => {
    expect(classifyEvent(wireEvents.find((e) => e.typeId === 108)!)).toEqual({ type: "timeout", subType: "" });
    for (const typeId of [97, 98, 99, 100, 101, 107, 118, 120]) {
      const e = wireEvents.find((x) => x.typeId === typeId);
      if (e) expect(classifyEvent(e)).toBeNull();
    }
    expect(classifyEvent({ ...wireEvents.find((e) => e.goals === 2)!, goals: 0 })).toBeNull();
  });
});

describe("assignGlobalPeriods", () => {
  it("keeps regulation periods and globalises overtime from the markers", () => {
    const sorted = sortProfixioEvents(wireEvents);
    const periods = assignGlobalPeriods(sorted, 4);
    expect(periods.get(500001)).toBe(1);
    expect(periods.get(500904)).toBe(3);
    expect(periods.get(500905)).toBe(5); // OT start, raw period 1
    expect(periods.get(500906)).toBe(5); // 3-pointer in OT, raw period 1
    expect(periods.get(500907)).toBe(5); // match end in OT
  });

  it("handles a provider that already numbers OT above the regulation count, and never yields 0", () => {
    const sorted = sortProfixioEvents(wireEvents).filter((e) => !e.startsExtraPeriod);
    const bumped = sorted.map((e) => (e.id >= 500906 ? { ...e, period: 5 } : e));
    expect(assignGlobalPeriods(bumped, 4).get(500906)).toBe(5);
    expect(assignGlobalPeriods([{ ...sorted[0], period: 0 }], 4).get(sorted[0].id)).toBe(1);
    expect(assignGlobalPeriods([{ ...sorted[0], period: 3 }], 2).get(sorted[0].id)).toBe(5);
  });
});

describe("normalizeProfixioEvents", () => {
  it("keeps only clip-worthy types, in time order, with Profixio ids as event ids", () => {
    const types = new Set(normalized.map((e) => e.type));
    expect([...types].sort()).toEqual(["2pt", "3pt", "foul", "freethrow", "timeout"]);
    expect(normalized.some((e) => e.eventId === 500903)).toBe(false); // substitution
    expect(normalized.some((e) => e.eventId === 500001)).toBe(false); // period marker
    expect(new Set(normalized.map((e) => e.eventId)).size).toBe(normalized.length);
    for (let i = 1; i < normalized.length; i++) {
      expect(normalized[i].realWorldTime >= normalized[i - 1].realWorldTime).toBe(true);
    }
  });

  it("maps a 3-pointer completely", () => {
    expect(byId(500906)).toEqual({
      eventId: 500906,
      type: "3pt",
      subType: "",
      period: 5,
      gameClockTime: "",
      realWorldTime: "2026-02-15T15:41:00Z",
      isSuccessful: 1,
      player: { playerId: expect.any(Number), pno: expect.any(Number), firstName: "Spelare", familyName: "2", teamNumber: 1 },
      eventTeam: { teamCode: "", teamName: "Hemma BK", teamNumber: 1 },
      qualifiers: [],
      x: null, y: null, area: null, shotClock: null, previousAction: null,
      onCourtHome: null, onCourtAway: null,
      scoreHome: 79,
      scoreAway: 76,
    });
  });

  it("sides: home players are 1, away players are 2, and the team name follows the event", () => {
    const away = normalized.find((e) => e.eventTeam?.teamName === "Borta BK" && e.player)!;
    expect(away.player?.teamNumber).toBe(2);
    expect(away.eventTeam?.teamNumber).toBe(2);
  });

  it("resolves a goal with no teamId from the scoreboard and names the team from the context", () => {
    expect(byId(500902)).toMatchObject({
      type: "2pt",
      eventTeam: { teamName: "Hemma BK", teamNumber: 1 },
      player: expect.objectContaining({ teamNumber: 1 }),
    });
  });

  it("keeps staff technicals as team events without a player", () => {
    expect(byId(500901)).toMatchObject({ type: "foul", subType: "coachTechnical", player: null, eventTeam: { teamNumber: 2, teamName: "Borta BK" } });
  });

  it("maps timeouts as team events", () => {
    const t = normalized.find((e) => e.type === "timeout")!;
    expect(t.player).toBeNull();
    expect(t.eventTeam?.teamName).toBe("Borta BK");
    expect(t.isSuccessful).toBe(1);
  });

  it("tolerates a non-numeric jersey number and exposes a clock when the feed has one", () => {
    expect(byId(500904)).toMatchObject({ gameClockTime: "07:32", player: expect.objectContaining({ pno: 0 }) });
  });

  it("always emits an array of qualifiers (saveMatch reads .length)", () => {
    for (const e of normalized) expect(Array.isArray(e.qualifiers)).toBe(true);
  });

  it("uses subTypes that both the label helper and the case-sensitive situation filter understand", () => {
    const technicalIds = [112, 116, 117];
    const base = wireEvents.find((e) => e.typeId === 109)!;
    for (const typeId of technicalIds) {
      const [e] = normalizeProfixioEvents(match({ events: [{ ...base, typeId }] }), ctx);
      expect(eventLabel(e)).toBe("Technical");
      expect(["technical", "benchTechnical", "coachTechnical"]).toContain(e.subType);
    }
  });

  it("skips duplicate event ids", () => {
    const dup = normalizeProfixioEvents(match({ events: [...wireEvents, wireEvents[0]] }), ctx);
    expect(dup.length).toBe(normalized.length);
  });
});

describe("findProfixioTipoff", () => {
  it("returns the match-start marker's wall-clock as ISO UTC", () => {
    expect(findProfixioTipoff(wireEvents)).toBe("2026-02-15T13:57:56Z");
  });

  it("falls back to the first-period start and never to the OT start", () => {
    const noStart = wireEvents.filter((e) => !e.startsMatch);
    const p1 = { ...wireEvents.find((e) => e.startsPeriod)!, period: 1, startedAt: "2026-02-15T13:58:30Z", id: 1 };
    expect(findProfixioTipoff([...noStart, p1])).toBe("2026-02-15T13:58:30Z");
    expect(findProfixioTipoff(noStart)).toBeNull(); // only OT start (period 1 raw) and later periods remain
    expect(findProfixioTipoff([])).toBeNull();
  });
});

describe("buildProfixioRosters", () => {
  it("splits players by side, drops staff and sorts by jersey number", () => {
    const rosters = buildProfixioRosters(lineup, { homeWebId: 1001, awayWebId: 1002 });
    expect(rosters.home.length + rosters.away.length).toBe(18);
    expect(rosters.home.every((p) => p.playerName.startsWith("Spelare"))).toBe(true);
    const nums = rosters.away.map((p) => Number(p.jerseyNumber) || 0);
    expect(nums).toEqual([...nums].sort((a, b) => a - b));
    expect([...rosters.home, ...rosters.away].map((p) => p.jerseyNumber)).toContain("");
  });
});

describe("schedule rows and categories", () => {
  it("maps a schedule row to the import UI's ScheduleGame with a namespaced uuid", () => {
    const game = profixioRowToScheduleGame(sample.schedule[0] as never);
    expect(game).toMatchObject({
      uuid: "profixio:11111111",
      rawStartDateTime: "2026-02-15T14:00:00Z",
      startDateTime: "2026-02-15T14:00:00Z",
      homeTeamInfo: { names: { short: "Hemma BK", long: "Hemma BK" }, score: 76, status: "COMPLETE" },
      awayTeamInfo: { names: { short: "Borta BK", long: "Borta BK" }, score: 87, status: "COMPLETE" },
      venueInfo: { name: "Hemmahallen" },
    });
    expect(game.homeTeamInfo.icon).toContain("cloudinary");
    const upcoming = profixioRowToScheduleGame(sample.schedule[1] as never);
    expect(upcoming.homeTeamInfo.status).toBe("SCHEDULED");
    expect(upcoming.homeTeamInfo.score).toBe(0);
  });

  it("round-trips the namespaced source game id and rejects bare Genius ids", () => {
    expect(profixioSourceGameId(32406189)).toBe("profixio:32406189");
    expect(parseProfixioSourceGameId("profixio:32406189")).toBe(32406189);
    expect(parseProfixioSourceGameId("2668882")).toBeNull();
    expect(parseProfixioSourceGameId("profixio:x")).toBeNull();
  });

  it("strips the league name from category labels and drops empty categories", () => {
    expect(categoryLabel("Nivå 2A Herrar U19", "Herrar U19")).toBe("Nivå 2A");
    expect(categoryLabel("Slutspel Stockholmsserien Herrar U19", "Herrar U19")).toBe("Slutspel Stockholmsserien");
    expect(categoryLabel("Herrar U19", "Herrar U19")).toBe("Herrar U19");
    expect(categoriesToStages(sample.categories as never, "Herrar U19")).toEqual([
      { id: "1172071", label: "Nivå 2A", categoryId: 1172071 },
      { id: "1172076", label: "Nivå 1", categoryId: 1172076 },
    ]);
  });
});
