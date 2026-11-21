import { describe, expect, it } from "vitest";
import type { League } from "../../types/league";
import type { StoredMatch } from "../../types/match";
import { FACTOR_KEYS, factorsOf } from "../game-box";
import { GAP_SWINGS, MIN_GAP_GAMES, geniusTotals, realGap, seasonContext, seasonGaps, seasonMatchOf } from "../season-context";
import type { SeasonPayload, SeasonStanding, TeamGame } from "../season-payload";
import sblHerr from "./fixtures/season-sbl-herr.json";
import { g, hasNaN, payload, st as inGroup, tg } from "./helpers/season";

const totals = (t: TeamGame) => geniusTotals(t);
const sum = (...ts: TeamGame[]) => {
  const out = { pts: 0, fgm: 0, fga: 0, tpm: 0, fta: 0, oreb: 0, dreb: 0, tov: 0 };
  for (const t of ts) for (const k of Object.keys(out) as (keyof typeof out)[]) out[k] += totals(t)[k];
  return out;
};

describe("seasonContext", () => {
  it("compares tonight with each team's other games, not with tonight", () => {
    const b1 = tg(1, { fgm: 20 });
    const b2 = tg(3, { dreb: 31 });
    const p = payload([g(100, tg(1, { fgm: 40 }), tg(2)), g(101, b1, b2)]);
    const c = seasonContext(p, 100)!;
    expect(c.home.teamId).toBe(1);
    expect(c.home.games).toBe(1);
    expect(c.home.factors).toEqual(factorsOf(totals(b1), totals(b2)));
    expect(c.home.allowed).toEqual(factorsOf(totals(b2), totals(b1)));
    expect(c.regular).toBe(true);
  });

  it("sums the other games before dividing", () => {
    const a = tg(1, { fgm: 20, fga: 60 });
    const b = tg(1, { fgm: 35, fga: 70 });
    const oa = tg(3);
    const ob = tg(4, { dreb: 40 });
    const c = seasonContext(payload([g(100, 1, 2), g(101, a, oa), g(102, ob, b)]), 100)!;
    expect(c.home.games).toBe(2);
    expect(c.home.factors).toEqual(factorsOf(sum(a, b), sum(oa, ob)));
    expect(c.home.perGame.paint).toBe(30);
  });

  it("compares a finals game with the whole regular season", () => {
    const p = payload([
      g(100, tg(1), tg(2), "FINALS"),
      g(101, tg(1), tg(3)),
      g(102, tg(4), tg(1)),
      g(103, tg(1), tg(2), "FINALS"),
    ]);
    const c = seasonContext(p, 100)!;
    expect(c.regular).toBe(false);
    expect(c.home.games).toBe(2);
    expect(c.away.games).toBe(0);
  });

  it("still knows both teams when tonight's statistics aren't built", () => {
    const c = seasonContext(payload([g(100, 1, 2), g(101, tg(1), tg(2))]), 100)!;
    expect([c.home.teamId, c.away.teamId]).toEqual([1, 2]);
    expect([c.home.games, c.away.games]).toEqual([1, 1]);
  });

  it("counts a game with no match type as a regular-season one", () => {
    const c = seasonContext(payload([g(100, 1, 2, ""), g(101, tg(1), tg(3), "")]), 100)!;
    expect(c.regular).toBe(true);
    expect(c.home.games).toBe(1);
  });

  it("is null for a game the season doesn't list", () => {
    expect(seasonContext(payload([g(101, tg(1), tg(2))]), 100)).toBeNull();
  });

  it("leaves a game with one side's statistics out", () => {
    const c = seasonContext(payload([g(100, 1, 2), g(101, tg(1), 3)]), 100)!;
    expect(c.home.games).toBe(0);
  });

  it("has nothing to say, and no NaN, for a team with no other games", () => {
    const p = payload([g(100, 1, 2), g(101, tg(2, { fga: 0, fgm: 0, tpm: 0 }), tg(3))]);
    const c = seasonContext(p, 100)!;
    for (const k of FACTOR_KEYS) {
      expect(c.home.factors[k]).toBeNull();
      expect(c.home.ranks[k]).toBeNull();
    }
    expect(Object.values(c.home.perGame)).toEqual([null, null, null, null, null]);
    expect(c.away.factors.efg).toBeNull();
    expect(c.away.ranks.efg).toBeNull();
    expect(hasNaN(c)).toBe(false);
  });

  it("ranks highest first, ties sharing a place, turnover rate lowest first", () => {
    // eFG = (fgm + 0.5 × tpm) / fga with tpm 0: 0.50, 0.55, 0.55, 0.60.
    const shoot = (teamId: number, fgm: number, tov: number) => tg(teamId, { fgm, fga: 100, tpm: 0, tov });
    const p = payload([
      g(100, 1, 2),
      g(101, shoot(1, 50, 10), shoot(2, 55, 14)),
      g(102, shoot(3, 55, 12), shoot(4, 60, 8)),
    ]);
    const c = seasonContext(p, 100)!;
    expect(c.teams).toBe(4);
    expect([c.home.ranks.efg, c.away.ranks.efg]).toEqual([4, 2]);
    expect(c.away.ranks.tovRate).toBe(4);
  });

  it("takes each team's regular-season place in the table", () => {
    const st = (teamId: number, matchType: string, position: number): SeasonStanding => ({
      teamId, position, poolNumber: 1, matchType, played: 10, won: 6, lost: 4, last5: "WWLWL", streak: "1",
    });
    const c = seasonContext(payload([g(100, 1, 2)], [st(1, "FINALS", 2), st(1, "REGULAR", 5)]), 100)!;
    expect(c.home.standing).toEqual({ position: 5, won: 6, lost: 4, last5: "WWLWL", streak: "1" });
    expect(c.away.standing).toBeNull();
  });

  it("takes Genius's rebounds as they are: dead-ball rebounds are outside them, as in our plays", () => {
    expect(geniusTotals(tg(1, { oreb: 11, orebDeadball: 6, dreb: 22 }))).toMatchObject({ oreb: 11, dreb: 22 });
  });

  it("places a team among its own group only", () => {
    const two = [inGroup(1, 10), inGroup(2, 10, 2), inGroup(3, 20), inGroup(4, 20, 2)];
    const p = payload(
      [g(100, tg(1), tg(2)), g(101, tg(1, { pts: 70 }), tg(2, { pts: 90 })), g(200, tg(3, { pts: 120 }), tg(4, { pts: 110 }))],
      two,
    );
    const c = seasonContext(p, 100)!;
    expect(c.away.ranks.ppp).toBe(1); // team 2 leads its group; teams 3 and 4 score more, in another
    expect(c.home.ranks.ppp).toBe(2);
    expect(c.home.of).toBe(2);
    expect(c.teams).toBe(4);
  });
});

