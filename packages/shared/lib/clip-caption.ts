/**
 * The note on a clip, as the players and the export draw it: a pill in the
 * top-left corner of the frame, white on a translucent dark box, at most
 * three lines. One geometry, as fractions of the frame, drives the DOM pill
 * in the players (a measured frame box) and the canvas painter in the export
 * (the export frame in pixels), so what the coach sees is what exports.
 *
 * Top-left because the broadcasts' score bug sits bottom-centre, the
 * watermark bottom-right and the players' controls along the bottom. In a
 * vertical frame the pill starts at the cards' content band (y 240), under
 * the status bar and the feed tabs.
 */
import { CARD_SIZE, wrapWords, type CardAspect, type CardFontWeight } from "./card-layout";

export const CAPTION_FRACTIONS: Record<CardAspect, { left: number; top: number; maxWidth: number; fontSize: number }> = {
  "16:9": { left: 0.03, top: 0.05, maxWidth: 0.6, fontSize: 0.055 },
  "9:16": { left: 0.06, top: 0.125, maxWidth: 0.8, fontSize: 0.026 },
};
/** The pill's spacing, in ems of its font size. */
export const CAPTION_EM = { lineHeight: 1.25, padX: 0.6, padY: 0.35, radius: 0.4 } as const;
export const CAPTION_MAX_LINES = 3;
/** What the editor lets a coach type: about three lines at the export size. */
export const CAPTION_MAX_CHARS = 120;
export const CAPTION_BACKGROUND = "rgba(0,0,0,0.6)";
export const CAPTION_COLOR = "#ffffff";
export const CAPTION_WEIGHT: CardFontWeight = "bold";
/** Bumped whenever the pill's drawing changes, so cached renders (send-to-phone links) are redone. */
export const CAPTION_RENDER_VERSION = 1;

/** Roboto's cap height as a share of the font size (as card-layout). */
const CAP = 0.72;
const ELLIPSIS = "…";

export interface CaptionLayout {
  left: number;
  top: number;
  /** The whole pill's width limit, padding included. */
  maxWidth: number;
  fontSize: number;
  lineHeight: number;
  padX: number;
  padY: number;
  radius: number;
  maxLines: number;
}

/** The pill in pixels for a frame of this size: the export size by default, a measured player box otherwise. */
export function captionLayout(aspect: CardAspect, frame: { width: number; height: number } = CARD_SIZE[aspect]): CaptionLayout {
  const f = CAPTION_FRACTIONS[aspect];
  const fontSize = Math.round(frame.height * f.fontSize);
  return {
    left: Math.round(frame.width * f.left),
    top: Math.round(frame.height * f.top),
    maxWidth: Math.round(frame.width * f.maxWidth),
    fontSize,
    lineHeight: Math.round(fontSize * CAPTION_EM.lineHeight),
    padX: Math.round(fontSize * CAPTION_EM.padX),
    padY: Math.round(fontSize * CAPTION_EM.padY),
    radius: Math.round(fontSize * CAPTION_EM.radius),
    maxLines: CAPTION_MAX_LINES,
  };
}

/** Alphabetic baseline of line `i` from the box's content top: the caps centred in the line box. */
export function captionBaseline(i: number, l: CaptionLayout): number {
  return i * l.lineHeight + (l.lineHeight + CAP * l.fontSize) / 2;
}

/** The line cut to fit `maxWidth` with an ellipsis, dropping whole code points so an emoji never splits. */
function ellipsize(line: string, measure: (line: string) => number, maxWidth: number): string {
  const chars = Array.from(line);
  while (chars.length > 0 && measure(chars.join("") + ELLIPSIS) > maxWidth) chars.pop();
  while (chars.length > 0 && chars[chars.length - 1] === " ") chars.pop();
  return chars.join("") + ELLIPSIS;
}

/**
 * The note as the pill shows it: explicit line breaks kept, each paragraph
 * word-wrapped to `maxWidth` (text width, padding excluded), cut to
 * `maxLines` with "…" on the last line when the rest doesn't fit there; a
 * word wider than the line is cut the same way. Empty for blank text.
 * `measure` is already bound to the pill's font.
 */
export function wrapCaption(
  text: string,
  measure: (line: string) => number,
  maxWidth: number,
  maxLines: number,
): string[] {
  const lines = text.split(/\r?\n/).flatMap((paragraph) => wrapWords(paragraph, measure, maxWidth));
  if (lines.length === 0) return [];
  const kept = lines.slice(0, maxLines);
  if (lines.length > maxLines) {
    kept[kept.length - 1] = `${kept[kept.length - 1]} ${lines.slice(maxLines).join(" ")}`;
  }
  return kept.map((line) => (measure(line) > maxWidth ? ellipsize(line, measure, maxWidth) : line));
}
