import { describe, expect, it } from "vitest";
import type { SyncPoint } from "../../types/match";
import { computeVideoTime } from "../clip-timing";
import { buildGameTimeline } from "../game-timeline";
import { normalizeSyncPoint, sameSyncPoint } from "../period-sync";
import {
  checkCandidate,
  cutShiftSeconds,
  describeReach,
  describeShiftSeconds,
  gapCandidate,
  gapShift,
  narrowClose,
  narrowFound,
  narrowRight,
  playsMoved,
  partChecked,
  partOf,
  planFix,
  standingChecks,
  suggestedScope,
  syncFixes,
  withoutFix,
  withoutFixes,
  syncParts,
  syncProgress,
  withCheck,
  withOwnTime,
  withoutOwnTime,
  type CheckEvent,
} from "../sync-check";

// A game from 17:30 on the wall clock: Q1 17:30–17:52, Q2 17:54–18:16, Q3 18:26–18:46, Q4 18:48–19:08, with the
// league's times. A made basket every two minutes of each quarter, and a rebound a minute after each.
const T = (hms: string) => `2026-09-20T${hms}Z`;
const hms = (h: number, m: number, s = 0) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
let nextId = 1;
const play = (period: number, time: string, type: string, clock: string, made = 0): CheckEvent & { eventId: number } => ({
  eventId: nextId++,
  period,
  realWorldTime: T(time),
  gameClockTime: clock,
  type,
  isSuccessful: made,
  eventTeam: { teamCode: "", teamName: "Lidingö", teamNumber: 1 },
  scoreHome: null,
  scoreAway: null,
});
const quarter = (period: number, h: number, m: number) => {
  const out: Array<CheckEvent & { eventId: number }> = [];
  for (let i = 0; i < 10; i++) {
    const at = m + 1 + i * 2;
    out.push(play(period, hms(h + Math.floor(at / 60), at % 60), "2pt", `${String(9 - i).padStart(2, "0")}:30`, 1));
    out.push(play(period, hms(h + Math.floor((at + 1) / 60), (at + 1) % 60), "rebound", `${String(9 - i).padStart(2, "0")}:00`));
  }
  return out;
};
const events = [...quarter(1, 17, 30), ...quarter(2, 17, 54), ...quarter(3, 18, 26), ...quarter(4, 18, 48)];
const baskets = (period: number) => events.filter((e) => e.period === period && e.type === "2pt");
const mark = (p: number, start: string, end: string) => ({
  startRealWorldTime: T(start),
  endRealWorldTime: T(end),
  anchor: { realWorldTime: T(start), kind: "period_start" as const, label: `Start of Q${p}` },
});
const sync: SyncPoint = {
  syncVideoTime: 42,
  syncRealWorldTime: T("17:30:00"),
  marks: { "1": mark(1, "17:30:00", "17:52:00"), "2": mark(2, "17:54:00", "18:16:00"), "3": mark(3, "18:26:00", "18:46:00"), "4": mark(4, "18:48:00", "19:08:00") },
};
const at = (e: CheckEvent, s: SyncPoint = sync) => computeVideoTime(e, s)!;
const LEAD = 10;

describe("syncParts", () => {
  it("a game with no cuts is its quarters, none of them checked", () => {
    const parts = syncParts(sync, events);
    expect(parts.map((p) => p.name)).toEqual(["Q1", "Q2", "Q3", "Q4"]);
    expect(parts.every((p) => !partChecked(p))).toBe(true);
    expect(syncProgress(parts)).toEqual({ total: 4, checked: 0, left: 4 });
  });

  it("a cut inside a quarter divides it, and names both sides by the clock where it divides", () => {
    const fifth = baskets(1)[4];
    const cut = planFix(sync, events, fifth, at(fifth) - 20, LEAD, "play")!.next;
    const parts = syncParts(cut, events);
    expect(parts.map((p) => p.name)).toEqual(["Q1 to 05:30", "Q1 from 05:30", "Q2", "Q3", "Q4"]);
    expect(partOf(parts, baskets(1)[0])?.name).toBe("Q1 to 05:30");
    expect(partOf(parts, baskets(1)[9])?.name).toBe("Q1 from 05:30");
    // The fixed play is the check of the stretch it starts.
    expect(parts.map(partChecked)).toEqual([false, true, false, false, false]);
  });

  it("a checked play checks the part it is in", () => {
    const parts = syncParts(withCheck(sync, baskets(3)[9]), events);
    expect(parts.map(partChecked)).toEqual([false, false, true, false]);
    expect(syncProgress(parts).left).toBe(3);
  });
});

