import { describe, expect, it } from "vitest";
import { clipShipKey } from "../clip-ship-plan";
import {
  CLIP_SHIP_KEY_RE,
  isSyncTime,
  mediaClipKeyFromUrl,
  mediaPurgePrefix,
  mediaPurgeScopeOf,
  parseSyncPeriodsPayload,
  syncPeriodsPayloadOf,
} from "../game-video-wire";
import { clearPeriodSync, normalizeSyncPoint, setPeriodSync, shiftPeriod, shiftWholeGame, type PeriodEvent } from "../period-sync";
import type { SyncPoint } from "../../types/match";

const T = (hms: string) => `2026-09-20T${hms}Z`;
const q2 = { syncVideoTime: 1392, syncRealWorldTime: T("17:54:30"), anchor: { kind: "first_basket" as const, label: "Lidingö's first basket of Q2 (20–15)" } };

describe("isSyncTime", () => {
  it("takes ISO 8601 with a zone, as the import and PostgREST write them", () => {
    for (const s of ["2026-09-20T17:30:00Z", "2026-09-20T17:30:00.000Z", "2026-09-20T17:30:00.123456Z", "2026-09-20T17:30:00+00:00", "2026-09-20T19:30:00+02:00", "2026-09-20T17:30Z"]) {
      expect(isSyncTime(s), s).toBe(true);
    }
  });

  it("refuses times without a zone, other shapes and days the calendar hasn't", () => {
    for (const s of ["2026-09-20T17:30:00", "2026-09-20 17:30:00Z", "2026-09-20T17:30:00+00", "2026-02-30T17:30:00Z", "2026-09-20T24:00:00Z", "2026-13-01T00:00:00Z", "yesterday", ""]) {
      expect(isSyncTime(s), s).toBe(false);
    }
    expect(isSyncTime(1789925400000)).toBe(false);
    expect(isSyncTime(null)).toBe(false);
  });
});

describe("parseSyncPeriodsPayload", () => {
  const good = {
    periods: { "2": q2, "5": { syncVideoTime: 5100, syncRealWorldTime: T("19:15:00") } },
    syncVideoTime: -15,
    marks: { "1": { startRealWorldTime: T("17:30:00"), endRealWorldTime: T("17:52:00"), anchor: { realWorldTime: T("17:30:00"), kind: "period_start", label: "Start of Q1" } } },
    breaksCut: true,
  };

  it("keeps a good payload, field for field", () => {
    expect(parseSyncPeriodsPayload(good)).toEqual(good);
  });

  it("leaves out fields it doesn't know, and null anchors and mark times", () => {
    const parsed = parseSyncPeriodsPayload({
      periods: { "2": { ...q2, junk: 1 }, "3": { syncVideoTime: 2722, syncRealWorldTime: T("18:26:40"), anchor: null } },
      marks: { "2": { anchor: { realWorldTime: T("17:54:30"), kind: "first_basket", label: "x", extra: true }, endRealWorldTime: null } },
      other: "x",
    });
    expect(parsed).toEqual({
      periods: { "2": q2, "3": { syncVideoTime: 2722, syncRealWorldTime: T("18:26:40") } },
      marks: { "2": { anchor: { realWorldTime: T("17:54:30"), kind: "first_basket", label: "x" } } },
    });
  });

  it("takes an empty set: every quarter follows Q1 again", () => {
    expect(parseSyncPeriodsPayload({ periods: {}, breaksCut: false })).toEqual({ periods: {}, breaksCut: false });
  });

  it("refuses anything the function wouldn't store", () => {
    const bad: unknown[] = [
      null,
      [],
      { breaksCut: true },
      { periods: [] },
      { periods: { "1": q2 } },
      { periods: { "9": q2 } },
      { periods: { "02": q2 } },
      { periods: { "2": { ...q2, syncVideoTime: -1 } } },
      { periods: { "2": { ...q2, syncVideoTime: 36000 } } },
      { periods: { "2": { ...q2, syncVideoTime: Number.NaN } } },
      { periods: { "2": { ...q2, syncVideoTime: "1392" } } },
      { periods: { "2": { ...q2, syncRealWorldTime: "2026-09-20T17:54:30" } } },
      { periods: { "2": { ...q2, anchor: { kind: "buzzer", label: "x" } } } },
      { periods: { "2": { ...q2, anchor: { kind: "play", label: "x".repeat(201) } } } },
      { periods: {}, syncVideoTime: -3600 },
      { periods: {}, syncVideoTime: 36000 },
      { periods: {}, breaksCut: "yes" },
      { periods: {}, marks: { "0": good.marks["1"] } },
      { periods: {}, marks: { "2": { anchor: { kind: "play", label: "x" } } } },
      { periods: {}, marks: { "2": { ...good.marks["1"], startRealWorldTime: "soon" } } },
      { periods: {}, marks: [] },
    ];
    for (const raw of bad) expect(parseSyncPeriodsPayload(raw), JSON.stringify(raw)).toBeNull();
  });
});

