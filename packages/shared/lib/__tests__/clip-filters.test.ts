import { describe, expect, it } from "vitest";
import type { PlayByPlayEvent } from "../../types/match";
import {
  EMPTY_CLIP_FILTERS,
  EVENT_TYPE_OPTIONS,
  SHOT_TYPE_OPTIONS,
  SITUATION_OPTIONS,
  applyClipFilters,
  hasActiveFilters,
  matchesClipFilters,
  matchesLabelFilter,
  matchesShotType,
  matchesSingleType,
  matchesSituation,
  playersOf,
  teamsOf,
  toggleFilter,
} from "../clip-filters";

function ev(partial: Partial<PlayByPlayEvent> & { eventId: number }): PlayByPlayEvent {
  return {
    type: "2pt",
    subType: "jumpshot",
    period: 1,
    gameClockTime: "09:00",
    realWorldTime: "2026-10-04T13:00:00Z",
    isSuccessful: 1,
    qualifiers: [],
    ...partial,
  };
}

const made2 = ev({ eventId: 1, type: "2pt", subType: "layup", isSuccessful: 1, qualifiers: ["fastbreak", "pointsinthepaint"], eventTeam: { teamCode: "FRY", teamName: "Fryshuset", teamNumber: 1 }, player: { playerId: 1, pno: 4, firstName: "Pedro", familyName: "Lelo", teamNumber: 1 } });
const miss3 = ev({ eventId: 2, type: "3pt", subType: "jumpshot", isSuccessful: 0, eventTeam: { teamCode: "SOL", teamName: "Sollentuna", teamNumber: 2 }, player: { playerId: 2, pno: 7, firstName: "Finn", familyName: "Eriksson", teamNumber: 2 } });
const defReb = ev({ eventId: 3, type: "rebound", subType: "defensive", isSuccessful: 1, eventTeam: { teamCode: "FRY", teamName: "Fryshuset", teamNumber: 1 } });
const travel = ev({ eventId: 4, type: "turnover", subType: "travel", isSuccessful: 1 });
const shootingFoul = ev({ eventId: 5, type: "foul", subType: "personal", qualifiers: ["shooting"] });
const dunk = ev({ eventId: 6, type: "2pt", subType: "alleyoopdunk", isSuccessful: 1 });

describe("the matchers", () => {
  it("read made and missed shots, rebounds by side and plain types", () => {
    expect(matchesSingleType(made2, "2pt-made")).toBe(true);
    expect(matchesSingleType(made2, "2pt-miss")).toBe(false);
    expect(matchesSingleType(miss3, "3pt-miss")).toBe(true);
    expect(matchesSingleType(defReb, "rebound-def")).toBe(true);
    expect(matchesSingleType(defReb, "rebound-off")).toBe(false);
    expect(matchesSingleType(travel, "turnover")).toBe(true);
    expect(matchesSingleType(shootingFoul, "foul")).toBe(true);
  });

  it("group shot subtypes and situations the way the desktop picker does", () => {
    expect(matchesShotType(made2, "subtype:layup")).toBe(true);
    expect(matchesShotType(dunk, "subtype:dunk")).toBe(true);
    expect(matchesShotType(miss3, "subtype:jumpshot")).toBe(true);
    expect(matchesShotType(miss3, "subtype:layup")).toBe(false);
    expect(matchesSituation(made2, "qual:fastbreak")).toBe(true);
    expect(matchesSituation(made2, "qual:pointsinthepaint")).toBe(true);
    expect(matchesSituation(shootingFoul, "qual:shooting")).toBe(true);
    expect(matchesSituation(travel, "subtype:travel")).toBe(true);
    expect(matchesSituation(travel, "subtype:badpass")).toBe(false);
  });

  it("every option's value is accepted by its matcher without throwing", () => {
    for (const o of EVENT_TYPE_OPTIONS) expect(typeof matchesSingleType(made2, o.value)).toBe("boolean");
    for (const o of SHOT_TYPE_OPTIONS) expect(typeof matchesShotType(made2, o.value)).toBe("boolean");
    for (const o of SITUATION_OPTIONS) expect(typeof matchesSituation(made2, o.value)).toBe("boolean");
  });
});