describe("checkCandidate", () => {
  const parts = syncParts(sync, events);
  it("is the part's last made basket", () => {
    expect(checkCandidate(parts[0], parts, events, sync)).toBe(baskets(1)[9]);
  });
  it("passes over plays the coach tried, plays logged late and plays with a place of their own", () => {
    expect(checkCandidate(parts[0], parts, events, sync, new Set([baskets(1)[9].eventId]))).toBe(baskets(1)[8]);
    const late = events.map((e) => (e === baskets(1)[9] ? { ...e, loggedAt: T("17:53:00") } : e));
    expect(checkCandidate(parts[0], parts, late, sync)?.eventId).toBe(baskets(1)[8].eventId);
    expect(checkCandidate(parts[0], parts, events, withOwnTime(sync, baskets(1)[9], 5))).toBe(baskets(1)[8]);
  });
  it("is null for a part with no made basket", () => {
    const none = events.filter((e) => e.period !== 2 || e.type !== "2pt");
    const p = syncParts(sync, none);
    expect(checkCandidate(p[1], p, none, sync)).toBeNull();
  });
});

describe("planFix", () => {
  it("from the play: earlier plays stay, the play and everything after it move, to the end of the game", () => {
    const fifth = baskets(1)[4];
    const plan = planFix(sync, events, fifth, at(fifth) - 20, LEAD, "play")!;
    expect(plan.delta).toBe(-20);
    expect(at(baskets(1)[3], plan.next)).toBe(at(baskets(1)[3]));
    expect(at(fifth, plan.next)).toBe(at(fifth) - 20);
    expect(at(baskets(4)[9], plan.next)).toBe(at(baskets(4)[9]) - 20);
    expect(plan.reach.from).toEqual({ kind: "play" });
    expect(plan.reach.to).toEqual({ kind: "game" });
    expect(describeReach(plan.reach)).toBe("from this play to the end of the game");
    expect(plan.next.checks?.map((c) => c.eventId)).toEqual([fifth.eventId]);
  });

  it("stops at the next checked play, which stays where it was with everything after it", () => {
    const checked = withCheck(sync, baskets(2)[9]);
    const fifth = baskets(1)[4];
    const plan = planFix(checked, events, fifth, at(fifth) - 20, LEAD, "play")!;
    expect(at(baskets(2)[8], plan.next)).toBe(at(baskets(2)[8]) - 20);
    expect(at(baskets(2)[9], plan.next)).toBe(at(baskets(2)[9]));
    expect(at(baskets(3)[0], plan.next)).toBe(at(baskets(3)[0]));
    expect(plan.reach.to).toEqual({ kind: "check" });
    expect(describeReach(plan.reach)).toBe("from this play up to the next play you checked");
    expect(plan.next.checks?.map((c) => c.eventId)).toEqual([fifth.eventId, baskets(2)[9].eventId]);
  });

  it("stops before a later quarter that has its own sync", () => {
    const own: SyncPoint = { ...sync, periods: { "3": { syncVideoTime: 3000, syncRealWorldTime: T("18:26:00") } } };
    const last = baskets(1)[9];
    const plan = planFix(own, events, last, at(last, own) + 8, LEAD, "play")!;
    expect(at(baskets(2)[0], plan.next)).toBe(at(baskets(2)[0], own) + 8);
    expect(at(baskets(3)[0], plan.next)).toBe(at(baskets(3)[0], own));
    expect(describeReach(plan.reach)).toBe("from this play to the end of Q2");
  });

  it("from the start: the whole stretch moves with the play", () => {
    const last = baskets(2)[9];
    const plan = planFix(sync, events, last, at(last) + 30, LEAD, "start")!;
    expect(at(baskets(1)[9], plan.next)).toBe(at(baskets(1)[9]));
    expect(at(baskets(2)[0], plan.next)).toBe(at(baskets(2)[0]) + 30);
    expect(at(baskets(4)[9], plan.next)).toBe(at(baskets(4)[9]) + 30);
    expect(describeReach(plan.reach)).toBe("from the start of Q2 to the end of the game");
    expect(plan.next.periods?.["2"]).toBeDefined();
  });

  it("from the start of Q1 with nothing else placed on its own is the whole game", () => {
    const last = baskets(1)[9];
    const plan = planFix(sync, events, last, at(last) - 5, LEAD, "start")!;
    expect(plan.reach.plays).toBe(events.length);
    expect(describeReach(plan.reach)).toBe("the whole game");
  });

  it("from the start of a stretch a cut began moves that cut, and the stretch before it stays", () => {
    const fifth = baskets(1)[4];
    const cut = planFix(sync, events, fifth, at(fifth) - 20, LEAD, "play")!.next;
    const last = baskets(1)[9];
    const plan = planFix(cut, events, last, at(last, cut) + 3, LEAD, "start")!;
    expect(at(baskets(1)[3], plan.next)).toBe(at(baskets(1)[3]));
    expect(at(fifth, plan.next)).toBe(at(fifth) - 17);
    expect(plan.next.cuts).toHaveLength(1);
    // The play the stretch was checked on moved with it: it is no longer a check, the new one is.
    expect(plan.next.checks?.map((c) => c.eventId)).toEqual([last.eventId]);
  });

  it("a play with a place of its own gives it up when the plays around it are moved from it", () => {
    const fifth = baskets(1)[4];
    const own = withOwnTime(sync, fifth, 9);
    const plan = planFix(own, events, fifth, at(fifth) + 6, LEAD, "play")!;
    expect(plan.delta).toBe(6);
    expect(plan.next.playTimes).toBeUndefined();
    expect(at(fifth, plan.next)).toBe(at(fifth) + 6);
  });

  it("is null for a play the sync can't place", () => {
    expect(planFix(sync, events, { ...baskets(1)[0], realWorldTime: "" }, 10, LEAD, "play")).toBeNull();
  });
});