describe("syncPeriodsPayloadOf", () => {
  // A game with the league's marks and a quarter set, as the game page holds it.
  const events: PeriodEvent[] = [
    { period: 1, realWorldTime: T("17:30:30"), type: "2pt", isSuccessful: 1, eventTeam: null, scoreHome: 2, scoreAway: 0 },
    { period: 2, realWorldTime: T("17:54:30"), type: "2pt", isSuccessful: 1, eventTeam: null, scoreHome: 20, scoreAway: 15 },
    { period: 3, realWorldTime: T("18:26:40"), type: "2pt", isSuccessful: 1, eventTeam: null, scoreHome: 40, scoreAway: 33 },
  ];
  const sync: SyncPoint = normalizeSyncPoint({
    syncVideoTime: 42,
    syncRealWorldTime: T("17:30:00"),
    marks: { "2": { anchor: { realWorldTime: T("17:54:30"), kind: "first_basket", label: "Q2's first basket" } } },
    periods: { "2": q2 },
    breaksCut: true,
  });

  it("carries the quarters and the coach's answer, the tip-off and the marks only when asked", () => {
    expect(syncPeriodsPayloadOf(sync)).toEqual({ periods: { "2": q2 }, breaksCut: true });
    expect(syncPeriodsPayloadOf(sync, { withTipoff: true }).syncVideoTime).toBe(42);
    expect(syncPeriodsPayloadOf(sync, { withMarks: true }).marks).toEqual(sync.marks);
    expect(syncPeriodsPayloadOf({ syncVideoTime: 42 })).toEqual({ periods: {} });
  });

  it("leaves off an anchor the function wouldn't keep", () => {
    const odd = { ...sync, periods: { "2": { ...q2, anchor: { kind: "buzzer", label: "x" } } } } as unknown as SyncPoint;
    expect(syncPeriodsPayloadOf(odd).periods["2"]).toEqual({ syncVideoTime: 1392, syncRealWorldTime: q2.syncRealWorldTime });
  });

  it("whatever the period-sync edits make passes the function's check", () => {
    const anchor3 = { realWorldTime: T("18:26:40"), kind: "first_basket" as const, label: "Q3's first basket" };
    for (const next of [
      setPeriodSync(sync, 3, 2722, anchor3),
      clearPeriodSync(sync, 2),
      shiftPeriod(sync, events, 3, -12),
      shiftPeriod(sync, events, 2, 4),
      shiftWholeGame(sync, 3),
    ]) {
      const payload = syncPeriodsPayloadOf(next, { withTipoff: true });
      expect(parseSyncPeriodsPayload(payload), JSON.stringify(next)).toEqual(payload);
    }
  });
});

describe("the media purge", () => {
  const key = clipShipKey("smoke-abc", 2002, 10, 3, 18);

  it("reads a clip's key off the end of its public URL", () => {
    expect(CLIP_SHIP_KEY_RE.test(key)).toBe(true);
    expect(mediaClipKeyFromUrl(`https://pub-73aaabb798fc45db835870accdd0bf85.r2.dev/${key}`)).toBe(key);
    expect(mediaClipKeyFromUrl(`https://media.example/base/path/${key}`)).toBe(key);
    expect(mediaClipKeyFromUrl("https://pub-x.r2.dev/clips/123456/77_pre-2.0_post3.0.mp4")).toBe("clips/123456/77_pre-2.0_post3.0.mp4");
  });

  it("finds no key in anything else", () => {
    expect(mediaClipKeyFromUrl(`https://pub-x.r2.dev/${key}?v=2`)).toBeNull();
    expect(mediaClipKeyFromUrl("https://pub-x.r2.dev/highlights/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002.mp4")).toBeNull();
    expect(mediaClipKeyFromUrl(`ftp://pub-x.r2.dev/${key}`)).toBeNull();
    expect(mediaClipKeyFromUrl(key)).toBeNull();
    expect(mediaClipKeyFromUrl(null)).toBeNull();
  });

  it("deletes everywhere only where the project says all; the smoke's games otherwise", () => {
    expect(mediaPurgeScopeOf("all")).toBe("all");
    expect(mediaPurgeScopeOf(" ALL ")).toBe("all");
    for (const v of [undefined, null, "", "smoke", "everything"]) expect(mediaPurgeScopeOf(v)).toBe("smoke");
    expect(mediaPurgePrefix("all")).toBe("clips/");
    expect(mediaPurgePrefix("smoke")).toBe("clips/smoke-");
    expect(key.startsWith(mediaPurgePrefix("smoke"))).toBe(true);
  });
});
