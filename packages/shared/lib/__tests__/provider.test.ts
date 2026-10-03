import { describe, expect, it } from "vitest";
import {
  DEFAULT_POST_ROLL,
  DEFAULT_PRE_ROLL,
  defaultPostRoll,
  defaultPostRollForMatches,
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

describe("pre- and post-roll defaults", () => {
  it("uses the same pre-roll for both providers — the first-basket anchor cancels Profixio's entry lag", () => {
    expect(defaultPreRoll({ sourceGameId: "profixio:1" })).toBe(DEFAULT_PRE_ROLL);
    expect(defaultPreRoll({ sourceGameId: "2668882" })).toBe(DEFAULT_PRE_ROLL);
    expect(defaultPreRoll(null)).toBe(10);
    expect(defaultPreRollForMatches([{ sourceGameId: "1" }, { sourceGameId: "profixio:2" }])).toBe(10);
    expect(defaultPreRollForMatches([])).toBe(10);
  });

  it("gives Profixio games a longer tail — events land up to ~4 s after the computed time", () => {
    expect(defaultPostRoll({ sourceGameId: "profixio:1" })).toBe(6);
    expect(defaultPostRoll({ leagueId: "profixio-749-herrar-u19" })).toBe(6);
    expect(defaultPostRoll({ sourceGameId: "2668882" })).toBe(DEFAULT_POST_ROLL);
    expect(defaultPostRoll(null)).toBe(3);
  });

  it("takes the longest post-roll across a mixed playlist", () => {
    expect(defaultPostRollForMatches([{ sourceGameId: "1" }, { sourceGameId: "profixio:2" }])).toBe(6);
    expect(defaultPostRollForMatches([{ sourceGameId: "1" }])).toBe(3);
    expect(defaultPostRollForMatches([])).toBe(3);
  });
});