describe("narrowing down where a shift starts", () => {
  const q1 = baskets(1);
  const fifth = q1[4];
  // The fifth basket of Q1 was found 20 s earlier, and the video was cut there.
  const fixed = planFix(sync, events, fifth, at(fifth) - 20, LEAD, "play")!.next;
  const gap = { a: null, b: fifth };

  it("the gap's shift is how far its cut moves the plays after it", () => {
    expect(gapShift(fixed, fifth)).toBe(-20);
    expect(gapShift(sync, fifth)).toBe(0);
  });

  it("asks about the stretch's first basket first, then halves the plays in doubt", () => {
    expect(gapCandidate(fixed, events, gap)).toBe(q1[0]);
    // Right at the first: three baskets are left between it and the cut.
    expect(gapCandidate(fixed, events, { a: q1[0], b: fifth })).toBe(q1[2]);
    expect(gapCandidate(fixed, events, { a: q1[2], b: fifth })).toBe(q1[3]);
    expect(gapCandidate(fixed, events, { a: q1[3], b: fifth })).toBeNull();
    expect(gapCandidate(sync, events, gap), "no cut, nothing to narrow").toBeNull();
  });

  it("with no basket left between the two, it ends on a missed shot, a turnover or a foul", () => {
    // Between the fourth basket and the cut: a turnover and a missed three, and the rebound that is in the game anyway.
    const turnover = { ...play(1, "17:37:40", "turnover", "06:20"), eventId: 9001 };
    const miss = { ...play(1, "17:38:20", "3pt", "05:50"), eventId: 9002 };
    const more = [...events, turnover, miss];
    expect(gapCandidate(fixed, more, { a: q1[3], b: fifth })).toBe(miss);
    expect(gapCandidate(fixed, more, { a: q1[3], b: { ...fifth } }), "the gap's own ends are never asked about").toBe(miss);
    expect(gapCandidate(fixed, more, { a: miss, b: fifth })).toBeNull();
    expect(gapCandidate(fixed, more, { a: turnover, b: fifth })).toBe(miss);
  });

  it("a play that looks right is a check, and the shift starts after it", () => {
    const step = narrowRight(fixed, gap, q1[0]);
    expect(step.gaps).toEqual([{ a: q1[0], b: fifth }]);
    expect(step.sync.checks?.map((c) => c.eventId)).toEqual([q1[0].eventId, fifth.eventId]);
  });

  it("a play found where the shift would put it: the cut moves back to it, and nothing after it moves", () => {
    const step = narrowFound(fixed, events, { a: q1[0], b: fifth }, q1[2], at(q1[2]) - 20.4, LEAD);
    expect(step.outcome).toBe("same");
    expect(step.gaps).toEqual([{ a: q1[0], b: q1[2] }]);
    expect(step.sync.cuts).toHaveLength(1);
    expect(step.sync.cuts![0].eventId).toBe(q1[2].eventId);
    expect(at(q1[1], step.sync)).toBe(at(q1[1]));
    expect(at(q1[2], step.sync)).toBe(at(q1[2]) - 20);
    expect(at(q1[3], step.sync)).toBe(at(q1[3]) - 20);
    expect(at(fifth, step.sync)).toBe(at(fifth) - 20);
    expect(standingChecks(step.sync).map((c) => c.eventId), "the found play is still a check").toEqual([fifth.eventId]);
  });

  it("a play found where it already was is right after all", () => {
    const step = narrowFound(fixed, events, { a: q1[0], b: fifth }, q1[2], at(q1[2]) + 0.3, LEAD);
    expect(step.outcome).toBe("right");
    expect(step.gaps).toEqual([{ a: q1[2], b: fifth }]);
    expect(step.sync.cuts).toEqual(fixed.cuts);
  });

  it("a first basket with an error of its own moves the stretch from its start, and leaves the gap after it", () => {
    // The quarter's own sync is 12 s off the other way; the cut made from the fifth basket stays where it is.
    const step = narrowFound(fixed, events, gap, q1[0], at(q1[0]) + 12, LEAD);
    expect(step.outcome).toBe("own");
    expect(step.gaps).toEqual([{ a: q1[0], b: fifth }]);
    expect(at(q1[0], step.sync)).toBe(at(q1[0]) + 12);
    expect(at(q1[3], step.sync)).toBe(at(q1[3]) + 12);
    expect(at(fifth, step.sync)).toBe(at(fifth) - 20);
    expect(gapShift(step.sync, fifth)).toBe(-32);
    expect(standingChecks(step.sync).map((c) => c.eventId)).toEqual([q1[0].eventId, fifth.eventId]);
  });

  it("a later play with an error of its own is cut on its own, with a gap on either side", () => {
    const step = narrowFound(fixed, events, { a: q1[0], b: fifth }, q1[2], at(q1[2]) + 5, LEAD);
    expect(step.outcome).toBe("own");
    expect(step.gaps).toEqual([
      { a: q1[0], b: q1[2] },
      { a: q1[2], b: fifth },
    ]);
    expect(at(q1[1], step.sync)).toBe(at(q1[1]));
    expect(at(q1[2], step.sync)).toBe(at(q1[2]) + 5);
    expect(at(q1[3], step.sync)).toBe(at(q1[3]) + 5);
    expect(at(fifth, step.sync)).toBe(at(fifth) - 20);
  });

  it("no play left in doubt and none seen right: the whole stretch was off, and moves from its start", () => {
    // Off at the first basket too, by as much: the cut moved back to it, and nothing is before it.
    const back = narrowFound(fixed, events, gap, q1[0], at(q1[0]) - 20, LEAD);
    expect(gapCandidate(back.sync, events, back.gaps[0])).toBeNull();
    const closed = narrowClose(back.sync, events, back.gaps[0]);
    expect(closed.cuts).toBeUndefined();
    expect(closed.syncVideoTime).toBe(sync.syncVideoTime - 20);
    expect(at(q1[0], closed)).toBe(at(q1[0]) - 20);
    expect(at(fifth, closed)).toBe(at(fifth) - 20);
    expect(playsMoved(sync, closed, events)).toBe(events.length);
  });

  it("with a play seen right before it, closing the gap changes nothing: the cut is where the shift starts", () => {
    expect(narrowClose(fixed, events, { a: q1[3], b: fifth })).toBe(fixed);
  });

  it("a cut never starts so early that it takes the last play seen right with it", () => {
    // The rebound a minute before the third basket was seen right; a cut 90 s ahead of the basket would reach past it.
    const rebound = events.find((e) => e.period === 1 && e.type === "rebound" && e.realWorldTime === T("17:34:00"))!;
    const step = narrowFound(fixed, events, { a: rebound, b: fifth }, q1[2], at(q1[2]) - 20, 90);
    expect(at(rebound, step.sync)).toBe(at(rebound));
    expect(at(q1[2], step.sync)).toBe(at(q1[2]) - 20);
  });
});

