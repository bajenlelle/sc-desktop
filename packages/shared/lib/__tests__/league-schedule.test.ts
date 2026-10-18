import { describe, expect, it } from "vitest";
import {
  BUNDLED_LEAGUES,
  COUNTRY_NAMES,
  NATIONAL_TEAM_LEAGUES,
  countryFlag,
  groupLeagues,
  leagueGroupName,
} from "../league-schedule";
import { NT_LEAGUE_IDS } from "../plan-tier";
import type { League } from "../../types/league";

const league = (id: string, name: string, extra: Partial<League> = {}): League => ({
  id,
  name,
  country: "SE",
  seasons: [{ id: "2026-27", label: "2026/27", competitionId: 1, stages: [] }],
  ...extra,
});

describe("the bundled catalogue", () => {
  it("carries the national leagues with a competition per season, newest first", () => {
    expect(BUNDLED_LEAGUES.map((l) => l.id)).toEqual(["sbl-herr", "sbl-dam", "superettan-herr", "basketettan-herr", "basketettan-dam"]);
    for (const l of BUNDLED_LEAGUES) {
      expect(l.seasons[0].id > l.seasons[1].id).toBe(true);
      for (const s of l.seasons) expect(s.competitionId).toBeGreaterThan(0);
    }
  });

  it("keeps the national-team league ids in step with the import-cap exemption", () => {
    expect(NATIONAL_TEAM_LEAGUES.map((l) => l.id)).toEqual(NT_LEAGUE_IDS);
  });
});

describe("countryFlag", () => {
  it("builds the regional-indicator pair for an ISO-2 code and nothing for anything else", () => {
    expect(countryFlag("SE")).toBe("🇸🇪");
    expect(countryFlag("se")).toBe("🇸🇪");
    expect(countryFlag("SWE")).toBe("");
    expect(countryFlag("")).toBe("");
  });
});

describe("groupLeagues", () => {
  const stockholm = league("profixio-sthlm-u19", "Herrar U19", { region: "Stockholm Basket", provider: "profixio" });
  const skane = league("profixio-skane-u19", "Herrar U19", { region: "Skåne Basket", provider: "profixio" });
  const all = [...NATIONAL_TEAM_LEAGUES, stockholm, ...BUNDLED_LEAGUES, skane];

  it("names the group after the district, else the country, national teams apart", () => {
    expect(leagueGroupName(stockholm)).toBe("Stockholm Basket");
    expect(leagueGroupName(BUNDLED_LEAGUES[0])).toBe(COUNTRY_NAMES.SE);
    expect(leagueGroupName(NATIONAL_TEAM_LEAGUES[0])).toBe("National teams");
    expect(leagueGroupName(league("x", "X", { country: "NO" }))).toBe("NO");
  });

  it("orders countries, then districts alphabetically, national teams last", () => {
    expect(groupLeagues(all).map(([name]) => name)).toEqual(["Sweden", "Skåne Basket", "Stockholm Basket", "National teams"]);
    expect(groupLeagues(all)[0][1].map((l) => l.id)).toEqual(BUNDLED_LEAGUES.map((l) => l.id));
  });

  it("filters by league name, group or district, case-insensitively, and keeps everything for a blank query", () => {
    expect(groupLeagues(all, "sbl").flatMap(([, ls]) => ls.map((l) => l.id))).toEqual(["sbl-herr", "sbl-dam"]);
    expect(groupLeagues(all, "stockholm").map(([name]) => name)).toEqual(["Stockholm Basket"]);
    expect(groupLeagues(all, "u19").map(([name]) => name)).toEqual(["Skåne Basket", "Stockholm Basket"]);
    expect(groupLeagues(all, "  ")).toEqual(groupLeagues(all));
    expect(groupLeagues(all, "zzz")).toEqual([]);
  });
});
