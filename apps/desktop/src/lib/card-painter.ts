/**
 * Draws playlist cards (text and stats) on a canvas. The editor's stage and
 * the export use the same pixels: the layout is shared (card-layout.ts) and
 * the font is the bundled Roboto, so a card looks the same on every machine
 * and in every exported video.
 */
import robotoRegularUrl from "@/assets/fonts/Roboto-Regular.ttf?url";
import robotoBoldUrl from "@/assets/fonts/Roboto-Bold.ttf?url";
import {
  CARD_BACKGROUND,
  CARD_SIZE,
  layoutStatsCard,
  layoutTextCard,
  type CardAspect,
  type CardFontWeight,
  type MeasureText,
} from "@scoutable/shared/lib/card-layout";
import {
  arrowHead,
  arrowPolyline,
  DEFAULT_DRAWING_COLOR,
  DRAWING_COLORS,
  DRAWING_HALO,
  drawingMetrics,
  LABEL_BACKGROUND,
  LABEL_COLOR,
  LABEL_EM,
  screenBar,
  shaftPolyline,
  SPOTLIGHT_DIM,
  SPOTLIGHT_SOFT_FROM,
  spotlightEllipse,
  toCropFrame,
  zigzag,
  type DrawingMetrics,
  type DrawingPoint,
  type DrawingShape,
} from "@scoutable/shared/lib/clip-drawing";
import {
  CAPTION_BACKGROUND,
  CAPTION_COLOR,
  CAPTION_WEIGHT,
  captionBaseline,
  captionLayout,
  wrapCaption,
} from "@scoutable/shared/lib/clip-caption";
import { cardContent } from "@scoutable/shared/lib/stats-card";
import type { PlaylistTextCard } from "@/types/match";

/** What a card is drawn from: its text, or its stats spec when it has one. */
export type CardSource = Pick<PlaylistTextCard, "text" | "card">;

const FAMILY = "Scoutable Card";

let fontsLoading: Promise<void> | null = null;

/** Loads the card font once; every paint waits for it. */
export function loadCardFonts(): Promise<void> {
  fontsLoading ??= Promise.all(
    [
      new FontFace(FAMILY, `url(${robotoRegularUrl})`, { weight: "400" }),
      new FontFace(FAMILY, `url(${robotoBoldUrl})`, { weight: "700" }),
    ].map(async (face) => {
      await face.load();
      document.fonts.add(face);
    }),
  )
    .then(() => undefined)
    .catch((e: unknown) => {
      fontsLoading = null; // let the next paint try again
      throw e;
    });
  return fontsLoading;
}

function font(px: number, weight: CardFontWeight): string {
  return `${weight === "bold" ? 700 : 400} ${px}px "${FAMILY}"`;
}

/** Paints a card at its export size. Call after loadCardFonts resolves. */
export function paintCard(source: CardSource, aspect: CardAspect, canvas = document.createElement("canvas")): HTMLCanvasElement {
  const { width, height } = CARD_SIZE[aspect];
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't draw the card");
  ctx.fillStyle = CARD_BACKGROUND;
  ctx.fillRect(0, 0, width, height);
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  const measure: MeasureText = (text, px, weight) => {
    ctx.font = font(px, weight);
    return ctx.measureText(text).width;
  };
  const runs = source.card
    ? layoutStatsCard(cardContent(source.card), aspect, measure)
    : layoutTextCard(source.text, aspect, measure);
  for (const run of runs) {
    ctx.font = font(run.px, run.weight);
    ctx.fillStyle = run.color;
    ctx.fillText(run.text, run.x, run.y);
  }
  return canvas;
}

/** A rounded rectangle path drawn with arcs: WebKit 15.4 (macOS 12.3) has no roundRect. */
function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/**
 * Paints a clip's note pill on a transparent frame at the export size, as
 * the players draw it over the footage (clip-caption.ts holds the geometry).
 * Call after loadCardFonts resolves.
 */