describe("a play with a place of its own", () => {
  const fifth = baskets(1)[4];
  const own = withOwnTime(sync, fifth, 512.5);
  it("is where the coach found it, and nothing else moves", () => {
    expect(at(fifth, own)).toBe(512.5);
    expect(at(baskets(1)[5], own)).toBe(at(baskets(1)[5]));
    // A moment that isn't a play (no event id) is placed by the sync.
    expect(computeVideoTime({ realWorldTime: fifth.realWorldTime, period: 1 }, own)).toBe(at(fifth));
  });
  it("stays there when the game around it is moved", () => {
    const last = baskets(1)[9];
    const plan = planFix(own, events, last, at(last) - 5, LEAD, "start")!;
    expect(at(fifth, plan.next)).toBe(512.5);
  });
  it("is marked on the timeline and doesn't stretch its quarter's band", () => {
    const far = withOwnTime(sync, fifth, 4000);
    const full = events.map((e) => ({ ...e, subType: "", qualifiers: [] as string[] }));
    const tl = buildGameTimeline({ matchId: "m", events: full, sync: far });
    expect(tl.plays.find((p) => p.event.eventId === fifth.eventId)).toMatchObject({ time: 4000, own: true });
    expect(tl.overlaps).toBe(false);
    expect(tl.bands[0].end).toBeLessThan(1500);
  });
  it("can be given back", () => {
    expect(withoutOwnTime(own, fifth)).toEqual(sync);
    expect(withoutOwnTime(sync, fifth)).toBe(sync);
  });
});

