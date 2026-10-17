/**
 * The numbers behind a stats card, on the desktop.
 *
 * Genius games read the federation's official hosted pages (hosted-stats.ts)
 * through the app's HTTP client: the box score for a game, the player
 * statistics page for a season. If a page can't be read, a game falls back
 * to counting the stored play-by-play (no minutes or plus-minus); a season
 * has no fallback. Profixio games only ever count their play-by-play.
 *
 * Pages are cached for the session (10 minutes each): one season page holds
 * every player in the competition.
 */
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { playerName } from "@scoutable/shared/lib/events";
import {
  HostedLayoutError,
  hostedBoxScoreUrl,
  hostedPlayerStatsUrl,
  parseHostedBoxScore,
  parseHostedPlayerStats,
  type HostedSeasonPlayer,
} from "@scoutable/shared/lib/hosted-stats";
import { pbpLine } from "@scoutable/shared/lib/pbp-line";
import { PROFIXIO_SOURCE_PREFIX } from "@scoutable/shared/lib/provider";
import type { GameLine } from "@scoutable/shared/lib/stat-lines";
import {
  STATS_CARD_VERSION,
  defaultColumns,
  normalizeColumns,
  type GameStatsCard,
  type SeasonStatsCard,
  type StatKey,
  type StatsCardPlayer,
  type StatsCardSeason,
  type StatsCardSource,
} from "@scoutable/shared/lib/stats-card";
import type { League } from "@scoutable/shared/types/league";
import type { StoredMatch } from "@/types/match";
import { Sentry } from "@/lib/sentry";

// ---------------------------------------------------------------------------
// Which games have stats
// ---------------------------------------------------------------------------

export type GameStatsKind = "genius" | "profixio";

/** Genius games (numeric source id) and Profixio games have stats; older imports don't. */
export function statsKindOf(match: StoredMatch | undefined): GameStatsKind | null {
  const id = match?.sourceGameId ?? "";
  if (id.startsWith(PROFIXIO_SOURCE_PREFIX)) return "profixio";
  if (/^\d+$/.test(id)) return "genius";
  return null;
}

