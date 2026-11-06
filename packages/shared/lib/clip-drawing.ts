/**
 * A coach's drawing on one frame of a clip, and the geometry every surface
 * draws it with: the editor's and the players' SVG, the phone's
 * react-native-svg and the export's canvas take their points and sizes from
 * here, so all of them draw the same pixels. Points are fractions of the
 * 16:9 frame (x of its width, y of its height); sizes are fractions of the
 * frame's height, so a 720, 1080 or 219 pixel frame looks the same.
 */
import { cropWidthFrac } from "./crop-path";

export type DrawingPoint = { x: number; y: number };
export type ArrowKind = "cut" | "pass" | "screen" | "dribble";
export type DrawingColor = "yellow" | "white" | "red" | "blue";

export type DrawingShape =
  /** Dims the frame around a soft bright hole; `r` is the radius as a fraction of the frame's height (an upright ellipse, rx = 0.8 ry). */
  | { kind: "spotlight"; id: string; at: DrawingPoint; r: number }
  /** `bend` in [-1, 1] moves the curve's control point off the chord's middle along its left normal, as a fraction of the chord; 0 or absent is straight. */
  | { kind: "arrow"; id: string; arrow: ArrowKind; from: DrawingPoint; to: DrawingPoint; bend?: number; color?: DrawingColor }
  /** A one-line label centred on `at`. */
  | { kind: "text"; id: string; at: DrawingPoint; text: string; color?: DrawingColor };

/** A drawing freezes one frame of the clip: `t` is that frame in the source video (absolute seconds, like crop keyframes). */
export interface ClipDrawing {
  id: string;
  t: number;
  /** Seconds the picture stands still. */
  hold: number;
  shapes: DrawingShape[];
}

/** Bumped whenever drawings change how they look, so cached renders (send-to-phone links) are redone. */
export const DRAWING_RENDER_VERSION = 1;
export const HOLD_DEFAULT = 4;
export const HOLD_MIN = 1;
export const HOLD_MAX = 10;
export const SPOTLIGHT_DEFAULT_R = 0.085;
export const SPOTLIGHT_MIN_R = 0.04;
export const SPOTLIGHT_MAX_R = 0.3;
/** rx = SPOTLIGHT_ASPECT × ry: players are taller than wide. */
export const SPOTLIGHT_ASPECT = 0.8;
/** The hole's edge fades from this fraction of the radius out to the radius. */
export const SPOTLIGHT_SOFT_FROM = 0.8;
export const SPOTLIGHT_DIM = "rgba(0,0,0,0.55)";
export const DRAWING_HALO = "rgba(0,0,0,0.45)";
export const LABEL_BACKGROUND = "rgba(0,0,0,0.6)";
export const LABEL_COLOR = "#ffffff";
export const LABEL_MAX_CHARS = 40;
/** A label's pill in ems of its font, like the note's. */
export const LABEL_EM = { padX: 0.5, padY: 0.3, radius: 0.35, lineHeight: 1.2 } as const;
export const DRAWING_COLORS: Record<DrawingColor, string> = {
  yellow: "#FFD60A",
  white: "#FFFFFF",
  red: "#FF453A",
  blue: "#0A84FF",
};
export const DEFAULT_DRAWING_COLOR: DrawingColor = "yellow";
/** A bent arrow is drawn as this many straight segments. */
export const ARROW_SEGMENTS = 24;

/** Sizes in pixels for one frame. */
export interface DrawingMetrics {
  stroke: number;
  /** Width of the dark line under every stroke. */
  halo: number;
  headLength: number;
  headHalfWidth: number;
  dash: [number, number];
  bar: number;
  zigzagAmp: number;
  zigzagWave: number;
  labelFont: number;
}

export function drawingMetrics(frame: { width: number; height: number }): DrawingMetrics {
  const stroke = Math.max(2, 0.008 * frame.height);
  return {
    stroke,
    halo: 1.8 * stroke,
    headLength: 3.2 * stroke,
    headHalfWidth: 1.6 * stroke,
    dash: [3 * stroke, 2 * stroke],
    bar: 4 * stroke,
    zigzagAmp: 1.2 * stroke,
    zigzagWave: 3 * stroke,
    labelFont: Math.max(11, 0.045 * frame.height),
  };
}

type Frame = { width: number; height: number };
type Arrow = Extract<DrawingShape, { kind: "arrow" }>;
type Spotlight = Extract<DrawingShape, { kind: "spotlight" }>;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const toPx = (p: DrawingPoint, frame: Frame): DrawingPoint => ({ x: p.x * frame.width, y: p.y * frame.height });

function unit(from: DrawingPoint, to: DrawingPoint): DrawingPoint {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  return len > 0 ? { x: dx / len, y: dy / len } : { x: 1, y: 0 };
}

