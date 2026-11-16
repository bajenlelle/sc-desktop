import { describe, expect, it } from "vitest";
import type { ClipFilters } from "../clip-filters";
import {
  applyPresetFilters,
  parsePresetFilters,
  presetFilters,
  presetLabelsGone,
  sameFilters,
  serialiseFilters,
} from "../filter-presets";

const F = (o: Partial<Record<keyof ClipFilters, string[]>>): ClipFilters => ({
  types: new Set(o.types), shotTypes: new Set(o.shotTypes), situations: new Set(o.situations),
  teams: new Set(o.teams), players: new Set(o.players), labels: new Set(o.labels),
});
const GUARD_TYPES = ["3pt-miss", "2pt-made", "3pt-made", "2pt-miss"];
const guard = F({ types: GUARD_TYPES });

describe("filter presets", () => {
  it("serialises a guard's offence with sorted arrays and the four preset groups, never teams or players", () => {
    const f = F({ types: GUARD_TYPES, teams: ["Fryshuset"], players: ["id:8"], labels: ["l1"] });
    expect(serialiseFilters(f)).toEqual({ v: 1, types: ["2pt-made", "2pt-miss", "3pt-made", "3pt-miss"], shotTypes: [], situations: [], labels: ["l1"] });
  });
  it("reads back what it wrote", () => {
    const f = F({ types: ["steal"], labels: ["l1"], situations: ["qual:fastbreak"], shotTypes: ["subtype:layup"] });
    const read = parsePresetFilters(JSON.parse(JSON.stringify(serialiseFilters(f))))!;
    expect(sameFilters(read, f)).toBe(true);
    expect(read.teams.size).toBe(0);
    expect(read.players.size).toBe(0);
  });
  it("ignores the teams and players a row written before presets dropped them may carry", () => {
    const p = parsePresetFilters({ v: 1, types: ["2pt-made"], teams: ["Fryshuset"], players: ["id:8", "name:Ada Lind"], labels: [] })!;
    expect([...p.types]).toEqual(["2pt-made"]);
    expect(p.teams.size).toBe(0);
    expect(p.players.size).toBe(0);
  });
  it("drops what it doesn't know and refuses what isn't a v1 preset", () => {
    const p = parsePresetFilters({ v: 1, types: ["2pt-made", "bogus", 3], labels: ["l1", 4, ""], extra: true })!;
    expect([...p.types]).toEqual(["2pt-made"]);
    expect([...(p.labels ?? [])]).toEqual(["l1"]);
    expect(p.situations.size).toBe(0);
    expect(parsePresetFilters([])).toBeNull();
    expect(parsePresetFilters({ v: 2, types: [] })).toBeNull();
    expect(parsePresetFilters(null)).toBeNull();
  });
  it("compares the four groups regardless of order, a missing label group as empty, whatever the team or players", () => {
    const { labels: _l, ...noLabels } = guard;
    expect(sameFilters(noLabels, guard)).toBe(true);
    expect(sameFilters(guard, F({ types: GUARD_TYPES, teams: ["AIK"], players: ["id:8"] }))).toBe(true);
    expect(sameFilters(guard, F({ types: ["2pt-made"] }))).toBe(false);
    expect(sameFilters(guard, F({ types: GUARD_TYPES, labels: ["l1"] }))).toBe(false);
  });
  it("keeps the four groups of the filters on screen as a preset", () => {
    const p = presetFilters(F({ types: ["steal"], shotTypes: ["subtype:layup"], situations: ["qual:fastbreak"], labels: ["l1"], teams: ["AIK"], players: ["id:8"] }));
    expect(p).toEqual(F({ types: ["steal"], shotTypes: ["subtype:layup"], situations: ["qual:fastbreak"], labels: ["l1"] }));
  });
  it("applies a preset over the filters on screen, leaving the team and players as they are", () => {
    const current = F({ types: ["turnover"], labels: ["l2"], teams: ["AIK"], players: ["id:8", "name:Ada Lind"] });
    const preset = F({ types: ["2pt-made"], shotTypes: ["subtype:layup"], labels: ["l1", "gone"] });
    const applied = applyPresetFilters(current, preset, ["l1", "l2"]);
    expect(applied).toEqual(F({ types: ["2pt-made"], shotTypes: ["subtype:layup"], labels: ["l1"], teams: ["AIK"], players: ["id:8", "name:Ada Lind"] }));
    expect(applied.teams).toBe(current.teams);
    expect(applied.players).toBe(current.players);
  });
  it("says when none of a preset's labels is there any more", () => {
    expect(presetLabelsGone(F({ types: ["steal"], labels: ["l1"] }), ["l2"])).toBe(true);
    expect(presetLabelsGone(F({ types: ["steal"], labels: ["l1", "gone"] }), ["l1"])).toBe(false);
    expect(presetLabelsGone(F({ types: ["steal"] }), [])).toBe(false);
  });
});
