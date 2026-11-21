/**
 * The whole competition's season, team by team, for the Teams page and a
 * team's page (the design: docs/superpowers/specs/2026-11-21-team-page-design.md).
 * Every team's numbers at both ends, from the same summed rows and the same
 * formula as the game's Stats view (`factorsOf` over `geniusTotals`), and its
 * place within its group (the standings' `poolNumber`): a league played in
 * groups is measured group by group, one played as one table has one group.
 */
import { FACTOR_SCALE, factorsOf, type FactorKey, type PointsFrom, type TeamFactors } from "./game-box";
import { MIN_SWING_GAMES, geniusTotals, perGame, populationSd, sidesByTeam, standingRowOf, summed, type Side } from "./season-context";
import type { TeamStanding } from "./season-copy";
import type { SeasonPayload, TeamGame } from "./season-payload";

/** The four factors and points per possession, the share of shots from three, and possessions a game. */
export type ProfileKey = FactorKey | "threeRate" | "pace";

export const PROFILE_KEYS: readonly ProfileKey[] = ["ppp", "efg", "tovRate", "orebPct", "ftRate", "threeRate", "pace"];

/** Each bar's fixed scale: the factors' own, and the share of shots from three. */
export const PROFILE_SCALE: Record<Exclude<ProfileKey, "pace">, number> = { ...FACTOR_SCALE, threeRate: 0.6 };

/** With the ball (`own`) or what the team lets its opponents do (`allowed`). */
export type End = "own" | "allowed";

export interface TeamProfile {
  teamId: number;
  /** The group it is measured in (the standings' poolNumber); null without standings. */
  group: number | null;
  /** Counted regular-season games. */
  games: number;
  own: Record<ProfileKey, number | null>;
  /** Its opponents' numbers in its games; `pace` is always null here. */
  allowed: Record<ProfileKey, number | null>;
  /** 1 = the best of its group at that end; ties share a place; null without a value. */
  place: Record<End, Record<ProfileKey, number | null>>;
  /** Teams of its group with a counted game: the "of 12". */
  of: number;
  /** Points a game from the paint, second chances, fast breaks, turnovers and the bench. */
  perGame: Record<PointsFrom, number | null>;
  standing: TeamStanding | null;
}

export interface GroupSeason {
  group: number | null;
  teamIds: number[];
  /** The mean of its teams' values. */
  mean: Record<End, Record<ProfileKey, number | null>>;
}

export interface LeagueSeason {
  /** Every team in the standings or in a fixture. */
  teams: ReadonlyMap<number, TeamProfile>;
  /** Ascending group number, a null group last. */
  groups: GroupSeason[];
  /** One game's usual swing for each number, competition-wide. */
  swing: Record<End, Record<ProfileKey, number | null>>;
}

const blank = (): Record<ProfileKey, number | null> =>
  ({ ppp: null, efg: null, tovRate: null, orebPct: null, ftRate: null, threeRate: null, pace: null });

const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null);

/** One side's numbers from its rows and its opponents' (a season summed, or a single game). */
function values(team: TeamGame[], opp: TeamGame[], games: number, withPace: boolean): Record<ProfileKey, number | null> {
  if (games === 0) return blank();
  const t = summed(team);
  const o = summed(opp);
  const f: TeamFactors = factorsOf(t, o);
  const tpa = team.reduce((n, r) => n + r.tpa, 0);
  return {
    ppp: f.ppp,
    efg: f.efg,
    tovRate: f.tovRate,
    orebPct: f.orebPct,
    ftRate: f.ftRate,
    threeRate: ratio(tpa, t.fga),
    pace: withPace && f.possessions !== null ? f.possessions / games : null,
  };
}

/** Whether a higher value is the better one at that end: more is better with the ball, less is better allowed, turnovers the other way round. */
export function higherIsBetter(end: End, key: ProfileKey): boolean {
  if (end === "own") return key !== "tovRate";
  return key === "tovRate";
}

function placeOf(end: End, key: ProfileKey, value: number | null, all: (number | null)[]): number | null {
  if (value === null) return null;
  const higher = higherIsBetter(end, key);
  return 1 + all.filter((v) => v !== null && (higher ? v > value : v < value)).length;
}

const mean = (xs: (number | null)[]): number | null => {
  const known = xs.filter((x): x is number => x !== null);
  return known.length ? known.reduce((a, b) => a + b, 0) / known.length : null;
};

function swingOf(byTeam: Map<number, Side[]>): Record<End, Record<ProfileKey, number | null>> {
  const out: Record<End, Record<ProfileKey, number | null>> = { own: blank(), allowed: blank() };
  for (const end of ["own", "allowed"] as const) {
    for (const key of [...PROFILE_KEYS]) {
      if (end === "allowed" && key === "pace") continue;
      const spreads: number[] = [];
      for (const sides of byTeam.values()) {
        if (sides.length < MIN_SWING_GAMES) continue;
        const single = sides
          .map((s) => (end === "own" ? values([s.team], [s.opp], 1, true) : values([s.opp], [s.team], 1, false))[key])
          .filter((v): v is number => v !== null);
        if (single.length >= MIN_SWING_GAMES) spreads.push(populationSd(single));
      }
      out[end][key] = spreads.length ? spreads.reduce((a, b) => a + b, 0) / spreads.length : null;
    }
  }
  return out;
}

/** Every team's season, placed within its group. */
export function leagueSeason(payload: SeasonPayload): LeagueSeason {
  const byTeam = sidesByTeam(payload);

  const ids = new Set<number>();
  for (const s of payload.standings) ids.add(s.teamId);
  for (const game of payload.games) {
    ids.add(game.homeTeamId);
    ids.add(game.awayTeamId);
  }
  for (const id of byTeam.keys()) ids.add(id);

  const profiles = new Map<number, TeamProfile>();
  for (const teamId of ids) {
    const sides = byTeam.get(teamId) ?? [];
    const row = standingRowOf(payload, teamId);
    profiles.set(teamId, {
      teamId,
      group: row?.poolNumber ?? null,
      games: sides.length,
      own: values(sides.map((s) => s.team), sides.map((s) => s.opp), sides.length, true),
      allowed: values(sides.map((s) => s.opp), sides.map((s) => s.team), sides.length, false),
      place: { own: blank(), allowed: blank() },
      of: 0,
      perGame: perGame(sides),
      standing: row ? { position: row.position, won: row.won, lost: row.lost, last5: row.last5, streak: row.streak } : null,
    });
  }

  const groupIds = [...new Set([...profiles.values()].map((p) => p.group))].sort((a, b) =>
    a === null ? 1 : b === null ? -1 : a - b,
  );
  const groups: GroupSeason[] = groupIds.map((group) => {
    const members = [...profiles.values()].filter((p) => p.group === group);
    const playing = members.filter((p) => p.games > 0);
    const groupMean: Record<End, Record<ProfileKey, number | null>> = { own: blank(), allowed: blank() };
    for (const end of ["own", "allowed"] as const) {
      for (const key of PROFILE_KEYS) {
        const all = playing.map((p) => p[end][key]);
        groupMean[end][key] = mean(all);
        for (const p of playing) p.place[end][key] = placeOf(end, key, p[end][key], all);
      }
    }
    for (const p of members) p.of = playing.length;
    return { group, teamIds: members.map((p) => p.teamId), mean: groupMean };
  });

  return { teams: profiles, groups, swing: swingOf(byTeam) };
}