/** The left normal of a direction on screen (y down): pointing up for an arrow to the right. */
const leftNormal = (d: DrawingPoint): DrawingPoint => ({ x: d.y, y: -d.x });

/** The arrow's path in pixels: its two ends when straight, a quadratic curve of ARROW_SEGMENTS segments when bent. */
export function arrowPolyline(a: Arrow, frame: Frame): DrawingPoint[] {
  const A = toPx(a.from, frame);
  const B = toPx(a.to, frame);
  const bend = a.bend ?? 0;
  if (!bend) return [A, B];
  const len = Math.hypot(B.x - A.x, B.y - A.y);
  const n = leftNormal(unit(A, B));
  const C = { x: (A.x + B.x) / 2 + n.x * bend * len, y: (A.y + B.y) / 2 + n.y * bend * len };
  const pts: DrawingPoint[] = [];
  for (let i = 0; i <= ARROW_SEGMENTS; i++) {
    const u = i / ARROW_SEGMENTS;
    const v = 1 - u;
    pts.push({ x: v * v * A.x + 2 * v * u * C.x + u * u * B.x, y: v * v * A.y + 2 * v * u * C.y + u * u * B.y });
  }
  return pts;
}

/** The shaft: the path shortened by the head's length so the stroke ends at the head's base. */
export function shaftPolyline(polyline: DrawingPoint[], metrics: DrawingMetrics, hasHead: boolean): DrawingPoint[] {
  if (!hasHead || polyline.length < 2) return [...polyline];
  let remaining = metrics.headLength;
  for (let i = polyline.length - 1; i > 0; i--) {
    const a = polyline[i - 1];
    const b = polyline[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > remaining) {
      const f = remaining / len;
      return [...polyline.slice(0, i), { x: b.x - (b.x - a.x) * f, y: b.y - (b.y - a.y) * f }];
    }
    remaining -= len;
  }
  return [polyline[0], polyline[0]];
}

/** The filled head along the path's last segment; a screen has none. */
export function arrowHead(
  polyline: DrawingPoint[],
  metrics: DrawingMetrics,
  kind: ArrowKind = "cut",
): { base: DrawingPoint; tip: DrawingPoint; left: DrawingPoint; right: DrawingPoint } | null {
  if (kind === "screen" || polyline.length < 2) return null;
  const tip = polyline[polyline.length - 1];
  const d = unit(polyline[polyline.length - 2], tip);
  const n = leftNormal(d);
  const base = { x: tip.x - d.x * metrics.headLength, y: tip.y - d.y * metrics.headLength };
  const w = metrics.headHalfWidth;
  return {
    base,
    tip,
    left: { x: base.x + n.x * w, y: base.y + n.y * w },
    right: { x: base.x - n.x * w, y: base.y - n.y * w },
  };
}

/** A screen's bar: across the path's end, `bar` long, centred on it. */
export function screenBar(polyline: DrawingPoint[], metrics: DrawingMetrics): [DrawingPoint, DrawingPoint] {
  const end = polyline[polyline.length - 1];
  const n = leftNormal(unit(polyline[Math.max(0, polyline.length - 2)], end));
  const h = metrics.bar / 2;
  return [
    { x: end.x + n.x * h, y: end.y + n.y * h },
    { x: end.x - n.x * h, y: end.y - n.y * h },
  ];
}

