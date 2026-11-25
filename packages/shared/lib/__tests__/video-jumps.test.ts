import { describe, expect, it } from "vitest";
import type { PlayByPlayEvent, SyncPoint } from "../../types/match";
import { computeVideoTime } from "../clip-timing";
import { buildGameTimeline } from "../game-timeline";
import { normalizeSyncPoint, sameSyncPoint } from "../period-sync";
import { withCheck } from "../sync-check";
import { isolatedCuts, lostInJump, lostPlays, syncFromJump, videoJumps } from "../video-jumps";

// A first quarter from 13:00:00 on the wall clock, a play every 20 s for ten minutes; the tip-off at 60 s in the video.
const TIP = Date.parse("2026-11-22T13:00:00Z");
const iso = (s: number) => new Date(TIP + s * 1000).toISOString();
const events: PlayByPlayEvent[] = Array.from({ length: 30 }, (_, i) => ({
  eventId: i + 1,
  type: i % 3 === 0 ? "2pt" : "rebound",
  subType: "",
  period: 1,
  gameClockTime: `0${9 - Math.floor((i * 20) / 60)}:00`.slice(-5),
  realWorldTime: iso(i * 20),
  isSuccessful: i % 3 === 0 ? 1 : 0,
  qualifiers: [],
}));
const sync: SyncPoint = { syncVideoTime: 60, syncRealWorldTime: iso(0) };
const at = (e: PlayByPlayEvent, s: SyncPoint = sync) => computeVideoTime(e, s)!;

describe("isolatedCuts", () => {
  it("keeps a cut on its own and drops a production's run of cuts (measured on Superettan replays)", () => {
    // A break's graphics: cuts 3–15 s apart for a minute and a half; a dropped stream: one cut.
    const run = [1724, 1739, 1742, 1757, 1760, 1775, 1778, 1793, 1796, 1811];
    expect(isolatedCuts([149, ...run, 2471])).toEqual([149, 2471]);
    expect(isolatedCuts([])).toEqual([]);
  });

  it("counts a burst of cuts a second apart as one, at its last cut (Älmhult Beasts P16 vs Södertälje)", () => {
    // A stream joined back on at 1:10:13: three cuts in two seconds, nothing else in the recording.
    expect(isolatedCuts([4213.8, 4214.8, 4215.8])).toEqual([4215.8]);
    // A burst with a production's run near it is still part of that run.
    expect(isolatedCuts([1700, 1700.8, 1724, 1739, 1742])).toEqual([]);
    // Graphics 3 s apart stay apart.
    expect(isolatedCuts([1739, 1742])).toEqual([]);
  });
});

describe("videoJumps", () => {
  it("is a lone cut inside a quarter's play, not one before the tip-off or after the last play", () => {
    const jumps = videoJumps([20, 386, 900], sync, events);
    expect(jumps.map((j) => j.at)).toEqual([386]);
    expect(jumps[0].period).toBe(1);
    // Asked about: the first basket 45 s after it by the sync (the plays just after it may be lost): 60 + 20·21 = 480.
    expect(jumps[0].firstPlay.eventId).toBe(22);
    expect(jumps[0].answered).toBe(false);
  });

  it("is answered by a play after it seen in the right place, or a fix near it", () => {
    const checked = withCheck(sync, events[18]);
    expect(videoJumps([386], checked, events)[0].answered).toBe(true);
    const fixed = syncFromJump(sync, 386, events[18], 400);
    expect(videoJumps([386], fixed, events)[0].answered).toBe(true);
  });

  it("is not the jump where the game's footage starts", () => {
    expect(videoJumps([85], { ...sync, footageStart: 85 }, events)).toEqual([]);
  });
});

describe("syncFromJump", () => {
  // The stream dropped at 386 s and lost 20 s of play: the play the sync has at 420 (360 s in) is at 400.
  const fixed = syncFromJump(sync, 386, events[18], 400);

  it("places the plays from the jump on by the play found after it, starting at the jump itself", () => {
    expect(fixed.cuts).toHaveLength(1);
    expect(fixed.cuts![0]).toMatchObject({ syncVideoTime: 386, jump: true, eventId: 19 });
    expect(at(events[18], fixed)).toBeCloseTo(400);
    expect(at(events[20], fixed)).toBeCloseTo(440);
    // Before the jump nothing moved.
    expect(at(events[10], fixed)).toBeCloseTo(at(events[10]));
  });

  it("the plays the drop lost are not in the video", () => {
    // Play 17 (320 s in, at 380) was before the drop.
    expect(lostInJump(events[16], fixed)).toBe(false);
    // The lost stretch: 326–346 s after the tip-off (the cut starts at 346): play 18, at 340 s, is in it.
    const lost = events.filter((e) => lostInJump(e, fixed)).map((e) => e.eventId);
    expect(lost).toEqual([18]);
    expect(lostPlays(events, fixed)).toBe(1);
    const timeline = buildGameTimeline({ matchId: "m", events, sync: fixed });
    expect(timeline.lostInJumps).toBe(1);
    expect(timeline.plays.find((p) => p.event.eventId === 18)?.reach).toBe("lost");
  });

  it("keeps the jump mark through the normaliser, and tells syncs apart by it", () => {
    expect(normalizeSyncPoint(fixed).cuts![0].jump).toBe(true);
    const plain = { ...fixed, cuts: fixed.cuts!.map(({ jump: _j, ...c }) => c) };
    expect(sameSyncPoint(fixed, plain)).toBe(false);
  });

  it("replaces a try at the same jump", () => {
    const tried: SyncPoint = { ...sync, cuts: [{ period: 1, syncVideoTime: 395, syncRealWorldTime: iso(355), eventId: 19 }] };
    expect(syncFromJump(tried, 386, events[18], 400).cuts).toHaveLength(1);
  });
});
