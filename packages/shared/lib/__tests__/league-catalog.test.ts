import { describe, expect, it } from "vitest";
import { catalogToLeagues, parseLeagueCatalog } from "../league-catalog";
import type { CatalogLeague } from "../../types/league";

/** One well-formed league, the shape the edge function serves. */
function catalogLeague(partial: Partial<CatalogLeague> = {}): CatalogLeague {
  return {
    id: "basketettan-herr",
    name: "Basketettan Herr",
    country: "SE",
    gender: "men",
    seasons: [
      { id: "2026-27", label: "2026/27", competitionId: 50039 },
      { id: "2025-26", label: "2025/26", competitionId: 42251 },
    ],
    ...partial,
  };
}

describe("parseLeagueCatalog", () => {
  it("accepts a well-formed catalogue unchanged", () => {
    const input = [catalogLeague()];
    expect(parseLeagueCatalog(input)).toEqual(input);
  });

  it("preserves season order, since seasons[0] is the current season", () => {
    const out = parseLeagueCatalog([catalogLeague()]);
    expect(out?.[0].seasons.map((s) => s.id)).toEqual(["2026-27", "2025-26"]);
  });

  it("rejects an empty catalogue — 'no leagues at all' is never a real answer", () => {
    expect(parseLeagueCatalog([])).toBeNull();
  });

  it("rejects anything that isn't an array", () => {
    expect(parseLeagueCatalog(null)).toBeNull();
    expect(parseLeagueCatalog(undefined)).toBeNull();
    expect(parseLeagueCatalog({})).toBeNull();
    expect(parseLeagueCatalog("[]")).toBeNull();
    expect(parseLeagueCatalog(42)).toBeNull();
  });

  it("rejects a league missing any required field", () => {
    for (const key of ["id", "name", "country", "gender", "seasons"] as const) {
      const league: Record<string, unknown> = { ...catalogLeague() };
      delete league[key];
      expect(parseLeagueCatalog([league])).toBeNull();
    }
  });

  it("rejects wrong types rather than coercing them", () => {
    expect(parseLeagueCatalog([catalogLeague({ id: "" })])).toBeNull();
    expect(parseLeagueCatalog([{ ...catalogLeague(), name: 123 }])).toBeNull();
    expect(parseLeagueCatalog([{ ...catalogLeague(), gender: "mixed" }])).toBeNull();
    expect(parseLeagueCatalog([catalogLeague({ seasons: [] })])).toBeNull();
  });

  it("rejects a season without a usable competitionId — it could never be fetched", () => {
    const bad = (competitionId: unknown) =>
      parseLeagueCatalog([
        { ...catalogLeague(), seasons: [{ id: "2026-27", label: "2026/27", competitionId }] },
      ]);
    expect(bad(undefined)).toBeNull();
    expect(bad("50039")).toBeNull();
    expect(bad(0)).toBeNull();
    expect(bad(-1)).toBeNull();
    expect(bad(Number.NaN)).toBeNull();
  });

  it("fails the whole catalogue rather than serving a partial one", () => {
    // A half-read list would silently hide leagues, which is the failure mode
    // this function exists to prevent.
    expect(parseLeagueCatalog([catalogLeague(), { id: "broken" }])).toBeNull();
  });

  it("rejects a truncated cache blob", () => {
    // What a half-written localStorage entry parses to.
    expect(parseLeagueCatalog([{ id: "sbl-herr", name: "SBL Herr" }])).toBeNull();
  });
});

describe("catalogToLeagues", () => {
  it("attaches both stages to every season", () => {
    const [league] = catalogToLeagues([catalogLeague()]);
    for (const season of league.seasons) {
      expect(season.stages.map((s) => s.id)).toEqual(["regular", "playoff"]);
      expect(season.stages.map((s) => s.matchType)).toEqual(["REGULAR", "FINALS"]);
    }
  });

  it("carries identity and competitionIds through untouched", () => {
    const [league] = catalogToLeagues([catalogLeague()]);
    expect(league).toMatchObject({
      id: "basketettan-herr",
      name: "Basketettan Herr",
      country: "SE",
      gender: "men",
    });
    expect(league.seasons.map((s) => s.competitionId)).toEqual([50039, 42251]);
  });

  it("keeps season order so seasons[0] stays current", () => {
    const [league] = catalogToLeagues([catalogLeague()]);
    expect(league.seasons[0].id).toBe("2026-27");
  });

  it("maps an empty catalogue to an empty list without throwing", () => {
    expect(catalogToLeagues([])).toEqual([]);
  });
});
