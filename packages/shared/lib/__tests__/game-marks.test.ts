import { describe, expect, it } from "vitest";
import type { PlayByPlayEvent } from "../../types/match";
import {
  findGeniusGameMarks,
  gameMarksBasis,
  gameMarksFromEvents,
  gameMarksStale,
  normalizeGameMarks,
  resolveGameMarks,
} from "../game-marks";
import type { GeniusAction } from "../genius";
import sample from "./fixtures/genius-sample.json";

const actions = sample.actions as unknown as GeniusAction[];
/** Norrköping, the fixture's home side (Högsbo is the away competitor). */
const HOME = 187007;
const AWAY = 187005;

function action(partial: Partial<GeniusAction>): GeniusAction {
  return {
    actionNumber: 1,
    actionType: "clock",
    subType: "start",
    period: 1,
    periodType: "REGULAR",
    clock: "10:00:00",
    shotClock: "00:00:00",
    timeActual: "2026-01-10 17:00:00",
    success: 1,
    personId: 0,
    shirtNumber: "",
    teamId: 0,
    qualifiers: "",
    previousAction: 0,
    x: 0,
    y: 0,
    area: "",
    playersTeam1: "",
    playersTeam2: "",
    score1: "0",
    score2: "0",
    ...partial,
  };
}

function ev(partial: Partial<PlayByPlayEvent>): PlayByPlayEvent {
  return { eventId: 1, type: "2pt", subType: "", period: 1, gameClockTime: "10:00", realWorldTime: "", isSuccessful: 1, qualifiers: [], ...partial };
}

