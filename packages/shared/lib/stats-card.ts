/**
 * Stats cards: a player's stat line for one game, or their season averages,
 * shown as a full-frame card in a playlist and baked into exports.
 *
 * Storage: a stats card is a text item (playlist_clips.item_type 'text')
 * whose `card` column holds the spec below. `text_content` keeps a readable
 * fallback line (fallbackText), so builds and apps that don't know specs
 * show a plain text card instead of losing it.
 *
 * Official numbers only: the line is a snapshot of the source, never edited;
 * players choose the columns and may override the heading and details.
 */
import type { PlayByPlayEvent } from "../types/match";
import { playerName } from "./events";
import { gameEfficiency, gameRebounds, type GameLine, type SeasonLine } from "./stat-lines";

export const STATS_CARD_VERSION = 1 as const;
export const MAX_STAT_COLUMNS = 6;

export type StatsCardScope = "game" | "season";
/** Where the numbers came from: the official hosted pages, our play-by-play, or Profixio's. */
export type StatsCardSource = "genius_hosted" | "pbp" | "profixio";

export interface StatsCardPlayer {
  /** Genius or Profixio personId. */
  id: string;
  name: string;
  number: string | null;
  teamId: string | null;
  teamName: string;
}

export interface StatsCardGame {
  /** matches.id of the imported game. */
  matchId: string;
  sourceGameId: string;
  competitionId: number | null;
  opponent: string;
  /** YYYY-MM-DD. */
  date: string;
  home: boolean;
  /** Final score from the player's side, when known. */
  us: number | null;
  them: number | null;
}

export interface StatsCardSeason {
  competitionId: number;
  leagueId: string;
  seasonId: string;
  /** "Superettan Herr 2025/26". */
  label: string;
}

interface StatsCardBase {
  type: "stats";
  v: typeof STATS_CARD_VERSION;
  source: StatsCardSource;
  player: StatsCardPlayer;
  columns: StatKey[];
  /** Overrides; null means automatic, so a new player or game rewrites them. */
  heading: string | null;
  details: string | null;
  /** When the numbers were read (ISO). */
  asOf: string;
}

export interface GameStatsCard extends StatsCardBase {
  scope: "game";
  game: StatsCardGame;
  line: GameLine;
}

export interface SeasonStatsCard extends StatsCardBase {
  scope: "season";
  season: StatsCardSeason;
  line: SeasonLine;
}

export type StatsCardSpec = GameStatsCard | SeasonStatsCard;

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

export type StatKey =
  | "pts" | "reb" | "oreb" | "dreb" | "ast" | "stl" | "blk"
  | "fg" | "fgm" | "fgPct" | "tp" | "tpm" | "tpPct" | "ft" | "ftm" | "ftPct"
  | "min" | "pm" | "eff" | "tov" | "pf" | "gp";

const MINUS = "−";

function int(n: number | null): string | null {
  if (n === null) return null;
  return n < 0 ? `${MINUS}${Math.abs(n)}` : String(n);
}

function signedInt(n: number | null): string | null {
  if (n === null) return null;
  return n > 0 ? `+${n}` : int(n);
}

function oneDecimal(n: number | null): string | null {
  if (n === null) return null;
  const s = Math.abs(n).toFixed(1);
  return n < 0 && s !== "0.0" ? `${MINUS}${s}` : s;
}

function signedDecimal(n: number | null): string | null {
  if (n === null) return null;
  const s = oneDecimal(n)!;
  return n > 0 && s !== "0.0" ? `+${s}` : s;
}

function madeOf(made: number | null, attempted: number | null): string | null {
  return made === null || attempted === null ? null : `${made}/${attempted}`;
}

/** Made count, only where attempts aren't recorded (Profixio). */
function madeOnly(made: number | null, attempted: number | null): string | null {
  return attempted === null ? int(made) : null;
}

// Percentages print bare under a "%" label, as in a box score ("64" over "FG%").
function gamePct(made: number | null, attempted: number | null): string | null {
  return made === null || attempted === null || attempted === 0 ? null : String(Math.round((100 * made) / attempted));
}

function seasonPct(p: number | null): string | null {
  return p === null ? null : p.toFixed(1);
}

interface StatDef {
  key: StatKey;
  label: string;
  game?: (l: GameLine) => string | null;
  season?: (l: SeasonLine) => string | null;
}

