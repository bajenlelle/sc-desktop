/**
 * The scouting report: a playlist's clips laid out under the players of its
 * draft (lib/report-draft.ts), as the public page shows it. Pure, so the
 * desktop's view and the page the recipient opens come from one walk.
 *
 * The walk (deriveReportLayout): a Team section first, holding the intro and
 * the clips no player claims, left out when empty; then a section per draft
 * player, in draft order, with the clips placed under them. The playlist's
 * text and stats cards are video cards and not part of the report. Nothing
 * else is dropped except a clip that has no hosted file yet or whose play the
 * game data no longer has (`missing`).
 *
 * The report is a SNAPSHOT: only a game's owner can read the plays a report
 * is built from, and the page is anonymous. It carries storage KEYS, never
 * URLs (the page prepends the media host; the database checks the key shapes
 * below), so a coach can't point a report at an arbitrary address.
 */
import type { PlayByPlayEvent, Playlist, PlaylistClipItem, PlaylistItem } from "../types/match";
import { eventLabel, formatGameClock, periodLabel } from "./events";
import { cyrb53 } from "./highlight-shares-db";
import { itemKey } from "./playlist-edits";
import { deriveReportLayout, sectionLabel, REPORT_MAX_SECTIONS, REPORT_TITLE_MAX, type ReportDraft } from "./report-draft";
import { cardContent, type StatsCardSpec } from "./stats-card";

export { REPORT_MAX_SECTIONS, REPORT_TITLE_MAX };

export const SCOUTING_REPORT_VERSION = 1 as const;

/** What the database accepts (publish_scouting_report checks the same numbers; sections and the title are in report-draft.ts). */
export const REPORT_MAX_CLIPS = 300;

/** presign-upload's CLIP_KEY: a clip file in the public media bucket. */
export const REPORT_CLIP_KEY =
  /^clips\/[A-Za-z0-9-]{1,64}\/\d{1,12}_pre-?\d{1,4}\.\d_post-?\d{1,4}\.\d(?:_s\d{1,6}\.\d)?\.mp4$/;
const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
/** A poster: highlights/<user>/<uuid>.jpg, the shape presign-upload already admits. */
export const REPORT_POSTER_KEY = new RegExp(`^highlights/(${UUID})/${UUID}\\.jpg$`);

export interface ReportCell {
  value: string;
  label: string;
}

export interface ReportStats {
  /** "Season averages · Superettan Herr 2025/26 · 18 games" or "vs AIK · 12 Oct 2026 · W 78–70". */
  context: string;
  cells: ReportCell[];
  /** When the numbers were read (ISO). */
  asOf: string;
}

export interface ReportPlayer {
  id: string;
  name: string;
  number: string | null;
  teamName: string;
}

export interface ReportClip {
  kind: "clip";
  /** c1, c2, … in page order: the anchor a print link points at. */
  id: string;
  clipKey: string;
  posterKey: string | null;
  /** "3PT Made". */
  label: string;
  /** The play's type, sub type and result, so the page colours its badge as the apps do. */
  type: string;
  subType: string;
  made: boolean;
  /** "Q2". */
  period: string;
  /** "4:31". */
  clock: string;
  /** The game, only when the report's clips come from more than one. */
  game: string | null;
  note: string | null;
  /** The coach's labels on the clip, at most two. */
  labels: string[];
}

export interface ReportText {
  kind: "text";
  text: string;
}

export interface ReportStatsBlock {
  kind: "stats";
  heading: string;
  stats: ReportStats;
}

export type ReportBlock = ReportClip | ReportText | ReportStatsBlock;

export interface ReportSection {
  /** "team", then p1, p2, … */
  id: string;
  kind: "team" | "player";
  player: ReportPlayer | null;
  note: string;
  stats: ReportStats | null;
  blocks: ReportBlock[];
}

