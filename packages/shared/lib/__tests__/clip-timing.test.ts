import { describe, expect, it } from "vitest";
import type { PlayByPlayEvent, SyncPoint } from "../../types/match";
import {
  clipBounds,
  clipShipKey,
  computeVideoTime,
  formatClipTime,
  isShippedClipStale,
  isWatchedPosition,
  playlistRolls,
  rebaseOffsets,
  shippedTotals,
} from "../clip-timing";

function ev(partial: Partial<PlayByPlayEvent>): PlayByPlayEvent {
  return partial as PlayByPlayEvent;
}

const sync: SyncPoint = { syncVideoTime: 120, syncRealWorldTime: "2026-01-01T12:00:00Z" };

describe("computeVideoTime", () => {
  it("offsets from the sync point in seconds", () => {
    expect(computeVideoTime(ev({ realWorldTime: "2026-01-01T12:01:30Z" }), sync)).toBe(210);
  });

  it("lands before the sync video time for earlier events", () => {
    const t = computeVideoTime(ev({ realWorldTime: "2026-01-01T11:59:00Z" }), sync);
    expect(t).toBe(60);
    expect(t!).toBeLessThan(sync.syncVideoTime);
  });

  it("is null when either timestamp is missing or unparseable", () => {
    expect(computeVideoTime(ev({}), sync)).toBeNull();
    expect(
      computeVideoTime(
        ev({ realWorldTime: "2026-01-01T12:01:30Z" }),
        { syncVideoTime: 120, syncRealWorldTime: "" },
      ),
    ).toBeNull();
    expect(computeVideoTime(ev({ realWorldTime: "not a date" }), sync)).toBeNull();
    expect(
      computeVideoTime(
        ev({ realWorldTime: "2026-01-01T12:01:30Z" }),
        { syncVideoTime: 120, syncRealWorldTime: "not a date" },
      ),
    ).toBeNull();
  });
});

describe("clipBounds", () => {
  it("clamps the start at zero", () => {
    expect(clipBounds(2, 5, 3)).toEqual({ start: 0, end: 5 });
  });

  it("adds offsets on both sides", () => {
    expect(clipBounds(100, 5, 3, 2, 4)).toEqual({ start: 93, end: 107 });
  });

  it("defaults offsets to zero", () => {
    expect(clipBounds(100, 5, 3)).toEqual({ start: 95, end: 103 });
  });
});

describe("clipShipKey", () => {
  // GOLDEN: this exact string addresses already-uploaded R2 objects — if it
  // changes, every previously shipped clip is orphaned. The format changed
  // ONCE, deliberately, when sync-point invalidation shipped: the computed
  // start second joined the key (`_s`) so a re-synced game mints fresh URLs
  // that no browser/CDN cache can satisfy with the old cut. The presign edge
  // function's CLIP_KEY allowlist accepts BOTH formats (older desktop builds
  // still mint the _s-less shape). Never change this again without the same
  // treatment.
  it("formats the R2 object key with one-decimal rolls and start", () => {
    expect(clipShipKey("m1", 42, 5, 3, 754.2)).toBe("clips/m1/42_pre5.0_post3.0_s754.2.mp4");
  });

  it("rounds fractions with toFixed(1) semantics", () => {
    // (5.25).toFixed(1) === "5.3" (tie rounds up); (3.05).toFixed(1) === "3.0"
    // (3.05 is stored below the tie in binary) — both pinned as-is.
    expect(clipShipKey("m1", 7, 5.25, 3.05, 0)).toBe("clips/m1/7_pre5.3_post3.0_s0.0.mp4");
  });

  it("a sync-point change (different start) yields a different key", () => {
    expect(clipShipKey("m1", 42, 5, 3, 754.2)).not.toBe(clipShipKey("m1", 42, 5, 3, 751.2));
  });
});

describe("isWatchedPosition", () => {
  it("marks watched 3 seconds before the end of a normal-length clip", () => {
    expect(isWatchedPosition(12, 15)).toBe(true);
    expect(isWatchedPosition(11.9, 15)).toBe(false);
  });

  it("is watched exactly at the duration-minus-3 boundary", () => {
    expect(isWatchedPosition(7, 10)).toBe(true);
  });

  it("floors at 50% so short clips aren't watched moments after starting", () => {
    // 4s clip: duration - 3 = 1s, but the 50% floor demands 2s.
    expect(isWatchedPosition(1, 4)).toBe(false);
    expect(isWatchedPosition(2, 4)).toBe(true);
  });

  it("uses the 3-second rule once it exceeds the floor", () => {
    // 6s clip: max(3, 3) — both rules agree at 3s.
    expect(isWatchedPosition(2.9, 6)).toBe(false);
    expect(isWatchedPosition(3, 6)).toBe(true);
  });

  it("never marks watched for invalid durations", () => {
    expect(isWatchedPosition(5, 0)).toBe(false);
    expect(isWatchedPosition(5, NaN)).toBe(false);
    expect(isWatchedPosition(5, Infinity)).toBe(false);
    expect(isWatchedPosition(5, -1)).toBe(false);
  });
});

