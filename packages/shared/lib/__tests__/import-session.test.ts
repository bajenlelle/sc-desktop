import { describe, expect, it } from "vitest";
import { buildStoredMatch, buildSyncPoint, importAnchor, importAnchorForMatch, importBlockOf, type ImportPick } from "../import-session";
import type { GameData } from "../league-schedule";
import { matchSaveToken, type MatchSaveError } from "../matches-db";
import { PLAYOFF, REGULAR, type League } from "../../types/league";

const league: League = {
  id: "superettan-herr",
  name: "Superettan Herr",
  country: "SE",
  seasons: [{ id: "2026-27", label: "2026/27", competitionId: 49176, stages: [REGULAR, PLAYOFF] }],
};

const pick: ImportPick = {
  league,
  season: league.seasons[0],
  stage: PLAYOFF,
  game: {
    uuid: "2583394",
    rawStartDateTime: "2026-10-04T15:00:00Z",
    startDateTime: "2026-10-04T15:00:00Z",
    homeTeamInfo: { names: { short: "Sollentuna", long: "Sollentuna Basket" }, score: 84, icon: "", status: "COMPLETE" },
    awayTeamInfo: { names: { short: "AIK", long: "AIK Basket" }, score: 77, icon: "", status: "COMPLETE" },
    venueInfo: { name: "Sollentuna" },
    matchType: "FINALS",
  },
};

const event = { eventId: 1, type: "2pt", subType: "jumpshot", period: 1, gameClockTime: "09:40", realWorldTime: "2026-10-04T15:05:00Z", isSuccessful: 1, qualifiers: [] };

const data: GameData = {
  homeName: "Sollentuna Basket",
  awayName: "AIK Basket",
  date: "2026-10-04",
  homeRoster: [{ jerseyNumber: "4", playerName: "A" }],
  awayRoster: [{ jerseyNumber: "7", playerName: "B" }],
  events: [event],
  tipoffRealWorldTime: "2026-10-04T15:04:30Z",
  periodMarks: { "2": { anchor: { realWorldTime: "2026-10-04T15:30:00Z", kind: "play", label: "Q2's first basket" } } },
  pbpStatus: "ok",
};

describe("buildStoredMatch", () => {
  const newId = () => "new-uuid";

  it("builds a new web row with no videoUrl and no sync point, from the fetched data", () => {
    const m = buildStoredMatch(pick, data, { orgId: "org-1", existing: null, newId });
    expect(m).toEqual({
      id: "new-uuid",
      sourceGameId: "2583394",
      title: "Sollentuna Basket vs AIK Basket",
      date: "2026-10-04",
      homeTeam: { name: "Sollentuna Basket", color: "" },
      awayTeam: { name: "AIK Basket", color: "" },
      homeRoster: data.homeRoster,
      awayRoster: data.awayRoster,
      events: [event],
      leagueId: "superettan-herr",
      seasonId: "2026-27",
      stageId: "playoff",
      orgId: "org-1",
    });
    expect("videoUrl" in m).toBe(false);
    expect("syncPoint" in m).toBe(false);
  });

  it("keeps the existing row's id and the desktop's video path on a re-import", () => {
    const m = buildStoredMatch(pick, data, {
      orgId: "org-1",
      existing: { id: "old-uuid", videoUrl: "/Users/coach/Movies/game.mp4" },
      newId,
    });
    expect(m.id).toBe("old-uuid");
    expect(m.videoUrl).toBe("/Users/coach/Movies/game.mp4");
    const web = buildStoredMatch(pick, data, { orgId: "org-1", existing: { id: "old-uuid" }, newId });
    expect(web.id).toBe("old-uuid");
    expect("videoUrl" in web).toBe(false);
  });

  it("falls back to the schedule row's names and date when the play-by-play didn't load", () => {
    const m = buildStoredMatch({ ...pick, stage: null }, null, { orgId: null, existing: null, newId });
    expect(m.title).toBe("Sollentuna Basket vs AIK Basket");
    expect(m.date).toBe("2026-10-04");
    expect(m.events).toEqual([]);
    expect(m.homeRoster).toEqual([]);
    expect(m.stageId).toBeUndefined();
    expect("orgId" in m).toBe(false);
  });
});

describe("importAnchor", () => {
  it("anchors Genius games on the tip-off and Profixio games on what the data says", () => {
    expect(importAnchor(data)).toEqual({ kind: "tipoff", label: "the tip-off", realWorldTime: "2026-10-04T15:04:30Z" });
    expect(
      importAnchor({
        tipoffRealWorldTime: "2026-10-04T15:06:10Z",
        syncAnchor: { kind: "first_basket", label: "Örebro's first basket (2–0)" },
      }),
    ).toEqual({ kind: "first_basket", label: "Örebro's first basket (2–0)", realWorldTime: "2026-10-04T15:06:10Z" });
    expect(importAnchor({ tipoffRealWorldTime: null, syncAnchor: { kind: "match_start", label: "the start of period 1" } }).realWorldTime).toBeNull();
  });

  it("has nothing to anchor on without data", () => {
    expect(importAnchor(null)).toEqual({ kind: "tipoff", label: "the tip-off", realWorldTime: null });
    expect(importAnchor({ tipoffRealWorldTime: null })).toEqual({ kind: "tipoff", label: "the tip-off", realWorldTime: null });
  });
});

