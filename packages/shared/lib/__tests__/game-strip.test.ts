import { describe, expect, it } from "vitest";
import { placeRunLabels, placeTimeoutMarks, stripShowsPlays, stripTargetAt } from "../game-strip";

const NO_LEGEND = { x: 0, home: 0, away: 0 };

describe("stripShowsPlays", () => {
  it("shows no play marks for the whole game without a filter", () => {
    expect(stripShowsPlays({ filtered: false, zoomed: false })).toBe(false);
  });

  it("shows them when a filter is on, or zoomed into a quarter", () => {
    expect(stripShowsPlays({ filtered: true, zoomed: false })).toBe(true);
    expect(stripShowsPlays({ filtered: false, zoomed: true })).toBe(true);
    expect(stripShowsPlays({ filtered: true, zoomed: true })).toBe(true);
  });
});

describe("placeRunLabels", () => {
  it("prints a run's score over the middle of its stretch, on the edge row", () => {
    const labels = placeRunLabels([{ id: 1, team: 1, points: 12, x0: 200, x1: 260 }], { width: 600, legend: NO_LEGEND });
    expect(labels).toEqual([{ id: 1, x: 230, row: 0 }]);
  });

  it("keeps a score inside the strip when its stretch touches an end", () => {
    const labels = placeRunLabels(
      [
        { id: 1, team: 1, points: 9, x0: -40, x1: 6 },
        { id: 2, team: 2, points: 9, x0: 590, x1: 640 },
      ],
      { width: 600, legend: NO_LEGEND, labelWidth: 34 },
    );
    expect(labels).toEqual([
      { id: 1, x: 17, row: 0 },
      { id: 2, x: 583, row: 0 },
    ]);
  });

  it("moves a score a row in where its side's team name stands, and leaves the other side alone", () => {
    const legend = { x: 20, home: 130, away: 150 };
    const labels = placeRunLabels(
      [
        { id: 1, team: 1, points: 10, x0: 60, x1: 100 },
        { id: 2, team: 2, points: 10, x0: 160, x1: 200 },
        { id: 3, team: 1, points: 10, x0: 300, x1: 340 },
      ],
      { width: 600, legend },
    );
    expect(labels).toEqual([
      { id: 1, x: 80, row: 1 },
      { id: 2, x: 180, row: 1 },
      { id: 3, x: 320, row: 0 },
    ]);
  });

  it("of two scores that would stand on each other on one side, keeps the larger run's", () => {
    const labels = placeRunLabels(
      [
        { id: 1, team: 1, points: 8, x0: 200, x1: 220 },
        { id: 2, team: 1, points: 15, x0: 224, x1: 244 },
        { id: 3, team: 2, points: 8, x0: 226, x1: 246 },
      ],
      { width: 600, legend: NO_LEGEND, labelWidth: 34 },
    );
    expect(labels).toEqual([
      { id: 2, x: 234, row: 0 },
      { id: 3, x: 236, row: 0 },
    ]);
  });

  it("prints nothing for a run that is off the strip", () => {
    expect(placeRunLabels([{ id: 1, team: 1, points: 9, x0: -80, x1: -20 }], { width: 600, legend: NO_LEGEND })).toEqual([]);
    expect(placeRunLabels([{ id: 1, team: 1, points: 9, x0: 620, x1: 700 }], { width: 600, legend: NO_LEGEND })).toEqual([]);
  });
});

describe("placeTimeoutMarks", () => {
  it("puts a timeout on the edge row, and a row in where its side's team name stands", () => {
    const legend = { x: 0, home: 120, away: 140 };
    const placed = placeTimeoutMarks(
      [
        { id: 1, team: 1, x: 60 },
        { id: 2, team: 2, x: 130 },
        { id: 3, team: 1, x: 130 },
        { id: 4, team: 0, x: 60 },
      ],
      { legend },
    );
    expect(placed).toEqual([
      { id: 1, row: 1 },
      { id: 2, row: 1 },
      { id: 3, row: 0 },
      { id: 4, row: 0 },
    ]);
  });
});

describe("stripTargetAt", () => {
  const on = {
    timeouts: [{ id: 7, x: 300 }],
    runs: [{ id: 3, x0: 200, x1: 310 }],
    play: { key: "p1", distance: 2 },
    playsShown: true,
  };

  it("on the graph, a timeout comes before the run it stands in", () => {
    expect(stripTargetAt({ x: 304, zone: "chart" }, on)).toEqual({ kind: "timeout", id: 7 });
    expect(stripTargetAt({ x: 250, zone: "chart" }, on)).toEqual({ kind: "run", id: 3 });
    expect(stripTargetAt({ x: 400, zone: "chart" }, on)).toEqual({ kind: "time" });
  });

  it("takes the nearest of two timeouts", () => {
    const two = { ...on, timeouts: [{ id: 7, x: 300 }, { id: 8, x: 308 }] };
    expect(stripTargetAt({ x: 305, zone: "chart" }, two)).toEqual({ kind: "timeout", id: 8 });
  });

  it("in the lane under the graph, means the play mark it is on when marks are shown", () => {
    expect(stripTargetAt({ x: 250, zone: "lane" }, on)).toEqual({ kind: "play", key: "p1" });
    expect(stripTargetAt({ x: 250, zone: "lane" }, { ...on, play: { key: "p1", distance: 9 } })).toEqual({ kind: "time" });
    expect(stripTargetAt({ x: 250, zone: "lane" }, { ...on, play: null })).toEqual({ kind: "time" });
  });

  it("never means a play while no marks are shown: a click goes to the second under the pointer", () => {
    expect(stripTargetAt({ x: 250, zone: "lane" }, { ...on, playsShown: false })).toEqual({ kind: "time" });
    expect(stripTargetAt({ x: 250, zone: "chart" }, { ...on, playsShown: false, runs: [], timeouts: [] })).toEqual({ kind: "time" });
  });

  it("on the quarter bands, is only ever a time", () => {
    expect(stripTargetAt({ x: 304, zone: "band" }, on)).toEqual({ kind: "time" });
  });
});
