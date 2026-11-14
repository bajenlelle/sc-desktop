import { describe, expect, it } from "vitest";
import { placePeakLabel, placeRunLabels, placeTimeoutMarks, runsOnStrip, stripShowsPlays, stripTargetAt } from "../game-strip";

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

describe("runsOnStrip", () => {
  const run = (id: number, x0: number, x1: number) => ({ id, team: 1 as const, points: 9, x0, x1 });

  it("leaves out a run that lies in another quarter than the one that has the strip", () => {
    // Zoomed into a quarter, the scale parks what is before it at the left edge and what is after it at the right.
    expect(runsOnStrip([run(1, 0, 0), run(2, 600, 600)], 600)).toEqual([]);
  });

  it("keeps a run that reaches into the strip from either side", () => {
    expect(runsOnStrip([run(1, 0, 44), run(2, 560, 600)], 600)).toEqual([run(1, 0, 44), run(2, 560, 600)]);
  });

  it("gives a run too short to see a width that can be seen and pointed at", () => {
    expect(runsOnStrip([run(1, 300, 301)], 600)).toEqual([run(1, 300, 304)]);
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

  it("goes a row in where a figure of its side stands on the edge row: a run's score, the largest lead", () => {
    // A timeout called to stop a run stands right at the run's score.
    const words = [
      { team: 1 as const, x: 300, width: 34, row: 0 as const },
      { team: 2 as const, x: 400, width: 28, row: 0 as const },
    ];
    const placed = placeTimeoutMarks(
      [
        { id: 1, team: 1, x: 312 },
        { id: 2, team: 2, x: 312 },
        { id: 3, team: 2, x: 410 },
        { id: 4, team: 1, x: 330 },
      ],
      { legend: NO_LEGEND, words },
    );
    expect(placed).toEqual([
      { id: 1, row: 1 },
      { id: 2, row: 0 },
      { id: 3, row: 1 },
      { id: 4, row: 0 },
    ]);
  });

  it("stays on the edge row beside a figure that is itself a row in", () => {
    const words = [{ team: 1 as const, x: 300, width: 34, row: 1 as const }];
    expect(placeTimeoutMarks([{ id: 1, team: 1, x: 300 }], { legend: NO_LEGEND, words })).toEqual([{ id: 1, row: 0 }]);
  });

  it("of two timeouts of one side that would stand on each other, puts the later a row in", () => {
    const placed = placeTimeoutMarks(
      [
        { id: 1, team: 1, x: 300 },
        { id: 2, team: 1, x: 306 },
        { id: 3, team: 2, x: 306 },
      ],
      { legend: NO_LEGEND },
    );
    expect(placed).toEqual([
      { id: 1, row: 0 },
      { id: 2, row: 1 },
      { id: 3, row: 0 },
    ]);
  });
});

describe("placePeakLabel", () => {
  it("prints the largest lead over its peak, on the first row, when nothing of its side stands there", () => {
    expect(placePeakLabel(300, { width: 600, marks: [] })).toEqual({ x: 300, row: 0 });
    expect(placePeakLabel(300, { width: 600, marks: [{ x: 100, row: 0 }, { x: 340, row: 0 }] })).toEqual({ x: 300, row: 0 });
  });

  it("keeps it inside the strip", () => {
    expect(placePeakLabel(4, { width: 600, marks: [] })).toEqual({ x: 14, row: 0 });
    expect(placePeakLabel(598, { width: 600, marks: [] })).toEqual({ x: 586, row: 0 });
  });

  it("goes a row further in, under a timeout's mark on the edge over the peak", () => {
    // Still over the peak, where the side's area is tallest: beside the mark the line would run through it.
    expect(placePeakLabel(304, { width: 600, marks: [{ x: 300, row: 0 }] })).toEqual({ x: 304, row: 1 });
    expect(placePeakLabel(300, { width: 600, marks: [{ x: 320, row: 0 }] })).toEqual({ x: 300, row: 1 });
  });

  it("goes a row in under a run's score on the edge too, which is wider than a mark", () => {
    // The largest lead is often reached at the end of a run, so the two figures meet often.
    expect(placePeakLabel(300, { width: 600, marks: [{ x: 328, row: 0, width: 34 }] })).toEqual({ x: 300, row: 1 });
    expect(placePeakLabel(300, { width: 600, marks: [{ x: 328, row: 0 }] })).toEqual({ x: 300, row: 0 });
    expect(placePeakLabel(300, { width: 600, marks: [{ x: 340, row: 0, width: 34 }] })).toEqual({ x: 300, row: 0 });
  });

  it("is not printed where the row under the edge is taken as well: the line under the track names the largest lead too", () => {
    // The figure on the first row is a little in from the edge, so something a row in is in its way there as well.
    expect(placePeakLabel(300, { width: 600, marks: [{ x: 300, row: 1 }] })).toBeNull();
    expect(placePeakLabel(300, { width: 600, marks: [{ x: 310, row: 0, width: 34 }, { x: 296, row: 1 }] })).toBeNull();
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