export interface ScoutingReport {
  v: typeof SCOUTING_REPORT_VERSION;
  header: {
    title: string;
    opponent: string | null;
    /** ISO. Not part of the content key. */
    preparedAt: string;
    players: number;
    clips: number;
    /** Show the "made with scoutable." mark (decided at generate time by the plan and watermark setting). */
    attribution: boolean;
  };
  sections: ReportSection[];
}

export interface MissingClip {
  key: string;
  matchId: string;
  eventId: number;
  /** not_shipped: no hosted file yet. no_play: the game data no longer has the play. */
  reason: "not_shipped" | "no_play";
}

export interface BuildReportInput {
  draft: ReportDraft;
  playlist: Pick<Playlist, "items">;
  /** Plays by `<matchId>:<eventId>`. */
  eventByKey: ReadonlyMap<string, PlayByPlayEvent>;
  matchLabel?: (matchId: string) => string;
  /** The share sheet's title; the draft's when absent. */
  title?: string;
  /** The share sheet's opponent; the draft's when absent (null = none). */
  opponent?: string | null;
  /** Poster storage key by clip item key (`<matchId>:<eventId>`). */
  posters?: ReadonlyMap<string, string>;
  /** The coach's labels by clip item key. */
  labelsByKey?: ReadonlyMap<string, readonly string[]>;
  attribution?: boolean;
  now?: Date;
}

export interface BuiltReport {
  report: ScoutingReport;
  /** Hash of what the page says, not of posters or timestamps: equal keys, equal pages. */
  contentKey: string;
  /** The clip files the report plays, in page order. */
  clipKeys: string[];
  missing: MissingClip[];
}

/** The storage key of a hosted clip's public URL, or null when it isn't one of ours. */
export function clipKeyFromUrl(url: string): string | null {
  let path: string;
  try {
    path = decodeURIComponent(new URL(url).pathname);
  } catch {
    return null;
  }
  // The bucket's public host may carry a path prefix; the key is the tail.
  const at = path.indexOf("clips/");
  const key = at < 0 ? "" : path.slice(at);
  return REPORT_CLIP_KEY.test(key) ? key : null;
}

function statsOf(card: StatsCardSpec): ReportStats {
  const c = cardContent(card);
  return { context: c.context, cells: c.cells, asOf: card.asOf };
}

export function buildScoutingReport(input: BuildReportInput): BuiltReport {
  const { draft, playlist, eventByKey, now = new Date() } = input;
  const title = (input.title ?? draft.title ?? "").trim();
  const opponent = input.opponent === undefined ? draft.opponent : input.opponent;
  const layout = deriveReportLayout(draft, playlist.items, eventByKey);
  const missing: MissingClip[] = layout.missing.map((m) => ({ ...m, reason: "no_play" }));

  // The clips that make the page, to know whether it spans several games.
  const games = new Set<string>();
  for (const s of layout.sections) {
    for (const item of s.clips) if (item.r2Url && clipKeyFromUrl(item.r2Url)) games.add(item.matchId);
  }
  const multiGame = games.size > 1;

  let clipCount = 0;
  const clipKeys: string[] = [];

  const clipBlock = (item: PlaylistClipItem): ReportClip | null => {
    const key = itemKey(item);
    const event = eventByKey.get(key)!; // the layout placed it, so its play exists
    const clipKey = item.r2Url ? clipKeyFromUrl(item.r2Url) : null;
    if (!clipKey) {
      missing.push({ key, matchId: item.matchId, eventId: item.eventId, reason: "not_shipped" });
      return null;
    }
    clipCount++;
    clipKeys.push(clipKey);
    return {
      kind: "clip",
      id: `c${clipCount}`,
      clipKey,
      posterKey: input.posters?.get(key) ?? null,
      label: eventLabel(event),
      type: event.type,
      subType: event.subType ?? "",
      made: !!event.isSuccessful,
      period: periodLabel(event.period),
      clock: formatGameClock(event.gameClockTime),
      game: multiGame ? (input.matchLabel?.(item.matchId) ?? null) : null,
      note: item.note?.trim() ? item.note.trim() : null,
      labels: [...(input.labelsByKey?.get(key) ?? [])].slice(0, 2),
    };
  };

  const sections: ReportSection[] = [];
  let players = 0;
  for (const s of layout.sections) {
    const blocks: ReportBlock[] = [];
    if (!s.section) {
      const intro = draft.intro.trim();
      if (intro) blocks.push({ kind: "text", text: intro });
    }
    for (const item of s.clips) {
      const block = clipBlock(item);
      if (block) blocks.push(block);
    }
    if (!s.section) {
      // The layout lists the team only when it has an intro or clips; with every clip unshipped it would be empty.
      if (blocks.length > 0) sections.push({ id: "team", kind: "team", player: null, note: "", stats: null, blocks });
      continue;
    }
    const { player, note, stats } = s.section;
    sections.push({
      id: `p${++players}`,
      kind: "player",
      player: { id: player.id, name: player.name, number: player.number, teamName: player.teamName },
      note: note.trim(),
      stats: stats ? statsOf(stats) : null,
      blocks,
    });
  }

  const report: ScoutingReport = {
    v: SCOUTING_REPORT_VERSION,
    header: {
      title,
      opponent: opponent?.trim() ? opponent.trim() : null,
      preparedAt: now.toISOString(),
      players,
      clips: clipCount,
      attribution: input.attribution ?? true,
    },
    sections,
  };
  return { report, contentKey: reportContentKey(report), clipKeys, missing };
}