/** The game's season as a stats card names it, when it's a Genius competition. */
export function seasonOf(match: StoredMatch, leagues: League[]): StatsCardSeason | null {
  const league = leagues.find((l) => l.id === match.leagueId);
  const season = league?.seasons.find((s) => s.id === match.seasonId);
  if (!league || !season?.competitionId || season.provider === "profixio") return null;
  return {
    competitionId: season.competitionId,
    leagueId: league.id,
    seasonId: season.id,
    label: `${league.name} ${season.label}`,
  };
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

const PAGE_TTL_MS = 10 * 60 * 1000;
const pages = new Map<string, { at: number; html: Promise<string> }>();

function hostedPage(url: string, fresh = false): Promise<string> {
  const hit = pages.get(url);
  if (!fresh && hit && Date.now() - hit.at < PAGE_TTL_MS) return hit.html;
  const html = (async () => {
    const res = await tauriFetch(url, { method: "GET", signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`The stats page answered ${res.status}`);
    return res.text();
  })();
  pages.set(url, { at: Date.now(), html });
  html.catch(() => pages.delete(url)); // a failure is retried next time
  return html;
}

/** A layout change is ours to fix; a network failure isn't worth a report. */
function noteFailure(e: unknown): void {
  if (e instanceof HostedLayoutError) Sentry.captureException(e);
}

// ---------------------------------------------------------------------------
// A game
// ---------------------------------------------------------------------------

export interface StatsPlayerOption {
  player: StatsCardPlayer;
  line: GameLine;
  side: "home" | "away";
}

export interface GameStats {
  source: StatsCardSource;
  /** Everyone who played, home team first. */
  players: StatsPlayerOption[];
  score: { home: number; away: number };
}

const plain = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** "Middlebrooks, B." → "B. Middlebrooks", for a player our events don't name. */
function printedToName(printed: string): string {
  const [family, given] = printed.split(",").map((s) => s.trim());
  return given ? `${given} ${family}` : printed;
}

/** Names and shirt numbers by personId, from the game's stored events. */
function eventPeople(match: StoredMatch): Map<string, { name: string; number: string | null; side: "home" | "away"; teamName: string }> {
  const people = new Map<string, { name: string; number: string | null; side: "home" | "away"; teamName: string }>();
  for (const e of match.events ?? []) {
    if (!e.player) continue;
    const id = String(e.player.playerId);
    if (people.has(id)) continue;
    const side = e.player.teamNumber === 2 ? "away" : "home";
    people.set(id, {
      name: playerName(e),
      number: e.player.pno ? String(e.player.pno) : null,
      side,
      teamName: e.eventTeam?.teamName || (side === "home" ? match.homeTeam.name : match.awayTeam.name),
    });
  }
  return people;
}

function totals(players: StatsPlayerOption[]): { home: number; away: number } {
  const sum = (side: "home" | "away") => players.filter((p) => p.side === side).reduce((n, p) => n + p.line.pts, 0);
  return { home: sum("home"), away: sum("away") };
}

/** Counting stats from the stored play-by-play. */
function statsFromEvents(match: StoredMatch, kind: GameStatsKind): GameStats {
  const players = [...eventPeople(match)].map(([id, p]): StatsPlayerOption => ({
    player: { id, name: p.name, number: p.number, teamId: null, teamName: p.teamName },
    line: pbpLine(match.events ?? [], id, kind),
    side: p.side,
  }));
  players.sort((a, b) => (a.side === b.side ? 0 : a.side === "home" ? -1 : 1));
  return { source: kind === "profixio" ? "profixio" : "pbp", players, score: totals(players) };
}

/** Everyone's line in one game, or null when the game has no stats at all. */
export async function loadGameStats(
  match: StoredMatch,
  leagues: League[],
  opts: { fresh?: boolean } = {},
): Promise<GameStats | null> {
  const kind = statsKindOf(match);
  if (!kind) return null;
  const season = kind === "genius" ? seasonOf(match, leagues) : null;
  if (!season) return statsFromEvents(match, kind);

  try {
    const html = await hostedPage(hostedBoxScoreUrl(season.competitionId, match.sourceGameId!), opts.fresh);
    const people = eventPeople(match);
    const teams = parseHostedBoxScore(html);
    const players: StatsPlayerOption[] = [];
    teams.forEach((team, index) => {
      const side =
        plain(team.teamName) === plain(match.homeTeam.name)
          ? "home"
          : plain(team.teamName) === plain(match.awayTeam.name)
            ? "away"
            : index === 0
              ? "home"
              : "away";
      for (const p of team.players) {
        if (!p.line.min && !p.line.pts) continue; // didn't play
        const known = people.get(p.personId);
        players.push({
          player: {
            id: p.personId,
            name: known?.name ?? printedToName(p.printedName),
            number: p.number ?? known?.number ?? null,
            teamId: team.teamId,
            teamName: team.teamName,
          },
          line: p.line,
          side,
        });
      }
    });
    if (players.length === 0) return statsFromEvents(match, kind);
    return { source: "genius_hosted", players, score: totals(players) };
  } catch (e) {
    noteFailure(e);
    return statsFromEvents(match, kind);
  }
}

// ---------------------------------------------------------------------------
// A season
// ---------------------------------------------------------------------------

/** The player's season line in the competition, or null when they aren't listed. */
export async function loadSeasonPlayer(
  competitionId: number,
  personId: string,
  opts: { fresh?: boolean } = {},
): Promise<HostedSeasonPlayer | null> {
  try {
    const players = parseHostedPlayerStats(await hostedPage(hostedPlayerStatsUrl(competitionId), opts.fresh));
    return players.get(personId) ?? null;
  } catch (e) {
    noteFailure(e);
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Building cards
// ---------------------------------------------------------------------------

/** What survives a change of player, game or scope: the overrides, and hand-picked columns. */
export interface CardKeep {
  heading?: string | null;
  details?: string | null;
  /** Only when the player picked them; otherwise the new line's defaults apply. */
  columns?: StatKey[];
}

export function makeGameCard(match: StoredMatch, stats: GameStats, option: StatsPlayerOption, competitionId: number | null, keep: CardKeep = {}): GameStatsCard {
  const home = option.side === "home";
  const card: GameStatsCard = {
    type: "stats",
    v: STATS_CARD_VERSION,
    source: stats.source,
    scope: "game",
    player: option.player,
    game: {
      matchId: match.id,
      sourceGameId: match.sourceGameId ?? "",
      competitionId,
      opponent: home ? match.awayTeam.name : match.homeTeam.name,
      date: match.date,
      home,
      us: home ? stats.score.home : stats.score.away,
      them: home ? stats.score.away : stats.score.home,
    },
    line: option.line,
    columns: [],
    heading: keep.heading ?? null,
    details: keep.details ?? null,
    asOf: new Date().toISOString(),
  };
  const kept = keep.columns ? normalizeColumns(keep.columns, card) : [];
  card.columns = kept.length > 0 ? kept : defaultColumns(card);
  return card;
}

export function makeSeasonCard(season: StatsCardSeason, player: StatsCardPlayer, seasonPlayer: HostedSeasonPlayer, keep: CardKeep = {}): SeasonStatsCard {
  const card: SeasonStatsCard = {
    type: "stats",
    v: STATS_CARD_VERSION,
    source: "genius_hosted",
    scope: "season",
    player,
    season,
    line: seasonPlayer.line,
    columns: [],
    heading: keep.heading ?? null,
    details: keep.details ?? null,
    asOf: new Date().toISOString(),
  };
  const kept = keep.columns ? normalizeColumns(keep.columns, card) : [];
  card.columns = kept.length > 0 ? kept : defaultColumns(card);
  return card;
}
