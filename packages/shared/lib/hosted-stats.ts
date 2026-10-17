/**
 * The federation's official numbers, read from Genius Sports' public
 * "hosted" statistics pages (hosted.dcd.shared.geniussports.com/SBF/…, the
 * pages BasketTV's league channels link to as "Statistik"). The source for
 * stats cards, for now: the pages are server-rendered HTML with no JSON
 * endpoint behind them (checked 2026-10-17), so these parsers read the
 * tables. The Warehouse API can replace them later without changing the
 * card format.
 *
 * Rules that keep the parsing honest:
 * - Each column is found by its header label, never by position, and each
 *   player by the personId in their link (the same Genius personId our
 *   play-by-play carries).
 * - When a required header is missing the parser throws HostedLayoutError
 *   instead of guessing; callers show "not available" and report it.
 * - Genius's EFF columns read 0.0 for every player, so they're ignored
 *   (see gameEfficiency).
 *
 * Pure string work, no DOM: it runs in the desktop webview, in vitest and in
 * a Deno edge function alike.
 */
import { addKnown, type GameLine, type SeasonLine } from "./stat-lines";

export const HOSTED_STATS_BASE = "https://hosted.dcd.shared.geniussports.com/SBF/en";

export function hostedBoxScoreUrl(competitionId: number, matchId: string | number): string {
  return `${HOSTED_STATS_BASE}/competition/${competitionId}/match/${matchId}/boxscore`;
}

export function hostedPlayerStatsUrl(competitionId: number): string {
  return `${HOSTED_STATS_BASE}/competition/${competitionId}/statistics/player`;
}

/** The page no longer has the tables or headers we read. */
export class HostedLayoutError extends Error {
  readonly code = "hosted_layout_changed";
  constructor(detail: string) {
    super(`hosted_layout_changed: ${detail}`);
    this.name = "HostedLayoutError";
  }
}

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity[0] === "#") {
      const hex = entity[1] === "x" || entity[1] === "X";
      const code = parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? whole;
  });
}

function textOf(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}

function cellsOf(rowHtml: string, tag: "td" | "th"): string[] {
  const re = tag === "td" ? /<td\b[^>]*>([\s\S]*?)<\/td>/gi : /<th\b[^>]*>([\s\S]*?)<\/th>/gi;
  return [...rowHtml.matchAll(re)].map((m) => textOf(m[1]));
}

function rowsOf(html: string): string[] {
  return [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1]);
}

function section(html: string, tag: "thead" | "tbody"): string | null {
  const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i").exec(html);
  return m ? m[1] : null;
}

const PERSON_RE = /\/person\/(\d+)/;

