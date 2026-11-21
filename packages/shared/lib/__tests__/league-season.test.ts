import { describe, expect, it } from "vitest";
import { leagueSeason } from "../league-season";
import type { SeasonPayload } from "../season-payload";
import sblHerr from "./fixtures/season-sbl-herr.json";
import { g, hasNaN, payload, st, tg } from "./helpers/season";

const two = [st(1, 10), st(2, 10, 2), st(3, 20), st(4, 20, 2)];

describe("leagueSeason", () => {
  it("measures a team within its group", () => {
    const p = payload(
      [
        g(100, tg(1, { tpa: 40 }), tg(2)),
        g(101, tg(2), tg(1, { tpa: 40 })),
        g(200, tg(3), tg(4, { tov: 20 })),
        g(201, tg(4, { tov: 20 }), tg(3)),
      ],
      two,
    );
    const l = leagueSeason(p);
    expect(l.groups.map((x) => x.group)).toEqual([10, 20]);
    expect(l.teams.get(1)!.group).toBe(10);
    expect(l.teams.get(1)!.of).toBe(2);
    expect(l.teams.get(1)!.own.threeRate).toBeCloseTo(80 / 130, 6);
    expect(l.teams.get(1)!.place.own.threeRate).toBe(1);
    expect(l.teams.get(2)!.place.own.threeRate).toBe(2);
    expect(l.teams.get(3)!.place.own.threeRate).toBe(1); // tied with 4, in its own group
    expect(l.teams.get(4)!.place.own.threeRate).toBe(1);
    expect(l.groups[0].mean.own.threeRate).toBeCloseTo((80 / 130 + 50 / 130) / 2, 6);
  });

  it("ranks what a team allows with 1 as the best defence", () => {
    const l = leagueSeason(payload([g(100, tg(1, { tpa: 40 }), tg(2)), g(200, tg(3), tg(4, { tov: 20 }))], two));
    expect(l.teams.get(1)!.place.allowed.threeRate).toBe(1); // fewest threes allowed
    expect(l.teams.get(2)!.place.allowed.threeRate).toBe(2);
    expect(l.teams.get(3)!.place.allowed.tovRate).toBe(1); // most turnovers forced
    expect(l.teams.get(4)!.place.own.tovRate).toBe(2); // loses it most
  });

  it("counts possessions a game as pace, with the ball only", () => {
    const l = leagueSeason(payload([g(100, tg(1), tg(2))], two));
    expect(l.teams.get(1)!.own.pace).toBeCloseTo(65 - 10 + 12 + 0.44 * 16, 6);
    expect(l.teams.get(1)!.allowed.pace).toBeNull();
  });

  it("leaves finals and one-sided games out", () => {
    const l = leagueSeason(
      payload([g(100, tg(1), tg(2)), g(300, tg(1, { tpa: 65 }), tg(2), "FINALS"), g(301, tg(1, { tpa: 65 }), 2)], two),
    );
    expect(l.teams.get(1)!.games).toBe(1);
    expect(l.teams.get(1)!.own.threeRate).toBeCloseTo(25 / 65, 6);
  });

  it("gives a team without a counted game no numbers and no places", () => {
    const l = leagueSeason(payload([g(100, tg(1), tg(2))], [...two, st(5, 10, 3)]));
    const t = l.teams.get(5)!;
    expect(t.games).toBe(0);
    expect(t.own.ppp).toBeNull();
    expect(t.place.own.ppp).toBeNull();
    expect(l.teams.get(1)!.of).toBe(2);
    expect(hasNaN(l)).toBe(false);
  });

  it("measures one game's usual swing for every number at both ends", () => {
    const p = payload(
      [1, 2, 3].map((i) => g(100 + i, tg(1, { tpa: 20 + 5 * i }), tg(2))),
      two,
    );
    const l = leagueSeason(p);
    expect(l.swing.own.threeRate).toBeGreaterThan(0);
    expect(l.swing.allowed.threeRate).toBeGreaterThan(0);
    expect(l.swing.own.pace).not.toBeNull();
  });

  it("reads the SBL Herr season as one group of eleven", () => {
    const l = leagueSeason(sblHerr as SeasonPayload);
    expect(l.groups).toHaveLength(1);
    expect(l.teams.size).toBe(11);
    const places = [...l.teams.values()].map((t) => t.place.own.ppp).sort((a, b) => a! - b!);
    expect(places[0]).toBe(1);
    expect(places.at(-1)).toBeLessThanOrEqual(11);
    expect(hasNaN(l)).toBe(false);
  });
});
