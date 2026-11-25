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
import type { GameMoment } from "./game-flow";
import { applyPlayFilters, type PlayFilters } from "./play-filters";
import { isBookkeepingEvent, sortPlaysChronologically } from "./events";
import { gameBox, type BoxStat } from "./game-box";
import { gameShots, SHOT_ZONES, type ChartShot, type ShotZone } from "./game-shots";
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
  /** The opponent's (Genius) team id in the game's competition, for its name to open its page; absent for a game that is no team's. */
  opponentId?: number;
  result: "W" | "L" | null;
  score: { own: number; opp: number } | null;
  /** A game that is no team's (Add clips lists the library's games): its title, which its header shows instead. */
  title?: string;
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
      opponentId: r.opponentId,
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

/** A key's count in the coach's games; `made` only for threes. */
export interface StatCount {
  count: number;
  made: number | null;
}

/** What the Season view shows from the coach's games. */
export interface TeamVideo {
  /** The games counted. */
  games: number;
  /** Every play on each side (Watch all). */
  all: Record<PlaysSide, number>;
  stats: Record<PlaysSide, Record<KeyStat, StatCount>>;
  shots: {
    /** Games with shot positions: the chart's dots and its zones come from these alone. */
    games: number;
    /** Games left out of the chart (imported before shot positions). */
    withoutPositions: number;
    dots: (ChartShot & { key: string })[];
    zones: Record<ShotZone, { made: number; attempts: number }>;
  };
  /** The team's players (With the ball), by person id: in how many games they have a play, and how many plays. */
  players: ReadonlyMap<number, { games: number; plays: number }>;
}

const SIDES: readonly PlaysSide[] = ["with", "without"];
const STATS: readonly KeyStat[] = ["threes", "oreb", "tov"];

/** The counts the Season view shows, each the length of what its pick opens. */
export function teamVideo(games: readonly GamePlays[]): TeamVideo {
  const all = { with: 0, without: 0 } as Record<PlaysSide, number>;
  const stats = { with: {}, without: {} } as Record<PlaysSide, Record<KeyStat, StatCount>>;
  for (const side of SIDES) {
    all[side] = pickKeys(null, side, games).length;
    for (const stat of STATS) stats[side][stat] = { count: 0, made: stat === "threes" ? 0 : null };
  }

  const zones = {} as Record<ShotZone, { made: number; attempts: number }>;
  for (const zone of SHOT_ZONES) zones[zone] = { made: 0, attempts: 0 };
  const dots: (ChartShot & { key: string })[] = [];
  let shotGames = 0;
  let withoutPositions = 0;
  const players = new Map<number, { games: number; plays: number }>();

  for (const g of games) {
    const box = gameBox(g.events);
    for (const side of SIDES) {
      const team = sideNumber(g.game, side) === 1 ? box.home : box.away;
      for (const stat of STATS) {
        const cell = team.totals[STAT_CELL[stat]];
        const c = stats[side][stat];
        c.count += cell.eventIds.length;
        if (c.made !== null) c.made += cell.value;
      }
    }

    const shots = gameShots(g.events);
    if (shots.hasPositions) {
      shotGames++;
      for (const s of g.game.side === 1 ? shots.home : shots.away) {
        dots.push({ ...s, key: keyOf(g.game, s.eventId) });
        zones[s.zone].attempts++;
        if (s.made) zones[s.zone].made++;
      }
    } else if (g.events.some((e) => e.type === "2pt" || e.type === "3pt")) {
      withoutPositions++;
    }

    const inGame = new Map<number, number>();
    for (const e of g.events) {
      if (isBookkeepingEvent(e) || sideOf(e) !== g.game.side || !e.player) continue;
      inGame.set(e.player.playerId, (inGame.get(e.player.playerId) ?? 0) + 1);
    }
    for (const [id, n] of inGame) {
      const p = players.get(id) ?? { games: 0, plays: 0 };
      players.set(id, { games: p.games + 1, plays: p.plays + n });
    }
  }

  return { games: games.length, all, stats, shots: { games: shotGames, withoutPositions, dots, zones }, players };
}

/** A row of the Plays list: a game's header, or one of its plays. */
export type TeamPlayRow =
  | { kind: "game"; game: TeamGame; plays: number }
  | { kind: "play"; key: string; game: TeamGame; event: PlayByPlayEvent };

/**
 * The Plays list: newest game first, each game's plays in game order, only the
 * side asked for ("all": both teams' plays and the team rows, as Add clips lists
 * a game), narrowed by the picked plays (null: none picked) and by the filters
 * (labels through `labelsOf`, moments through `momentsOf`). A game with nothing
 * listed has no header; a header counts its listed plays.
 */
export function teamPlayRows(
  games: readonly GamePlays[],
  side: PlaysSide | "all",
  picked: ReadonlySet<string> | null,
  filters: PlayFilters,
  labelsOf?: (key: string) => ReadonlySet<string> | undefined,
  momentsOf?: (gameId: string, eventId: number) => ReadonlySet<GameMoment> | undefined,
): TeamPlayRow[] {
  const out: TeamPlayRow[] = [];
  for (const g of [...games].sort((a, b) => newestFirst(a.game, b.game))) {
    const n = side === "all" ? null : sideNumber(g.game, side);
    const entries = sortPlaysChronologically(g.events)
      .filter((e) => !isBookkeepingEvent(e) && (n === null || sideOf(e) === n))
      .map((event) => ({ event, key: keyOf(g.game, event.eventId) }))
      .filter((x) => !picked || picked.has(x.key));
    const kept = applyPlayFilters(
      entries,
      filters,
      labelsOf ? (x) => labelsOf(x.key) : undefined,
      momentsOf ? (x) => momentsOf(g.game.gameId, x.event.eventId) : undefined,
    );
    if (kept.length === 0) continue;
    out.push({ kind: "game", game: g.game, plays: kept.length });
    for (const x of kept) out.push({ kind: "play", key: x.key, game: g.game, event: x.event });
  }
  return out;
}

function stepPlayable(rows: readonly TeamPlayRow[], fromKey: string | null, playable: (gameId: string) => boolean, dir: 1 | -1): string | null {
  const from = fromKey === null ? -1 : rows.findIndex((r) => r.kind === "play" && r.key === fromKey);
  if (from < 0 && dir === -1) return null;
  for (let i = from < 0 ? 0 : from + dir; i >= 0 && i < rows.length; i += dir) {
    const r = rows[i];
    if (r.kind === "play" && playable(r.game.gameId)) return r.key;
  }
  return null;
}

/** The next listed play whose game can play (the first with no key, or a key no longer listed); null past the last. */
export function nextPlayable(rows: readonly TeamPlayRow[], fromKey: string | null, playable: (gameId: string) => boolean): string | null {
  return stepPlayable(rows, fromKey, playable, 1);
}

/** The listed play before, whose game can play; null before the first. */
export function previousPlayable(rows: readonly TeamPlayRow[], fromKey: string | null, playable: (gameId: string) => boolean): string | null {
  return stepPlayable(rows, fromKey, playable, -1);
}
