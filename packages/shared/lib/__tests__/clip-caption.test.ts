import { describe, expect, it } from "vitest";
import { CARD_SIZE } from "../card-layout";
import { CAPTION_EM, CAPTION_MAX_LINES, CAPTION_TEXT_EM, captionBaseline, captionLayout, wrapCaption } from "../clip-caption";

/** Roughly Roboto bold: half an em per UTF-16 unit, so an emoji counts double. */
const measure = (s: string) => s.length * 20;

describe("captionLayout", () => {
  it("resolves the export geometry for both frames, the font unrounded so every surface wraps alike", () => {
    const wide = captionLayout("16:9");
    expect(wide.left).toBe(38);
    expect(wide.top).toBe(36);
    expect(wide.fontSize).toBeCloseTo(39.6);
    expect(wide.lineHeight).toBeCloseTo(49.5);
    expect(wide.padX).toBeCloseTo(23.76);
    expect(wide.padY).toBeCloseTo(13.86);
    expect(wide.radius).toBeCloseTo(15.84);
    expect(wide.textWidth).toBeCloseTo(CAPTION_TEXT_EM * 39.6);
    expect(wide.maxWidth).toBeCloseTo(wide.textWidth + 2 * wide.padX);
    expect(wide.maxLines).toBe(CAPTION_MAX_LINES);
    const tall = captionLayout("9:16");
    expect(tall.left).toBe(65);
    expect(tall.top).toBe(240);
    expect(tall.fontSize).toBeCloseTo(49.92);
    expect(tall.textWidth).toBeCloseTo(CAPTION_TEXT_EM * 49.92);
  });

  it("keeps five lines inside the frame's safe bands and the pill inside the frame's width", () => {
    for (const aspect of ["16:9", "9:16"] as const) {
      const l = captionLayout(aspect);
      const bottom = l.top + l.padY + CAPTION_MAX_LINES * l.lineHeight + l.padY;
      expect(bottom).toBeLessThan(aspect === "16:9" ? 636 : 1140);
      expect(l.left + l.maxWidth).toBeLessThanOrEqual(CARD_SIZE[aspect].width);
    }
    expect(captionLayout("9:16").top).toBeGreaterThanOrEqual(240);
  });

  it("scales to a measured player box", () => {
    const l = captionLayout("16:9", { width: 390, height: 219 });
    expect(l.fontSize).toBeCloseTo(219 * 0.055);
    expect(l.textWidth).toBeCloseTo(CAPTION_TEXT_EM * l.fontSize);
  });

  it("puts each baseline so the caps sit centred in the line box", () => {
    const l = captionLayout("16:9");
    expect(captionBaseline(0, l)).toBeCloseTo((l.lineHeight + 0.72 * l.fontSize) / 2);
    expect(captionBaseline(2, l) - captionBaseline(1, l)).toBeCloseTo(l.lineHeight);
  });

  it("spaces the pill in ems of its font", () => {
    expect(CAPTION_EM.padX + CAPTION_EM.padX + CAPTION_TEXT_EM).toBeCloseTo(captionLayout("16:9").maxWidth / 39.6);
  });
});

describe("wrapCaption", () => {
  it("keeps a short note on one line and wraps at the width", () => {
    expect(wrapCaption("Watch the help side", measure, 1000, 5)).toEqual(["Watch the help side"]);
    expect(wrapCaption("Watch the help side on this play", measure, 400, 5)).toEqual(["Watch the help side", "on this play"]);
  });

  it("keeps explicit line breaks", () => {
    expect(wrapCaption("Watch the help side\nLisa rotates late", measure, 1000, 5)).toEqual([
      "Watch the help side",
      "Lisa rotates late",
    ]);
  });

  it("ends the last line with an ellipsis when more lines follow, as the players' line clamp does", () => {
    expect(wrapCaption("one\ntwo\nthree\nfour", measure, 400, 3)).toEqual(["one", "two", "three…"]);
    const full = wrapCaption("one\ntwo\nthree four five six seven\neight", measure, 400, 3);
    expect(full).toEqual(["one", "two", "three four five six…"]);
    expect(measure(full[2])).toBeLessThanOrEqual(400);
  });

  it("keeps a blank line, as the field and the players show it", () => {
    expect(wrapCaption("Watch\n\nthe help side", measure, 1000, 5)).toEqual(["Watch", "", "the help side"]);
  });

  it("breaks a word wider than the line across lines, as the browser does, never inside an emoji", () => {
    expect(wrapCaption("a".repeat(45), measure, 400, 5)).toEqual(["a".repeat(20), "a".repeat(20), "a".repeat(5)]);
    expect(wrapCaption("see https://averylongaddress.example/with/path now", measure, 400, 5)).toEqual([
      "see",
      "https://averylongadd",
      "ress.example/with/pa",
      "th now",
    ]);
    const balls = wrapCaption("🏀".repeat(25), measure, 400, 5);
    expect(balls).toEqual(["🏀".repeat(10), "🏀".repeat(10), "🏀".repeat(5)]);
  });

  it("ellipsizes a broken word that still runs past the line limit", () => {
    const lines = wrapCaption("a".repeat(100), measure, 400, 3);
    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe(`${"a".repeat(19)}…`);
  });

  it("is empty for blank text", () => {
    expect(wrapCaption("  \n ", measure, 400, 5)).toEqual([]);
    expect(wrapCaption("", measure, 400, 5)).toEqual([]);
  });
});
