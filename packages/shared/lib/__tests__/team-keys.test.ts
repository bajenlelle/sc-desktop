import { describe, expect, it } from "vitest";
import { leagueSeason, type End, type LeagueSeason, type ProfileKey, type TeamProfile } from "../league-season";
import type { SeasonPayload } from "../season-payload";
import { keySentence, keysEmptyLine, teamKeys, type TeamKey } from "../team-keys";
import sblHerr from "./fixtures/season-sbl-herr.json";

const MEAN: Record<ProfileKey, number> = { ppp: 1.0, efg: 0.5, tovRate: 0.15, orebPct: 0.28, ftRate: 0.3, threeRate: 0.4, pace: 72 };
const all = (v: number | null) => ({ ppp: v, efg: v, tovRate: v, orebPct: v, ftRate: v, threeRate: v, pace: v });

/** A team at the group's average in everything, 6th of 12, with `games` games. */
function prof(games = 9): TeamProfile {
  return {
    teamId: 1,
    group: 1,
    games,
    own: { ...MEAN },
    allowed: { ...MEAN, pace: null },
    place: { own: all(6), allowed: { ...all(6), pace: null } },
    of: 12,
    perGame: { paint: null, second_chance: null, fast_break: null, turnovers: null, bench: null },
    standing: null,
  };
}

/** Moves one number of `p` to `value`, at `place`. */
function at(p: TeamProfile, end: End, key: ProfileKey, value: number, place: number): TeamProfile {
  p[end][key] = value;
  p.place[end][key] = place;
  return p;
}

/** One group whose average is MEAN, with the same swing for every number. */
function lg(swing: number | null): LeagueSeason {
  return {
    teams: new Map(),
    groups: [{ group: 1, teamIds: [1], mean: { own: { ...MEAN }, allowed: { ...MEAN, pace: null } } }],
    swing: { own: all(swing), allowed: { ...all(swing), pace: null } },
  };
}

describe("teamKeys", () => {
  it("needs five games", () => {
    const k = teamKeys(at(prof(4), "own", "threeRate", 0.6, 1), lg(0.08));
    expect(k.status).toBe("early");
    expect(k.withBall).toEqual([]);
  });

  it("needs a place among the best two or the worst two", () => {
    expect(teamKeys(at(prof(), "own", "threeRate", 0.6, 3), lg(0.08)).withBall).toEqual([]);
  });

  it("needs to stand twice its uncertainty from the average", () => {
    // swing 0.08 over 9 games: one standard error is 0.0267, so the gap must reach 0.0533
    expect(teamKeys(at(prof(), "own", "threeRate", 0.44, 1), lg(0.08)).withBall).toEqual([]);
    const b = teamKeys(at(prof(), "own", "threeRate", 0.46, 1), lg(0.08));
    expect(b.withBall.map((x) => x.metric)).toEqual(["threeRate"]);
    expect(b.withBall[0].score).toBeCloseTo(0.06 / (0.08 / 3), 6);
  });

  it("counts the worst two as well", () => {
    const k = teamKeys(at(prof(), "own", "tovRate", 0.19, 11), lg(0.03));
    expect(k.withBall[0]).toMatchObject({ metric: "tovRate", high: true, place: 11, of: 12 });
  });

  it("never makes a key of shooting or the free-throw rate", () => {
    const p = at(at(prof(), "own", "efg", 0.7, 1), "own", "ftRate", 0.6, 1);
    expect(teamKeys(p, lg(0.01)).withBall).toEqual([]);
  });

  it("keeps the three strongest a side, strongest first", () => {
    // swing 0.03 over 9 games: one standard error is 0.01
    const p = prof();
    at(p, "own", "ppp", 1.05, 1);
    at(p, "own", "threeRate", 0.44, 1);
    at(p, "own", "orebPct", 0.31, 1);
    at(p, "own", "pace", 72.02, 1);
    const k = teamKeys(p, lg(0.03));
    expect(k.withBall.map((x) => [x.metric, Number(x.score.toFixed(6))])).toEqual([["ppp", 5], ["threeRate", 4], ["orebPct", 3]]);
  });

  it("has pace with the ball only", () => {
    const k = teamKeys(at(prof(), "own", "pace", 80, 1), lg(1));
    expect(k.withBall.map((x) => x.metric)).toEqual(["pace"]);
    expect(k.withoutBall.some((x) => x.metric === "pace")).toBe(false);
  });

  it("reads what a team allows as keys without the ball", () => {
    const k = teamKeys(at(prof(), "allowed", "tovRate", 0.21, 1), lg(0.03));
    expect(k.withoutBall[0]).toMatchObject({ end: "allowed", metric: "tovRate", high: true, place: 1 });
  });

  it("takes a swing of zero as certain", () => {
    expect(teamKeys(at(prof(), "own", "threeRate", 0.45, 1), lg(0)).withBall[0].score).toBe(Infinity);
  });

  it("takes a gap of rounding noise as no gap, even when every game is alike", () => {
    expect(teamKeys(at(prof(), "own", "ppp", 1.0 + 1e-15, 1), lg(0)).withBall).toEqual([]);
  });

  it("has no key without a swing", () => {
    expect(teamKeys(at(prof(), "own", "threeRate", 0.6, 1), lg(null)).withBall).toEqual([]);
  });
});