/**
 * What the playlist says, as a hash: the sections and what is in them, not
 * when the report was made, which poster frames it uses (posters are re-cut on
 * every publish), when the numbers were read, or the share sheet's own fields
 * (the title, the opponent and the footer mark are the coach's to set when
 * publishing, not the playlist's). A coach sees "up to date" while the playlist
 * still builds the same report.
 */
export function reportContentKey(report: ScoutingReport): string {
  const stable = {
    s: report.sections.map((s) => ({
      i: s.id,
      p: s.player,
      n: s.note,
      st: s.stats ? { c: s.stats.context, v: s.stats.cells } : null,
      b: s.blocks.map((b) =>
        b.kind === "clip"
          ? { k: b.clipKey, n: b.note, l: b.labels, g: b.game, y: b.label, q: b.period, c: b.clock }
          : b.kind === "text"
            ? { x: b.text }
            : { h: b.heading, v: b.stats.cells, c: b.stats.context },
      ),
    })),
  };
  return cyrb53(`r1|${JSON.stringify(stable)}`);
}

// ---------------------------------------------------------------------------
// Reading a stored report
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);

function parseStats(raw: unknown): ReportStats | null {
  if (!isObj(raw) || !Array.isArray(raw.cells)) return null;
  const cells: ReportCell[] = [];
  for (const c of raw.cells) {
    if (isObj(c) && typeof c.value === "string" && typeof c.label === "string") cells.push({ value: c.value, label: c.label });
  }
  return { context: str(raw.context), cells, asOf: str(raw.asOf) };
}

function parseBlock(raw: unknown): ReportBlock | null {
  if (!isObj(raw)) return null;
  if (raw.kind === "clip") {
    if (typeof raw.clipKey !== "string" || !REPORT_CLIP_KEY.test(raw.clipKey)) return null;
    const poster = typeof raw.posterKey === "string" && REPORT_POSTER_KEY.test(raw.posterKey) ? raw.posterKey : null;
    return {
      kind: "clip",
      id: str(raw.id),
      clipKey: raw.clipKey,
      posterKey: poster,
      label: str(raw.label),
      type: str(raw.type),
      subType: str(raw.subType),
      made: raw.made === true,
      period: str(raw.period),
      clock: str(raw.clock),
      game: strOrNull(raw.game),
      note: strOrNull(raw.note),
      labels: Array.isArray(raw.labels) ? raw.labels.filter((l): l is string => typeof l === "string").slice(0, 2) : [],
    };
  }
  if (raw.kind === "text") return typeof raw.text === "string" && raw.text.trim() ? { kind: "text", text: raw.text } : null;
  if (raw.kind === "stats") {
    const stats = parseStats(raw.stats);
    return stats ? { kind: "stats", heading: str(raw.heading), stats } : null;
  }
  return null;
}

