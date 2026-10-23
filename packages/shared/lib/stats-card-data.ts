/**
 * The numbers behind a stats card, for every app.
 *
 * Genius games read the federation's official hosted pages (hosted-stats.ts):
 * the box score for a game, the player statistics page for a season. If a
 * page can't be read, a game falls back to counting the stored play-by-play
 * (no minutes or plus-minus); a season has no fallback. Profixio games only
 * ever count their play-by-play.
 *
 * The app brings the platform pieces (createStatsCardLoader): how a page is
 * fetched (the desktop's HTTP client; the web's /api/hosted-stats route) and
 * who hears about a page whose layout changed (Sentry lives in the apps,
 * never here). Each loader caches pages for the session (10 minutes each):
 * one season page holds every player in the competition.
 */
import type { League } from "../types/league";
import type { StoredMatch } from "../types/match";
import { playerName } from "./events";
import {
  HOSTED_STATS_BASE,
  HostedLayoutError,
  hostedBoxScoreUrl,
  hostedPlayerStatsUrl,
  parseHostedBoxScore,
  parseHostedPlayerStats,
  type HostedSeasonPlayer,
} from "./hosted-stats";
import { pbpLine } from "./pbp-line";
import { PROFIXIO_SOURCE_PREFIX } from "./provider";
import type { GameLine } from "./stat-lines";
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
} from "./stats-card";

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

/**
 * Every season of the game's league that has hosted stats, newest first (the
 * catalogue's order): what a card can show a player's season averages for,
 * not only the seasons of the games in a playlist (a clip from last season,
 * a player still playing this one). Empty for a game with no league, or one
 * whose league has no Genius seasons.
 */
export function leagueSeasonsOf(match: StoredMatch, leagues: League[]): StatsCardSeason[] {
  const league = leagues.find((l) => l.id === match.leagueId);
  if (!league || league.provider === "profixio") return [];
  return league.seasons.flatMap((s) =>
    s.competitionId && s.provider !== "profixio"
      ? [{ competitionId: s.competitionId, leagueId: league.id, seasonId: s.id, label: `${league.name} ${s.label}` }]
      : [],
  );
}

/**
 * A page whose tables or headers changed (hosted-stats.ts throws it). Checked
 * by class, and by its error code for an instance from another copy of the module.
 */
