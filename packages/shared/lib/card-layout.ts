/**
 * Where everything on a playlist card goes: one pure layout used by the
 * editor's stage and by the export, so the preview is the export.
 *
 * Frames are the export sizes (cards must match the clips' size for the
 * concat step): 1280×720 widescreen, 1080×1920 vertical. Content stays out of
 * the watermark (16:9 bottom right, y 636–672; 9:16 centred at y 1184–1220)
 * and out of the bottom ~35% of a vertical frame, where TikTok and Reels
 * draw their own UI.
 *
 * Text is measured through a callback (canvas measureText in the app, a fake
 * in tests). Runs are centred on x with y on the alphabetic baseline.
 */
import type { CardContent } from "./stats-card";

export type CardAspect = "16:9" | "9:16";

export const CARD_SIZE: Record<CardAspect, { width: number; height: number }> = {
  "16:9": { width: 1280, height: 720 },
  "9:16": { width: 1080, height: 1920 },
};

/** Bumped whenever the drawing changes, so cached renders (send-to-phone links) are redone. */
export const CARD_RENDER_VERSION = 1;

export const CARD_BACKGROUND = "#000000";

export type CardFontWeight = "regular" | "bold";

export type MeasureText = (text: string, px: number, weight: CardFontWeight) => number;

export interface TextRun {
  text: string;
  /** Centre of the run. */
  x: number;
  /** Alphabetic baseline. */
  y: number;
  px: number;
  weight: CardFontWeight;
  color: string;
}

const WHITE = "#ffffff";
const DETAILS = "rgba(255,255,255,0.7)";
const CONTEXT = "rgba(255,255,255,0.55)";
const LABEL = "rgba(255,255,255,0.6)";

/** Roboto's cap height as a share of the font size: the visual height of caps and digits. */
const CAP = 0.72;

/** The largest size from `px` down to `min` at which every text fits `width`. */
function fitSize(texts: string[], px: number, min: number, width: number, weight: CardFontWeight, measure: MeasureText): number {
  let size = px;
  while (size > min && texts.some((t) => measure(t, size, weight) > width)) size -= 2;
  return Math.max(size, min);
}

interface Geometry {
  /** Vertical band the content is centred in. */
  top: number;
  bottom: number;
  /** Side margin. */
  margin: number;
  heading: number;
  headingMin: number;
  details: number;
  context: number;
  value: number;
  valueMin: number;
  label: number;
  gapHeadingDetails: number;
  gapDetailsContext: number;
  gapHeaderCells: number;
  gapValueLabel: number;
  gapRows: number;
  /** Space between neighbouring stats, and the narrowest a stat may be. */
  cellGap: number;
  minCell: number;
}

const GEOMETRY: Record<CardAspect, Geometry> = {
  "16:9": {
    top: 60, bottom: 600, margin: 96,
    heading: 60, headingMin: 36, details: 28, context: 24, value: 88, valueMin: 48, label: 22,
    gapHeadingDetails: 22, gapDetailsContext: 14, gapHeaderCells: 64, gapValueLabel: 22, gapRows: 0,
    cellGap: 64, minCell: 120,
  },
  "9:16": {
    top: 240, bottom: 1140, margin: 80,
    heading: 84, headingMin: 48, details: 38, context: 32, value: 130, valueMin: 64, label: 32,
    gapHeadingDetails: 26, gapDetailsContext: 18, gapHeaderCells: 96, gapValueLabel: 24, gapRows: 64,
    cellGap: 72, minCell: 180,
  },
};

/** Cells per row: one row in widescreen; up to three per row, centred, in vertical. */
function cellRows(count: number, aspect: CardAspect): number[] {
  if (count === 0) return [];
  if (aspect === "16:9" || count <= 3) return [count];
  if (count === 4) return [2, 2];
  return [3, count - 3];
}