describe("what is stored", () => {
  it("normalizeSyncPoint keeps valid play times and checks, in time order, one check a play", () => {
    const raw = {
      ...sync,
      playTimes: { "12": 40.5, x: 3, "13": "9" },
      checks: [
        { period: 2, eventId: 30, realWorldTime: T("18:00:00"), videoTime: 1842 },
        { period: 1, eventId: 5, realWorldTime: T("17:40:00"), videoTime: 642 },
        { period: 1, eventId: 5, realWorldTime: T("17:41:00"), videoTime: 702 },
        { period: 0, eventId: 6, realWorldTime: T("17:41:00"), videoTime: 702 },
        { period: 1, eventId: 7, realWorldTime: "soon", videoTime: 1 },
        { period: 1, eventId: 8, realWorldTime: T("17:42:00") },
      ],
    } as unknown as SyncPoint;
    const n = normalizeSyncPoint(raw);
    expect(n.playTimes).toEqual({ "12": 40.5 });
    expect(n.checks?.map((c) => c.eventId)).toEqual([5, 30]);
  });
  it("a sync with another play placed, or another play checked, is another sync", () => {
    expect(sameSyncPoint(sync, withOwnTime(sync, { eventId: 3 }, 9))).toBe(false);
    expect(sameSyncPoint(sync, withCheck(sync, baskets(1)[0]))).toBe(false);
    expect(sameSyncPoint(withCheck(sync, baskets(1)[0]), withCheck(sync, baskets(1)[0]))).toBe(true);
  });
});