/** Canonical order: the order columns appear on a card. */
const STATS: StatDef[] = [
  { key: "pts", label: "PTS", game: (l) => int(l.pts), season: (l) => oneDecimal(l.ppg) },
  { key: "reb", label: "REB", game: (l) => int(gameRebounds(l)), season: (l) => oneDecimal(l.rpg) },
  { key: "oreb", label: "OREB", game: (l) => int(l.oreb), season: (l) => oneDecimal(l.orpg) },
  { key: "dreb", label: "DREB", game: (l) => int(l.dreb), season: (l) => oneDecimal(l.drpg) },
  { key: "ast", label: "AST", game: (l) => int(l.ast), season: (l) => oneDecimal(l.apg) },
  { key: "stl", label: "STL", game: (l) => int(l.stl), season: (l) => oneDecimal(l.spg) },
  { key: "blk", label: "BLK", game: (l) => int(l.blk), season: (l) => oneDecimal(l.bpg) },
  { key: "fg", label: "FG", game: (l) => madeOf(l.fgm, l.fga) },
  { key: "fgm", label: "FGM", game: (l) => madeOnly(l.fgm, l.fga) },
  { key: "fgPct", label: "FG%", game: (l) => gamePct(l.fgm, l.fga), season: (l) => seasonPct(l.fgPct) },
  { key: "tp", label: "3P", game: (l) => madeOf(l.tpm, l.tpa) },
  {
    key: "tpm",
    label: "3PM",
    game: (l) => madeOnly(l.tpm, l.tpa),
    season: (l) => (l.tpm === null || l.gp === 0 ? null : oneDecimal(l.tpm / l.gp)),
  },
  { key: "tpPct", label: "3P%", game: (l) => gamePct(l.tpm, l.tpa), season: (l) => seasonPct(l.tpPct) },
  { key: "ft", label: "FT", game: (l) => madeOf(l.ftm, l.fta) },
  { key: "ftm", label: "FTM", game: (l) => madeOnly(l.ftm, l.fta) },
  { key: "ftPct", label: "FT%", game: (l) => gamePct(l.ftm, l.fta), season: (l) => seasonPct(l.ftPct) },
  {
    key: "min",
    label: "MIN",
    game: (l) => (l.min === null ? null : String(Math.round(l.min / 60))),
    season: (l) => oneDecimal(l.mpg),
  },
  { key: "pm", label: "+/−", game: (l) => signedInt(l.pm), season: (l) => signedDecimal(l.pmPg) },
  { key: "eff", label: "EFF", game: (l) => int(gameEfficiency(l)) },
  { key: "tov", label: "TO", game: (l) => int(l.tov), season: (l) => oneDecimal(l.topg) },
  { key: "pf", label: "PF", game: (l) => int(l.pf), season: (l) => oneDecimal(l.pfpg) },
  { key: "gp", label: "GP", season: (l) => String(l.gp) },
];

const STAT_BY_KEY = new Map(STATS.map((s) => [s.key, s]));
const CANONICAL = STATS.map((s) => s.key);

export function statLabel(key: StatKey): string {
  return STAT_BY_KEY.get(key)?.label ?? key;
}

type Lined = Pick<GameStatsCard, "scope" | "line"> | Pick<SeasonStatsCard, "scope" | "line">;

/** The value as the card prints it, or null when the source doesn't have it. */
export function formatStat(key: StatKey, card: Lined): string | null {
  const def = STAT_BY_KEY.get(key);
  if (!def) return null;
  return card.scope === "game" ? (def.game?.(card.line) ?? null) : (def.season?.(card.line) ?? null);
}

/** Every column this line can fill, in card order. */
export function availableColumns(card: Lined): StatKey[] {
  return CANONICAL.filter((key) => formatStat(key, card) !== null);
}

/** Known, available, unique, in card order, at most six. */
export function normalizeColumns(columns: readonly StatKey[], card: Lined): StatKey[] {
  const wanted = new Set(columns);
  return availableColumns(card).filter((key) => wanted.has(key)).slice(0, MAX_STAT_COLUMNS);
}

/**
 * The columns a new card starts with: points plus what stands out in this
 * line, three to five in all. A stat stands out when it reaches its bar
 * (10 rebounds is twice the bar of 5); the strongest win. Only the familiar
 * box-score stats are picked; MIN, +/−, EFF and the rest are one click away.
 */