export function isHostedLayoutError(e: unknown): e is HostedLayoutError {
  return e instanceof HostedLayoutError || (e instanceof Error && (e as { code?: unknown }).code === "hosted_layout_changed");
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
export function eventPeople(match: StoredMatch): Map<string, { name: string; number: string | null; side: "home" | "away"; teamName: string }> {
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

// ---------------------------------------------------------------------------
// The loader: pages, a game, a season
// ---------------------------------------------------------------------------

/**
 * Reads one hosted page's HTML, or throws. `fresh` asks past any cache
 * between the app and the federation (the season card's Update).
 */
export type HostedPageFetcher = (url: string, fresh: boolean) => Promise<string>;

/** Hears about a page whose layout changed: ours to fix. Network failures aren't reported. */
export type HostedLayoutReporter = (err: HostedLayoutError, url: string) => void;

export interface StatsCardLoaderDeps {
  fetchPage: HostedPageFetcher;
  onLayoutError?: HostedLayoutReporter;
}

export interface StatsCardLoader {
  /** Everyone's line in one game, or null when the game has no stats at all. */
  loadGameStats(match: StoredMatch, leagues: League[], opts?: { fresh?: boolean }): Promise<GameStats | null>;
  /** The player's season line in the competition, or null when they aren't listed. Throws when the page can't be read. */
  loadSeasonPlayer(competitionId: number, personId: string, opts?: { fresh?: boolean }): Promise<HostedSeasonPlayer | null>;
}

const PAGE_TTL_MS = 10 * 60 * 1000;

/** One app's loader, with its own session cache of pages. Create it once, at module level. */
export function createStatsCardLoader({ fetchPage, onLayoutError }: StatsCardLoaderDeps): StatsCardLoader {
  const pages = new Map<string, { at: number; html: Promise<string> }>();

  function hostedPage(url: string, fresh = false): Promise<string> {
    const hit = pages.get(url);
    if (!fresh && hit && Date.now() - hit.at < PAGE_TTL_MS) return hit.html;
    const html = (async () => fetchPage(url, fresh))();
    pages.set(url, { at: Date.now(), html });
    // A failure is retried next time (unless a newer read has taken its place).
    html.catch(() => {
      if (pages.get(url)?.html === html) pages.delete(url);
    });
    return html;
  }

  /** A layout change is ours to fix; a network failure isn't worth a report. */
  function noteFailure(e: unknown, url: string): void {
    if (onLayoutError && isHostedLayoutError(e)) onLayoutError(e, url);
  }

  async function loadGameStats(match: StoredMatch, leagues: League[], opts: { fresh?: boolean } = {}): Promise<GameStats | null> {
    const kind = statsKindOf(match);
    if (!kind) return null;
    const season = kind === "genius" ? seasonOf(match, leagues) : null;
    if (!season) return statsFromEvents(match, kind);

    const url = hostedBoxScoreUrl(season.competitionId, match.sourceGameId!);
    try {
      const html = await hostedPage(url, opts.fresh);
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
      noteFailure(e, url);
      return statsFromEvents(match, kind);
    }
  }

  async function loadSeasonPlayer(competitionId: number, personId: string, opts: { fresh?: boolean } = {}): Promise<HostedSeasonPlayer | null> {
    const url = hostedPlayerStatsUrl(competitionId);
    try {
      const players = parseHostedPlayerStats(await hostedPage(url, opts.fresh));
      return players.get(personId) ?? null;
    } catch (e) {
      noteFailure(e, url);
      throw e;
    }
  }

  return { loadGameStats, loadSeasonPlayer };
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

// ---------------------------------------------------------------------------
// Asking a server for a page (the web's /api/hosted-stats)
// ---------------------------------------------------------------------------

/**
 * One of the two pages the loader reads, named by its numbers alone, so a
 * server that fetches pages for a browser builds the URL itself and can't be
 * used as an open proxy.
 */
export type HostedPageQuery =
  | { kind: "box"; competitionId: number; matchId: string }
  | { kind: "players"; competitionId: number };

/** Competition ids are small positive integers; match ids are digits (a Genius sourceGameId). */
const COMPETITION_RE = /^[1-9]\d{0,8}$/;
const MATCH_RE = /^\d{1,15}$/;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const BOX_URL_RE = new RegExp(`^${escapeRe(HOSTED_STATS_BASE)}/competition/(\\d+)/match/(\\d+)/boxscore$`);
const PLAYERS_URL_RE = new RegExp(`^${escapeRe(HOSTED_STATS_BASE)}/competition/(\\d+)/statistics/player$`);

function boxQuery(competition: string, match: string): HostedPageQuery | null {
  if (!COMPETITION_RE.test(competition) || !MATCH_RE.test(match)) return null;
  return { kind: "box", competitionId: Number(competition), matchId: match };
}

function playersQuery(competition: string): HostedPageQuery | null {
  return COMPETITION_RE.test(competition) ? { kind: "players", competitionId: Number(competition) } : null;
}

/** The query behind a page URL the loader built (hostedBoxScoreUrl / hostedPlayerStatsUrl), or null for any other URL. */
export function hostedPageQuery(url: string): HostedPageQuery | null {
  const box = BOX_URL_RE.exec(url);
  if (box) return boxQuery(box[1], box[2]);
  const players = PLAYERS_URL_RE.exec(url);
  if (players) return playersQuery(players[1]);
  return null;
}

/** The page's URL, built only by hosted-stats.ts from the query's numbers. */
export function hostedPageUrl(query: HostedPageQuery): string {
  return query.kind === "box" ? hostedBoxScoreUrl(query.competitionId, query.matchId) : hostedPlayerStatsUrl(query.competitionId);
}

/** The search params a server route reads: kind, competition, match (box only), fresh=1. */
export function hostedPageSearchParams(query: HostedPageQuery, fresh = false): URLSearchParams {
  const params = new URLSearchParams({ kind: query.kind, competition: String(query.competitionId) });
  if (query.kind === "box") params.set("match", query.matchId);
  if (fresh) params.set("fresh", "1");
  return params;
}

/**
 * A route's search params as a page query, or null when anything is off
 * (an unknown kind, a non-numeric id, a match on the season page, a fresh
 * other than 0 or 1): the route answers 400 then.
 */
export function parseHostedPageSearchParams(params: URLSearchParams): { query: HostedPageQuery; fresh: boolean } | null {
  const kind = params.get("kind");
  const competition = params.get("competition") ?? "";
  const match = params.get("match");
  const fresh = params.get("fresh");
  if (fresh !== null && fresh !== "0" && fresh !== "1") return null;
  let query: HostedPageQuery | null = null;
  if (kind === "box" && match !== null) query = boxQuery(competition, match);
  else if (kind === "players" && match === null) query = playersQuery(competition);
  return query ? { query, fresh: fresh === "1" } : null;
}