describe("formatClipTime", () => {
  it("shows minutes, seconds and tenths", () => {
    expect(formatClipTime(7.44)).toBe("0:07.4");
    expect(formatClipTime(62)).toBe("1:02.0");
    expect(formatClipTime(0)).toBe("0:00.0");
  });

  it("never goes negative", () => {
    expect(formatClipTime(-3)).toBe("0:00.0");
  });

  it("carries a rounded minute instead of showing 60 seconds", () => {
    expect(formatClipTime(59.96)).toBe("1:00.0");
    expect(formatClipTime(119.99)).toBe("2:00.0");
  });
});

describe("playlistRolls", () => {
  it("uses the playlist's saved pair, else the 10 s / 3 s default", () => {
    expect(playlistRolls({ preRoll: 15, postRoll: 5 })).toEqual({ pre: 15, post: 5 });
    expect(playlistRolls({ preRoll: 0, postRoll: 0 })).toEqual({ pre: 0, post: 0 });
    expect(playlistRolls({})).toEqual({ pre: 10, post: 3 });
    expect(playlistRolls(null)).toEqual({ pre: 10, post: 3 });
    expect(playlistRolls({ postRoll: 6 }, { pre: 12, post: 4 })).toEqual({ pre: 12, post: 6 });
  });
});

describe("shippedTotals", () => {
  const base = "https://pub-x.r2.dev/";
  it("reads the totals back from both key formats clipShipKey has written", () => {
    expect(shippedTotals(base + clipShipKey("m1", 42, 15, 5, 754.2))).toEqual({ pre: 15, post: 5 });
    expect(shippedTotals(base + "clips/m1/42_pre9.5_post3.0.mp4")).toEqual({ pre: 9.5, post: 3 });
  });

  it("returns null for anything else", () => {
    expect(shippedTotals(base + "highlights/abc.mp4")).toBeNull();
    expect(shippedTotals("")).toBeNull();
  });
});

describe("isShippedClipStale", () => {
  const url = (pre: number, post: number) => "https://pub-x.r2.dev/" + clipShipKey("m1", 42, pre, post, 100);

  it("is fresh when the file was cut with the pair plus the clip's offsets", () => {
    expect(isShippedClipStale({ r2Url: url(10, 3) }, { pre: 10, post: 3 })).toBe(false);
    expect(isShippedClipStale({ r2Url: url(12.5, 2), preRollOffset: 2.5, postRollOffset: -1 }, { pre: 10, post: 3 })).toBe(false);
  });

  it("is stale once the pair changes", () => {
    expect(isShippedClipStale({ r2Url: url(10, 3) }, { pre: 15, post: 3 })).toBe(true);
    expect(isShippedClipStale({ r2Url: url(10, 3) }, { pre: 10, post: 5 })).toBe(true);
  });

  it("is never stale when unshipped or the key format is unknown", () => {
    expect(isShippedClipStale({}, { pre: 15, post: 5 })).toBe(false);
    expect(isShippedClipStale({ r2Url: "https://pub-x.r2.dev/odd.mp4" }, { pre: 15, post: 5 })).toBe(false);
  });
});

describe("rebaseOffsets", () => {
  it("keeps a clip's length under another pair", () => {
    const r = rebaseOffsets({ preRollOffset: 2, postRollOffset: -1 }, { pre: 15, post: 5 }, { pre: 10, post: 3 });
    expect(r).toEqual({ preRollOffset: 7, postRollOffset: 1 });
    // Same effective totals before and after: 15+2 = 10+7, 5−1 = 3+1.
  });

  it("turns a previewed pair into offsets on the playlist's pair", () => {
    expect(rebaseOffsets({}, { pre: 15, post: 3 }, { pre: 10, post: 3 })).toEqual({ preRollOffset: 5, postRollOffset: 0 });
  });

  it("is a no-op between equal pairs and keeps hundredths", () => {
    expect(rebaseOffsets({ preRollOffset: 0.35 }, { pre: 10, post: 3 }, { pre: 10, post: 3 })).toEqual({ preRollOffset: 0.35, postRollOffset: 0 });
  });
});