describe("a check holds only while its play is where it was confirmed", () => {
  const last = baskets(1)[9];
  const checked = withCheck(sync, last);
  it("records where the play was", () => {
    expect(checked.checks).toEqual([{ period: 1, eventId: last.eventId, realWorldTime: last.realWorldTime, videoTime: at(last) }]);
    expect(standingChecks(checked)).toHaveLength(1);
  });
  it("a sync changed some other way (the tip-off moved in Details) leaves the part unchecked again", () => {
    const moved: SyncPoint = { ...checked, syncVideoTime: checked.syncVideoTime + 12 };
    expect(standingChecks(moved)).toHaveLength(0);
    expect(syncParts(moved, events).map(partChecked)).toEqual([false, false, false, false]);
    // And the next check written clears it away.
    expect(withCheck(moved, baskets(2)[9]).checks?.map((c) => c.eventId)).toEqual([baskets(2)[9].eventId]);
  });
  it("a check that no longer holds doesn't stop a fix", () => {
    const later = withCheck(sync, baskets(2)[9]);
    const moved: SyncPoint = { ...later, syncVideoTime: later.syncVideoTime + 12 };
    const fifth = baskets(1)[4];
    const plan = planFix(moved, events, fifth, at(fifth, moved) - 20, LEAD, "play")!;
    expect(plan.reach.to).toEqual({ kind: "game" });
    expect(at(baskets(2)[9], plan.next)).toBe(at(baskets(2)[9], moved) - 20);
  });
});

describe("the words", () => {
  it("a small shift, or a play logged late, is proposed for the play alone", () => {
    expect(suggestedScope({}, 2.4)).toBe("play");
    expect(suggestedScope({}, -22)).toBe("on");
    expect(suggestedScope({ loggedAt: T("17:53:00") }, -900)).toBe("play");
  });
  it("cutShiftSeconds: how far a cut moves the plays after it, each cut against the sync before it", () => {
    const fifth = baskets(1)[4];
    const eighth = baskets(1)[7];
    const one = planFix(sync, events, fifth, at(fifth) - 20, LEAD, "play")!.next;
    expect(one.cuts).toHaveLength(1);
    expect(cutShiftSeconds(one, one.cuts![0])).toBeCloseTo(-20);
    // A second fix later in the quarter is measured from where the first one left its plays.
    const two = planFix(one, events, eighth, at(eighth, one) + 8, LEAD, "play")!.next;
    expect(two.cuts).toHaveLength(2);
    expect(cutShiftSeconds(two, two.cuts![0])).toBeCloseTo(-20);
    expect(cutShiftSeconds(two, two.cuts![1])).toBeCloseTo(8);
  });
  it("syncFixes lists the cuts and own places in game order, and each can be taken back on its own", () => {
    const fifth = baskets(1)[4];
    const late = baskets(2)[3];
    const cut = planFix(sync, events, fifth, at(fifth) - 20, LEAD, "play")!.next;
    const both = withOwnTime(cut, late, at(late, cut) + 4);
    const fixes = syncFixes(both, events);
    expect(fixes.map((f) => f.kind)).toEqual(["cut", "own"]);
    expect(fixes[0]).toMatchObject({ kind: "cut", period: 1, name: "Q1 from 05:30", eventId: fifth.eventId });
    expect((fixes[0] as { shift: number }).shift).toBeCloseTo(-20);
    expect(fixes[1]).toMatchObject({ kind: "own", period: 2, eventId: late.eventId });

    const noCut = withoutFix(both, fixes[0]);
    expect(noCut.cuts).toBeUndefined();
    expect(at(fifth, noCut)).toBeCloseTo(at(fifth));
    expect(at(late, noCut), "the other fix stays").toBeCloseTo(at(late, cut) + 4);
    const noOwn = withoutFix(both, fixes[1]);
    expect(noOwn.playTimes).toBeUndefined();
    expect(noOwn.cuts).toHaveLength(1);

    const none = withoutFixes(both);
    expect(syncFixes(none, events)).toEqual([]);
    expect(at(late, none)).toBeCloseTo(at(late));
  });
  it("describeShiftSeconds", () => {
    expect(describeShiftSeconds(-22.2)).toBe("22 s earlier");
    expect(describeShiftSeconds(1.54)).toBe("1.5 s later");
    expect(describeShiftSeconds(125)).toBe("2:05 later");
  });
  it("describeReach", () => {
    expect(describeReach({ plays: 9, from: { kind: "period", period: 3 }, to: { kind: "period", period: 3 } })).toBe("all of Q3");
    expect(describeReach({ plays: 9, from: { kind: "play" }, to: { kind: "fix" } })).toBe("from this play up to the next fix");
  });
});
