import { describe, expect, it } from "vitest";
import {
  composeCatalog,
  deriveHomeWebId,
  inferGender,
  isFinal,
  mapApiEvent,
  mapApiLineup,
  mapEventType,
  mapPublicEvent,
  mapPublicLineup,
  matchCacheTtlMs,
  otherTeamId,
  seasonFromLabel,
  slugify,
  sortEvents,
  toIsoUtcSeconds,
  type ProfixioEvent,
} from "../profixio-wire";
import sample from "./fixtures/profixio-sample.json";

// Anonymised Profixio public payload (see the fixture's _note). Events are
// stored newest-first, as upstream serves them.
const rawEvents = sample.events as Array<Record<string, unknown>>;
const events = sortEvents(rawEvents.map(mapPublicEvent));
const byId = (id: number) => events.find((e) => e.id === id)!;

describe("toIsoUtcSeconds", () => {
  it("strips microseconds — the macOS WebView (WebKit) rejects 6 fractional digits", () => {
    expect(toIsoUtcSeconds("2026-02-15T15:37:04.000000Z")).toBe("2026-02-15T15:37:04Z");
    expect(Date.parse(toIsoUtcSeconds("2026-02-15T15:37:04.000000Z"))).toBe(Date.UTC(2026, 1, 15, 15, 37, 4));
  });

  it("treats bare timestamps as UTC and converts offsets", () => {
    expect(toIsoUtcSeconds("2026-02-15 15:37:04")).toBe("2026-02-15T15:37:04Z");
    expect(toIsoUtcSeconds("2026-02-15T17:37:04+02:00")).toBe("2026-02-15T15:37:04Z");
  });

  it("returns an empty string for nothing or garbage", () => {
    expect(toIsoUtcSeconds("")).toBe("");
    expect(toIsoUtcSeconds(null)).toBe("");
    expect(toIsoUtcSeconds(undefined)).toBe("");
    expect(toIsoUtcSeconds("yesterday")).toBe("");
  });
});

describe("mapPublicEvent", () => {
  it("trims a scoring event to the wire shape", () => {
    const e = byId(500902); // synthetic 2-pointer with no teamId
    expect(e).toMatchObject({
      id: 500902,
      typeId: 104,
      description: "2 poäng",
      teamId: null,
      period: 2,
      scoreHome: 32,
      scoreAway: 31,
      startedAt: "2026-02-15T14:30:20Z",
      goals: 2,
      isPersonFoul: false,
      timeout: false,
      startsMatch: false,
      stopsMatch: false,
      clock: null,
    });
    expect(e.person).toMatchObject({ isPlayer: true, isStaff: false });
    expect(typeof e.person?.personId).toBe("number");
  });

  it("keeps the staff flag on a coach technical and carries the team", () => {
    const e = byId(500901);
    expect(e.person).toMatchObject({ name: "Coach 1", isStaff: true, isPlayer: false });
    expect(e.teamId).toBe(1002);
  });

  it("maps period markers and timeouts with no person", () => {
    const start = byId(500001);
    expect(start).toMatchObject({ startsMatch: true, period: 1, person: null, teamId: null });
    expect(start.startedAt).toBe("2026-02-15T13:57:56Z");
    const timeout = events.find((e) => e.typeId === 108)!;
    expect(timeout).toMatchObject({ timeout: true, person: null });
    expect(timeout.teamId).not.toBeNull();
    const ot = byId(500905);
    expect(ot).toMatchObject({ startsExtraPeriod: true, startsMatch: false });
  });

  it("exposes the game clock only when the feed carries one", () => {
    expect(byId(500904).clock).toEqual({ totalGameTime: null, timeInPeriod: "7.32", display: "07:32" });
    expect(byId(500906).clock).toBeNull();
  });
});

