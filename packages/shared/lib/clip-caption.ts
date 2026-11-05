/**
 * The note on a clip, as the players and the export draw it: a pill in the
 * top-left corner of the frame, white on a translucent dark box, at most
 * five lines. One geometry, as fractions of the frame and ems of the font,
 * drives the DOM pill in the players (a measured frame box), the note
 * field in the editor (the same font at the same width in ems, so line N in
 * the field is line N on the clip) and the canvas painter in the export
 * (the export frame in pixels). The font size is never rounded: every
 * surface must wrap at the same place.
 *
 * Top-left because the broadcasts' score bug sits bottom-centre, the
 * watermark bottom-right and the players' controls along the bottom. In a
 * vertical frame the pill starts at the cards' content band (y 240), under
 * the status bar and the feed tabs.
 */
import { CARD_SIZE, type CardAspect, type CardFontWeight } from "./card-layout";

export const CAPTION_FRACTIONS: Record<CardAspect, { left: number; top: number; fontSize: number }> = {
  "16:9": { left: 0.03, top: 0.05, fontSize: 0.055 },
  "9:16": { left: 0.06, top: 0.125, fontSize: 0.026 },
};
/** The text's width in ems of the font: the same in both frames, so a note wraps alike in a widescreen and a vertical export. */
export const CAPTION_TEXT_EM = 18;
/** The pill's spacing, in ems of its font size. */
export const CAPTION_EM = { lineHeight: 1.25, padX: 0.6, padY: 0.35, radius: 0.4 } as const;
export const CAPTION_MAX_LINES = 5;
/** A backstop for pastes; the limit a coach meets is the lines. */
export const CAPTION_MAX_CHARS = 240;
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
  /** The text's width limit, padding excluded. */
  textWidth: number;
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
  const fontSize = frame.height * f.fontSize;
  const padX = fontSize * CAPTION_EM.padX;
  const textWidth = fontSize * CAPTION_TEXT_EM;
  return {
    left: Math.round(frame.width * f.left),
    top: Math.round(frame.height * f.top),
    textWidth,
    maxWidth: textWidth + 2 * padX,
    fontSize,
    lineHeight: fontSize * CAPTION_EM.lineHeight,
    padX,
    padY: fontSize * CAPTION_EM.padY,
    radius: fontSize * CAPTION_EM.radius,
    maxLines: CAPTION_MAX_LINES,
  };
}

/** Alphabetic baseline of line `i` from the box's content top: the caps centred in the line box. */
export function captionBaseline(i: number, l: CaptionLayout): number {
  return i * l.lineHeight + (l.lineHeight + CAP * l.fontSize) / 2;
}

type Measure = (line: string) => number;

/** A word wider than the line, cut into pieces that fit, whole code points so an emoji never splits (CSS overflow-wrap: anywhere). */
function breakWord(word: string, measure: Measure, maxWidth: number): string[] {
  const pieces: string[] = [];
  let current = "";
  for (const ch of Array.from(word)) {
    const candidate = current + ch;
    if (current && measure(candidate) > maxWidth) {
      pieces.push(current);
      current = ch;
    } else {
      current = candidate;
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

/** One paragraph wrapped as a browser wraps pre-wrap text: at spaces, and inside a word only when it is wider than the line. */
function wrapParagraph(paragraph: string, measure: Measure, maxWidth: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of paragraph.split(/\s+/).filter(Boolean)) {
    const candidate = current ? `${current} ${word}` : word;
    if (measure(candidate) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) {
      lines.push(current);
      current = "";
    }
    if (measure(word) <= maxWidth) {
      current = word;
      continue;
    }
    const pieces = breakWord(word, measure, maxWidth);
    lines.push(...pieces.slice(0, -1));
    current = pieces[pieces.length - 1] ?? "";
  }
  if (current) lines.push(current);
  // An empty paragraph is a blank line, as pre-wrap shows it.
  return lines.length === 0 ? [""] : lines;
}

/** The line cut to fit `maxWidth` with an ellipsis, dropping whole code points so an emoji never splits. */
function ellipsize(line: string, measure: Measure, maxWidth: number): string {
  const chars = Array.from(line);
  while (chars.length > 0 && measure(chars.join("") + ELLIPSIS) > maxWidth) chars.pop();
  while (chars.length > 0 && chars[chars.length - 1] === " ") chars.pop();
  return chars.join("") + ELLIPSIS;
}

/**
 * The note as the pill shows it: explicit line breaks kept (blank ones
 * too), each paragraph wrapped to `maxWidth` (text width, padding excluded)
 * as a browser wraps it, and cut to `maxLines` with "…" at the end of the
 * last line when more lines follow, as CSS line-clamp does. Empty for
 * blank text. `measure` is already bound to the pill's font.
 */
export function wrapCaption(text: string, measure: Measure, maxWidth: number, maxLines: number): string[] {
  if (text.trim() === "") return [];
  const lines = text.split(/\r?\n/).flatMap((paragraph) => wrapParagraph(paragraph, measure, maxWidth));
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  const last = kept[maxLines - 1];
  kept[maxLines - 1] = measure(last + ELLIPSIS) <= maxWidth ? last + ELLIPSIS : ellipsize(last, measure, maxWidth);
  return kept;
}
