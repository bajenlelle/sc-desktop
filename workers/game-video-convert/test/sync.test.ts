import assert from "node:assert/strict";
import { test } from "node:test";
import type { DetectResult } from "@scoutable/shared/lib/tipoff-detect";
import { detectStageFraction, syncFromDetection, syncFromHint, syncSkipReason } from "../src/sync.ts";

const stats = { apiCalls: 1, frames: 1, elapsedMs: 1 };

test("syncSkipReason: Profixio games and games without an anchor time skip hints and detection", () => {
  assert.equal(syncSkipReason({ isProfixio: true, anchorRealWorldTime: "2026-10-01T18:00:00Z" }), "profixio");
  assert.equal(syncSkipReason({ isProfixio: false, anchorRealWorldTime: null }), "no_anchor_time");
  assert.equal(syncSkipReason({ isProfixio: false, anchorRealWorldTime: "2026-10-01T18:00:00Z" }), null);
});

test("syncFromHint: confirmed hints are taken as is, automatic ones as estimates with their confidence", () => {
  assert.deepEqual(syncFromHint({ method: "confirmed", tipoffVideoTime: 252.3, confidence: 0.9 }), { outcome: "confirmed", seconds: 252.3 });
  assert.deepEqual(syncFromHint({ method: "auto", tipoffVideoTime: 252.3, confidence: 0.92 }), { outcome: "estimate", seconds: 252.3, confidence: 0.92 });
  assert.deepEqual(syncFromHint({ method: "auto", tipoffVideoTime: 10, confidence: null }), { outcome: "estimate", seconds: 10 });
});

test("syncFromDetection: found → estimate with the detector's confidence", () => {
  const found: DetectResult = { outcome: "found", estimate: { seconds: 301.5, confidence: 0.92, basis: "clock_transition" }, view: "overlay", stats, readings: [], fine: [] };
  assert.deepEqual(syncFromDetection(found), { outcome: "estimate", seconds: 301.5, confidence: 0.92 });
});

test("syncFromDetection: a recording that starts after the tip-off is a weak estimate, or nothing without a figure", () => {
  const withEstimate: DetectResult = { outcome: "starts_after_tipoff", estimateS: -42, firstClock: "9:18", view: "overlay", stats, readings: [] };
  assert.deepEqual(syncFromDetection(withEstimate), { outcome: "estimate", seconds: -42, confidence: 0.5 });
  const without: DetectResult = { outcome: "starts_after_tipoff", estimateS: null, firstClock: null, view: "whole", stats, readings: [] };
  assert.deepEqual(syncFromDetection(without), { outcome: "not_found" });
});

test("syncFromDetection: not found and cancelled are not_found", () => {
  assert.deepEqual(syncFromDetection({ outcome: "not_found", view: "whole", stats, readings: [] }), { outcome: "not_found" });
  assert.deepEqual(syncFromDetection({ outcome: "cancelled", stats }), { outcome: "not_found" });
});

test("detectStageFraction: stages advance along the detector's share of the bar", () => {
  const stages = (["locate", "coarse", "narrow", "fine"] as const).map((stage) => detectStageFraction({ stage, done: 0, total: 1 }));
  assert.deepEqual(stages, [0.05, 0.2, 0.5, 0.7]);
});
