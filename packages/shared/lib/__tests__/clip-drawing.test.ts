import { describe, expect, it } from "vitest";
import { cropWidthFrac } from "../crop-path";
import {
  arrowHead,
  arrowPolyline,
  clampShape,
  drawingMetrics,
  drawingShapeKey,
  hitTest,
  parseDrawingShape,
  pointsToPath,
  screenBar,
  shaftPolyline,
  spotlightEllipse,
  SPOTLIGHT_DEFAULT_R,
  toCropFrame,
  zigzag,
  type DrawingPoint,
  type DrawingShape,
} from "../clip-drawing";

const F = { width: 1280, height: 720 };
const p = (x: number, y: number): DrawingPoint => ({ x, y });
type Arrow = Extract<DrawingShape, { kind: "arrow" }>;
const arrow = (kind: Arrow["arrow"], extra: Partial<Arrow> = {}): Arrow => ({
  kind: "arrow",
  id: kind,
  arrow: kind,
  from: p(0.1, 0.5),
  to: p(0.6, 0.5),
  ...extra,
});
const cut = arrow("cut");
const screen = arrow("screen");
const dribble = arrow("dribble");
const spot: DrawingShape = { kind: "spotlight", id: "spot", at: p(0.5, 0.5), r: SPOTLIGHT_DEFAULT_R };

function expectNear(actual: DrawingPoint, x: number, y: number) {
  expect(actual.x).toBeCloseTo(x);
  expect(actual.y).toBeCloseTo(y);
}

describe("drawingMetrics", () => {
  it("scales the metrics with the frame height and floors the stroke at 2 px", () => {
    expect(drawingMetrics(F).stroke).toBeCloseTo(5.76);
    expect(drawingMetrics(F).headLength).toBeCloseTo(18.432);
    expect(drawingMetrics({ width: 390, height: 219 }).stroke).toBe(2);
  });
});

describe("arrows", () => {
  it("a straight arrow is its two end points in pixels", () => {
    const pts = arrowPolyline(cut, F);
    expect(pts).toHaveLength(2);
    expectNear(pts[0], 128, 360);
    expectNear(pts[1], 768, 360);
  });

  it("a bent arrow bows to the left normal by bend × chord", () => {
    const pts = arrowPolyline({ ...cut, bend: 0.5 }, F);
    expect(pts).toHaveLength(25);
    expectNear(pts[12], 448, 200);
    expectNear(pts[0], 128, 360);
    expectNear(pts[24], 768, 360);
  });

  it("the shaft stops at the head's base", () => {
    expect(shaftPolyline(arrowPolyline(cut, F), drawingMetrics(F), true).at(-1)!.x).toBeCloseTo(749.568);
    expect(shaftPolyline(arrowPolyline(screen, F), drawingMetrics(F), false).at(-1)!.x).toBeCloseTo(768);
  });

  it("the head points along the last segment, and a screen has none", () => {
    const h = arrowHead(arrowPolyline(cut, F), drawingMetrics(F))!;
    expectNear(h.tip, 768, 360);
    expect(h.base.x).toBeCloseTo(749.568);
    expect(h.left.y).toBeCloseTo(350.784);
    expect(h.right.y).toBeCloseTo(369.216);
    expect(arrowHead(arrowPolyline(screen, F), drawingMetrics(F), "screen")).toBeNull();
  });

  it("the screen bar stands across the end, four strokes long", () => {
    const [a, b] = screenBar(arrowPolyline(screen, F), drawingMetrics(F));
    expectNear(a, 768, 348.48);
    expectNear(b, 768, 371.52);
  });

  it("a dribble zigzags within its amplitude and ends straight", () => {
    const m = drawingMetrics(F);
    const z = zigzag(shaftPolyline(arrowPolyline(dribble, F), m, true), m);
    expectNear(z[0], 128, 360);
    expect(Math.max(...z.map((q) => Math.abs(q.y - 360)))).toBeCloseTo(6.912);
    expect(z.at(-1)!.y).toBeCloseTo(360);
    expect(z.at(-1)!.x).toBeCloseTo(749.568);
  });

  it("formats a path with at most two decimals", () => {
    expect(pointsToPath([p(1, 2), p(3.456, 4)])).toBe("M1 2 L3.46 4");
  });
});

