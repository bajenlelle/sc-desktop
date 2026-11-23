import { describe, expect, it } from "vitest";
import {
  EMPTY_PLAY_FILTERS,
  MOMENT_OPTIONS,
  appliedFilters,
  applyPlayFilters,
  clearField,
  matchesPlay,
  momentsOfGame,
  playFiltersActive,
  playFiltersCount,
  toggled,
  type PlayFilters,
} from "../play-filters";
import { ev, who } from "./helpers/plays";

const f = (patch: Partial<PlayFilters>): PlayFilters => ({ ...EMPTY_PLAY_FILTERS, ...patch });

describe("counting", () => {
  it("counts each field that narrows, the moment included", () => {
    expect(playFiltersActive(EMPTY_PLAY_FILTERS)).toBe(false);
    expect(playFiltersCount(EMPTY_PLAY_FILTERS)).toBe(0);
    const on = f({ types: new Set(["2pt-made", "3pt-made"]), periods: new Set([4]), moment: "clutch", labels: new Set(["x"]) });
    expect(playFiltersCount(on)).toBe(4);
    expect(playFiltersActive(on)).toBe(true);
  });

  it("clears one field and leaves the rest", () => {
    const on = f({ types: new Set(["turnover"]), moment: "run" });
    expect(clearField(on, "moment")).toEqual(f({ types: new Set(["turnover"]) }));
    expect(playFiltersCount(clearField(on, "types"))).toBe(1);
  });

  it("toggles a value in and out of a set without changing it", () => {
    const set = new Set([1]);
    expect([...toggled(set, 2)]).toEqual([1, 2]);
    expect([...toggled(set, 1)]).toEqual([]);
    expect([...set]).toEqual([1]);
  });
});

describe("matchesPlay", () => {
  const made = ev(1, "2pt", 1, { player: who(7, 1, "Andersson"), period: 4 });
  const turnover = ev(2, "turnover", 2, { period: 1 });

  it("reads players by key, so a player is the same across games", () => {
    expect(matchesPlay(f({ players: new Set(["id:7"]) }), made)).toBe(true);
    expect(matchesPlay(f({ players: new Set(["id:7"]) }), turnover)).toBe(false);
  });

  it("filters by quarter and by moment, a moment through the play's own moments", () => {
    expect(matchesPlay(f({ periods: new Set([4]) }), made)).toBe(true);
    expect(matchesPlay(f({ periods: new Set([4]) }), turnover)).toBe(false);
    expect(matchesPlay(f({ moment: "clutch" }), made, undefined, new Set(["clutch"]))).toBe(true);
    expect(matchesPlay(f({ moment: "clutch" }), made)).toBe(false);
  });

  it("combines fields, any value within one", () => {
    const both = f({ types: new Set(["2pt-made", "turnover"]), periods: new Set([1]) });
    expect(applyPlayFilters([{ event: made }, { event: turnover }], both).map((x) => x.event.eventId)).toEqual([2]);
  });

  it("reads labels through labelsOf", () => {
    const labelled = f({ labels: new Set(["pnr"]) });
    const entries = [{ event: made, labels: new Set(["pnr"]) }, { event: turnover, labels: undefined }];
    expect(applyPlayFilters(entries, labelled, (x) => x.labels).map((x) => x.event.eventId)).toEqual([1]);
  });
});

describe("appliedFilters", () => {
  it("one token per field, in the bar's order, with the section's words", () => {
    const tokens = appliedFilters(
      f({ labels: new Set(["l1"]), types: new Set(["3pt-miss", "2pt-made"]), players: new Set(["id:7"]), periods: new Set([5, 4]), moment: "after_timeout" }),
      { player: (k) => (k === "id:7" ? "#7 Andersson" : k), label: (id) => (id === "l1" ? "PnR" : id) },
    );
    expect(tokens.map((t) => `${t.name} ${t.op} ${t.values.join(", ")}`)).toEqual([
      "Event is any of 2PT made, 3PT miss",
      "Player is #7 Andersson",
      "Quarter is any of Q4, OT1",
      "When is After timeouts",
      "Label is PnR",
    ]);
  });

  it("names a player by the name a name key carries when no words are given", () => {
    expect(appliedFilters(f({ players: new Set(["name:Ida Berg"]) }))[0].values).toEqual(["Ida Berg"]);
  });
});

describe("moments", () => {
  it("offers no Fast break moment: it is a Situation", () => {
    expect(MOMENT_OPTIONS.map((m) => m.value)).not.toContain("fast_break");
  });

  it("works a game's moments out from its plays alone", () => {
    const moments = momentsOfGame([ev(1, "2pt", 1, { qualifiers: ["fastbreak"] })]);
    expect(moments.get(1)?.has("fast_break")).toBe(true);
  });
});