export function paintClipCaption(text: string, aspect: CardAspect, canvas = document.createElement("canvas")): HTMLCanvasElement {
  const { width, height } = CARD_SIZE[aspect];
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't draw the note");
  ctx.clearRect(0, 0, width, height);
  const l = captionLayout(aspect);
  // The font before measuring, or the lines wrap in the fallback font and draw in Roboto.
  ctx.font = font(l.fontSize, CAPTION_WEIGHT);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const lines = wrapCaption(text, (s) => ctx.measureText(s).width, l.textWidth, l.maxLines);
  if (lines.length === 0) return canvas;
  const textWidth = Math.ceil(Math.max(...lines.map((s) => ctx.measureText(s).width)));
  roundedRect(ctx, l.left, l.top, textWidth + 2 * l.padX, lines.length * l.lineHeight + 2 * l.padY, l.radius);
  ctx.fillStyle = CAPTION_BACKGROUND;
  ctx.fill();
  ctx.fillStyle = CAPTION_COLOR;
  lines.forEach((line, i) => ctx.fillText(line, l.left + l.padX, l.top + l.padY + captionBaseline(i, l)));
  return canvas;
}

function tracePath(ctx: CanvasRenderingContext2D, pts: DrawingPoint[]): void {
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
}

function strokePath(
  ctx: CanvasRenderingContext2D,
  pts: DrawingPoint[],
  width: number,
  color: string,
  cap: CanvasLineCap,
  dash: number[] = [],
): void {
  tracePath(ctx, pts);
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.lineCap = cap;
  ctx.lineJoin = "round";
  ctx.setLineDash(dash);
  ctx.stroke();
}

/** An arrow as the players' SVG draws it (drawing-svg.tsx): the dark halo, then the line, the head or the bar. */
function paintArrow(
  ctx: CanvasRenderingContext2D,
  a: Extract<DrawingShape, { kind: "arrow" }>,
  frame: { width: number; height: number },
  m: DrawingMetrics,
): void {
  const color = DRAWING_COLORS[a.color ?? DEFAULT_DRAWING_COLOR];
  const line = arrowPolyline(a, frame);
  const head = arrowHead(line, m, a.arrow);
  const shaft = shaftPolyline(line, m, !!head);
  const pts = a.arrow === "dribble" ? zigzag(shaft, m) : shaft;
  const pass = a.arrow === "pass";
  const cap: CanvasLineCap = pass ? "butt" : "round";
  const dash = pass ? [...m.dash] : [];
  const bar = a.arrow === "screen" ? screenBar(line, m) : null;
  const triangle = () => head && tracePath(ctx, [head.tip, head.left, head.right]);
  strokePath(ctx, pts, m.halo, DRAWING_HALO, cap, dash);
  if (bar) strokePath(ctx, bar, m.halo, DRAWING_HALO, "round");
  if (head) {
    triangle();
    ctx.closePath();
    ctx.fillStyle = DRAWING_HALO;
    ctx.fill();
    ctx.lineWidth = m.halo - m.stroke;
    ctx.strokeStyle = DRAWING_HALO;
    ctx.lineJoin = "round";
    ctx.setLineDash([]);
    ctx.stroke();
  }
  strokePath(ctx, pts, m.stroke, color, cap, dash);
  if (bar) strokePath(ctx, bar, m.stroke, color, "round");
  if (head) {
    triangle();
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }
}

/** A label as the players draw it: the note's pill, small, with an edge in its colour. */
function paintLabel(
  ctx: CanvasRenderingContext2D,
  s: Extract<DrawingShape, { kind: "text" }>,
  frame: { width: number; height: number },
  m: DrawingMetrics,
): void {
  const px = m.labelFont;
  ctx.font = font(px, "bold");
  const padX = LABEL_EM.padX * px;
  const padY = LABEL_EM.padY * px;
  const lineHeight = LABEL_EM.lineHeight * px;
  const w = ctx.measureText(s.text).width + 2 * padX;
  const h = lineHeight + 2 * padY;
  const cx = s.at.x * frame.width;
  const cy = s.at.y * frame.height;
  const radius = LABEL_EM.radius * px;
  roundedRect(ctx, cx - w / 2, cy - h / 2, w, h, radius);
  ctx.fillStyle = LABEL_BACKGROUND;
  ctx.fill();
  const edge = Math.max(1, m.stroke / 2);
  roundedRect(ctx, cx - w / 2 + edge / 2, cy - h / 2 + edge / 2, w - edge, h - edge, radius - edge / 2);
  ctx.lineWidth = edge;
  ctx.strokeStyle = DRAWING_COLORS[s.color ?? DEFAULT_DRAWING_COLOR];
  ctx.setLineDash([]);
  ctx.stroke();
  ctx.fillStyle = LABEL_COLOR;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  // Caps centred in the line, as card-layout places text (cap height 0.72 em).
  ctx.fillText(s.text, cx, cy + 0.36 * px);
}