describe("realGap", () => {
  it("needs four other games and a gap of one and a half swings", () => {
    expect(GAP_SWINGS).toBe(1.5);
    expect(MIN_GAP_GAMES).toBe(4);
    expect(realGap(0.6, 0.5, 0.059, 4)).toBe(true);
    expect(realGap(0.6, 0.5, 0.059, 3)).toBe(false);
    expect(realGap(0.55, 0.5, 0.059, 10)).toBe(false);
    expect(realGap(null, 0.5, 0.059, 10)).toBe(false);
    expect(realGap(0.6, null, 0.059, 10)).toBe(false);
    expect(realGap(0.6, 0.5, null, 10)).toBe(false);
  });
});

describe("on SBL Herr 2026/27 as Genius had it on 2026-11-20", () => {
  const season = sblHerr as SeasonPayload;

  it("one game swings around a team's season as the probe measured", () => {
    const c = seasonContext(season, season.games[0].matchId)!;
    expect(c.teams).toBe(11);
    const probe = { ppp: 0.114, efg: 0.059, tovRate: 0.047, orebPct: 0.077, ftRate: 0.12 };
    for (const k of FACTOR_KEYS) expect(Math.abs(c.swing[k]! - probe[k])).toBeLessThan(0.01);
  });

  it("names about two real gaps a game", () => {
    let captions = 0;
    for (const game of season.games) {
      const c = seasonContext(season, game.matchId)!;
      const tonight = { home: factorsOf(geniusTotals(game.home!), geniusTotals(game.away!)), away: factorsOf(geniusTotals(game.away!), geniusTotals(game.home!)) };
      let byHand = 0;
      for (const side of ["home", "away"] as const) {
        for (const k of FACTOR_KEYS) if (realGap(tonight[side][k], c[side].factors[k], c.swing[k], c[side].games)) byHand++;
      }
      expect(seasonGaps(tonight, c)).toBe(byHand);
      captions += byHand;
    }
    const perGame = captions / season.games.length;
    expect(perGame).toBeGreaterThan(1.7);
    expect(perGame).toBeLessThan(2.3);
  });
});

describe("seasonMatchOf", () => {
  const leagues: League[] = [
    { id: "sbl-herr", name: "SBL Herr", country: "SE", seasons: [{ id: "2026-27", label: "2026/27", competitionId: 48974, stages: [] }] },
  ];
  const match = (over: Partial<StoredMatch>): StoredMatch => ({
    id: "m1",
    title: "A – B",
    date: "2026-11-20",
    homeTeam: { name: "A", color: "#111111" },
    awayTeam: { name: "B", color: "#eeeeee" },
    homeRoster: [],
    awayRoster: [],
    events: [],
    leagueId: "sbl-herr",
    seasonId: "2026-27",
    sourceGameId: "2851767",
    ...over,
  });

  it("finds a Genius game's competition and match", () => {
    expect(seasonMatchOf(match({}), leagues)).toEqual({ competitionId: 48974, matchId: 2851767 });
  });

  it("is null for a Profixio game and for a game with no league", () => {
    expect(seasonMatchOf(match({ sourceGameId: "profixio:123"}), leagues)).toBeNull();
    expect(seasonMatchOf(match({ leagueId: undefined, seasonId: undefined }), leagues)).toBeNull();
  });
});
