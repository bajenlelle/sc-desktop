import { describe, expect, it } from "vitest";
import {
  decideImportView,
  filterScheduleGames,
  readImportView,
  resolveSelection,
  resolveStage,
  scheduleEmptyMessage,
  writeImportView,
} from "../import-picker";
import type { ScheduleGame } from "../genius";
import { PLAYOFF, REGULAR, type League } from "../../types/league";

const league = (id: string, seasons: string[], competition = 1): League => ({
  id,
  name: id,
  country: "SE",
  seasons: seasons.map((s, i) => ({ id: s, label: s, competitionId: competition + i, stages: [REGULAR, PLAYOFF] })),
});

const bundled = [league("sbl-herr", ["2026-27", "2025-26"], 10), league("sbl-dam", ["2026-27", "2025-26"], 20)];
const served = [league("sbl-herr", ["2026-27", "2025-26"], 100), league("superettan-herr", ["2026-27"], 200)];

describe("resolveSelection", () => {
  it("follows the selected league and season to the new catalogue's objects by id", () => {
    const r = resolveSelection(served, { leagueId: "sbl-herr", seasonId: "2025-26" })!;
    expect(r.league).toBe(served[0]);
    expect(r.season).toBe(served[0].seasons[1]);
    expect(r.season?.competitionId).toBe(101);
  });

  it("falls back to the first league when the league is gone, keeping the season by id where it can", () => {
    // SBL Dam left the catalogue: SBL Herr takes over, still on 2025/26.
    expect(resolveSelection(served, { leagueId: "sbl-dam", seasonId: "2025-26" })).toEqual({
      league: served[0],
      season: served[0].seasons[1],
    });
    expect(resolveSelection(bundled, {})).toEqual({ league: bundled[0], season: bundled[0].seasons[0] });
    expect(resolveSelection(served, { leagueId: "superettan-herr", seasonId: "2025-26" })?.season?.id).toBe("2026-27");
  });

  it("gives null without leagues, and a null season for a league without seasons", () => {
    expect(resolveSelection([], { leagueId: "sbl-herr" })).toBeNull();
    expect(resolveSelection([{ id: "x", name: "x", country: "SE", seasons: [] }], {})?.season).toBeNull();
  });
});

describe("resolveStage", () => {
  it("keeps the stage by id across a refresh, else takes the first", () => {
    expect(resolveStage([REGULAR, PLAYOFF], "playoff")).toBe(PLAYOFF);
    expect(resolveStage([REGULAR, PLAYOFF], "gone")).toBe(REGULAR);
    expect(resolveStage([REGULAR, PLAYOFF], null)).toBe(REGULAR);
    expect(resolveStage([], "regular")).toBeNull();
  });
});

const game = (uuid: string, date: string, home: string, away: string): ScheduleGame => ({
  uuid,
  rawStartDateTime: date,
  startDateTime: date,
  homeTeamInfo: { names: { short: home, long: `${home} Basket` }, score: 80, icon: "", status: "COMPLETE" },
  awayTeamInfo: { names: { short: away, long: `${away} BK` }, score: 70, icon: "", status: "COMPLETE" },
  venueInfo: { name: "Hall" },
});

describe("filterScheduleGames", () => {
  const games = [game("1", "2026-10-04T15:00:00Z", "Sollentuna", "AIK"), game("2", "2026-09-27T15:00:00Z", "Djurgården", "Umeå")];

  it("matches either side's short or long name, ignoring case", () => {
    expect(filterScheduleGames(games, "aik").map((g) => g.uuid)).toEqual(["1"]);
    expect(filterScheduleGames(games, "umeå bk").map((g) => g.uuid)).toEqual(["2"]);
    expect(filterScheduleGames(games, "SOLL").map((g) => g.uuid)).toEqual(["1"]);
  });

  it("matches the date as it is written in Sweden, and keeps everything for a blank query", () => {
    expect(filterScheduleGames(games, "2026-09-27").map((g) => g.uuid)).toEqual(["2"]);
    expect(filterScheduleGames(games, "")).toBe(games);
    expect(filterScheduleGames(games, "   ")).toBe(games);
    expect(filterScheduleGames(games, "nobody")).toEqual([]);
  });
});

describe("decideImportView", () => {
  it("opens on the team's games unless the space has no team or chose all games before", () => {
    expect(decideImportView("team-1", null)).toBe("team");
    expect(decideImportView("team-1", "all")).toBe("all");
    expect(decideImportView(null, null)).toBe("all");
    expect(decideImportView(undefined, "all")).toBe("all");
  });
});

describe("the remembered view", () => {
  function storage() {
    const data = new Map<string, string>();
    return {
      data,
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => {
        data.set(k, v);
      },
      removeItem: (k: string) => {
        data.delete(k);
      },
    };
  }

  it("remembers only the choice of all games, per space", () => {
    const s = storage();
    writeImportView(s, "org-1", "all");
    expect(readImportView(s, "org-1")).toBe("all");
    expect(readImportView(s, "org-2")).toBeNull();
    writeImportView(s, "org-1", "team");
    expect(readImportView(s, "org-1")).toBeNull();
    expect(s.data.size).toBe(0);
  });

  it("is quiet without a space or a store", () => {
    expect(readImportView(null, "org-1")).toBeNull();
    expect(readImportView(storage(), null)).toBeNull();
    expect(() => writeImportView(null, "org-1", "all")).not.toThrow();
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {},
    };
    expect(readImportView(broken, "org-1")).toBeNull();
    expect(() => writeImportView(broken, "org-1", "all")).not.toThrow();
  });
});

describe("scheduleEmptyMessage", () => {
  const base = { scheduleCount: 0, isProfixio: false, stage: REGULAR, stageCount: 2, seasonCount: 2, seasonLabel: "2026/27" };

  it("points at the category, the season, or says nothing matched", () => {
    expect(scheduleEmptyMessage({ ...base, isProfixio: true, stage: { id: "c1", label: "Nivå 1" } })).toBe(
      "No played games in Nivå 1 yet. Pick another category above.",
    );
    expect(scheduleEmptyMessage(base)).toBe("No completed games in 2026/27 yet. Switch season above to import earlier games.");
    expect(scheduleEmptyMessage({ ...base, seasonLabel: null })).toBe(
      "No completed games in this season yet. Switch season above to import earlier games.",
    );
    expect(scheduleEmptyMessage({ ...base, seasonCount: 1 })).toBe("No games found.");
    expect(scheduleEmptyMessage({ ...base, scheduleCount: 12 })).toBe("No games found.");
    expect(scheduleEmptyMessage({ ...base, isProfixio: true, stageCount: 1 })).toBe(
      "No completed games in 2026/27 yet. Switch season above to import earlier games.",
    );
  });
});
