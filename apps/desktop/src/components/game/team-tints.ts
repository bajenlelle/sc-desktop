/**
 * The two fills of the score graph. A team's own colour is the best key a
 * coach has (it is the jersey they are looking at), but the game page lets it
 * be black, white, grey or nothing, and both teams may wear blue. So: a
 * team's colour is used when it is a colour at all; home falls back to the
 * accent and away to the text colour; and when the two would still read as
 * one, the away side is hatched. Position (home above the line, away below)
 * and the names beside the graph carry who is who either way; colour only
 * helps.
 */

type Rgb = [number, number, number];

function parseHex(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** sRGB → OKLab (Björn Ottosson's matrices). */
function oklab([r, g, b]: Rgb): [number, number, number] {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const [lr, lg, lb] = [lin(r), lin(g), lin(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** Below this chroma a colour reads as grey; it can't tell two teams apart. */
const CHROMA_FLOOR = 0.06;
/** Two fills closer than this (OKLab × 100) read as the same colour. */
const SAME_COLOUR = 15;
/** Roughly the accent across the themes, for telling whether an away colour sits too close to it. */
const ACCENT_STAND_IN = "#0aa5c4";

function hue(hex: string): [number, number, number] | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const lab = oklab(rgb);
  return Math.hypot(lab[1], lab[2]) >= CHROMA_FLOOR ? lab : null;
}

export interface TeamTints {
  /** A CSS colour for each side's fill. */
  home: string;
  away: string;
  homeOpacity: number;
  awayOpacity: number;
  /** The away fill is hatched: the two colours alone wouldn't tell the sides apart. */
  awayHatch: boolean;
}

export function teamTints(homeColor: string, awayColor: string): TeamTints {
  const home = hue(homeColor);
  const away = hue(awayColor);
  const homeLab = home ?? hue(ACCENT_STAND_IN)!;
  const close =
    !!away && Math.hypot(homeLab[0] - away[0], homeLab[1] - away[1], homeLab[2] - away[2]) * 100 < SAME_COLOUR;
  return {
    home: home ? homeColor : "var(--primary)",
    away: away ? awayColor : "var(--foreground)",
    homeOpacity: 0.24,
    awayOpacity: away ? 0.24 : 0.13,
    awayHatch: close,
  };
}
