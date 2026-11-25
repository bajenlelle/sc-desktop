import { describe, expect, it } from "vitest";
import { findLatePlays, placeLatePlays, wasLoggedLate } from "../late-plays";

// One quarter from 13:00:00 on the wall clock. The table types each play in a few seconds after it happens.
const T = (seconds: number) => new Date(Date.UTC(2026, 10, 22, 13, 0, seconds)).toISOString();
const play = (eventId: number, clock: string, at: number, type = "2pt", period = 1): { eventId: number; period: number; gameClockTime: string; realWorldTime: string; type: string; loggedAt?: string } => ({
  eventId,
  period,
  gameClockTime: clock,
  realWorldTime: T(at),
  type,
});

describe("findLatePlays", () => {
  const inOrder = [
    play(10, "10:00", 0, "rebound"),
    play(11, "09:40", 22),
    play(12, "09:12", 55, "rebound"),
    play(13, "08:50", 80),
    play(14, "08:31", 104, "turnover"),
    play(15, "07:55", 150),
  ];

  it("a feed that agrees with itself has none, and comes back as the array it was", () => {
    expect(findLatePlays(inOrder).size).toBe(0);
    expect(placeLatePlays(inOrder)).toBe(inOrder);
  });

  it("a turnover typed in at the break is placed between the plays around it by game clock", () => {
    // 09:00 on the game clock, typed in twenty minutes later: between 09:12 (at 55 s) and 08:50 (at 80 s).
    const late = play(16, "09:00", 1200, "turnover");
    const found = findLatePlays([...inOrder, late]);
    expect([...found.keys()]).toEqual([16]);
    const placed = new Date(found.get(16)!.realWorldTime).getTime() - new Date(T(0)).getTime();
    expect(placed / 1000).toBeGreaterThanOrEqual(55 + 12);
    expect(placed / 1000).toBeLessThanOrEqual(80 - 10);
    expect(found.get(16)!.lateBySeconds).toBeGreaterThan(1100);
  });

  it("the placed play keeps the feed's stamp as loggedAt; every other play is the object it was", () => {
    const late = play(16, "09:00", 1200, "turnover");
    const events = [...inOrder, late];
    const placed = placeLatePlays(events);
    expect(placed).not.toBe(events);
    expect(placed.slice(0, 6).every((e, i) => e === events[i])).toBe(true);
    expect(placed[6].loggedAt).toBe(T(1200));
    expect(placed[6].realWorldTime).not.toBe(T(1200));
    expect(wasLoggedLate(placed[6])).toBe(true);
    expect(wasLoggedLate(placed[0])).toBe(false);
  });

  it("placing twice changes nothing more, and the first stamp is the one kept", () => {
    const once = placeLatePlays([...inOrder, play(16, "09:00", 1200, "turnover")]);
    const twice = placeLatePlays(once);
    expect(twice).toBe(once);
    expect(findLatePlays(once).size).toBe(0);
  });

  it("a clock the table puts back by half a minute is not a late entry", () => {
    // The table's clock had run ahead; from 09:12 it is put back to 09:40 and the plays go on from there.
    const corrected = [
      play(10, "10:00", 0, "rebound"),
      play(11, "09:12", 40),
      play(12, "09:38", 46, "rebound"),
      play(13, "09:30", 55),
      play(14, "09:02", 84),
    ];
    expect(findLatePlays(corrected).size).toBe(0);
  });

  it("a clock put back by more than a minute, and played on from, is not a late entry either", () => {
    // From 06:32 the table puts its clock back to 07:32. The plays that follow are typed in as they happen,
    // a second of wall clock for each second of game clock.
    const putBack = [
      play(10, "10:00", 0, "rebound"),
      play(11, "06:47", 200),
      play(12, "06:32", 222, "rebound"),
      play(13, "07:17", 262, "3pt"),
      play(14, "06:53", 286, "3pt"),
      play(15, "06:42", 297),
      play(16, "06:22", 318, "3pt"),
      play(17, "05:51", 348, "foul"),
    ];
    expect(findLatePlays(putBack).size).toBe(0);
  });

  it("plays typed in together at a break are all late, the last of them too", () => {
    const batch = [
      ...inOrder,
      play(16, "07:20", 190),
      play(17, "00:04", 640),
      // Two turnovers the table missed, typed in a few seconds apart at the break.
      play(18, "09:00", 900, "turnover"),
      play(19, "08:10", 906, "turnover"),
    ];
    expect([...findLatePlays(batch).keys()]).toEqual([18, 19]);
  });

  it("a play missed during the period and typed in at a timeout is late: the game went on from where it was", () => {
    const events = [
      ...inOrder,
      play(16, "05:00", 340),
      // 09:00 on the clock, typed in with five minutes left; the next play comes ten seconds later.
      play(17, "09:00", 420, "turnover"),
      play(18, "04:52", 430),
      play(19, "04:30", 452, "rebound"),
    ];
    expect([...findLatePlays(events).keys()]).toEqual([17]);
  });

  it("a play typed in half a minute late stays where the feed put it", () => {
    expect(findLatePlays([...inOrder, play(16, "08:10", 190, "turnover")]).size).toBe(0);
  });

  it("after a foul the clock stood still: the play is placed at the far side of the stoppage", () => {
    const events = [
      play(10, "10:00", 0, "rebound"),
      play(11, "09:30", 32, "foul"),
      // Free throws and a substitution: the clock starts again a minute later.
      play(12, "09:20", 100),
      play(13, "08:00", 190),
      play(20, "09:25", 900, "turnover"),
    ];
    const at = (new Date(findLatePlays(events).get(20)!.realWorldTime).getTime() - new Date(T(0)).getTime()) / 1000;
    expect(at).toBe(95);
  });

  it("with no foul before it, the play is the likelier reason play stopped: it is placed at the near side", () => {
    const events = [
      play(10, "10:00", 0, "rebound"),
      play(11, "09:30", 32, "rebound"),
      play(12, "09:20", 100),
      play(13, "08:00", 190),
      play(20, "09:25", 900, "turnover"),
    ];
    const at = (new Date(findLatePlays(events).get(20)!.realWorldTime).getTime() - new Date(T(0)).getTime()) / 1000;
    expect(at).toBe(37);
  });

  it("each quarter is read on its own, and a play without a clock or a stamp is left alone", () => {
    const events = [
      ...inOrder,
      // Q2 starts again at 10:00: its plays aren't late entries of Q1.
      play(30, "10:00", 1300, "rebound", 2),
      play(31, "09:41", 1320, "2pt", 2),
      { ...play(32, "", 1400, "foul", 2) },
      { ...play(33, "09:00", 0, "foul", 2), realWorldTime: "" },
    ];
    expect(findLatePlays(events).size).toBe(0);
  });

  it("a late play from before everything logged in order is placed ahead of the first of them", () => {
    const events = [play(10, "09:40", 22), play(11, "09:12", 55), play(12, "08:50", 80), play(20, "09:50", 700, "turnover")];
    const at = (new Date(findLatePlays(events).get(20)!.realWorldTime).getTime() - new Date(T(0)).getTime()) / 1000;
    expect(at).toBe(12);
  });
});