/**
 * A stored report as the page can safely draw it, or null when it isn't one
 * this build reads. The database checks a report's size and clip keys when it
 * is published, nothing more, so the page re-checks the shapes it uses and
 * drops what doesn't fit (a block it can't read, a poster that isn't ours).
 */
export function parseScoutingReport(raw: unknown): ScoutingReport | null {
  if (!isObj(raw) || raw.v !== SCOUTING_REPORT_VERSION || !isObj(raw.header) || !Array.isArray(raw.sections)) return null;
  const sections: ReportSection[] = [];
  for (const s of raw.sections) {
    if (!isObj(s) || (s.kind !== "team" && s.kind !== "player") || !Array.isArray(s.blocks)) continue;
    const p = s.player;
    const player: ReportPlayer | null =
      s.kind === "player" && isObj(p) && typeof p.name === "string"
        ? { id: str(p.id), name: p.name, number: strOrNull(p.number), teamName: str(p.teamName) }
        : null;
    if (s.kind === "player" && !player) continue;
    sections.push({
      id: str(s.id, `s${sections.length + 1}`),
      kind: s.kind,
      player,
      note: str(s.note),
      stats: s.stats == null ? null : parseStats(s.stats),
      blocks: s.blocks.map(parseBlock).filter((b): b is ReportBlock => b !== null),
    });
  }
  const h = raw.header;
  const clips = sections.reduce((n, s) => n + s.blocks.filter((b) => b.kind === "clip").length, 0);
  return {
    v: SCOUTING_REPORT_VERSION,
    header: {
      title: str(h.title),
      opponent: strOrNull(h.opponent),
      preparedAt: str(h.preparedAt),
      players: sections.filter((s) => s.kind === "player").length,
      clips,
      attribution: h.attribution !== false,
    },
    sections,
  };
}

/** A title the database accepts: trimmed, at most REPORT_TITLE_MAX characters. */
export function clampReportTitle(title: string): string {
  return title.trim().slice(0, REPORT_TITLE_MAX);
}

// ---------------------------------------------------------------------------
// The share sheet's preview
// ---------------------------------------------------------------------------

/** One section as the share sheet lists it. */
export interface OutlineRow {
  id: string;
  /** "#7 Alva Berg", or "Team". */
  label: string;
  clips: number;
  note: boolean;
  stats: boolean;
}

/**
 * What the share sheet previews: a row per section, counting the clips the
 * playlist holds whether or not their files are hosted yet (Generate prepares
 * those; the built report leaves them out until it has). The Team row shows
 * when it has clips or an intro; a player's row always, empty or not.
 */
export function reportOutline(draft: ReportDraft, items: readonly PlaylistItem[], eventByKey: ReadonlyMap<string, PlayByPlayEvent>): OutlineRow[] {
  let players = 0;
  return deriveReportLayout(draft, items, eventByKey).sections.map((s) =>
    s.section
      ? { id: `p${++players}`, label: sectionLabel(s.section.player), clips: s.clips.length, note: s.section.note.trim().length > 0, stats: s.section.stats !== null }
      : { id: "team", label: "Team", clips: s.clips.length, note: draft.intro.trim().length > 0, stats: false },
  );
}

// ---------------------------------------------------------------------------
// The page's jump bar
// ---------------------------------------------------------------------------

/** The page shows its jump bar from this many sections (the Team section counts). */
export const JUMP_BAR_MIN_SECTIONS = 3;

function lastName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1] || name;
}

/** One chip per section, in page order: the team's as "Team", a player's as "#7 Berg" (number when known, last name). */
export function reportJumpItems(sections: readonly ReportSection[]): { id: string; label: string }[] {
  return sections.map((s) => ({
    id: s.id,
    label: s.player ? [s.player.number ? `#${s.player.number}` : null, lastName(s.player.name)].filter(Boolean).join(" ") : "Team",
  }));
}