describe("findGeniusGameMarks", () => {
  it("reads the real feed's timeout with its team, clock and score", () => {
    const marks = findGeniusGameMarks(actions, HOME);
    expect(marks.v).toBe(1);
    expect(marks.source).toBe("genius");
    expect(marks.timeouts).toEqual([
      {
        eventId: 148,
        period: 1,
        clock: "02:37",
        realWorldTime: "2025-09-19T17:20:25Z",
        kind: "team",
        teamNumber: 1,
        scoreHome: 15,
        scoreAway: 14,
      },
    ]);
  });

  it("keeps each period's start, with overtime as period 5 and 6", () => {
    const { periods } = findGeniusGameMarks(actions, HOME);
    expect(periods["1"]).toEqual({ startRealWorldTime: "2025-09-19T17:06:08Z" });
    expect(periods["5"]).toEqual({ startRealWorldTime: "2025-10-26T17:51:32Z" });
    expect(periods["6"]).toEqual({ startRealWorldTime: "2025-10-26T18:06:44Z" });
  });

  it("names the away side when it called the timeout", () => {
    const marks = findGeniusGameMarks([action({ actionNumber: 5, actionType: "timeout", subType: "full", teamId: AWAY })], HOME);
    expect(marks.timeouts[0].teamNumber).toBe(2);
  });

  it("takes the restart from the next clock start of the same period", () => {
    const marks = findGeniusGameMarks(
      [
        action({ actionNumber: 291, subType: "stop", timeActual: "2026-01-10 16:41:09", period: 2 }),
        action({ actionNumber: 292, actionType: "timeout", subType: "full", teamId: HOME, period: 2, clock: "03:42:00", timeActual: "2026-01-10 16:41:14" }),
        action({ actionNumber: 293, subType: "adjustment", period: 2, timeActual: "2026-01-10 16:41:55" }),
        action({ actionNumber: 297, subType: "start", period: 2, timeActual: "2026-01-10 16:42:37" }),
        action({ actionNumber: 299, subType: "start", period: 2, timeActual: "2026-01-10 16:42:40" }),
      ],
      HOME,
    );
    expect(marks.timeouts[0].resumeRealWorldTime).toBe("2026-01-10T16:42:37Z");
  });

  it("leaves the restart out when the period ends first", () => {
    const marks = findGeniusGameMarks(
      [
        action({ actionNumber: 10, actionType: "timeout", subType: "full", teamId: HOME, period: 1, clock: "00:02:00" }),
        action({ actionNumber: 11, actionType: "period", subType: "end", period: 1, timeActual: "2026-01-10 17:01:00" }),
        action({ actionNumber: 12, subType: "start", period: 2, timeActual: "2026-01-10 17:03:00" }),
      ],
      HOME,
    );
    expect(marks.timeouts[0].resumeRealWorldTime).toBeUndefined();
    expect(marks.periods["1"]).toEqual({ endRealWorldTime: "2026-01-10T17:01:00Z" });
  });

  it("marks an officials' timeout as nobody's", () => {
    const marks = findGeniusGameMarks([action({ actionNumber: 142, actionType: "timeout", subType: "officials", teamId: 0 })], HOME);
    expect(marks.timeouts[0]).toMatchObject({ kind: "officials", teamNumber: null });
  });

  it("goes by action number, whatever order the rows come in", () => {
    const marks = findGeniusGameMarks(
      [
        action({ actionNumber: 30, subType: "start", timeActual: "2026-01-10 17:05:00" }),
        action({ actionNumber: 20, actionType: "timeout", subType: "full", teamId: HOME, timeActual: "2026-01-10 17:04:00" }),
        action({ actionNumber: 10, actionType: "timeout", subType: "full", teamId: AWAY, timeActual: "2026-01-10 17:02:00" }),
      ],
      HOME,
    );
    expect(marks.timeouts.map((t) => t.eventId)).toEqual([10, 20]);
    expect(marks.timeouts[0].resumeRealWorldTime).toBe("2026-01-10T17:05:00Z");
  });

  it("keeps the first start and the last end of a period", () => {
    const marks = findGeniusGameMarks(
      [
        action({ actionNumber: 1, actionType: "period", subType: "start", timeActual: "2026-01-10 17:00:00" }),
        action({ actionNumber: 2, actionType: "period", subType: "start", timeActual: "2026-01-10 17:00:30" }),
        action({ actionNumber: 3, actionType: "period", subType: "end", timeActual: "2026-01-10 17:20:00" }),
        action({ actionNumber: 4, actionType: "period", subType: "end", timeActual: "2026-01-10 17:21:00" }),
      ],
      HOME,
    );
    expect(marks.periods["1"]).toEqual({ startRealWorldTime: "2026-01-10T17:00:00Z", endRealWorldTime: "2026-01-10T17:21:00Z" });
  });
});

describe("gameMarksFromEvents", () => {
  it("reads timeout rows a feed keeps among its plays", () => {
    const marks = gameMarksFromEvents([
      ev({ eventId: 9, type: "timeout", period: 2, gameClockTime: "04:10", realWorldTime: "2026-01-10T17:30:00Z", eventTeam: { teamCode: "", teamName: "AIK", teamNumber: 2 }, scoreHome: 30, scoreAway: 28 }),
      ev({ eventId: 4, type: "timeout", period: 1, gameClockTime: "06:00", realWorldTime: "2026-01-10T17:10:00Z" }),
      ev({ eventId: 5, type: "2pt", realWorldTime: "2026-01-10T17:11:00Z" }),
    ]);
    expect(marks?.source).toBe("events");
    expect(marks?.timeouts.map((t) => [t.eventId, t.kind, t.teamNumber])).toEqual([
      [4, "officials", null],
      [9, "team", 2],
    ]);
  });

  it("is null for a game with no timeout rows", () => {
    expect(gameMarksFromEvents([ev({ realWorldTime: "2026-01-10T17:11:00Z" })])).toBeNull();
  });
});

