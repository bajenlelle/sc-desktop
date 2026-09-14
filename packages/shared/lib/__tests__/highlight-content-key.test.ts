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

  it("changes when a sync-point change moves a clip's computed video time", () => {
    // A re-synced game re-cuts every clip — reusing the old render would
    // serve the old cut. This was the v1→v2 gap.
    const synced = (syncVideoTime: number): HighlightContentSegment[] => [
      clip(1, {
        event: { eventId: 1, realWorldTime: "2026-09-14T18:00:30.000Z" },
        syncPoint: { syncVideoTime, syncRealWorldTime: "2026-09-14T18:00:00.000Z" },
      }),
      BASE[1],
      BASE[2],
    ];
    expect(highlightContentKey(synced(35), 10, 3, "16:9")).not.toBe(
      highlightContentKey(synced(38), 10, 3, "16:9"),
    );
    // …and is stable when the sync is unchanged.
    expect(highlightContentKey(synced(35), 10, 3, "16:9")).toBe(
      highlightContentKey(synced(35), 10, 3, "16:9"),
    );
  });

  it("treats a missing sync point as unknown, distinct from any real time", () => {
    const withSync: HighlightContentSegment[] = [
      clip(1, {
        event: { eventId: 1, realWorldTime: "2026-09-14T18:00:30.000Z" },
        syncPoint: { syncVideoTime: 35, syncRealWorldTime: "2026-09-14T18:00:00.000Z" },
      }),
    ];
    expect(highlightContentKey([clip(1)], 10, 3, "16:9")).not.toBe(
      highlightContentKey(withSync, 10, 3, "16:9"),
    );
  });
});