describe("spotlightEllipse", () => {
  it("is an upright ellipse sized by the frame height", () => {
    const e = spotlightEllipse(spot as Extract<DrawingShape, { kind: "spotlight" }>, F);
    expect(e.cx).toBeCloseTo(640);
    expect(e.cy).toBeCloseTo(360);
    expect(e.rx).toBeCloseTo(48.96);
    expect(e.ry).toBeCloseTo(61.2);
  });
});

describe("clampShape", () => {
  it("keeps a shape inside the frame and its limits", () => {
    expect(clampShape({ kind: "spotlight", id: "s", at: p(-0.1, 1.2), r: 0.5 })).toEqual({ kind: "spotlight", id: "s", at: p(0, 1), r: 0.3 });
    expect(clampShape({ kind: "spotlight", id: "s", at: p(0.5, 0.5), r: 0.01 })).toMatchObject({ r: 0.04 });
    expect(clampShape({ ...cut, bend: 2 })).toMatchObject({ bend: 1 });
    expect(clampShape({ ...cut, to: p(1.5, -1) })).toMatchObject({ to: p(1, 0) });
    expect(clampShape({ kind: "text", id: "t", at: p(0.5, 0.5), text: ` ${"a".repeat(60)} ` })).toMatchObject({ text: "a".repeat(40) });
  });
});

describe("toCropFrame", () => {
  it("maps into the crop window, clamped at the frame's edge like the export", () => {
    const cw = cropWidthFrac(16, 9);
    expectNear(toCropFrame(p(0.5, 0.3), 0.5), 0.5, 0.3);
    expect(toCropFrame(p(0.5 - cw / 2, 0.3), 0.5).x).toBeCloseTo(0);
    expect(toCropFrame(p(0.05, 0.3), 0).x).toBeCloseTo(0.05 / cw);
    expect(toCropFrame(p(1, 0.3), 1).x).toBeCloseTo(1);
  });
});

describe("hitTest", () => {
  it("returns the topmost shape near the point", () => {
    expect(hitTest([spot, cut], p(0.3, 0.505), F, 0)?.id).toBe(cut.id);
    expect(hitTest([spot, cut], p(0.5, 0.5), F, 0)?.id).toBe(cut.id);
    expect(hitTest([cut, spot], p(0.5, 0.5), F, 0)?.id).toBe(spot.id);
    expect(hitTest([spot, cut], p(0.9, 0.9), F, 0)).toBeNull();
  });

  it("can leave spotlights out, so an arrow or a label starts on the spotlighted player", () => {
    expect(hitTest([spot], p(0.5, 0.5), F, 0, { spotlights: false })).toBeNull();
    expect(hitTest([cut, spot], p(0.5, 0.5), F, 0, { spotlights: false })?.id).toBe(cut.id);
    expect(hitTest([cut, spot], p(0.5, 0.5), F, 0)?.id).toBe(spot.id);
  });

  it("finds a label by its pill", () => {
    const label: DrawingShape = { kind: "text", id: "t", at: p(0.2, 0.2), text: "Help side" };
    expect(hitTest([label], p(0.2, 0.2), F, 0)?.id).toBe("t");
    expect(hitTest([label], p(0.2, 0.4), F, 0)).toBeNull();
  });
});

