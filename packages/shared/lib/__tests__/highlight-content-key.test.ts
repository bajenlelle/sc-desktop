import { describe, expect, it } from "vitest";
import {
  highlightContentKey,
  type HighlightContentSegment,
} from "../highlight-shares-db";

function clip(
  eventId: number,
  extra?: Partial<Extract<HighlightContentSegment, { kind: "clip" }>>,
): HighlightContentSegment {
  return { kind: "clip", matchId: "m1", event: { eventId }, ...extra };
}

const BASE: HighlightContentSegment[] = [
  clip(1),
  { kind: "text", text: "Halftime", durationSeconds: 4 },
  clip(2, { preRollOffset: 2 }),
];

describe("highlightContentKey", () => {
  it("is deterministic for identical input", () => {
    expect(highlightContentKey(BASE, 10, 3, "16:9")).toBe(
      highlightContentKey(BASE, 10, 3, "16:9"),
    );
  });

  it("changes when clip order changes", () => {
    const reordered = [BASE[2], BASE[1], BASE[0]];
    expect(highlightContentKey(reordered, 10, 3, "16:9")).not.toBe(
      highlightContentKey(BASE, 10, 3, "16:9"),
    );
  });

  it("changes when a roll offset changes", () => {
    const edited = [clip(1, { postRollOffset: 1 }), BASE[1], BASE[2]];
    expect(highlightContentKey(edited, 10, 3, "16:9")).not.toBe(
      highlightContentKey(BASE, 10, 3, "16:9"),
    );
  });

  it("changes when global rolls change", () => {
    expect(highlightContentKey(BASE, 8, 3, "16:9")).not.toBe(
      highlightContentKey(BASE, 10, 3, "16:9"),
    );
  });

  it("changes when text card content changes", () => {
    const edited = [BASE[0], { kind: "text" as const, text: "Fulltime", durationSeconds: 4 }, BASE[2]];
    expect(highlightContentKey(edited, 10, 3, "16:9")).not.toBe(
      highlightContentKey(BASE, 10, 3, "16:9"),
    );
  });

  it("crop-pan edits change the 9:16 key but NOT the 16:9 key", () => {
    const panned = [
      clip(1, { cropKeyframes: [{ t: 100, cx: 0.3 }] }),
      BASE[1],
      BASE[2],
    ];
    // Pans don't shape a widescreen render — its link must survive pan edits.
    expect(highlightContentKey(panned, 10, 3, "16:9")).toBe(
      highlightContentKey(BASE, 10, 3, "16:9"),
    );
    expect(highlightContentKey(panned, 10, 3, "9:16")).not.toBe(
      highlightContentKey(BASE, 10, 3, "9:16"),
    );
    const movedPan = [
      clip(1, { cropKeyframes: [{ t: 100, cx: 0.7 }] }),
      BASE[1],
      BASE[2],
    ];
    expect(highlightContentKey(movedPan, 10, 3, "9:16")).not.toBe(
      highlightContentKey(panned, 10, 3, "9:16"),
    );
  });
});
