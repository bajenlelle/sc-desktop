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

/** The card as an object URL for an <img>; revoke it when it's replaced. */
export async function cardObjectUrl(source: CardSource, aspect: CardAspect): Promise<string> {
  return URL.createObjectURL(await paintToBlob(source, aspect));
}
