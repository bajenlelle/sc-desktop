/**
 * The Highlights page's data, from the games a player has imported: who played in them (for "Who are you?"),
 * which games the player played in and how (their line, how good their plays are), and where each suggested play
 * sits in the game's video. Pure; the page loads the games and their plays.
 */
import type { PlayByPlayEvent, StoredMatch, SyncPoint } from "../types/match";
import { computeVideoTime } from "./clip-timing";
import { playerName } from "./events";
import { FRAME_MAX, FRAME_SAMPLE_FPS } from "./highlight-framing";
import { highlightCandidates, type HighlightCandidate } from "./highlight-picks";
import { pbpLine } from "./pbp-line";

export interface GamePlayer {
  personId: string;
  name: string;
  number: string | null;
  teamName: string;
  /** How many of the games they appear in. */
  games: number;
}

type GameWithEvents = Pick<StoredMatch, "id" | "date" | "homeTeam" | "awayTeam" | "syncPoint" | "videoUrl"> & { events: PlayByPlayEvent[] };

/** Everyone with a play in these games, the most games first, then by name. */
export function playersInGames(games: GameWithEvents[]): GamePlayer[] {
  const byId = new Map<string, GamePlayer>();
  for (const g of games) {
    const seen = new Set<string>();
    for (const e of g.events) {
      if (!e.player) continue;
      const id = String(e.player.playerId);
      if (seen.has(id)) continue;
      seen.add(id);
      const teamName = e.eventTeam?.teamName || (e.player.teamNumber === 2 ? g.awayTeam.name : g.homeTeam.name);
      const p = byId.get(id);
      if (p) p.games += 1;
      else byId.set(id, { personId: id, name: playerName(e), number: e.player.pno ? String(e.player.pno) : null, teamName, games: 1 });
    }
  }
  return [...byId.values()].sort((a, b) => b.games - a.games || a.name.localeCompare(b.name));
}

export interface MyGame {
  id: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  /** "22 pts · 17 reb". */
  line: string;
  points: number;
  candidates: HighlightCandidate[];
  /** The sum of the candidates' scores: how good a game it was for highlights. */
  score: number;
  /** The game has a sync point, so its plays can be found in the video. */
  synced: boolean;
}

/** The games the player has plays in, newest first. */
export function myGames(games: GameWithEvents[], personId: string): MyGame[] {
  const out: MyGame[] = [];
  for (const g of games) {
    if (!g.events.some((e) => e.player && String(e.player.playerId) === personId)) continue;
    const l = pbpLine(g.events, personId, "genius");
    const parts = [`${l.pts} pts`];
    const reb = (l.oreb ?? 0) + (l.dreb ?? 0);
    if (reb >= 5) parts.push(`${reb} reb`);
    if ((l.ast ?? 0) >= 4) parts.push(`${l.ast} ast`);
    const candidates = highlightCandidates({ matchId: g.id, events: g.events }, personId);
    out.push({
      id: g.id,
      date: g.date,
      homeTeam: g.homeTeam.name,
      awayTeam: g.awayTeam.name,
      line: parts.join(" · "),
      points: l.pts,
      candidates,
      score: candidates.reduce((s, c) => s + c.score, 0),
      synced: !!g.syncPoint,
    });
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** The game to start with: the best one for highlights that can be found in its video. */
export function bestGameId(games: MyGame[]): string | null {
  const usable = games.filter((g) => g.synced && g.candidates.length > 0);
  if (usable.length === 0) return null;
  return usable.reduce((best, g) => (g.score > best.score ? g : best)).id;
}

/** Seconds before the clip's first play and after its anchor that the framing looks at. */
const BEFORE_S = 5;
const AFTER_S = 2.5;
/** The longest window one framing call takes. */
const MAX_WINDOW_S = (FRAME_MAX - 1) / FRAME_SAMPLE_FPS;

/**
 * Where the candidate sits in the game's video: from 5 s before its first play to 2.5 s after the play it's built
 * around (a basket is entered in the feed a moment after it goes in), at most 10.75 s, keeping the end. Null when
 * the game isn't synced.
 */
export function candidateWindow(c: HighlightCandidate, sync: SyncPoint | undefined): { start: number; end: number } | null {
  if (!sync) return null;
  const first = computeVideoTime(c.events[0], sync);
  const anchor = computeVideoTime(c.anchor, sync);
  if (first == null || anchor == null) return null;
  const end = anchor + AFTER_S;
  const start = Math.max(0, first - BEFORE_S, end - MAX_WINDOW_S);
  return { start, end };
}
