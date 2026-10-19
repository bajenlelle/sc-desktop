/**
 * Draws playlist cards (text and stats) for the server export, call for call
 * as the desktop's painter does (apps/desktop/src/lib/card-painter.ts), over
 * the same shared layout (card-layout.ts) and the same Roboto files
 * (assets/fonts, twins of apps/desktop/src/assets/fonts), on @napi-rs/canvas
 * (Skia) instead of a browser canvas. A PNG at the export's own size, so the
 * concat pass can join it with the clips.
 */
import { createCanvas, GlobalFonts, type Canvas } from "@napi-rs/canvas";
import {
  CARD_BACKGROUND,
  CARD_SIZE,
  layoutStatsCard,
  layoutTextCard,
  type CardAspect,
  type CardFontWeight,
  type MeasureText,
  type TextRun,
} from "@scoutable/shared/lib/card-layout";
import { cardContent, fallbackText, parseCardSpec, type StatsCardSpec } from "@scoutable/shared/lib/stats-card";
import { CARD_FONT_FILES } from "./assets";

const FAMILY = "Scoutable Card";

/** What a card is drawn from: its text, and a stats card's spec as stored (playlist_clips.card), or null. */
export interface CardPaintSource {
  text: string;
  card: unknown | null;
}

let fontsRegistered = false;

/** Registers the card font once, both weights under one family, as the desktop's loadCardFonts does. */
export function registerCardFonts(): void {
  if (fontsRegistered) return;
  const regular = GlobalFonts.registerFromPath(CARD_FONT_FILES.regular, FAMILY);
  const bold = GlobalFonts.registerFromPath(CARD_FONT_FILES.bold, FAMILY);
  if (!regular || !bold) throw new Error(`card fonts could not be registered from ${CARD_FONT_FILES.regular}`);
  fontsRegistered = true;
}

function font(px: number, weight: CardFontWeight): string {
  return `${weight === "bold" ? 700 : 400} ${px}px "${FAMILY}"`;
}

/** A canvas of the export's size with the card's runs drawn, and the runs (for tests and logs). */
export interface PaintedCard {
  canvas: Canvas;
  runs: TextRun[];
}

function paint(aspect: CardAspect, layout: (measure: MeasureText) => TextRun[]): PaintedCard {
  const { width, height } = CARD_SIZE[aspect];
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = CARD_BACKGROUND;
  ctx.fillRect(0, 0, width, height);
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  const measure: MeasureText = (text, px, weight) => {
    ctx.font = font(px, weight);
    return ctx.measureText(text).width;
  };
  const runs = layout(measure);
  for (const run of runs) {
    ctx.font = font(run.px, run.weight);
    ctx.fillStyle = run.color;
    ctx.fillText(run.text, run.x, run.y);
  }
  return { canvas, runs };
}

/**
 * Paints a card at its export size. A stats card is drawn from its spec; a
 * spec this build can't parse leaves the card's text (its fallback line), as
 * the desktop's rowToPlaylist does, and a spec that parses but can't be
 * drawn is drawn as plain text, as the desktop's export then does.
 */
export function paintCard(source: CardPaintSource, aspect: CardAspect): PaintedCard {
  registerCardFonts();
  const spec: StatsCardSpec | null = source.card == null ? null : parseCardSpec(source.card);
  if (spec) {
    try {
      return paint(aspect, (measure) => layoutStatsCard(cardContent(spec), aspect, measure));
    } catch {
      let text = source.text;
      try {
        text = fallbackText(spec);
      } catch {
        // the stored text, then
      }
      return paint(aspect, (measure) => layoutTextCard(text, aspect, measure));
    }
  }
  return paint(aspect, (measure) => layoutTextCard(source.text, aspect, measure));
}

/** The card as a PNG of the export's size (1280×720 or 1080×1920). */
export function paintCardPng(source: CardPaintSource, aspect: CardAspect): Buffer {
  return paintCard(source, aspect).canvas.toBuffer("image/png");
}