describe("sortEvents", () => {
  it("orders oldest first, breaking timestamp ties by id, and does not mutate", () => {
    const input = rawEvents.map(mapPublicEvent);
    const copy = [...input];
    const sorted = sortEvents(input);
    expect(input).toEqual(copy);
    expect(sorted[0].id).toBe(500001);
    expect(sorted[sorted.length - 1].stopsMatch).toBe(true);
    const i902 = sorted.findIndex((e) => e.id === 500902);
    expect(sorted[i902 + 1].id).toBe(500903); // same startedAt
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].startedAt >= sorted[i - 1].startedAt).toBe(true);
    }
  });
});

describe("deriveHomeWebId / otherTeamId", () => {
  it("finds the home side from the first home-score increment", () => {
    expect(deriveHomeWebId(events)).toBe(1001);
    expect(otherTeamId(events, 1001)).toBe(1002);
  });

  it("returns null without scoring events", () => {
    const markers = events.filter((e) => e.goals == null);
    expect(deriveHomeWebId(markers)).toBeNull();
    expect(otherTeamId([], 1001)).toBeNull();
  });

  it("skips a home goal whose teamId is missing and takes the next one", () => {
    const slice = events.filter((e) => e.id === 500902 || e.id === 500906 || e.goals == null);
    expect(deriveHomeWebId(slice)).toBe(1001);
  });
});

describe("mapApiEvent parity", () => {
  it("maps the documented-API event shape to exactly the same wire event", () => {
    // The API serves the same fields with two differences we know of:
    // teamId is a string ("" for none) and the clock fields are separate keys.
    const apiTwin = (raw: Record<string, unknown>) => {
      const { secondsSinceStartOfPeriod: _s, pausedAt: _p, ...rest } = raw;
      return {
        ...rest,
        teamId: raw.teamId == null ? "" : String(raw.teamId),
        totalGameTime: null,
        timeInPeriod: raw.timeInPeriod ?? null,
        displayGameTime: raw.displayGameTime ?? null,
      };
    };
    expect(rawEvents.map((r) => mapApiEvent(apiTwin(r)))).toEqual(rawEvents.map(mapPublicEvent));
  });
});

describe("lineup and event types", () => {
  it("trims lineup rows and keeps staff distinguishable", () => {
    const rows = (sample.lineup as Array<Record<string, unknown>>).map(mapPublicLineup);
    expect(rows).toHaveLength(21);
    expect(rows.filter((r) => r.type === "staff")).toHaveLength(3);
    const home = rows.find((r) => r.webTeamId === 1001)!;
    expect(home).toMatchObject({ webTeamId: 1001, teamRegistrationId: 2001, type: "player" });
    expect(typeof home.personId).toBe("number");
    expect(rows.map(mapApiLineup)).toEqual(rows); // the API driver reuses the trimmed shape
  });

  it("trims the event-type table to the flags the normaliser needs", () => {
    const types = (sample.eventtypes as Array<Record<string, unknown>>).map(mapEventType);
    expect(types).toHaveLength(27);
    expect(types.find((t) => t.id === 104)).toEqual({
      id: 104, name: "2 poäng", isGoalEvent: true, numberOfGoals: 2, isPersonFoul: false, isTeamFoul: false,
      givesTimeout: false, gamestateStartStopType: null, switches2Players: false,
    });
    expect(types.find((t) => t.id === 97)).toMatchObject({ gamestateStartStopType: 1 });
    expect(types.find((t) => t.id === 108)).toMatchObject({ givesTimeout: true });
    expect(types.find((t) => t.id === 107)).toMatchObject({ switches2Players: true });
  });
});

