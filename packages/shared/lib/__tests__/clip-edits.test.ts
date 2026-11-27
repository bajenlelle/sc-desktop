import { describe, expect, it } from "vitest";
import { clampSlowLength, slowAtPlayhead, slowRoom, slowStartingAt, type SlowSection } from "../clip-timeline";
import { withDrawing, type ClipDrawing } from "../clip-drawing";

const s = (id: string, t: number, length: number): SlowSection => ({ id, t, length, rate: 0.5 });
const id = () => "new";

describe("slow motion at the playhead", () => {
  it("opens the section under the playhead", () => {
    const a = s("a", 12, 2);
    expect(slowAtPlayhead([a], 13, 10, 20, id)).toEqual({ open: a, seekTo: null, created: false });
  });
  it("opens a section starting just after the playhead, at its start", () => {
    const a = s("a", 12, 2);
    expect(slowAtPlayhead([a], 11.7, 10, 20, id)).toEqual({ open: a, seekTo: 12, created: false });
  });
  it("starts a new half-speed section at the playhead, as long as the room allows", () => {
    expect(slowAtPlayhead([s("a", 16, 1)], 15, 10, 20, id)).toEqual({ open: { id: "new", t: 15, length: 1, rate: 0.5 }, seekTo: null, created: true });
    expect(slowAtPlayhead([], 12, 10, 20, id)?.open).toEqual({ id: "new", t: 12, length: 2, rate: 0.5 });
  });
  it("opens the next section when there is too little room before it", () => {
    const a = s("a", 15.2, 1);
    expect(slowAtPlayhead([a], 14.9, 10, 20, id)).toEqual({ open: a, seekTo: 15.2, created: false });
    // A playhead before the clip starts the section at the clip's start, 0.3 s short of the next.
    const b = s("b", 10.3, 1);
    expect(slowAtPlayhead([b], 9, 10, 20, id)).toEqual({ open: b, seekTo: null, created: false });
  });
  it("keeps a new section inside the clip", () => {
    expect(slowAtPlayhead([], 19.9, 10, 20, id)?.open).toEqual({ id: "new", t: 19.5, length: 0.5, rate: 0.5 });
  });
});

describe("a section's room", () => {
  const a = s("a", 11, 1);
  const b = s("b", 14, 1);
  const c = s("c", 17, 1);
  it("runs from the end of the one before to the start of the next", () => {
    expect(slowRoom([a, b, c], b, 10, 20)).toEqual({ min: 12, max: 17 });
    expect(slowRoom([a, b, c], a, 10, 20)).toEqual({ min: 10, max: 14 });
    expect(slowRoom([a, b, c], c, 10, 20)).toEqual({ min: 15, max: 20 });
  });
  it("keeps a length between the shortest, the longest and the next section", () => {
    expect(clampSlowLength([a, b, c], b, 9, 10, 20)).toBe(3);
    expect(clampSlowLength([b], b, 9, 10, 30)).toBe(6);
    expect(clampSlowLength([b], b, 0.1, 10, 30)).toBe(0.5);
  });
  it("moves a section to the playhead within its neighbours, shortened to fit", () => {
    expect(slowStartingAt([a, b, c], b, 16.8, 10, 20)).toEqual({ ...b, t: 16.5, length: 0.5 });
    expect(slowStartingAt([a, b, c], b, 11, 10, 20)).toEqual({ ...b, t: 12 });
  });
});

describe("a drawing put in place", () => {
  const d = (id: string, t: number, shapes = 1): ClipDrawing => ({ id, t, hold: 4, shapes: Array.from({ length: shapes }, (_, i) => ({ kind: "text", id: `${id}${i}`, x: 0.5, y: 0.5, text: "x", color: "yellow" }) as never) });
  it("replaces its copy and keeps time order", () => {
    expect(withDrawing([d("a", 5), d("b", 2)], d("a", 1)).map((x) => x.id)).toEqual(["a", "b"]);
  });
  it("drops a drawing with no shapes", () => {
    expect(withDrawing([d("a", 5), d("b", 2)], d("a", 5, 0)).map((x) => x.id)).toEqual(["b"]);
    expect(withDrawing(undefined, d("a", 5))).toHaveLength(1);
  });
});