describe("drawingShapeKey", () => {
  it("names a shape by its fields in a fixed order, at three decimals, whatever order its keys come in", () => {
    const a: DrawingShape = { kind: "arrow", id: "x", arrow: "pass", from: p(0.1, 0.5), to: p(0.6, 0.5), bend: 0.25, color: "red" };
    const reordered = JSON.parse('{"to":{"y":0.5,"x":0.6},"color":"red","bend":0.25,"from":{"y":0.5,"x":0.1},"arrow":"pass","id":"y","kind":"arrow"}');
    expect(drawingShapeKey(a)).toBe("a:pass:0.100:0.500:0.600:0.500:0.250:red");
    expect(drawingShapeKey(reordered)).toBe(drawingShapeKey(a));
    expect(drawingShapeKey({ kind: "spotlight", id: "s", at: p(0.5, 0.25), r: 0.085 })).toBe("s:0.500:0.250:0.085");
    expect(drawingShapeKey({ kind: "text", id: "t", at: p(0.2, 0.2), text: "Help side" })).toBe("t:0.200:0.200::Help side");
  });
});

describe("parseDrawingShape", () => {
  it("reads each kind of shape and gives it the id it is handed", () => {
    expect(parseDrawingShape({ kind: "spotlight", at: { x: 0.5, y: 0.4 }, r: 0.1 }, "s1")).toEqual({ kind: "spotlight", id: "s1", at: p(0.5, 0.4), r: 0.1 });
    expect(parseDrawingShape({ kind: "arrow", arrow: "screen", from: { x: 0.1, y: 0.2 }, to: { x: 0.3, y: 0.4 }, bend: -0.5, color: "blue" }, "s2")).toEqual({
      kind: "arrow",
      id: "s2",
      arrow: "screen",
      from: p(0.1, 0.2),
      to: p(0.3, 0.4),
      bend: -0.5,
      color: "blue",
    });
    expect(parseDrawingShape({ kind: "text", at: { x: 0.2, y: 0.8 }, text: " Help side ", color: "white" }, "s3")).toEqual({ kind: "text", id: "s3", at: p(0.2, 0.8), text: "Help side", color: "white" });
  });

  it("keeps a shape inside the frame and its limits, like the editor", () => {
    expect(parseDrawingShape({ kind: "spotlight", at: { x: -1, y: 2 }, r: 9 }, "s")).toEqual({ kind: "spotlight", id: "s", at: p(0, 1), r: 0.3 });
    expect(parseDrawingShape({ kind: "arrow", arrow: "cut", from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, bend: 4 }, "s")).toMatchObject({ bend: 1 });
    expect((parseDrawingShape({ kind: "text", at: { x: 0.5, y: 0.5 }, text: "x".repeat(60) }, "s") as { text: string }).text).toHaveLength(40);
  });

  it("drops what it can't draw and leaves out a colour it doesn't know", () => {
    expect(parseDrawingShape(null, "s")).toBeNull();
    expect(parseDrawingShape("spotlight", "s")).toBeNull();
    expect(parseDrawingShape({ kind: "circle", at: { x: 0.5, y: 0.5 }, r: 0.1 }, "s")).toBeNull();
    expect(parseDrawingShape({ kind: "spotlight", at: { x: Number.NaN, y: 0.5 }, r: 0.1 }, "s")).toBeNull();
    expect(parseDrawingShape({ kind: "spotlight", at: { x: 0.5, y: 0.5 } }, "s")).toBeNull();
    expect(parseDrawingShape({ kind: "arrow", arrow: "lob", from: { x: 0, y: 0 }, to: { x: 1, y: 1 } }, "s")).toBeNull();
    expect(parseDrawingShape({ kind: "arrow", arrow: "cut", from: { x: 0, y: 0 }, to: "1,1" }, "s")).toBeNull();
    expect(parseDrawingShape({ kind: "arrow", arrow: "cut", from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, bend: "lots" }, "s")).toBeNull();
    expect(parseDrawingShape({ kind: "text", at: { x: 0.5, y: 0.5 }, text: "   " }, "s")).toBeNull();
    expect(parseDrawingShape({ kind: "text", at: { x: 0.5, y: 0.5 }, text: 7 }, "s")).toBeNull();
    expect(parseDrawingShape({ kind: "arrow", arrow: "cut", from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, color: "pink" }, "s")).toEqual({
      kind: "arrow",
      id: "s",
      arrow: "cut",
      from: p(0, 0),
      to: p(1, 1),
    });
  });
});