export function defaultColumns(card: Lined): StatKey[] {
  const available = new Set(availableColumns(card));
  const scores = new Map<StatKey, number>();
  const score = (key: StatKey, value: number | null, bar: number, when = true) => {
    if (available.has(key) && value !== null && when) scores.set(key, value / bar);
  };

  if (card.scope === "game") {
    const l = card.line;
    const fgPct = l.fga ? (100 * (l.fgm ?? 0)) / l.fga : 0;
    const ftPct = l.fta ? (100 * (l.ftm ?? 0)) / l.fta : 0;
    score("reb", gameRebounds(l), 5);
    score("ast", l.ast, 4);
    score("stl", l.stl, 2);
    score("blk", l.blk, 2);
    score("tp", l.tpm, 2);
    score("tpm", l.tpm, 2);
    score("fg", fgPct, 50, (l.fga ?? 0) >= 6);
    score("ft", ftPct, 80, (l.fta ?? 0) >= 4);
  } else {
    const l = card.line;
    score("reb", l.rpg, 4);
    score("ast", l.apg, 3);
    score("stl", l.spg, 1.2);
    score("blk", l.bpg, 0.8);
    score("tpPct", l.tpPct, 35, l.tpa !== null && l.gp > 0 && l.tpa / l.gp >= 2);
    score("fgPct", l.fgPct, 48);
    score("ftPct", l.ftPct, 80);
  }

  const picked: StatKey[] = ["pts"];
  const ranked = [...scores.entries()].filter(([, s]) => s >= 1).sort((a, b) => b[1] - a[1]);
  for (const [key] of ranked) {
    if (picked.length >= 5) break;
    picked.push(key);
  }
  // Too few stand out: fill with the usual line so a card never shows points alone.
  for (const key of ["reb", "ast", "fg", "fgm", "tpm"] as StatKey[]) {
    if (picked.length >= 3) break;
    if (available.has(key) && !picked.includes(key)) picked.push(key);
  }
  return normalizeColumns(picked, card);
}

// ---------------------------------------------------------------------------
// Card content and fallback text
// ---------------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-12" (or an ISO timestamp) → "12 Oct 2026". */
export function formatCardDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) return date;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

/** "vs AIK" at home, "@ AIK" away. */
export function opponentLabel(game: StatsCardGame): string {
  return `${game.home ? "vs" : "@"} ${game.opponent}`;
}

function resultLabel(game: StatsCardGame): string | null {
  if (game.us === null || game.them === null) return null;
  const outcome = game.us > game.them ? "W" : game.us < game.them ? "L" : "T";
  return `${outcome} ${game.us}–${game.them}`;
}

export function autoDetails(player: StatsCardPlayer): string {
  return [player.number ? `#${player.number}` : null, player.teamName || null].filter(Boolean).join(" · ");
}

export function cardContext(card: StatsCardSpec): string {
  if (card.scope === "game") {
    return [opponentLabel(card.game), formatCardDate(card.game.date), resultLabel(card.game)]
      .filter(Boolean)
      .join(" · ");
  }
  const games = `${card.line.gp} game${card.line.gp === 1 ? "" : "s"}`;
  return ["Season averages", card.season.label, games].join(" · ");
}

export interface CardCell {
  value: string;
  label: string;
}

/** What a card draws, the same for every aspect. */
export interface CardContent {
  heading: string;
  details: string;
  context: string;
  cells: CardCell[];
}

export function cardContent(card: StatsCardSpec): CardContent {
  const cells = normalizeColumns(card.columns, card).map((key) => ({
    value: formatStat(key, card)!,
    label: statLabel(key),
  }));
  return {
    heading: card.heading?.trim() || card.player.name,
    details: card.details?.trim() ?? autoDetails(card.player),
    context: cardContext(card),
    cells,
  };
}

/** One readable line for apps that don't draw specs: "Alva Berg · 24 PTS · 8 REB · vs AIK". */
export function fallbackText(card: StatsCardSpec): string {
  const content = cardContent(card);
  const stats = content.cells.map((c) => `${c.value} ${c.label}`);
  const where = card.scope === "game" ? opponentLabel(card.game) : `season averages, ${card.season.label}`;
  return [content.heading, ...stats, where].join(" · ");
}

// ---------------------------------------------------------------------------
// Parsing a stored spec
// ---------------------------------------------------------------------------

const GAME_LINE_KEYS = [
  "min", "fgm", "fga", "tpm", "tpa", "ftm", "fta", "oreb", "dreb", "ast", "stl", "blk", "tov", "pf", "pm",
] as const;
const SEASON_LINE_KEYS = [
  "gs", "mpg", "rpg", "orpg", "drpg", "apg", "spg", "bpg", "topg", "pfpg", "fgPct", "tpm", "tpa", "tpPct", "ftPct", "pmPg",
] as const;
const SOURCES: StatsCardSource[] = ["genius_hosted", "pbp", "profixio"];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const numOrNull = (v: unknown): number | null => (isNum(v) ? v : null);
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);

