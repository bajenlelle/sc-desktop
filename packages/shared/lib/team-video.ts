/**
 * A team's plays in the coach's own games (docs/teams.md, "Plays"): which of
 * its games the coach has and its side in each, what a Watch link picks, the
 * counts the Season view shows beside the keys, and the Plays list across
 * games. Pure: the desktop's team page and the tests share it.
 *
 * Every count is the length of the plays its pick opens (`pickKeys`), and the
 * picks count through the Stats view's own rules (`gameBox`, `gameShots`), so a
 * number here always equals the plays Watch lists and what one game's Stats
 * view says.
 */
import type { PlayByPlayEvent } from "../types/match";
import { isBookkeepingEvent } from "./events";
import { gameBox, type BoxStat } from "./game-box";
import { gameShots, type ShotZone } from "./game-shots";
import type { End } from "./league-season";
import type { KeyMetric } from "./team-keys";
import type { TeamGameRow } from "./team-schedule";

/** One of the team's games in the coach's library. */
export interface TeamGame {
  /** The league's (Genius) match id. */
  leagueMatchId: number;
  /** The library game's id (StoredMatch.id): what clip keys are made of. */
  gameId: string;
  /** The team's teamNumber in this game: 1 at home, 2 away. */
  side: 1 | 2;
  /** ISO UTC. */
  at: string;
  home: boolean;
  opponentName: string;
  result: "W" | "L" | null;
  score: { own: number; opp: number } | null;
}

/** A game and its stored plays. */
export interface GamePlays {
  game: TeamGame;
  events: readonly PlayByPlayEvent[];
}

/** The team's own plays, or what its opponents did against it. */
export type PlaysSide = "with" | "without";

/** The keys that have plays behind them: threes, offensive rebounds, turnovers. */
export type KeyStat = "threes" | "oreb" | "tov";

/** What a Watch link asked for. A zone or a player is always the team's own (With the ball). */
export type PlaysPick =
  | { kind: "stat"; stat: KeyStat; side: PlaysSide }
  | { kind: "zone"; zone: ShotZone }
  | { kind: "player"; personId: number; name: string };

const STAT_CELL: Record<KeyStat, BoxStat> = { threes: "tp", oreb: "oreb", tov: "tov" };

/** The team's played games that the coach has, newest first, with its side in each (from the fixture, never names). */
export function teamLibraryGames(rows: readonly TeamGameRow[], library: ReadonlyMap<number, string>): TeamGame[] {
  const out: TeamGame[] = [];
  for (const r of rows) {
    if (r.status !== "played") continue;
    const gameId = library.get(r.matchId);
    if (!gameId) continue;
    out.push({
      leagueMatchId: r.matchId,
      gameId,
      side: r.home ? 1 : 2,
      at: r.at,
      home: r.home,
      opponentName: r.opponentName,
      result: r.result,
      score: r.score,
    });
  }
  return out.sort(newestFirst);
}

/** Latest game first; the same moment by league match id, so the order never depends on how the games came in. */
export function newestFirst(a: TeamGame, b: TeamGame): number {
  return b.at.localeCompare(a.at) || b.leagueMatchId - a.leagueMatchId;
}

/** The side a play belongs to: its player's, else its team's (a team row). */
export function sideOf(e: PlayByPlayEvent): 1 | 2 | null {
  const n = e.player?.teamNumber ?? e.eventTeam?.teamNumber;
  return n === 1 || n === 2 ? n : null;
}

/** The teamNumber whose plays a side lists in this game. */
export function sideNumber(game: TeamGame, side: PlaysSide): 1 | 2 {
  if (side === "with") return game.side;
  return game.side === 1 ? 2 : 1;
}

/** The plays behind a key on the Season view, or null for a key no one kind of play answers (points per possession, pace). */
export function keyStatOf(end: End, metric: KeyMetric): { stat: KeyStat; side: PlaysSide } | null {
  const side: PlaysSide = end === "own" ? "with" : "without";
  switch (metric) {
    case "threeRate":
      return { stat: "threes", side };
    case "orebPct":
      return { stat: "oreb", side };
    case "tovRate":
      return { stat: "tov", side };
    default:
      return null;
  }
}

const keyOf = (game: TeamGame, eventId: number) => `${game.gameId}:${eventId}`;

/** One game's plays a pick opens, as clip keys, in the game's own order. */
function gameKeys(pick: PlaysPick | null, side: PlaysSide, g: GamePlays): string[] {
  const n = sideNumber(g.game, side);
  if (!pick) return g.events.filter((e) => !isBookkeepingEvent(e) && sideOf(e) === n).map((e) => keyOf(g.game, e.eventId));
  if (pick.kind === "stat") {
    const box = gameBox(g.events);
    const team = n === 1 ? box.home : box.away;
    return team.totals[STAT_CELL[pick.stat]].eventIds.map((id) => keyOf(g.game, id));
  }
  if (side !== "with") return [];
  if (pick.kind === "zone") {
    const shots = gameShots(g.events);
    return (n === 1 ? shots.home : shots.away).filter((s) => s.zone === pick.zone).map((s) => keyOf(g.game, s.eventId));
  }
  return g.events
    .filter((e) => !isBookkeepingEvent(e) && sideOf(e) === n && e.player?.playerId === pick.personId)
    .map((e) => keyOf(g.game, e.eventId));
}

/**
 * The plays a pick opens across the games, as `${gameId}:${eventId}`, game by
 * game in the order given. No pick: every play on that side. A zone or a
 * player belongs to the team's own side, so asked for without the ball it opens nothing.
 */
export function pickKeys(pick: PlaysPick | null, side: PlaysSide, games: readonly GamePlays[]): string[] {
  return games.flatMap((g) => gameKeys(pick, side, g));
}

/** The pick after a flip of the side: a stat follows to the other side; a zone or a player has no other side and goes. */
export function flipPick(pick: PlaysPick | null, to: PlaysSide): PlaysPick | null {
  if (!pick) return null;
  return pick.kind === "stat" ? { ...pick, side: to } : null;
}

/** Whether a game's plays can play here: "sync" without a tip-off, "video" without a readable file, else "ok" (not probed yet counts as ok). */
export function playability(
  m: { videoUrl?: string | null; syncPoint?: unknown },
  status: "ok" | "missing" | "unreadable" | undefined,
): "ok" | "video" | "sync" {
  if (!m.syncPoint) return "sync";
  if (!m.videoUrl || status === "missing" || status === "unreadable") return "video";
  return "ok";
}