function num(s: string | undefined): number | null {
  if (s === undefined) return null;
  const t = s.replace(/−/g, "-").replace(/,/g, "").trim();
  if (t === "" || t === "-") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** "32:19" → 1939. */
function clockSeconds(s: string | undefined): number | null {
  const m = /^(\d+):(\d{2})$/.exec(s?.trim() ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Header label → column index, or HostedLayoutError naming what's missing. */
function columnIndex(headers: string[], required: readonly string[], where: string): Map<string, number> {
  const index = new Map<string, number>();
  headers.forEach((h, i) => {
    if (!index.has(h)) index.set(h, i);
  });
  const missing = required.filter((label) => !index.has(label));
  if (missing.length > 0) throw new HostedLayoutError(`${where} lacks ${missing.join(", ")}`);
  return index;
}

interface ParsedTable {
  headers: string[];
  /** Rows that link to a person, in page order. */
  rows: Array<{ personId: string; cells: string[] }>;
}

function parseTable(tableHtml: string): ParsedTable {
  const head = section(tableHtml, "thead") ?? rowsOf(tableHtml)[0] ?? "";
  const body = section(tableHtml, "tbody") ?? tableHtml;
  const rows: ParsedTable["rows"] = [];
  for (const row of rowsOf(body)) {
    const personId = PERSON_RE.exec(row)?.[1];
    if (personId) rows.push({ personId, cells: cellsOf(row, "td") });
  }
  return { headers: cellsOf(head, "th"), rows };
}

// ---------------------------------------------------------------------------
// Box score: …/competition/{id}/match/{matchId}/boxscore
// ---------------------------------------------------------------------------

export interface HostedBoxPlayer {
  personId: string;
  /** As the page prints it: "Family, F.". */
  printedName: string;
  /** Shirt number, when shown. */
  number: string | null;
  line: GameLine;
}

export interface HostedBoxTeam {
  /** Genius teamId from the team link. */
  teamId: string | null;
  teamName: string;
  players: HostedBoxPlayer[];
}

const BOX_COLUMNS = [
  "Player", "Mins", "Pts", "2PM", "2PA", "3PM", "3PA", "FTM", "FTA",
  "OFF", "DEF", "AST", "TO", "STL", "BLK", "PF", "+/-",
] as const;

/** One entry per team table, players in page order (DNP rows have min 0). */
export function parseHostedBoxScore(html: string): HostedBoxTeam[] {
  const teams: HostedBoxTeam[] = [];
  const teamTable =
    /<a\b[^>]*href\s*=\s*"[^"]*\/team\/(\d+)[^"]*"[^>]*>\s*<h4[^>]*>([\s\S]*?)<\/h4>\s*<\/a>[\s\S]*?<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  for (const m of html.matchAll(teamTable)) {
    const table = parseTable(m[3]);
    const col = columnIndex(table.headers, BOX_COLUMNS, "box score");
    const players = table.rows.map(({ personId, cells }): HostedBoxPlayer => {
      const v = (label: (typeof BOX_COLUMNS)[number]) => num(cells[col.get(label)!]);
      const tpm = v("3PM");
      const tpa = v("3PA");
      const numberCol = col.get("No");
      return {
        personId,
        printedName: cells[col.get("Player")!] ?? "",
        number: numberCol !== undefined ? cells[numberCol] || null : null,
        line: {
          min: clockSeconds(cells[col.get("Mins")!]),
          pts: v("Pts") ?? 0,
          fgm: addKnown(v("2PM"), tpm),
          fga: addKnown(v("2PA"), tpa),
          tpm,
          tpa,
          ftm: v("FTM"),
          fta: v("FTA"),
          oreb: v("OFF"),
          dreb: v("DEF"),
          ast: v("AST"),
          stl: v("STL"),
          blk: v("BLK"),
          tov: v("TO"),
          pf: v("PF"),
          pm: v("+/-"),
        },
      };
    });
    teams.push({ teamId: m[1] ?? null, teamName: textOf(m[2]), players });
  }
  if (teams.length === 0) throw new HostedLayoutError("box score has no team tables");
  return teams;
}

// ---------------------------------------------------------------------------
// Season: …/competition/{id}/statistics/player
// ---------------------------------------------------------------------------

export interface HostedSeasonPlayer {
  personId: string;
  name: string;
  line: SeasonLine;
  /** Rows combined: a player who changed teams mid-season has one per team. */
  stints: number;
}

const AVERAGES_COLUMNS = ["Player", "PPG", "APG", "RPG", "ORPG", "DRPG", "BLKPG", "STPG", "TOPG"] as const;
const SHOOTING_COLUMNS = ["Player", "G", "FG%", "2PM", "2PA", "3PM", "3PA", "3P%", "FT%", "FTAPG"] as const;
const OTHER_COLUMNS = ["Player", "G", "GS", "MPG", "+/-", "+/- PG", "Tot Fouls PG"] as const;

/** One row per team the player appeared for, published values as-is. */
interface Stint {
  name: string;
  g: number;
  gs: number | null;
  mpg: number | null;
  ppg: number | null;
  apg: number | null;
  rpg: number | null;
  orpg: number | null;
  drpg: number | null;
  bpg: number | null;
  spg: number | null;
  topg: number | null;
  pfpg: number | null;
  fgPct: number | null;
  twoPm: number | null;
  twoPa: number | null;
  tpm: number | null;
  tpa: number | null;
  tpPct: number | null;
  ftPct: number | null;
  ftaPg: number | null;
  pm: number | null;
  pmPg: number | null;
}

/** Rows keyed "personId#n": the n-th row of that player, the same in all three tables. */
function keyedRows(table: ParsedTable): Map<string, string[]> {
  const seen = new Map<string, number>();
  const out = new Map<string, string[]>();
  for (const { personId, cells } of table.rows) {
    const n = seen.get(personId) ?? 0;
    seen.set(personId, n + 1);
    out.set(`${personId}#${n}`, cells);
  }
  return out;
}

/** Every player's season line in the competition, keyed by personId. */
export function parseHostedPlayerStats(html: string): Map<string, HostedSeasonPlayer> {
  const tables = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].map((m) => parseTable(m[1]));
  const averages = tables.find((t) => t.headers.includes("PPG"));
  const shooting = tables.find((t) => t.headers.includes("FG%"));
  const other = tables.find((t) => t.headers.includes("MPG"));
  if (!averages || !shooting || !other) throw new HostedLayoutError("player statistics tables not found");

  const a = columnIndex(averages.headers, AVERAGES_COLUMNS, "averages table");
  const s = columnIndex(shooting.headers, SHOOTING_COLUMNS, "shooting table");
  const o = columnIndex(other.headers, OTHER_COLUMNS, "other table");
  const shootingRows = keyedRows(shooting);
  const otherRows = keyedRows(other);

  const stints = new Map<string, Stint[]>();
  for (const [key, ac] of keyedRows(averages)) {
    const sc = shootingRows.get(key);
    const oc = otherRows.get(key);
    if (!sc || !oc) continue;
    const av = (label: (typeof AVERAGES_COLUMNS)[number]) => num(ac[a.get(label)!]);
    const sv = (label: (typeof SHOOTING_COLUMNS)[number]) => num(sc[s.get(label)!]);
    const ov = (label: (typeof OTHER_COLUMNS)[number]) => num(oc[o.get(label)!]);
    const g = sv("G") ?? ov("G");
    if (!g) continue;
    const personId = key.slice(0, key.indexOf("#"));
    const stint: Stint = {
      name: ac[a.get("Player")!] ?? "",
      g,
      gs: ov("GS"),
      mpg: ov("MPG"),
      ppg: av("PPG"),
      apg: av("APG"),
      rpg: av("RPG"),
      orpg: av("ORPG"),
      drpg: av("DRPG"),
      bpg: av("BLKPG"),
      spg: av("STPG"),
      topg: av("TOPG"),
      pfpg: ov("Tot Fouls PG"),
      fgPct: sv("FG%"),
      twoPm: sv("2PM"),
      twoPa: sv("2PA"),
      tpm: sv("3PM"),
      tpa: sv("3PA"),
      tpPct: sv("3P%"),
      ftPct: sv("FT%"),
      ftaPg: sv("FTAPG"),
      pm: ov("+/-"),
      pmPg: ov("+/- PG"),
    };
    stints.set(personId, [...(stints.get(personId) ?? []), stint]);
  }

  const out = new Map<string, HostedSeasonPlayer>();
  for (const [personId, list] of stints) {
    out.set(personId, { personId, name: list[0].name, line: combineStints(list), stints: list.length });
  }
  return out;
}

/** A single row as published; several rows (one per team) weighted by games. */
function combineStints(list: Stint[]): SeasonLine {
  if (list.length === 1) {
    const x = list[0];
    return {
      gp: x.g,
      gs: x.gs,
      mpg: x.mpg,
      ppg: x.ppg ?? 0,
      rpg: x.rpg,
      orpg: x.orpg,
      drpg: x.drpg,
      apg: x.apg,
      spg: x.spg,
      bpg: x.bpg,
      topg: x.topg,
      pfpg: x.pfpg,
      fgPct: x.fgPct,
      tpm: x.tpm,
      tpa: x.tpa,
      tpPct: x.tpPct,
      ftPct: x.ftPct,
      pmPg: x.pmPg,
    };
  }
  const gp = list.reduce((sum, x) => sum + x.g, 0);
  const total = (pick: (x: Stint) => number | null): number | null =>
    list.some((x) => pick(x) === null) ? null : list.reduce((sum, x) => sum + pick(x)!, 0);
  const perGame = (pick: (x: Stint) => number | null): number | null => {
    const weighted = total((x) => (pick(x) === null ? null : pick(x)! * x.g));
    return weighted === null ? null : weighted / gp;
  };
  const pct = (made: number | null, attempted: number | null): number | null =>
    made === null || attempted === null || attempted === 0 ? null : (100 * made) / attempted;

  const tpm = total((x) => x.tpm);
  const tpa = total((x) => x.tpa);
  const fgm = total((x) => addKnown(x.twoPm, x.tpm));
  const fga = total((x) => addKnown(x.twoPa, x.tpa));
  // Free throws are published as a rate and attempts per game only, so the
  // made count is rebuilt from them; rounding makes this approximate.
  const fta = total((x) => (x.ftaPg === null ? null : x.ftaPg * x.g));
  const ftm = total((x) => (x.ftaPg === null || x.ftPct === null ? null : (x.ftPct / 100) * x.ftaPg * x.g));
  const pm = total((x) => x.pm);

  return {
    gp,
    gs: total((x) => x.gs),
    mpg: perGame((x) => x.mpg),
    ppg: perGame((x) => x.ppg) ?? 0,
    rpg: perGame((x) => x.rpg),
    orpg: perGame((x) => x.orpg),
    drpg: perGame((x) => x.drpg),
    apg: perGame((x) => x.apg),
    spg: perGame((x) => x.spg),
    bpg: perGame((x) => x.bpg),
    topg: perGame((x) => x.topg),
    pfpg: perGame((x) => x.pfpg),
    fgPct: pct(fgm, fga),
    tpm,
    tpa,
    tpPct: pct(tpm, tpa),
    ftPct: pct(ftm, fta),
    pmPg: pm === null ? null : pm / gp,
  };
}
