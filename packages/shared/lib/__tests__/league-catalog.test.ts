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

// ---------------------------------------------------------------------------
// Provider-aware catalogue (Profixio seasons carry a league handle, not a
// Genius competitionId). Served by the `profixio` function and merged
// client-side with the genius list, so both shapes must round-trip and the
// genius rules above must stay byte-for-byte the same.
// ---------------------------------------------------------------------------

function profixioLeague(partial: Partial<CatalogLeague> = {}): CatalogLeague {
  return {
    id: "profixio-749-herrar-u19",
    name: "Herrar U19",
    country: "SE",
    gender: "men",
    region: "Stockholm Basket",
    provider: "profixio",
    seasons: [
      {
        id: "2026-27",
        label: "2026/27",
        provider: "profixio",
        profixio: { leagueId: 27804, seasonId: 776, tournamentId: 52949 },
      },
      { id: "2025-26", label: "2025/26", provider: "profixio", profixio: { leagueId: 17550 } },
    ],
    ...partial,
  };
}

describe("parseLeagueCatalog — Profixio seasons", () => {
  it("accepts a Profixio league unchanged", () => {
    const input = [profixioLeague()];
    expect(parseLeagueCatalog(input)).toEqual(input);
  });

  it("accepts a mixed catalogue and preserves order", () => {
    const input = [catalogLeague(), profixioLeague()];
    expect(parseLeagueCatalog(input)?.map((l) => l.id)).toEqual([
      "basketettan-herr",
      "profixio-749-herrar-u19",
    ]);
  });

  it("does not require gender on a Profixio league (youth names don't always carry one)", () => {
    const league: Record<string, unknown> = { ...profixioLeague() };
    delete league.gender;
    expect(parseLeagueCatalog([league])).toEqual([league]);
  });

  it("still requires gender on a Genius league", () => {
    const league: Record<string, unknown> = { ...catalogLeague() };
    delete league.gender;
    expect(parseLeagueCatalog([league])).toBeNull();
  });

  it("rejects a Profixio season without a usable league handle", () => {
    const bad = (profixio: unknown) =>
      parseLeagueCatalog([
        {
          ...profixioLeague(),
          seasons: [{ id: "2025-26", label: "2025/26", provider: "profixio", profixio }],
        },
      ]);
    expect(bad(undefined)).toBeNull();
    expect(bad({})).toBeNull();
    expect(bad({ leagueId: 0 })).toBeNull();
    expect(bad({ leagueId: "17550" })).toBeNull();
    expect(bad({ leagueId: 17550.5 })).toBeNull();
    expect(bad({ leagueId: 17550, tournamentId: "x" })).toBeNull();
  });

  it("rejects an unknown provider", () => {
    expect(
      parseLeagueCatalog([
        { ...catalogLeague(), seasons: [{ id: "x", label: "x", provider: "sportradar", competitionId: 1 }] },
      ]),
    ).toBeNull();
  });

  it("still rejects a provider-less season without competitionId", () => {
    // Guards against a server accidentally dropping competitionId for Genius.
    expect(
      parseLeagueCatalog([{ ...catalogLeague(), seasons: [{ id: "x", label: "x" }] }]),
    ).toBeNull();
  });

  it("rejects a non-string region and tolerates a missing one", () => {
    expect(parseLeagueCatalog([{ ...profixioLeague(), region: 42 }])).toBeNull();
    const league: Record<string, unknown> = { ...profixioLeague() };
    delete league.region;
    expect(parseLeagueCatalog([league])).toEqual([league]);
  });
});

describe("catalogToLeagues — Profixio seasons", () => {
  it("leaves stages empty on Profixio seasons (categories load lazily) and keeps the handle", () => {
    const [league] = catalogToLeagues([profixioLeague()]);
    expect(league.region).toBe("Stockholm Basket");
    for (const season of league.seasons) {
      expect(season.provider).toBe("profixio");
      expect(season.stages).toEqual([]);
      expect(season.competitionId).toBeUndefined();
    }
    expect(league.seasons[0].profixio).toEqual({ leagueId: 27804, seasonId: 776, tournamentId: 52949 });
  });

  it("marks Genius seasons explicitly and attaches no region key when absent", () => {
    const [league] = catalogToLeagues([catalogLeague()]);
    expect(league.seasons.every((s) => s.provider === "genius")).toBe(true);
    expect("region" in league).toBe(false);
  });
});