export function layoutStatsCard(content: CardContent, aspect: CardAspect, measure: MeasureText): TextRun[] {
  const g = GEOMETRY[aspect];
  const { width } = CARD_SIZE[aspect];
  const centre = width / 2;
  const inner = width - 2 * g.margin;

  const headingPx = fitSize([content.heading], g.heading, g.headingMin, inner, "bold", measure);
  const detailsPx = fitSize([content.details], g.details, 18, inner, "regular", measure);
  const contextPx = fitSize([content.context], g.context, 16, inner, "regular", measure);

  // Stats sit side by side, each as wide as its value or label plus a gap,
  // so short and long numbers space evenly. A full vertical grid shares its
  // column widths so the rows line up. The numbers shrink only when a row
  // would otherwise overflow.
  const rowCounts = cellRows(content.cells.length, aspect);
  const rowCells: CardContent["cells"][] = [];
  rowCounts.reduce((start, count) => {
    rowCells.push(content.cells.slice(start, start + count));
    return start + count;
  }, 0);
  const labelPx = g.label;
  const sharedColumns = rowCells.length > 1 && rowCells.every((r) => r.length === rowCells[0].length);
  const widthsAt = (px: number): number[][] => {
    const own = rowCells.map((row) =>
      row.map((c) => Math.max(g.minCell, Math.max(measure(c.value, px, "bold"), measure(c.label, labelPx, "regular")) + g.cellGap)),
    );
    if (!sharedColumns) return own;
    const columns = own[0].map((_, i) => Math.max(...own.map((row) => row[i])));
    return own.map(() => columns);
  };
  let valuePx = g.value;
  const fits = (px: number) => widthsAt(px).every((row) => row.reduce((sum, w) => sum + w, 0) <= inner);
  while (valuePx > g.valueMin && !fits(valuePx)) valuePx -= 2;
  const rowWidths = widthsAt(valuePx);

  // Stack heights use cap heights, so the block centres on what the eye sees.
  type Line = { height: number; gapBefore: number; draw: (baseline: number) => TextRun[] };
  const lines: Line[] = [];
  lines.push({
    height: CAP * headingPx,
    gapBefore: 0,
    draw: (y) => [{ text: content.heading, x: centre, y, px: headingPx, weight: "bold", color: WHITE }],
  });
  if (content.details) {
    lines.push({
      height: CAP * detailsPx,
      gapBefore: g.gapHeadingDetails,
      draw: (y) => [{ text: content.details, x: centre, y, px: detailsPx, weight: "regular", color: DETAILS }],
    });
  }
  if (content.context) {
    lines.push({
      height: CAP * contextPx,
      gapBefore: content.details ? g.gapDetailsContext : g.gapHeadingDetails,
      draw: (y) => [{ text: content.context, x: centre, y, px: contextPx, weight: "regular", color: CONTEXT }],
    });
  }
  rowCells.forEach((cells, rowIndex) => {
    const widths = rowWidths[rowIndex];
    let x = centre - widths.reduce((sum, w) => sum + w, 0) / 2;
    const xs = widths.map((w) => {
      const mid = x + w / 2;
      x += w;
      return mid;
    });
    lines.push({
      height: CAP * valuePx,
      gapBefore: rowIndex === 0 ? g.gapHeaderCells : g.gapRows,
      draw: (y) => cells.map((c, i) => ({ text: c.value, x: xs[i], y, px: valuePx, weight: "bold" as const, color: WHITE })),
    });
    lines.push({
      height: CAP * labelPx,
      gapBefore: g.gapValueLabel,
      draw: (y) => cells.map((c, i) => ({ text: c.label, x: xs[i], y, px: labelPx, weight: "regular" as const, color: LABEL })),
    });
  });

  const total = lines.reduce((sum, l) => sum + l.gapBefore + l.height, 0);
  let y = (g.top + g.bottom) / 2 - total / 2;
  const runs: TextRun[] = [];
  for (const line of lines) {
    y += line.gapBefore + line.height;
    runs.push(...line.draw(Math.round(y)));
  }
  return runs;
}

/**
 * A text card, drawn as the Rust exporter always has: white Roboto at a
 * 72 px line height (61 px em), centred, word-wrapped inside 40 px side
 * margins (60 px vertical), lines 1.3 apart.
 */
export function layoutTextCard(text: string, aspect: CardAspect, measure: MeasureText): TextRun[] {
  const { width, height } = CARD_SIZE[aspect];
  const px = 61;
  const maxWidth = width - (aspect === "9:16" ? 120 : 80);
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && measure(candidate, px, "regular") > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);

  const step = Math.round(px * 1.2);
  const blockHeight = (lines.length - 1) * step + CAP * px;
  const firstBaseline = (height - blockHeight) / 2 + CAP * px;
  return lines.map((line, i) => ({
    text: line,
    x: width / 2,
    y: Math.round(firstBaseline + i * step),
    px,
    weight: "regular",
    color: WHITE,
  }));
}
