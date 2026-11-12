import { describe, expect, it } from "vitest";
import type { ClipFilters } from "../clip-filters";
import {
  fitPresetToGames,
  gameToPreset,
  parsePresetFilters,
  presetToGame,
  sameFilters,
  serialiseFilters,
  type PresetGame,
} from "../filter-presets";

const F = (o: Partial<Record<keyof ClipFilters, string[]>>): ClipFilters => ({
  types: new Set(o.types), shotTypes: new Set(o.shotTypes), situations: new Set(o.situations),
  teams: new Set(o.teams), players: new Set(o.players), labels: new Set(o.labels),
});
const guard = F({ types: ["3pt-miss", "2pt-made", "3pt-made", "2pt-miss"] });

describe("filter presets", () => {
  it("serialises a guard's offence with sorted arrays and every group", () => {
    expect(serialiseFilters(guard)).toEqual({ v: 1, types: ["2pt-made", "2pt-miss", "3pt-made", "3pt-miss"], shotTypes: [], situations: [], teams: [], players: [], labels: [] });
  });
  it("reads back what it wrote", () => {
    const f = F({ types: ["steal"], players: ["id:8", "name:Ada Lind"], teams: ["Fryshuset"], labels: ["l1"], situations: ["qual:fastbreak"], shotTypes: ["subtype:layup"] });
    expect(sameFilters(parsePresetFilters(JSON.parse(JSON.stringify(serialiseFilters(f))))!, f)).toBe(true);
  });
  it("drops what it doesn't know and refuses what isn't a v1 preset", () => {
    const p = parsePresetFilters({ v: 1, types: ["2pt-made", "bogus", 3], players: ["id:8", "name:Ada Lind", "8"], extra: true })!;
    expect([...p.types]).toEqual(["2pt-made"]);
    expect([...p.players]).toEqual(["id:8", "name:Ada Lind"]);
    expect(p.labels?.size).toBe(0);
    expect(parsePresetFilters([])).toBeNull();
    expect(parsePresetFilters({ v: 2, types: [] })).toBeNull();
    expect(parsePresetFilters(null)).toBeNull();
  });
  it("compares filters regardless of order, a missing label group as empty", () => {
    const { labels: _l, ...noLabels } = guard;
    expect(sameFilters(noLabels, guard)).toBe(true);
    expect(sameFilters(guard, F({ types: ["2pt-made"] }))).toBe(false);
  });
  it("fits a preset to the games on screen", () => {
    const p = F({ types: ["2pt-made"], teams: ["Fryshuset", "AIK"], players: ["id:8", "id:99"], labels: ["l1", "gone"] });
    const fit = fitPresetToGames(p, { teams: ["Fryshuset"], players: ["id:8"], labels: ["l1"] });
    expect(sameFilters(fit, F({ types: ["2pt-made"], teams: ["Fryshuset"], players: ["id:8"], labels: ["l1"] }))).toBe(true);
  });
  const g: PresetGame = { home: "Fryshuset", away: "Sollentuna", people: [{ id: 8, name: "Finn Eriksson" }, { id: 3, name: "Ada Lind" }], labels: ["l1"] };
  it("reads a preset in the game view's terms", () => {
    const { clip, team } = presetToGame(F({ players: ["id:8", "name:Ada Lind", "id:99"], teams: ["fryshuset"], labels: ["l1", "gone"] }), g);
    expect([...clip.players].sort()).toEqual(["Ada Lind", "Finn Eriksson"]);
    expect(clip.teams.size).toBe(0);
    expect([...(clip.labels ?? [])]).toEqual(["l1"]);
    expect(team).toBe(1);
    expect(presetToGame(F({ teams: ["Fryshuset", "Sollentuna"] }), g).team).toBe(0);
  });
  it("writes the game view's filters as a preset", () => {
    const p = gameToPreset(F({ players: ["Finn Eriksson", "Nobody Known"] }), 2, g);
    expect([...p.players].sort()).toEqual(["id:8", "name:Nobody Known"]);
    expect([...p.teams]).toEqual(["Sollentuna"]);
  });
});
