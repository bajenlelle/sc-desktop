import { describe, expect, it } from "vitest";
import { clipBounds, computeVideoTime, playlistRolls, type SyncPointLike } from "../clip-ship-plan";
import { toSegmentKeyframes as cropPathSegmentKeyframes, type CropKeyframe } from "../crop-path";
import {
  DEFAULT_CARD_SECONDS,
  buildExportPlanSegments,
  exportFrameRate,
  exportItemKey,
  exportPlanFingerprint,
  toSegmentKeyframes,
  type ExportPlanCopy,
  type ExportPlanInput,
  type ExportPlanItem,
  type ExportPlanShape,
} from "../export-plan";
import { exportFrameRate as wireExportFrameRate, type RenderExportSegment } from "../game-video-wire";
import { itemKey } from "../playlist-edits";
import type { PlaylistItem } from "../../types/match";

const kf = (t: number, cx: number): CropKeyframe => ({ t, cx });

/** A deterministic pseudo-random sequence, so the comparisons below cover many shapes and stay reproducible. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
    return s / 4294967296;
  };
}

describe("the restated rules match their sources", () => {
  it("exportFrameRate is game-video-wire's, for every kind of input", () => {
    const fixed = [23.976, 23.98, 24, 24.4, 25, 29.97, 29.9701, 30, 47.95, 50, 59.94, 60, 61, 120, 0.4, 0.6, 1, 0, -5, NaN, Infinity, null, undefined];
    for (const fps of fixed) expect(exportFrameRate(fps)).toBe(wireExportFrameRate(fps));
    const r = rng(7);
    for (let i = 0; i < 2000; i++) {
      const fps = r() * 130 - 5;
      expect(exportFrameRate(fps)).toBe(wireExportFrameRate(fps));
    }
  });

  it("toSegmentKeyframes is crop-path's, on crop-path's own cases", () => {
    const cases: [CropKeyframe[] | undefined, number, number][] = [
      [undefined, 10, 16],
      [[], 10, 16],
      [[kf(12, 0.25), kf(14, 0.75)], 10, 16],
      [[kf(0, 0.2), kf(20, 0.8)], 5, 15],
      [[kf(30, 0.9), kf(2, 0.1), kf(12, 0.5)], 10, 20],
      [[kf(10, 0.25), kf(16, 0.75)], 10, 16],
      [[kf(5, 0.25), kf(10.0005, 0.75)], 10, 16],
      [[kf(15.9995, 0.25)], 10, 16],
      [[kf(5, 0.25)], 10, 10],
      [[kf(0, 0.5), kf(5, 0.25), kf(5, 0.75), kf(10, 0.5)], 2, 9],
    ];
    for (const [kfs, start, end] of cases) expect(toSegmentKeyframes(kfs, start, end)).toEqual(cropPathSegmentKeyframes(kfs, start, end));
  });

  it("toSegmentKeyframes is crop-path's on random pans and windows", () => {
    const r = rng(42);
    for (let i = 0; i < 1000; i++) {
      const n = Math.floor(r() * 7);
      const kfs = Array.from({ length: n }, () => kf(Math.round(r() * 40000) / 1000, Math.round(r() * 10000) / 10000));
      const start = Math.round(r() * 30000) / 1000;
      const end = start + Math.round(r() * 15000) / 1000;
      expect(toSegmentKeyframes(kfs, start, end)).toEqual(cropPathSegmentKeyframes(kfs, start, end));
    }
  });

  it("names items the way the editor's itemKey does", () => {
    const clip = { type: "clip", matchId: "m1", eventId: 42 } as unknown as PlaylistItem;
    const card = { type: "text", id: "c-1", text: "x", durationSeconds: 5 } as unknown as PlaylistItem;
    expect(exportItemKey({ kind: "clip", matchId: "m1", eventId: 42, window: null, cropKeyframes: null })).toBe(itemKey(clip));
    expect(exportItemKey({ kind: "card", id: "c-1", text: "x", durationSeconds: 5, card: null })).toBe(itemKey(card));
  });
});

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

const copyA: ExportPlanCopy = { videoId: "va", durationSeconds: 600, fps: 29.97 };
const copyB: ExportPlanCopy = { videoId: "vb", durationSeconds: 300, fps: 25 };

const clip = (matchId: string, eventId: number, start: number, end: number, cropKeyframes: unknown = null): ExportPlanItem => ({
  kind: "clip",
  matchId,
  eventId,
  window: { start, end },
  cropKeyframes,
});
const card = (id: string, text: string, durationSeconds: number | null = 5, spec: unknown = null): ExportPlanItem => ({
  kind: "card",
  id,
  text,
  durationSeconds,
  card: spec,
});

function plan(over: Partial<ExportPlanInput> = {}) {
  return buildExportPlanSegments({
    aspect: "16:9",
    items: [clip("a", 1, 10, 23), card("c1", "Half time"), clip("b", 2, 40, 53), clip("a", 3, 100, 113)],
    selection: null,
    copies: new Map([
      ["a", copyA],
      ["b", copyB],
    ]),
    ...over,
  });
}

describe("buildExportPlanSegments", () => {
  it("keeps the playlist's order, cards included, with no pan at 16:9", () => {
    const p = plan();
    expect(p.segments).toEqual([
      { kind: "clip", matchId: "a", eventId: 1, videoId: "va", start: 10, end: 23, keyframes: null },
      { kind: "card", durationSeconds: 5, text: "Half time", card: null },
      { kind: "clip", matchId: "b", eventId: 2, videoId: "vb", start: 40, end: 53, keyframes: null },
      { kind: "clip", matchId: "a", eventId: 3, videoId: "va", start: 100, end: 113, keyframes: null },
    ]);
    expect(p).toMatchObject({ clips: 3, cards: 1, noCopy: [], dropped: [] });
  });

  it("renders at the first clip's copy rate", () => {
    expect(plan().rate).toBe("30000/1001");
    expect(plan({ items: [clip("b", 2, 40, 53), clip("a", 1, 10, 23)] }).rate).toBe("25");
    // A copy without a recorded rate (a desktop upload): "" — the renderer probes the copy.
    expect(plan({ copies: new Map([["a", { ...copyA, fps: null }], ["b", copyB]]) }).rate).toBe("");
    // Cards alone: no copy to take a rate from — the renderer's 30.
    expect(plan({ items: [card("c1", "Only a card")] }).rate).toBe("");
  });

  it("takes the rate from the first clip that is kept, not one that was dropped", () => {
    const p = plan({ items: [clip("b", 9, 299.9, 310), clip("a", 1, 10, 23)] });
    expect(p.dropped).toEqual([{ matchId: "b", eventId: 9, reason: "past_end" }]);
    expect(p.rate).toBe("30000/1001");
  });

  it("exports a selection in the playlist's order, cards by their text: key", () => {
    const p = plan({ selection: ["a:3", "text:c1", "a:1", "nope:7"] });
    expect(p.segments.map((s) => (s.kind === "clip" ? `${s.matchId}:${s.eventId}` : `text:${s.text}`))).toEqual(["a:1", "text:Half time", "a:3"]);
    expect(p).toMatchObject({ clips: 2, cards: 1 });
    expect(plan({ selection: ["b:2"] }).segments).toHaveLength(1);
    expect(plan({ selection: [] }).segments).toHaveLength(0);
  });

  it("drops a play without a time, and reports games without a copy per game", () => {
    const p = plan({
      items: [clip("a", 1, 10, 23), { kind: "clip", matchId: "a", eventId: 5, window: null, cropKeyframes: null }, clip("x", 7, 5, 18), clip("x", 8, 30, 43), clip("y", 1, 2, 15)],
    });
    expect(p.segments).toHaveLength(1);
    expect(p.dropped).toEqual([{ matchId: "a", eventId: 5, reason: "no_time" }]);
    expect(p.noCopy).toEqual([
      { matchId: "x", eventIds: [7, 8] },
      { matchId: "y", eventIds: [1] },
    ]);
  });

  it("drops a clip that starts in its copy's last quarter-second or after it (the desktop's rule)", () => {
    const p = plan({ items: [clip("b", 1, 299.75, 312), clip("b", 2, 350, 363), clip("b", 3, 299.74, 312)] });
    expect(p.dropped).toEqual([
      { matchId: "b", eventId: 1, reason: "past_end" },
      { matchId: "b", eventId: 2, reason: "past_end" },
    ]);
    // Kept, and its window cut at the copy's end: ffmpeg stops there anyway, and the fade-out lands on footage.
    expect(p.segments).toEqual([{ kind: "clip", matchId: "b", eventId: 3, videoId: "vb", start: 299.74, end: 300, keyframes: null }]);
  });

  it("keeps clips of a copy whose length is unknown, uncut", () => {
    const p = plan({ items: [clip("a", 1, 5000, 5013)], copies: new Map([["a", { ...copyA, durationSeconds: null }]]) });
    expect(p.segments).toEqual([{ kind: "clip", matchId: "a", eventId: 1, videoId: "va", start: 5000, end: 5013, keyframes: null }]);
  });

  it("rebases a 9:16 clip's pan onto the clip, exactly as crop-path does; no pan is the centre", () => {
    const pan = [kf(12, 0.25), kf(20, 0.75), kf(30, 0.4)];
    const p = plan({ aspect: "9:16", items: [clip("a", 1, 10, 23, pan), clip("a", 2, 40, 53)] });
    const [first, second] = p.segments as Extract<RenderExportSegment, { kind: "clip" }>[];
    expect(first.keyframes).toEqual(cropPathSegmentKeyframes(pan, 10, 23));
    // Clip time from the seek point: the hold before the first keyframe, the two inside, the path's value at the end.
    expect(first.keyframes?.map((k) => k.t)).toEqual([0, 2, 10, 13]);
    expect(first.keyframes?.map((k) => k.cx)[3]).toBeCloseTo(0.645, 12);
    expect(second.keyframes).toEqual([{ t: 0, cx: 0.5 }]);
  });

  it("rebases onto the cut window when the copy ends inside the clip", () => {
    const pan = [kf(290, 0.3), kf(310, 0.7)];
    const p = plan({ aspect: "9:16", items: [clip("b", 1, 295, 308, pan)] });
    const seg = p.segments[0] as Extract<RenderExportSegment, { kind: "clip" }>;
    expect(seg.end).toBe(300);
    expect(seg.keyframes).toEqual(cropPathSegmentKeyframes(pan, 295, 300));
  });

  it("ignores a stored pan it can't read", () => {
    const p = plan({ aspect: "9:16", items: [clip("a", 1, 10, 23, [{ t: "12", cx: 0.2 }, null, { t: 14 }, "x"]), clip("a", 2, 30, 43, { t: 1, cx: 0.2 })] });
    expect(p.segments.map((s) => (s.kind === "clip" ? s.keyframes : null))).toEqual([[{ t: 0, cx: 0.5 }], [{ t: 0, cx: 0.5 }]]);
    const mixed = plan({ aspect: "9:16", items: [clip("a", 1, 10, 23, [{ t: "12", cx: 0.2 }, { t: 15, cx: 0.8 }])] });
    expect((mixed.segments[0] as Extract<RenderExportSegment, { kind: "clip" }>).keyframes).toEqual(cropPathSegmentKeyframes([kf(15, 0.8)], 10, 23));
  });

  it("passes a stats card's spec through and holds a card's length to 1–60 s", () => {
    const spec = { v: 1, kind: "game", player: { name: "A" } };
    const p = plan({ items: [card("s1", "A · 12 pts", 6, spec), card("c2", "x", null), card("c3", "y", 0), card("c4", "z", 0.4), card("c5", "w", 600), card("c6", "v", NaN)] });
    expect(p.segments).toEqual([
      { kind: "card", durationSeconds: 6, text: "A · 12 pts", card: spec },
      { kind: "card", durationSeconds: DEFAULT_CARD_SECONDS, text: "x", card: null },
      { kind: "card", durationSeconds: DEFAULT_CARD_SECONDS, text: "y", card: null },
      { kind: "card", durationSeconds: 1, text: "z", card: null },
      { kind: "card", durationSeconds: 60, text: "w", card: null },
      { kind: "card", durationSeconds: DEFAULT_CARD_SECONDS, text: "v", card: null },
    ]);
    expect(p).toMatchObject({ clips: 0, cards: 6 });
  });

  it("takes the windows the function computes with clip-ship-plan, as the ship plan does", () => {
    // The function's side: computeVideoTime(event, sync) → clipBounds with the playlist's pair and the clip's offsets.
    const sync: SyncPointLike = { syncVideoTime: 10, syncRealWorldTime: "2026-10-04T13:00:00.000Z" };
    const pair = playlistRolls({ preRoll: null, postRoll: null });
    const events = [
      { eventId: 1001, realWorldTime: "2026-10-04T13:00:00.000Z", period: 1, pre: 0, post: 0 },
      { eventId: 1002, realWorldTime: "2026-10-04T13:00:02.000Z", period: 1, pre: -2, post: 1.5 },
      { eventId: 1003, realWorldTime: null, period: 1, pre: 0, post: 0 },
    ];
    const items: ExportPlanItem[] = events.map((e) => {
      const t = computeVideoTime({ realWorldTime: e.realWorldTime, period: e.period }, sync);
      return { kind: "clip", matchId: "m", eventId: e.eventId, window: t === null ? null : clipBounds(t, pair.pre, pair.post, e.pre, e.post), cropKeyframes: null };
    });
    const p = buildExportPlanSegments({ aspect: "16:9", items, selection: null, copies: new Map([["m", copyA]]) });
    expect(p.segments.map((s) => (s.kind === "clip" ? [s.start, s.end] : null))).toEqual([
      [0, 13],
      [4, 16.5],
    ]);
    expect(p.dropped).toEqual([{ matchId: "m", eventId: 1003, reason: "no_time" }]);
  });

  it("treats a window that isn't one as no time", () => {
    const bad: ExportPlanItem[] = [
      { kind: "clip", matchId: "a", eventId: 1, window: { start: NaN, end: 5 }, cropKeyframes: null },
      { kind: "clip", matchId: "a", eventId: 2, window: { start: 5, end: 5 }, cropKeyframes: null },
      { kind: "clip", matchId: "a", eventId: 3, window: { start: -1, end: 5 }, cropKeyframes: null },
    ];
    expect(plan({ items: bad }).dropped.map((d) => d.reason)).toEqual(["no_time", "no_time", "no_time"]);
  });
});

// ---------------------------------------------------------------------------
// The fingerprint
// ---------------------------------------------------------------------------

describe("exportPlanFingerprint", () => {
  const spec = { v: 1, kind: "game", player: { name: "A", number: 7 }, columns: ["pts", "reb"] };
  const base: ExportPlanShape = {
    aspect: "9:16",
    watermark: true,
    rate: "30000/1001",
    segments: [
      { kind: "clip", matchId: "a", eventId: 1, videoId: "va", start: 10, end: 23, keyframes: [{ t: 0, cx: 0.25 }, { t: 13, cx: 0.75 }] },
      { kind: "card", durationSeconds: 5, text: "Half time", card: spec },
      { kind: "clip", matchId: "b", eventId: 2, videoId: "vb", start: 40, end: 53, keyframes: [{ t: 0, cx: 0.5 }] },
    ],
  };
  const fp = exportPlanFingerprint(base);
  const clipAt = (i: number) => base.segments[i] as Extract<RenderExportSegment, { kind: "clip" }>;
  const withSegment = (i: number, s: RenderExportSegment): ExportPlanShape => ({ ...base, segments: base.segments.map((x, j) => (j === i ? s : x)) });

  it("is a short, stable token", () => {
    expect(fp).toMatch(/^ep1-[0-9a-z]+$/);
    expect(exportPlanFingerprint(structuredClone(base))).toBe(fp);
  });

  it("reads a spec the same whatever order its keys come in, and ignores float noise under a millisecond", () => {
    const reordered = { columns: ["pts", "reb"], player: { number: 7, name: "A" }, kind: "game", v: 1 };
    expect(exportPlanFingerprint(withSegment(1, { kind: "card", durationSeconds: 5, text: "Half time", card: reordered }))).toBe(fp);
    expect(exportPlanFingerprint(withSegment(0, { ...clipAt(0), start: 10.0000001, end: 22.9999999 }))).toBe(fp);
  });

  it("changes with anything that shapes the file", () => {
    const changed: ExportPlanShape[] = [
      { ...base, aspect: "16:9" },
      { ...base, watermark: false },
      { ...base, rate: "25" },
      { ...base, segments: [base.segments[2], base.segments[1], base.segments[0]] },
      { ...base, segments: base.segments.slice(0, 2) },
      withSegment(0, { ...clipAt(0), start: 10.1 }),
      withSegment(0, { ...clipAt(0), end: 23.5 }),
      withSegment(0, { ...clipAt(0), videoId: "va2" }),
      withSegment(0, { ...clipAt(0), eventId: 9 }),
      withSegment(0, { ...clipAt(0), keyframes: [{ t: 0, cx: 0.3 }, { t: 13, cx: 0.75 }] }),
      withSegment(0, { ...clipAt(0), keyframes: null }),
      withSegment(1, { kind: "card", durationSeconds: 6, text: "Half time", card: spec }),
      withSegment(1, { kind: "card", durationSeconds: 5, text: "Full time", card: spec }),
      withSegment(1, { kind: "card", durationSeconds: 5, text: "Half time", card: { ...spec, columns: ["pts"] } }),
      withSegment(1, { kind: "card", durationSeconds: 5, text: "Half time", card: null }),
    ];
    const prints = changed.map(exportPlanFingerprint);
    for (const p of prints) expect(p).not.toBe(fp);
    expect(new Set(prints).size).toBe(prints.length);
  });
});
