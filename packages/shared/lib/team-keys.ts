/**
 * What stands out about a team (the design:
 * docs/superpowers/specs/2026-11-21-team-page-design.md, "What stands out").
 * A number is a key when the team has played enough, sits among the best two
 * or the worst two of its group, and is further from the group's average than
 * its own uncertainty explains. Shooting (eFG%) and the free-throw rate are
 * never keys: over a season this short they are the least settled numbers.
 */
import { apart, higherIsBetter, type End, type LeagueSeason, type TeamProfile } from "./league-season";
import { ordinal } from "./season-copy";

/** Games a team needs before anything is called out. */
export const MIN_KEY_GAMES = 5;
/** A key is among this many best or worst of its group. */
export const KEY_EDGE = 2;
/** A key is at least this many standard errors from the group's average. */
export const KEY_ERRORS = 2;
/** Keys shown a side. */
export const MAX_KEYS = 3;

export type KeyMetric = "ppp" | "threeRate" | "orebPct" | "tovRate" | "pace";

export interface TeamKey {
  end: End;
  metric: KeyMetric;
  /** Above the group's average. */
  high: boolean;
  value: number;
  place: number;
  of: number;
  /** The gap in standard errors; the larger, the surer. */
  score: number;
}

export interface TeamKeys {
  status: "early" | "ready";
  games: number;
  withBall: TeamKey[];
  withoutBall: TeamKey[];
}

const CANDIDATES: Record<End, readonly KeyMetric[]> = {
  own: ["ppp", "threeRate", "orebPct", "tovRate", "pace"],
  allowed: ["ppp", "threeRate", "orebPct", "tovRate"],
};

function keysAt(end: End, profile: TeamProfile, league: LeagueSeason): TeamKey[] {
  const group = league.groups.find((g) => g.group === profile.group);
  const out: TeamKey[] = [];
  for (const metric of CANDIDATES[end]) {
    const value = profile[end][metric];
    const place = profile.place[end][metric];
    const mean = group?.mean[end][metric] ?? null;
    const swing = league.swing[end][metric];
    if (value === null || place === null || mean === null || swing === null) continue;
    if (place > KEY_EDGE && place <= profile.of - KEY_EDGE) continue;
    if (!apart(value, mean)) continue;
    const gap = Math.abs(value - mean);
    const se = swing / Math.sqrt(profile.games);
    if (gap < KEY_ERRORS * se) continue;
    out.push({ end, metric, high: value > mean, value, place, of: profile.of, score: se > 0 ? gap / se : Infinity });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, MAX_KEYS);
}

/** The team's keys at both ends, strongest first. */
export function teamKeys(profile: TeamProfile, league: LeagueSeason): TeamKeys {
  if (profile.games < MIN_KEY_GAMES) return { status: "early", games: profile.games, withBall: [], withoutBall: [] };
  return { status: "ready", games: profile.games, withBall: keysAt("own", profile, league), withoutBall: keysAt("allowed", profile, league) };
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

const WORDS: Record<End, Record<KeyMetric, [high: (v: number) => string, low: (v: number) => string] | null>> = {
  own: {
    ppp: [(v) => `Score efficiently: ${v.toFixed(2)} points per possession`, (v) => `Struggle to score: ${v.toFixed(2)} points per possession`],
    threeRate: [(v) => `Shoot a lot of threes: ${pct(v)} of shots`, (v) => `Rarely shoot threes: ${pct(v)} of shots`],
    orebPct: [(v) => `Crash the offensive glass: win ${pct(v)} of their misses`, (v) => `Leave the offensive glass: win ${pct(v)} of their misses`],
    tovRate: [(v) => `Lose the ball: on ${pct(v)} of possessions`, (v) => `Take care of the ball: turnovers on ${pct(v)} of possessions`],
    pace: [(v) => `Play fast: ${Math.round(v)} possessions a game`, (v) => `Play slowly: ${Math.round(v)} possessions a game`],
  },
  allowed: {
    ppp: [
      (v) => `Easy to score on: ${v.toFixed(2)} points allowed per possession`,
      (v) => `Hard to score on: ${v.toFixed(2)} points allowed per possession`,
    ],
    threeRate: [(v) => `Give up threes: ${pct(v)} of opponents' shots`, (v) => `Take away the three: ${pct(v)} of opponents' shots`],
    orebPct: [
      (v) => `Give up second chances: opponents win ${pct(v)} of their misses`,
      (v) => `Clean the defensive glass: opponents win ${pct(v)} of their misses`,
    ],
    tovRate: [(v) => `Force turnovers: on ${pct(v)} of opponents' possessions`, (v) => `Rarely force turnovers: on ${pct(v)} of opponents' possessions`],
    pace: null,
  },
};

/** "most in the league" for the group's highest value, "fewest in Södra" for its lowest, else "2nd of 12". */
function placeWords(key: TeamKey, where: string | null): string {
  const better = higherIsBetter(key.end, key.metric);
  const highest = (key.place === 1 && better) || (key.place === key.of && !better);
  const lowest = (key.place === 1 && !better) || (key.place === key.of && better);
  const scope = where ?? "the league";
  if (highest) return `most in ${scope}`;
  if (lowest) return `fewest in ${scope}`;
  return `${ordinal(key.place)} of ${key.of}`;
}

/** One key as a sentence without a subject, so it reads right on any team's page. `where` names the group in a grouped league. */
export function keySentence(key: TeamKey, where: string | null): string {
  const words = WORDS[key.end][key.metric];
  if (!words) return "";
  return `${(key.high ? words[0] : words[1])(key.value)}, ${placeWords(key, where)}.`;
}

/** The section's one line when it has no keys; null when it has some. */
export function keysEmptyLine(keys: TeamKeys): string | null {
  if (keys.status === "early") return `Too early to say what stands out: ${keys.games} ${keys.games === 1 ? "game" : "games"} played.`;
  if (keys.withBall.length === 0 && keys.withoutBall.length === 0) return "Nothing stands out. Close to the league average at both ends.";
  return null;
}