describe("basis and staleness", () => {
  const plays = [
    ev({ eventId: 1, realWorldTime: "2026-01-10T17:05:00Z" }),
    ev({ eventId: 2, realWorldTime: "2026-01-10T17:01:00Z" }),
    ev({ eventId: 3, realWorldTime: "2026-01-10T18:40:00Z" }),
  ];

  it("is the play count with the first and last play's time", () => {
    expect(gameMarksBasis(plays)).toEqual({ plays: 3, first: "2026-01-10T17:01:00Z", last: "2026-01-10T18:40:00Z" });
  });

  it("is stale without marks, without a basis, or once the plays moved", () => {
    const marks = { ...findGeniusGameMarks([], HOME), basis: gameMarksBasis(plays) };
    expect(gameMarksStale(null, plays)).toBe(true);
    expect(gameMarksStale(findGeniusGameMarks([], HOME), plays)).toBe(true);
    expect(gameMarksStale(marks, plays)).toBe(false);
    expect(gameMarksStale(marks, plays.slice(0, 2))).toBe(true);
    expect(gameMarksStale(marks, [...plays.slice(0, 2), ev({ eventId: 3, realWorldTime: "2026-01-10T18:41:00Z" })])).toBe(true);
  });
});

describe("normalizeGameMarks", () => {
  it("gives back what findGeniusGameMarks made", () => {
    const marks = { ...findGeniusGameMarks(actions, HOME), basis: { plays: 12, first: "2025-09-19T17:06:30Z", last: "2025-09-19T17:20:00Z" } };
    expect(normalizeGameMarks(JSON.parse(JSON.stringify(marks)))).toEqual(marks);
  });

  it("is undefined for anything that isn't marks", () => {
    expect(normalizeGameMarks(null)).toBeUndefined();
    expect(normalizeGameMarks([])).toBeUndefined();
    expect(normalizeGameMarks({ v: 2, source: "genius" })).toBeUndefined();
    expect(normalizeGameMarks({ v: 1, source: "elsewhere" })).toBeUndefined();
  });

  it("drops malformed timeouts and periods and keeps the rest", () => {
    const marks = normalizeGameMarks({
      v: 1,
      source: "genius",
      periods: { "1": { startRealWorldTime: "2026-01-10T17:00:00Z", endRealWorldTime: "soon" }, x: { startRealWorldTime: "2026-01-10T17:00:00Z" }, "2": {} },
      timeouts: [
        { eventId: 5, period: 1, clock: "05:00", realWorldTime: "2026-01-10T17:08:00Z", kind: "team", teamNumber: 2, scoreHome: 8, scoreAway: "9" },
        { eventId: 6, period: 1, clock: "04:00", realWorldTime: "not a time", kind: "team", teamNumber: 1 },
        { eventId: "7", period: 1, realWorldTime: "2026-01-10T17:09:00Z" },
        { eventId: 8, period: 0, realWorldTime: "2026-01-10T17:09:00Z" },
        { eventId: 9, period: 2, realWorldTime: "2026-01-10T17:30:00Z", kind: "team", teamNumber: 3 },
        "nonsense",
      ],
    });
    expect(marks?.periods).toEqual({ "1": { startRealWorldTime: "2026-01-10T17:00:00Z" } });
    expect(marks?.timeouts).toEqual([
      { eventId: 5, period: 1, clock: "05:00", realWorldTime: "2026-01-10T17:08:00Z", kind: "team", teamNumber: 2, scoreHome: 8, scoreAway: 9 },
      { eventId: 9, period: 2, clock: "", realWorldTime: "2026-01-10T17:30:00Z", kind: "officials", teamNumber: null, scoreHome: null, scoreAway: null },
    ]);
    expect(marks?.basis).toBeUndefined();
  });
});

describe("resolveGameMarks", () => {
  it("prefers the stored marks, then the plays' own, then nothing", () => {
    const stored = findGeniusGameMarks(actions, HOME);
    const timeout = ev({ eventId: 4, type: "timeout", realWorldTime: "2026-01-10T17:10:00Z" });
    expect(resolveGameMarks({ gameMarks: stored, events: [timeout] })).toBe(stored);
    expect(resolveGameMarks({ events: [timeout] })?.source).toBe("events");
    expect(resolveGameMarks({ events: [] })).toBeNull();
  });
});