describe("isFinal / matchCacheTtlMs", () => {
  const kickoff = "2026-02-15T14:00:00Z";
  const at = (hoursAfter: number) => Date.parse(kickoff) + hoursAfter * 3_600_000;
  const withEnd = events;
  const noEnd = events.filter((e) => !e.stopsMatch);

  it("is final only after full time plus the correction grace", () => {
    expect(isFinal("full_time", noEnd, kickoff, at(4))).toBe(true);
    expect(isFinal("full_time", noEnd, kickoff, at(1))).toBe(false);
    expect(isFinal("in_progress", withEnd, kickoff, at(4))).toBe(true);
    expect(isFinal("not_started", [], kickoff, at(-2))).toBe(false);
    expect(isFinal("in_progress", noEnd, kickoff, at(4))).toBe(false);
  });

  it("caches finals forever, live games briefly, empty protocols by age", () => {
    expect(matchCacheTtlMs({ final: true, pbpStatus: "ok", kickoff }, at(5))).toBe(Infinity);
    expect(matchCacheTtlMs({ final: false, pbpStatus: "ok", kickoff }, at(1))).toBe(120_000);
    expect(matchCacheTtlMs({ final: false, pbpStatus: "empty", kickoff }, at(-24))).toBe(6 * 3_600_000);
    expect(matchCacheTtlMs({ final: false, pbpStatus: "empty", kickoff }, at(8 * 24))).toBe(Infinity);
  });
});

describe("catalogue composition", () => {
  it("infers gender from Swedish league names", () => {
    expect(inferGender("Herrar Division 2")).toBe("men");
    expect(inferGender("Pojkar U15")).toBe("men");
    expect(inferGender("Damer U19")).toBe("women");
    expect(inferGender("Flickor U12 Easy Basket")).toBe("women");
    expect(inferGender("Mixed U10")).toBeUndefined();
  });

  it("slugifies Swedish names and parses season labels", () => {
    expect(slugify("Herrar U19")).toBe("herrar-u19");
    expect(slugify("Nivå 2A — Pojkar U13")).toBe("niva-2a-pojkar-u13");
    expect(seasonFromLabel("Säsongen 26/27")).toEqual({ id: "2026-27", label: "2026/27" });
    expect(seasonFromLabel("2025/26")).toEqual({ id: "2025-26", label: "2025/26" });
    expect(seasonFromLabel("Cup 2026")).toEqual({ id: "cup-2026", label: "Cup 2026" });
  });

  it("groups one league per (district, name) with seasons newest first", () => {
    const leagues = composeCatalog([
      { districtId: 749, districtName: "Stockholm Basket", seasonId: 763, seasonLabel: "Säsongen 25/26", leagues: [{ leagueId: 17550, name: "Herrar U19" }] },
      { districtId: 749, districtName: "Stockholm Basket", seasonId: 776, seasonLabel: "Säsongen 26/27", leagues: [{ leagueId: 27804, name: "Herrar U19" }, { leagueId: 27811, name: "Damer U19" }] },
      { districtId: 752, districtName: "Skånes BDF", seasonId: 776, seasonLabel: "Säsongen 26/27", leagues: [{ leagueId: 28001, name: "Herrar U19" }] },
    ]);
    expect(leagues.map((l) => l.id)).toEqual([
      "profixio-749-herrar-u19",
      "profixio-749-damer-u19",
      "profixio-752-herrar-u19",
    ]);
    const [herrar, damer] = leagues;
    expect(herrar).toMatchObject({ name: "Herrar U19", country: "SE", gender: "men", region: "Stockholm Basket", provider: "profixio" });
    expect(herrar.seasons).toEqual([
      { id: "2026-27", label: "2026/27", provider: "profixio", profixio: { leagueId: 27804, seasonId: 776 } },
      { id: "2025-26", label: "2025/26", provider: "profixio", profixio: { leagueId: 17550, seasonId: 763 } },
    ]);
    expect(damer.gender).toBe("women");
    expect(damer.seasons).toHaveLength(1);
  });

  it("omits gender when the name carries none and yields an empty list for no rows", () => {
    const [l] = composeCatalog([
      { districtId: 1, districtName: "X", seasonId: 776, seasonLabel: "Säsongen 26/27", leagues: [{ leagueId: 5, name: "Mixed U10" }] },
    ]);
    expect("gender" in l).toBe(false);
    expect(composeCatalog([])).toEqual([]);
  });
});

// Type-level smoke: the wire event is what the client normaliser consumes.
const _typed: ProfixioEvent = events[0];
void _typed;