function pointAlong(polyline: DrawingPoint[], s: number): { point: DrawingPoint; dir: DrawingPoint } {
  let left = s;
  for (let i = 1; i < polyline.length; i++) {
    const a = polyline[i - 1];
    const b = polyline[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (left <= len || i === polyline.length - 1) {
      const f = len > 0 ? Math.min(1, left / len) : 0;
      return { point: { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }, dir: unit(a, b) };
    }
    left -= len;
  }
  return { point: polyline[0], dir: { x: 1, y: 0 } };
}

function pathLength(polyline: DrawingPoint[]): number {
  let total = 0;
  for (let i = 1; i < polyline.length; i++) total += Math.hypot(polyline[i].x - polyline[i - 1].x, polyline[i].y - polyline[i - 1].y);
  return total;
}

/** A dribble: the shaft as a zigzag (peaks every half wave, alternating sides), its last wave straight so the head sits on a line. */
export function zigzag(shaft: DrawingPoint[], metrics: DrawingMetrics): DrawingPoint[] {
  const total = pathLength(shaft);
  const end = shaft[shaft.length - 1];
  const step = metrics.zigzagWave / 2;
  const straight = Math.max(0, total - metrics.zigzagWave);
  const out: DrawingPoint[] = [shaft[0]];
  let sign = 1;
  for (let s = step; s < straight; s += step) {
    const { point, dir } = pointAlong(shaft, s);
    const n = leftNormal(dir);
    out.push({ x: point.x + n.x * metrics.zigzagAmp * sign, y: point.y + n.y * metrics.zigzagAmp * sign });
    sign = -sign;
  }
  if (straight > 0) out.push(pointAlong(shaft, straight).point);
  out.push(end);
  return out;
}

const fmt = (v: number) => String(Number(v.toFixed(2)));

/** An SVG path through the points; the canvas walks the same list with moveTo/lineTo. */
export function pointsToPath(points: DrawingPoint[]): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${fmt(p.x)} ${fmt(p.y)}`).join(" ");
}

export function spotlightEllipse(s: Spotlight, frame: Frame): { cx: number; cy: number; rx: number; ry: number } {
  const ry = s.r * frame.height;
  return { cx: s.at.x * frame.width, cy: s.at.y * frame.height, rx: SPOTLIGHT_ASPECT * ry, ry };
}

const clampPoint = (p: DrawingPoint): DrawingPoint => ({ x: clamp(p.x, 0, 1), y: clamp(p.y, 0, 1) });

/** A label's text as it is kept: trimmed, at most LABEL_MAX_CHARS characters (never half an emoji). */
export function labelText(text: string): string {
  return Array.from(text.trim()).slice(0, LABEL_MAX_CHARS).join("").trim();
}

/** The shape kept inside the frame and its limits. */
export function clampShape(s: DrawingShape): DrawingShape {
  switch (s.kind) {
    case "spotlight":
      return { ...s, at: clampPoint(s.at), r: clamp(s.r, SPOTLIGHT_MIN_R, SPOTLIGHT_MAX_R) };
    case "arrow":
      return { ...s, from: clampPoint(s.from), to: clampPoint(s.to), ...(s.bend !== undefined ? { bend: clamp(s.bend, -1, 1) } : {}) };
    case "text":
      return { ...s, at: clampPoint(s.at), text: labelText(s.text) };
  }
}

/**
 * A point of the 16:9 frame in the 9:16 export's crop window centred at `cx`
 * (a fraction of the source width, as crop keyframes). The window's left
 * edge is clamped inside the frame like the export's crop; assumes a 16:9
 * source, like the editor's crop window.
 */
export function toCropFrame(p: DrawingPoint, cx: number): DrawingPoint {
  const cw = cropWidthFrac(16, 9);
  const left = clamp(cx - cw / 2, 0, 1 - cw);
  return { x: (p.x - left) / cw, y: p.y };
}

/** A label's pill in pixels, centred on its point; the width is estimated from the character count (good enough to pick it). */
export function labelBox(s: Extract<DrawingShape, { kind: "text" }>, frame: Frame): { x: number; y: number; width: number; height: number } {
  const font = drawingMetrics(frame).labelFont;
  const width = font * (0.6 * Array.from(s.text).length + 2 * LABEL_EM.padX);
  const height = font * (LABEL_EM.lineHeight + 2 * LABEL_EM.padY);
  const c = toPx(s.at, frame);
  return { x: c.x - width / 2, y: c.y - height / 2, width, height };
}

function distanceToPolyline(p: DrawingPoint, polyline: DrawingPoint[]): number {
  let best = Infinity;
  for (let i = 1; i < polyline.length; i++) {
    const a = polyline[i - 1];
    const b = polyline[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const u = len2 > 0 ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1) : 0;
    best = Math.min(best, Math.hypot(p.x - (a.x + u * dx), p.y - (a.y + u * dy)));
  }
  return best;
}

/**
 * The shape under a point (a fraction of the frame), the last drawn first,
 * or null. `spotlights: false` leaves spotlights out, so an arrow or a label
 * can start on the spotlighted player.
 */
export function hitTest(
  shapes: DrawingShape[],
  p: DrawingPoint,
  frame: Frame,
  tolerancePx: number,
  opts: { spotlights?: boolean } = {},
): DrawingShape | null {
  const P = toPx(p, frame);
  const m = drawingMetrics(frame);
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i];
    if (s.kind === "spotlight") {
      if (opts.spotlights === false) continue;
      const e = spotlightEllipse(s, frame);
      const rx = e.rx + tolerancePx;
      const ry = e.ry + tolerancePx;
      if (((P.x - e.cx) / rx) ** 2 + ((P.y - e.cy) / ry) ** 2 <= 1) return s;
    } else if (s.kind === "arrow") {
      if (distanceToPolyline(P, arrowPolyline(s, frame)) <= 2 * m.stroke + 6 + tolerancePx) return s;
    } else {
      const b = labelBox(s, frame);
      if (P.x >= b.x - tolerancePx && P.x <= b.x + b.width + tolerancePx && P.y >= b.y - tolerancePx && P.y <= b.y + b.height + tolerancePx) return s;
    }
  }
  return null;
}