describe("importAnchorForMatch", () => {
  const stored = buildStoredMatch(pick, data, { orgId: null, existing: null, newId: () => "m" });

  it("reads a desktop-synced game's anchor off its sync point", () => {
    expect(importAnchorForMatch({ ...stored, syncPoint: { syncVideoTime: 252, syncRealWorldTime: "2026-10-04T15:04:30Z" } })).toEqual({
      kind: "tipoff",
      label: "the tip-off",
      realWorldTime: "2026-10-04T15:04:30Z",
    });
    expect(
      importAnchorForMatch({
        ...stored,
        syncPoint: { syncVideoTime: 300, syncRealWorldTime: "2026-10-04T15:06:10Z", anchor: { kind: "first_basket", label: "Örebro's first basket (2–0)" } },
      }),
    ).toEqual({ kind: "first_basket", label: "Örebro's first basket (2–0)", realWorldTime: "2026-10-04T15:06:10Z" });
  });

  it("finds a Profixio game's first made basket in its events", () => {
    const profixio = {
      ...stored,
      sourceGameId: "profixio:4711",
      events: [
        { ...event, eventId: 2, type: "foul", isSuccessful: 1, realWorldTime: "2026-10-04T15:05:10Z" },
        { ...event, eventId: 3, type: "2pt", realWorldTime: "2026-10-04T15:06:40Z", scoreHome: 2, scoreAway: 2, eventTeam: { teamCode: "", teamName: "AIK Basket", teamNumber: 2 } },
        { ...event, eventId: 1, type: "3pt", realWorldTime: "2026-10-04T15:05:30Z", scoreHome: 0, scoreAway: 3, eventTeam: { teamCode: "", teamName: "AIK Basket", teamNumber: 2 } },
      ],
    };
    expect(importAnchorForMatch(profixio)).toEqual({ kind: "first_basket", label: "AIK Basket's first basket (0–3)", realWorldTime: "2026-10-04T15:05:30Z" });
    expect(importAnchorForMatch({ ...profixio, events: [] })).toBeNull();
  });

  it("has nothing for an unsynced Genius game: its tip-off marker isn't among the plays", () => {
    expect(importAnchorForMatch(stored)).toBeNull();
    expect(importAnchorForMatch({ ...stored, syncPoint: { syncVideoTime: 10, syncRealWorldTime: "" } })).toBeNull();
  });
});

describe("buildSyncPoint", () => {
  it("names the anchor only when it isn't the tip-off and carries the period marks", () => {
    const tipoff = buildSyncPoint(252.3, importAnchor(data), data.periodMarks);
    expect(tipoff).toEqual({ syncVideoTime: 252.3, syncRealWorldTime: "2026-10-04T15:04:30Z", marks: data.periodMarks });
    const basket = buildSyncPoint(300, { kind: "first_basket", label: "Örebro's first basket (2–0)", realWorldTime: "2026-10-04T15:06:10Z" });
    expect(basket).toEqual({
      syncVideoTime: 300,
      syncRealWorldTime: "2026-10-04T15:06:10Z",
      anchor: { kind: "first_basket", label: "Örebro's first basket (2–0)" },
    });
    expect(buildSyncPoint(10, { kind: "tipoff", label: "the tip-off", realWorldTime: null }, {})).toEqual({
      syncVideoTime: 10,
      syncRealWorldTime: "",
    });
  });
});

describe("importBlockOf", () => {
  it("reads the token saveMatch attaches", () => {
    const limit: MatchSaveError = Object.assign(new Error("Failed to save match: import_limit_reached"), {
      token: "import_limit_reached" as const,
    });
    expect(importBlockOf(limit)).toBe("import_limit_reached");
    const locked: MatchSaveError = Object.assign(new Error("This organization's license has expired"), { token: "license_locked" as const });
    expect(importBlockOf(locked)).toBe("license_locked");
  });

  it("falls back to the message, and names nothing for other failures", () => {
    expect(importBlockOf(new Error("new row violates … import_limit_reached"))).toBe("import_limit_reached");
    expect(importBlockOf("license_locked")).toBe("license_locked");
    expect(importBlockOf(new Error("Failed to save events: timeout"))).toBeNull();
    expect(importBlockOf(null)).toBeNull();
    expect(importBlockOf(undefined)).toBeNull();
    expect(importBlockOf({ token: "something_else" })).toBeNull();
  });

  it("agrees with matchSaveToken on the database's messages", () => {
    expect(matchSaveToken("P0001: import_limit_reached")).toBe("import_limit_reached");
    expect(matchSaveToken("P0001: license_locked")).toBe("license_locked");
    expect(matchSaveToken("duplicate key value")).toBeNull();
  });
});