/**
 * Paints a drawing's shapes on a transparent frame at the export size, as
 * the players draw them over the footage (clip-drawing.ts holds the
 * geometry). For 9:16 the 16:9 points go into the crop window centred at
 * `cropCx`. Call after loadCardFonts resolves.
 */
export function paintClipDrawing(
  shapes: DrawingShape[],
  aspect: CardAspect,
  cropCx?: number,
  canvas = document.createElement("canvas"),
): HTMLCanvasElement {
  const frame = CARD_SIZE[aspect];
  canvas.width = frame.width;
  canvas.height = frame.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't draw the drawing");
  ctx.clearRect(0, 0, frame.width, frame.height);
  const place = (p: DrawingPoint) => (cropCx === undefined ? p : toCropFrame(p, cropCx));
  const placed = shapes.map((s): DrawingShape =>
    s.kind === "arrow" ? { ...s, from: place(s.from), to: place(s.to) } : { ...s, at: place(s.at) },
  );
  const m = drawingMetrics(frame);

  // The dimming, then each spotlight's soft hole cut out of it: overlapping holes stay holes.
  const spots = placed.filter((s): s is Extract<DrawingShape, { kind: "spotlight" }> => s.kind === "spotlight");
  if (spots.length > 0) {
    ctx.fillStyle = SPOTLIGHT_DIM;
    ctx.fillRect(0, 0, frame.width, frame.height);
    ctx.globalCompositeOperation = "destination-out";
    for (const s of spots) {
      const e = spotlightEllipse(s, frame);
      ctx.save();
      ctx.translate(e.cx, e.cy);
      ctx.scale(e.rx / e.ry, 1);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, e.ry);
      g.addColorStop(0, "rgba(0,0,0,1)");
      g.addColorStop(SPOTLIGHT_SOFT_FROM, "rgba(0,0,0,1)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, e.ry, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.globalCompositeOperation = "source-over";
  }
  for (const s of placed) if (s.kind === "arrow") paintArrow(ctx, s, frame, m);
  for (const s of placed) if (s.kind === "text") paintLabel(ctx, s, frame, m);
  return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Couldn't draw the image"))), "image/png"),
  );
}

async function paintToBlob(source: CardSource, aspect: CardAspect): Promise<Blob> {
  await loadCardFonts();
  return canvasToBlob(paintCard(source, aspect));
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** The card as a PNG for the exporter (base64, the export's own size). */
export async function cardPngBase64(source: CardSource, aspect: CardAspect): Promise<string> {
  return blobToBase64(await paintToBlob(source, aspect));
}

/** The note pill as a PNG for the exporter (base64, the export's own size, transparent elsewhere). */
export async function clipCaptionPngBase64(text: string, aspect: CardAspect): Promise<string> {
  await loadCardFonts();
  return blobToBase64(await canvasToBlob(paintClipCaption(text, aspect)));
}

/** A drawing as a PNG for the exporter (base64, the export's own size, transparent elsewhere). */
export async function clipDrawingPngBase64(shapes: DrawingShape[], aspect: CardAspect, cropCx?: number): Promise<string> {
  await loadCardFonts();
  return blobToBase64(await canvasToBlob(paintClipDrawing(shapes, aspect, cropCx)));
}

/** The card as an object URL for an <img>; revoke it when it's replaced. */
export async function cardObjectUrl(source: CardSource, aspect: CardAspect): Promise<string> {
  return URL.createObjectURL(await paintToBlob(source, aspect));
}
