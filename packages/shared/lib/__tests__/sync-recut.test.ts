import { describe, expect, it } from "vitest";
import type { SyncPoint } from "../../types/match";
import { clipShipKey, shippedStart, shippedTotals } from "../clip-timing";
import { movedClipRolls, planSyncRecut } from "../sync-recut";

const url = (pre: number, post: number, start: number) => "https://media.scoutable.se/" + clipShipKey("m1", 42, pre, post, start);

describe("shippedTotals / shippedStart", () => {
  it("read the cut back from a shipped clip's key", () => {
    expect(shippedTotals(url(8, 5, 754.2))).toEqual({ pre: 8, post: 5 });
    expect(shippedStart(url(8, 5, 754.2))).toBe(754.2);
  });

  it("read negative totals (a trim past the play)", () => {
    expect(shippedTotals("https://x/clips/m1/42_pre-2.0_post6.5_s10.0.mp4")).toEqual({ pre: -2, post: 6.5 });
  });

  it("find no start in a key minted before the start was part of it", () => {
    expect(shippedStart("https://x/clips/m1/42_pre10.0_post3.0.mp4")).toBeNull();
    expect(shippedTotals("https://x/clips/m1/42_pre10.0_post3.0.mp4")).toEqual({ pre: 10, post: 3 });
  });

  it("find nothing in a URL that isn't a clip key", () => {
    expect(shippedTotals("https://x/highlights/a/b.mp4")).toBeNull();
    expect(shippedStart("https://x/highlights/a/b.mp4")).toBeNull();
  });
});

describe("movedClipRolls", () => {
  // Tip-off at 0:42 in the video; the play is 10 min later on the wall clock.
  const sync: SyncPoint = { syncVideoTime: 42, syncRealWorldTime: "2026-09-20T17:30:00Z" };
  const event = { realWorldTime: "2026-09-20T17:40:00Z", period: 1 };
  // The play sits at 642 s, so a clip cut 8 s before it starts at 634.
  const shipped8x5 = { r2Url: url(8, 5, 634) };

  it("leaves a clip whose cut didn't move alone, whatever length it was cut at", () => {
    expect(movedClipRolls(shipped8x5, event, sync)).toBeNull();
  });

  it("returns the clip's own rolls when the sync moved its cut", () => {
    const later: SyncPoint = { ...sync, syncVideoTime: 54 };
    expect(movedClipRolls(shipped8x5, event, later)).toEqual({ pre: 8, post: 5 });
  });

  it("takes the clip's own offsets out of the rolls", () => {
    const later: SyncPoint = { ...sync, syncVideoTime: 54 };
    // Playlist rolls 10/3, this clip trimmed to 9.5 before and 4 after.
    const trimmed = { r2Url: url(9.5, 4, 632.5), preRollOffset: -0.5, postRollOffset: 1 };
    expect(movedClipRolls(trimmed, event, sync)).toBeNull();
    expect(movedClipRolls(trimmed, event, later)).toEqual({ pre: 10, post: 3 });
  });

  it("ignores a move smaller than the key's tenths", () => {
    expect(movedClipRolls(shipped8x5, event, { ...sync, syncVideoTime: 42.04 })).toBeNull();
  });

  it("can't compare an unshipped clip, a key without a start, or a play without a time", () => {
    const later: SyncPoint = { ...sync, syncVideoTime: 54 };
    expect(movedClipRolls({}, event, later)).toBeNull();
    expect(movedClipRolls({ r2Url: "https://x/clips/m1/42_pre8.0_post5.0.mp4" }, event, later)).toBeNull();
    expect(movedClipRolls(shipped8x5, { period: 1 }, later)).toBeNull();
  });

  it("follows a quarter's own sync", () => {
    const q2 = { realWorldTime: "2026-09-20T17:50:00Z", period: 2 };
    // Q1 sync puts it at 1242; Q2's own sync moves it to 1100.
    const cut = { r2Url: url(8, 5, 1234) };
    expect(movedClipRolls(cut, q2, sync)).toBeNull();
    const withQ2: SyncPoint = { ...sync, periods: { "2": { syncVideoTime: 1100, syncRealWorldTime: "2026-09-20T17:50:00Z" } } };
    expect(movedClipRolls(cut, q2, withQ2)).toEqual({ pre: 8, post: 5 });
  });
});

describe("planSyncRecut", () => {
  const sync: SyncPoint = { syncVideoTime: 54, syncRealWorldTime: "2026-09-20T17:30:00Z" };
  const events = new Map([
    [42, { realWorldTime: "2026-09-20T17:40:00Z", period: 1 }],
    [43, { realWorldTime: "2026-09-20T17:41:00Z", period: 1 }],
  ]);
  const moved = { playlistId: "p1", clip: { eventId: 42, r2Url: url(8, 5, 634) } };
  const still = { playlistId: "p1", clip: { eventId: 43, r2Url: "https://media.scoutable.se/" + clipShipKey("m1", 43, 10, 3, 704) } };

  it("re-cuts the moved clips with their own rolls when the video can be cut", () => {
    const plan = planSyncRecut([moved, still], events, sync, true);
    expect(plan.recut).toEqual([{ row: moved, rolls: { pre: 8, post: 5 } }]);
    expect(plan.hide).toEqual([]);
  });

  it("hides the moved clips when the video can't be cut, so none plays the wrong moment", () => {
    const plan = planSyncRecut([moved, still], events, sync, false);
    expect(plan.recut).toEqual([]);
    expect(plan.hide).toEqual([moved]);
  });

  it("skips clips whose play isn't in the game anymore", () => {
    const orphan = { playlistId: "p1", clip: { eventId: 99, r2Url: url(8, 5, 634) } };
    expect(planSyncRecut([orphan], events, sync, true)).toEqual({ recut: [], hide: [] });
  });
});

describe("movedClipRolls on trimmed clips (review fix)", () => {
  const sync: SyncPoint = { syncVideoTime: 42, syncRealWorldTime: "2026-09-20T17:30:00Z" };
  // The play sits at 100.0 s; trims are stored in hundredths, keys in tenths.
  const event = { realWorldTime: "2026-09-20T17:30:58Z", period: 1 };

  it("doesn't call a clip moved when only the key's rounding differs", () => {
    // Rolls 10/3, trimmed by -0.25: cut from 90.25, key says pre9.8 and s90.3.
    const trimmed = { r2Url: url(9.75, 3, 90.25), preRollOffset: -0.25 };
    expect(trimmed.r2Url).toContain("_pre9.8_post3.0_s90.3.mp4");
    expect(movedClipRolls(trimmed, event, sync)).toBeNull();
  });

  it("still sees a real move of a third of a second", () => {
    const trimmed = { r2Url: url(9.75, 3, 90.25), preRollOffset: -0.25 };
    expect(movedClipRolls(trimmed, event, { ...sync, syncVideoTime: 42.3 })).not.toBeNull();
  });

  it("rounds the rolls it hands back to hundredths", () => {
    const trimmed = { r2Url: url(9.75, 3, 90.25), preRollOffset: -0.25 };
    expect(movedClipRolls(trimmed, event, { ...sync, syncVideoTime: 50 })).toEqual({ pre: 10.05, post: 3 });
  });
});