const key = (end: End, metric: TeamKey["metric"], high: boolean, value: number, place: number, of = 12): TeamKey =>
  ({ end, metric, high, value, place, of, score: 3 });

describe("keySentence", () => {
  it.each([
    [key("own", "ppp", true, 1.14, 1), "Score efficiently: 1.14 points per possession, most in the league."],
    [key("own", "ppp", false, 0.94, 12), "Struggle to score: 0.94 points per possession, fewest in the league."],
    [key("own", "threeRate", true, 0.44, 1), "Shoot a lot of threes: 44% of shots, most in the league."],
    [key("own", "threeRate", false, 0.24, 12), "Rarely shoot threes: 24% of shots, fewest in the league."],
    [key("own", "orebPct", true, 0.34, 2), "Crash the offensive glass: win 34% of their misses, 2nd of 12."],
    [key("own", "orebPct", false, 0.21, 11), "Leave the offensive glass: win 21% of their misses, 11th of 12."],
    [key("own", "tovRate", true, 0.19, 11), "Lose the ball: on 19% of possessions, 11th of 12."],
    [key("own", "tovRate", false, 0.12, 1), "Take care of the ball: turnovers on 12% of possessions, fewest in the league."],
    [key("own", "pace", true, 78, 1), "Play fast: 78 possessions a game, most in the league."],
    [key("own", "pace", false, 66, 12), "Play slowly: 66 possessions a game, fewest in the league."],
    [key("allowed", "ppp", true, 1.12, 12), "Easy to score on: 1.12 points allowed per possession, most in the league."],
    [key("allowed", "ppp", false, 0.94, 1), "Hard to score on: 0.94 points allowed per possession, fewest in the league."],
    [key("allowed", "threeRate", true, 0.45, 12), "Give up threes: 45% of opponents' shots, most in the league."],
    [key("allowed", "threeRate", false, 0.27, 1), "Take away the three: 27% of opponents' shots, fewest in the league."],
    [key("allowed", "orebPct", true, 0.31, 11), "Give up second chances: opponents win 31% of their misses, 11th of 12."],
    [key("allowed", "orebPct", false, 0.22, 2), "Clean the defensive glass: opponents win 22% of their misses, 2nd of 12."],
    [key("allowed", "tovRate", true, 0.21, 1), "Force turnovers: on 21% of opponents' possessions, most in the league."],
    [key("allowed", "tovRate", false, 0.13, 12), "Rarely force turnovers: on 13% of opponents' possessions, fewest in the league."],
  ])("writes %o", (k, sentence) => {
    expect(keySentence(k, null)).toBe(sentence);
  });

  it("names the group in a grouped league", () => {
    expect(keySentence(key("own", "threeRate", true, 0.44, 1, 14), "Södra")).toBe("Shoot a lot of threes: 44% of shots, most in Södra.");
  });
});

describe("keysEmptyLine", () => {
  it("says so when nothing qualifies, or when it is too early", () => {
    expect(keysEmptyLine({ status: "early", games: 3, withBall: [], withoutBall: [] })).toBe("Too early to say what stands out: 3 games played.");
    expect(keysEmptyLine({ status: "early", games: 1, withBall: [], withoutBall: [] })).toBe("Too early to say what stands out: 1 game played.");
    expect(keysEmptyLine({ status: "ready", games: 9, withBall: [], withoutBall: [] })).toBe("Nothing stands out. Close to the league average at both ends.");
    expect(keysEmptyLine({ status: "ready", games: 9, withBall: [key("own", "ppp", true, 1.1, 1)], withoutBall: [] })).toBeNull();
  });
});

describe("on SBL Herr 2026/27", () => {
  it("gives at most three keys a side, none on shooting or free throws", () => {
    const l = leagueSeason(sblHerr as SeasonPayload);
    const keys = [...l.teams.values()].map((t) => teamKeys(t, l));
    for (const k of keys) {
      expect(k.withBall.length).toBeLessThanOrEqual(3);
      expect(k.withoutBall.length).toBeLessThanOrEqual(3);
      for (const x of [...k.withBall, ...k.withoutBall]) expect(["efg", "ftRate"]).not.toContain(x.metric);
    }
    expect(keys.some((k) => k.withBall.length + k.withoutBall.length > 0)).toBe(true);
  });
});
