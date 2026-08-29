import { describe, expect, it } from "vitest";
import {
  groupShipFailures,
  mergeShipResults,
  type ClipShipFailure,
  type ClipShipResult,
} from "../ship-result";

function failure(partial: Partial<ClipShipFailure>): ClipShipFailure {
  return { matchId: "m1", eventId: 1, message: "ffmpeg exited with code 1", ...partial };
}

function result(partial: Partial<ClipShipResult>): ClipShipResult {
  return { shipped: 0, skipped: 0, failures: [], uploaded: [], aborted: false, ...partial };
}

describe("groupShipFailures", () => {
  it("dedupes identical messages into one row with a count", () => {
    const rows = groupShipFailures([
      failure({ eventId: 1, message: "network timeout" }),
      failure({ eventId: 2, message: "network timeout" }),
      failure({ eventId: 3, message: "disk full" }),
    ]);
    expect(rows).toEqual([
      { message: "network timeout", count: 2 },
      { message: "disk full", count: 1 },
    ]);
  });

  it("sorts by count descending regardless of arrival order", () => {
    const rows = groupShipFailures([
      failure({ eventId: 1, message: "rare" }),
      failure({ eventId: 2, message: "common" }),
      failure({ eventId: 3, message: "common" }),
      failure({ eventId: 4, message: "common" }),
    ]);
    expect(rows.map((r) => r.message)).toEqual(["common", "rare"]);
  });

  it("keeps first-seen order on count ties", () => {
    // Map preserves insertion order and the sort is stable, so equal counts
    // stay in the order their message first appeared.
    const rows = groupShipFailures([
      failure({ eventId: 1, message: "b" }),
      failure({ eventId: 2, message: "a" }),
    ]);
    expect(rows.map((r) => r.message)).toEqual(["b", "a"]);
  });

  it("truncates to max (default 3) after sorting, keeping the biggest rows", () => {
    const failures = [
      failure({ eventId: 1, message: "one" }),
      failure({ eventId: 2, message: "two" }),
      failure({ eventId: 3, message: "two" }),
      failure({ eventId: 4, message: "three" }),
      failure({ eventId: 5, message: "three" }),
      failure({ eventId: 6, message: "three" }),
      failure({ eventId: 7, message: "four" }),
    ];
    expect(groupShipFailures(failures).map((r) => r.message)).toEqual(["three", "two", "one"]);
    expect(groupShipFailures(failures, 2)).toEqual([
      { message: "three", count: 3 },
      { message: "two", count: 2 },
    ]);
  });

  it("is empty for empty input", () => {
    expect(groupShipFailures([])).toEqual([]);
  });
});

describe("mergeShipResults", () => {
  it("sums shipped and skipped across the two runs", () => {
    const merged = mergeShipResults(
      result({ shipped: 3, skipped: 2 }),
      result({ shipped: 1, skipped: 4 }),
    );
    expect(merged.shipped).toBe(4);
    expect(merged.skipped).toBe(6);
  });

  it("concatenates uploads with the first run's before the retry's", () => {
    const a = { matchId: "m1", eventId: 1, r2Url: "https://r2/1.mp4" };
    const b = { matchId: "m1", eventId: 2, r2Url: "https://r2/2.mp4" };
    const merged = mergeShipResults(result({ uploaded: [a] }), result({ uploaded: [b] }));
    expect(merged.uploaded).toEqual([a, b]);
  });

  it("takes failures from the retry exactly — the first run's are replaced", () => {
    const remaining = [failure({ eventId: 2, message: "still failing" })];
    const merged = mergeShipResults(
      result({ failures: [failure({ eventId: 1 }), failure({ eventId: 2 })] }),
      result({ failures: remaining }),
    );
    expect(merged.failures).toBe(remaining);
  });

  it("clears failures when the retry succeeded, even if the first run had some", () => {
    const merged = mergeShipResults(
      result({ failures: [failure({ eventId: 1 })] }),
      result({ shipped: 1 }),
    );
    expect(merged.failures).toEqual([]);
  });

  it("takes aborted from the retry only", () => {
    expect(mergeShipResults(result({ aborted: true }), result({})).aborted).toBe(false);
    expect(mergeShipResults(result({}), result({ aborted: true })).aborted).toBe(true);
  });
});