describe("applyClipFilters", () => {
  const all = [made2, miss3, defReb, travel, shootingFoul, dunk].map((event) => ({ event, matchId: "m" }));

  it("lets everything through with no filters", () => {
    expect(hasActiveFilters(EMPTY_CLIP_FILTERS)).toBe(false);
    expect(applyClipFilters(all, EMPTY_CLIP_FILTERS)).toHaveLength(6);
  });

  it("is OR within a group and AND across groups", () => {
    const shots = { ...EMPTY_CLIP_FILTERS, types: new Set(["2pt-made", "3pt-miss"]) };
    expect(applyClipFilters(all, shots).map((x) => x.event.eventId)).toEqual([1, 2, 6]);
    const fryshusetShots = { ...shots, teams: new Set(["Fryshuset"]) };
    expect(applyClipFilters(all, fryshusetShots).map((x) => x.event.eventId)).toEqual([1]);
    const pedro = { ...EMPTY_CLIP_FILTERS, players: new Set(["Pedro Lelo"]) };
    expect(applyClipFilters(all, pedro).map((x) => x.event.eventId)).toEqual([1]);
    const dunks = { ...EMPTY_CLIP_FILTERS, shotTypes: new Set(["subtype:dunk"]) };
    expect(applyClipFilters(all, dunks).map((x) => x.event.eventId)).toEqual([6]);
    expect(matchesClipFilters(travel, { ...EMPTY_CLIP_FILTERS, situations: new Set(["subtype:travel"]) })).toBe(true);
  });

  it("lists the teams and players in order of first appearance", () => {
    expect(teamsOf(all.map((x) => x.event))).toEqual(["Fryshuset", "Sollentuna"]);
    expect(playersOf(all.map((x) => x.event))).toEqual(["Pedro Lelo", "Finn Eriksson"]);
  });

  it("toggles a value in and out of a group", () => {
    const on = toggleFilter(EMPTY_CLIP_FILTERS, "types", "steal");
    expect(on.types.has("steal")).toBe(true);
    expect(toggleFilter(on, "types", "steal").types.size).toBe(0);
    expect(on.shotTypes.size).toBe(0);
  });

  it("toggles a label even when the filters were built without the group", () => {
    const { labels: _l, ...noLabels } = EMPTY_CLIP_FILTERS;
    expect(toggleFilter(noLabels, "labels", "pnr").labels?.has("pnr")).toBe(true);
  });
});

describe("the label filter", () => {
  const all = [made2, miss3, defReb, travel].map((event) => ({ event, key: `m:${event.eventId}` }));
  const byKey = new Map<string, ReadonlySet<string>>([
    ["m:1", new Set(["pnr", "transition"])],
    ["m:2", new Set(["iso"])],
    ["m:4", new Set()],
  ]);
  const labelsOf = (x: { key: string }) => byKey.get(x.key);

  it("lets any chosen label through, and everything with none chosen", () => {
    expect(matchesLabelFilter(new Set(["iso"]), new Set(["iso", "pnr"]))).toBe(true);
    expect(matchesLabelFilter(new Set(["cut"]), new Set(["iso"]))).toBe(false);
    expect(matchesLabelFilter(undefined, new Set(["iso"]))).toBe(false);
    expect(matchesLabelFilter(undefined, undefined)).toBe(true);
    expect(matchesLabelFilter(new Set(), new Set())).toBe(true);
  });

  it("is OR within the labels and AND with the other groups", () => {
    const labels = { ...EMPTY_CLIP_FILTERS, labels: new Set(["pnr", "iso"]) };
    expect(hasActiveFilters(labels)).toBe(true);
    expect(applyClipFilters(all, labels, labelsOf).map((x) => x.event.eventId)).toEqual([1, 2]);
    const madeTwos = { ...labels, types: new Set(["2pt-made"]) };
    expect(applyClipFilters(all, madeTwos, labelsOf).map((x) => x.event.eventId)).toEqual([1]);
  });

  it("finds nothing by label when the labels aren't known", () => {
    expect(applyClipFilters(all, { ...EMPTY_CLIP_FILTERS, labels: new Set(["pnr"]) })).toEqual([]);
  });
});