function parseLine<K extends string>(raw: Obj, required: readonly K[], optional: readonly string[]): Record<string, number | null> | null {
  const line: Record<string, number | null> = {};
  for (const key of required) {
    if (!isNum(raw[key])) return null;
    line[key] = raw[key] as number;
  }
  for (const key of optional) line[key] = numOrNull(raw[key]);
  return line;
}

/** A stored spec, or null when it isn't one this build can draw (then it's a plain text card). */
export function parseCardSpec(raw: unknown): StatsCardSpec | null {
  if (!isObj(raw) || raw.type !== "stats" || raw.v !== STATS_CARD_VERSION) return null;
  if (!SOURCES.includes(raw.source as StatsCardSource)) return null;
  const p = raw.player;
  if (!isObj(p) || typeof p.id !== "string" || typeof p.name !== "string") return null;
  const player: StatsCardPlayer = {
    id: p.id,
    name: p.name,
    number: strOrNull(p.number),
    teamId: strOrNull(p.teamId),
    teamName: typeof p.teamName === "string" ? p.teamName : "",
  };
  if (!isObj(raw.line)) return null;
  const columns = Array.isArray(raw.columns)
    ? raw.columns.filter((c): c is StatKey => typeof c === "string" && STAT_BY_KEY.has(c as StatKey))
    : [];
  const base = {
    type: "stats" as const,
    v: STATS_CARD_VERSION,
    source: raw.source as StatsCardSource,
    player,
    heading: strOrNull(raw.heading),
    details: strOrNull(raw.details),
    asOf: typeof raw.asOf === "string" ? raw.asOf : "",
  };

  if (raw.scope === "game") {
    const g = raw.game;
    const line = parseLine(raw.line, ["pts"], GAME_LINE_KEYS);
    if (!isObj(g) || !line || typeof g.matchId !== "string" || typeof g.opponent !== "string") return null;
    const card: GameStatsCard = {
      ...base,
      scope: "game",
      columns: [],
      game: {
        matchId: g.matchId,
        sourceGameId: typeof g.sourceGameId === "string" ? g.sourceGameId : "",
        competitionId: numOrNull(g.competitionId),
        opponent: g.opponent,
        date: typeof g.date === "string" ? g.date : "",
        home: g.home === true,
        us: numOrNull(g.us),
        them: numOrNull(g.them),
      },
      line: line as unknown as GameLine,
    };
    card.columns = normalizeColumns(columns, card);
    return card;
  }

  if (raw.scope === "season") {
    const s = raw.season;
    const line = parseLine(raw.line, ["gp", "ppg"], SEASON_LINE_KEYS);
    if (!isObj(s) || !line || !isNum(s.competitionId) || typeof s.label !== "string") return null;
    const card: SeasonStatsCard = {
      ...base,
      scope: "season",
      columns: [],
      season: {
        competitionId: s.competitionId,
        leagueId: typeof s.leagueId === "string" ? s.leagueId : "",
        seasonId: typeof s.seasonId === "string" ? s.seasonId : "",
        label: s.label,
      },
      line: line as unknown as SeasonLine,
    };
    card.columns = normalizeColumns(columns, card);
    return card;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Default player
// ---------------------------------------------------------------------------

export interface ClipPlayer {
  playerId: string;
  name: string;
  number: string | null;
  teamName: string;
  clips: number;
}

/** Players in the given clip events, most clips first (ties keep first appearance). */
export function rankPlayersByClips(events: readonly PlayByPlayEvent[]): ClipPlayer[] {
  const byId = new Map<string, ClipPlayer>();
  for (const e of events) {
    if (!e.player) continue;
    const id = String(e.player.playerId);
    const row = byId.get(id);
    if (row) row.clips++;
    else
      byId.set(id, {
        playerId: id,
        name: playerName(e),
        number: e.player.pno ? String(e.player.pno) : null,
        teamName: e.eventTeam?.teamName ?? "",
        clips: 1,
      });
  }
  return [...byId.values()].sort((a, b) => b.clips - a.clips);
}

/**
 * Whose stats a new card shows: the player with the most clips; a tie goes
 * to the space's own team, then to the clip that's playing.
 */
export function pickDefaultPlayer(
  events: readonly PlayByPlayEvent[],
  opts: { preferTeam?: (teamName: string) => boolean; activePlayerId?: string | null } = {},
): ClipPlayer | null {
  const ranked = rankPlayersByClips(events);
  if (ranked.length === 0) return null;
  const top = ranked.filter((p) => p.clips === ranked[0].clips);
  return (
    (opts.preferTeam && top.find((p) => opts.preferTeam!(p.teamName))) ||
    (opts.activePlayerId != null && top.find((p) => p.playerId === String(opts.activePlayerId))) ||
    top[0]
  );
}
