import { describe, expect, it } from "vitest";
import {
  DEFAULT_POST_ROLL,
  defaultPreRoll,
  defaultPreRollForMatches,
  matchProvider,
  seasonProvider,
} from "../provider";

describe("seasonProvider", () => {
  it("defaults to genius when unset (bundled and national-team seasons never set it)", () => {
    expect(seasonProvider({})).toBe("genius");
    expect(seasonProvider({ provider: undefined })).toBe("genius");
  });

  it("returns the declared provider", () => {
    expect(seasonProvider({ provider: "profixio" })).toBe("profixio");
    expect(seasonProvider({ provider: "genius" })).toBe("genius");
  });
});

describe("matchProvider", () => {
  it("recognises a Profixio match by its namespaced source game id", () => {
    expect(matchProvider({ sourceGameId: "profixio:32406189" })).toBe("profixio");
  });

  it("recognises a Profixio match by its league id when the source id is missing", () => {
    expect(matchProvider({ leagueId: "profixio-749-herrar-u19" })).toBe("profixio");
  });

  it("treats bare Genius ids and legacy matches as genius", () => {
    expect(matchProvider({ sourceGameId: "2668882", leagueId: "sbl-herr" })).toBe("genius");
    expect(matchProvider({})).toBe("genius");
    expect(matchProvider({ sourceGameId: undefined, leagueId: undefined })).toBe("genius");
  });
});

describe("defaultPreRoll", () => {
  it("gives Profixio games a longer lead-in — the scorer's table logs 10–20 s after the play", () => {
    expect(defaultPreRoll({ sourceGameId: "profixio:1" })).toBe(20);
  });

  it("keeps the 10 s default for Genius games and when no match is loaded", () => {
    expect(defaultPreRoll({ sourceGameId: "2668882" })).toBe(10);
    expect(defaultPreRoll(null)).toBe(10);
    expect(defaultPreRoll(undefined)).toBe(10);
  });

  it("takes the longest default across a mixed playlist (a long pre-roll only lengthens a Genius clip)", () => {
    expect(defaultPreRollForMatches([{ sourceGameId: "1" }, { sourceGameId: "profixio:2" }])).toBe(20);
    expect(defaultPreRollForMatches([{ sourceGameId: "1" }])).toBe(10);
    expect(defaultPreRollForMatches([])).toBe(10);
  });

  it("exports the shared post-roll default", () => {
    expect(DEFAULT_POST_ROLL).toBe(3);
  });
});
