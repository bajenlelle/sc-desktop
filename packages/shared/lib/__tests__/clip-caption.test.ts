import { describe, expect, it } from "vitest";
import { captionBaseline, captionLayout, wrapCaption } from "../clip-caption";

/** Roughly Roboto bold: half an em per UTF-16 unit, so an emoji counts double. */
const measure = (s: string) => s.length * 20;

describe("captionLayout", () => {
  it("resolves the export pixels for both frames", () => {
    expect(captionLayout("16:9")).toEqual({
      left: 38, top: 36, maxWidth: 768, fontSize: 40, lineHeight: 50, padX: 24, padY: 14, radius: 16, maxLines: 3,
    });
    expect(captionLayout("9:16")).toEqual({
      left: 65, top: 240, maxWidth: 864, fontSize: 50, lineHeight: 63, padX: 30, padY: 18, radius: 20, maxLines: 3,
    });
  });

  it("keeps three lines inside the frame's safe bands", () => {
    const wide = captionLayout("16:9");
    expect(wide.top + wide.padY + 3 * wide.lineHeight + wide.padY).toBeLessThan(636);
    const tall = captionLayout("9:16");
    expect(tall.top).toBeGreaterThanOrEqual(240);
    expect(tall.top + tall.padY + 3 * tall.lineHeight + tall.padY).toBeLessThan(1140);
  });

  it("scales to a measured player box", () => {
    expect(captionLayout("16:9", { width: 390, height: 219 }).fontSize).toBe(12);
  });

  it("puts each baseline so the caps sit centred in the line box", () => {
    const l = captionLayout("16:9");
    expect(captionBaseline(0, l)).toBeCloseTo((50 + 0.72 * 40) / 2);
    expect(captionBaseline(2, l) - captionBaseline(1, l)).toBe(l.lineHeight);
  });
});

describe("wrapCaption", () => {
  it("keeps a short note on one line and wraps at the width", () => {
    expect(wrapCaption("Watch the help side", measure, 1000, 3)).toEqual(["Watch the help side"]);
    expect(wrapCaption("Watch the help side on this play", measure, 400, 3)).toEqual(["Watch the help side", "on this play"]);
  });

  it("keeps explicit line breaks", () => {
    expect(wrapCaption("Watch the help side\nLisa rotates late", measure, 1000, 3)).toEqual([
      "Watch the help side",
      "Lisa rotates late",
    ]);
  });

  it("cuts a fourth line into an ellipsis on the third that fits", () => {
    const lines = wrapCaption("one\ntwo\nthree\nfour five six seven eight nine", measure, 400, 3);
    expect(lines).toEqual(["one", "two", "three four five six…"]);
    expect(measure(lines[2])).toBeLessThanOrEqual(400);
  });

  it("joins a short tail onto the third line without an ellipsis when it fits", () => {
    expect(wrapCaption("one\ntwo\nthree\nfour", measure, 400, 3)).toEqual(["one", "two", "three four"]);
  });

  it("cuts a word wider than the line with an ellipsis, never inside an emoji", () => {
    const [word] = wrapCaption("a".repeat(60), measure, 400, 3);
    expect(word).toBe(`${"a".repeat(19)}…`);
    expect(measure(word)).toBeLessThanOrEqual(400);

    const [balls] = wrapCaption("🏀".repeat(30), measure, 400, 3);
    expect(balls.endsWith("…")).toBe(true);
    expect(Array.from(balls).every((c) => c === "🏀" || c === "…")).toBe(true);
    expect(measure(balls)).toBeLessThanOrEqual(400);
  });

  it("is empty for blank text", () => {
    expect(wrapCaption("  \n ", measure, 400, 3)).toEqual([]);
    expect(wrapCaption("", measure, 400, 3)).toEqual([]);
  });
});
