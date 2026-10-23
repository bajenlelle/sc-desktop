/**
 * The scouting report: a playlist with player cards, as the public page
 * shows it. Pure, so the desktop's preview and the page the recipient opens
 * come from one walk over the playlist.
 *
 * The walk: a player card opens a section, and the clips after it belong to
 * that player until the next player card. Anything before the first card
 * (clips, text cards, stats cards) goes in a "Team" section, left out when
 * empty. A text card is a paragraph where it sits and a stats card a stats
 * row. Nothing in the playlist is dropped except a clip that has no hosted
 * file yet or whose play the game data no longer has (`missing`).
 *
 * The report is a SNAPSHOT: only a game's owner can read the plays a report
 * is built from, and the page is anonymous. It carries storage KEYS, never
 * URLs (the page prepends the media host; the database checks the key shapes
 * below), so a coach can't point a report at an arbitrary address.
 */
import type { PlayByPlayEvent, Playlist, PlaylistClipItem, PlaylistItem } from "../types/match";
import { isClipItem } from "../types/match";
import { eventLabel, formatGameClock, periodLabel } from "./events";
import { cyrb53 } from "./highlight-shares-db";
import { itemKey } from "./playlist-edits";
import { isPlayerCard, playerCardsOf } from "./player-card";
import { cardContent, type StatsCardSpec } from "./stats-card";
import { statsCardTarget, type StatsCardTarget, type StatsClip } from "./stats-card-defaults";

export const SCOUTING_REPORT_VERSION = 1 as const;

/** What the database accepts (publish_scouting_report checks the same numbers). */
export const REPORT_MAX_SECTIONS = 60;
export const REPORT_MAX_CLIPS = 300;
export const REPORT_TITLE_MAX = 120;

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
  playlist: Pick<Playlist, "items">;
  /** Plays by `<matchId>:<eventId>`. */
  eventByKey: ReadonlyMap<string, PlayByPlayEvent>;
  matchLabel?: (matchId: string) => string;
  title: string;
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
  const { playlist, eventByKey, title, now = new Date() } = input;
  const items = playlist.items;
  const missing: MissingClip[] = [];

  // The clips that make the page, to know whether it spans several games.
  const games = new Set<string>();
  for (const item of items) {
    if (isClipItem(item) && item.r2Url && clipKeyFromUrl(item.r2Url) && eventByKey.has(itemKey(item))) {
      games.add(item.matchId);
    }
  }
  const multiGame = games.size > 1;

  const team: ReportSection = { id: "team", kind: "team", player: null, note: "", stats: null, blocks: [] };
  const sections: ReportSection[] = [];
  let current = team;
  let clipCount = 0;
  const clipKeys: string[] = [];

  const clipBlock = (item: PlaylistClipItem): ReportClip | null => {
    const key = itemKey(item);
    const event = eventByKey.get(key);
    if (!event) {
      missing.push({ key, matchId: item.matchId, eventId: item.eventId, reason: "no_play" });
      return null;
    }
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

  for (const item of items) {
    if (isPlayerCard(item)) {
      const spec = item.player;
      current = {
        id: `p${sections.length + 1}`,
        kind: "player",
        player: { id: spec.player.id, name: spec.player.name, number: spec.player.number, teamName: spec.player.teamName },
        note: spec.note.trim(),
        stats: spec.stats ? statsOf(spec.stats) : null,
        blocks: [],
      };
      sections.push(current);
      continue;
    }
    if (isClipItem(item)) {
      const block = clipBlock(item);
      if (block) current.blocks.push(block);
      continue;
    }
    if (item.card) {
      const c = cardContent(item.card);
      current.blocks.push({ kind: "stats", heading: c.heading, stats: statsOf(item.card) });
      continue;
    }
    const text = item.text.trim();
    if (text) current.blocks.push({ kind: "text", text });
  }

  const ordered = team.blocks.length > 0 ? [team, ...sections] : sections;
  const report: ScoutingReport = {
    v: SCOUTING_REPORT_VERSION,
    header: {
      title: title.trim(),
      opponent: input.opponent?.trim() ? input.opponent.trim() : null,
      preparedAt: now.toISOString(),
      players: sections.length,
      clips: clipCount,
      attribution: input.attribution ?? true,
    },
    sections: ordered,
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
// Where a new player card starts
// ---------------------------------------------------------------------------

/**
 * A new player card's player and game, for a card inserted at `insertIndex`:
 * the clips below it (up to the next player card) say whose it is, else the
 * clips above (back to the previous one). A player who already has a card
 * is never the default. From a clip's row ("Insert player card above"),
 * `anchor` names that clip. Season first: for opponent prep the season
 * says more than one game, and the caller falls back to the game where the
 * league has no season line. Null when no clip near the insertion has a
 * player who has no card yet.
 */
export function playerCardTarget(
  items: readonly PlaylistItem[],
  insertIndex: number,
  eventByKey: ReadonlyMap<string, PlayByPlayEvent>,
  opts: { anchor?: StatsClip | null; activePlayerId?: string | null } = {},
): StatsCardTarget | null {
  const taken = new Set(playerCardsOf(items).map((c) => c.player.player.id));
  const personOf = (c: StatsClip) => (c.event.player ? String(c.event.player.playerId) : null);
  const free = (c: StatsClip) => {
    const id = personOf(c);
    return id !== null && !taken.has(id);
  };
  const clipAt = (item: PlaylistItem): StatsClip | null => {
    if (!isClipItem(item)) return null;
    const event = eventByKey.get(itemKey(item));
    return event ? { matchId: item.matchId, event } : null;
  };

  let clips: StatsClip[];
  if (opts.anchor) {
    clips = [opts.anchor];
  } else {
    const below: StatsClip[] = [];
    for (let i = insertIndex; i < items.length && !isPlayerCard(items[i]); i++) {
      const c = clipAt(items[i]);
      if (c) below.push(c);
    }
    const above: StatsClip[] = [];
    for (let i = insertIndex - 1; i >= 0 && !isPlayerCard(items[i]); i--) {
      const c = clipAt(items[i]);
      if (c) above.push(c);
    }
    clips = below.filter(free).length > 0 ? below : above;
  }
  const usable = clips.filter(free);
  if (usable.length === 0) return null;
  const target = statsCardTarget(usable, {
    anchor: opts.anchor && free(opts.anchor) ? opts.anchor : null,
    activePlayerId: opts.activePlayerId ?? null,
  });
  return target ? { ...target, defaultScope: "season" } : null;
}

// ---------------------------------------------------------------------------
// A player card's section in the list
// ---------------------------------------------------------------------------

/** Index just past the last item of the player card at `cardIndex`'s section. */
export function sectionEnd(items: readonly PlaylistItem[], cardIndex: number): number {
  let i = cardIndex + 1;
  while (i < items.length && !isPlayerCard(items[i])) i++;
  return i;
}

/**
 * What the inspector says about a card's section: how many clips sit below it,
 * and the keys of the same player's clips elsewhere in the playlist (the
 * "Move n more clips here" helper). A clip in a group that also holds other
 * players' clips moves with its group, so the helper leaves grouped clips alone.
 */
export function playerSectionInfo(
  items: readonly PlaylistItem[],
  cardIndex: number,
  eventByKey: ReadonlyMap<string, PlayByPlayEvent>,
): { clips: number; elsewhere: string[] } {
  const card = items[cardIndex];
  if (!card || !isPlayerCard(card)) return { clips: 0, elsewhere: [] };
  const end = sectionEnd(items, cardIndex);
  const playerId = card.player.player.id;
  let clips = 0;
  const elsewhere: string[] = [];
  items.forEach((item, i) => {
    if (!isClipItem(item)) return;
    const inside = i > cardIndex && i < end;
    if (inside) {
      clips++;
      return;
    }
    const event = eventByKey.get(itemKey(item));
    if (event?.player && String(event.player.playerId) === playerId && !item.groupId) elsewhere.push(itemKey(item));
  });
  return { clips, elsewhere };
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

// ---------------------------------------------------------------------------
// The share sheet's defaults
// ---------------------------------------------------------------------------

/**
 * The opponent the share sheet starts with: for opponent prep, the team the
 * player cards are about, so the most common team name among them (a tie keeps
 * the first). Null when no card has one.
 */
export function defaultOpponent(items: readonly PlaylistItem[]): string | null {
  const counts = new Map<string, number>();
  for (const card of playerCardsOf(items)) {
    const team = card.player.player.teamName.trim();
    if (team) counts.set(team, (counts.get(team) ?? 0) + 1);
  }
  let best: string | null = null;
  let n = 0;
  for (const [team, c] of counts) {
    if (c > n) {
      best = team;
      n = c;
    }
  }
  return best;
}

/** A title the database accepts: trimmed, at most REPORT_TITLE_MAX characters. */
export function clampReportTitle(title: string): string {
  return title.trim().slice(0, REPORT_TITLE_MAX);
}

// ---------------------------------------------------------------------------
// Dragging a player's section
// ---------------------------------------------------------------------------

/**
 * The keys a section travels with when its head row (a player card) is
 * dragged: the head and every row after it up to the next head. Null when the
 * grabbed row isn't a head.
 */
export function sectionBlockKeys<T>(
  list: readonly T[],
  keyOf: (item: T) => string,
  isHead: (item: T) => boolean,
  anchorKey: string,
): string[] | null {
  const at = list.findIndex((item) => keyOf(item) === anchorKey);
  if (at < 0 || !isHead(list[at])) return null;
  let end = at + 1;
  while (end < list.length && !isHead(list[end])) end++;
  return list.slice(at, end).map(keyOf);
}

/**
 * A section dropped between two rows of another would take that section's
 * clips below it, or hand its own to the one above: so a dragged section's
 * drop gap snaps to the nearest section boundary (a head row, or the end of
 * the list; a tie goes to the earlier). A gap inside the dragged block itself
 * passes through, as the engine reads it as "stay".
 */
export function snapGapToSectionBoundary<T>(
  gap: number,
  list: readonly T[],
  keyOf: (item: T) => string,
  isHead: (item: T) => boolean,
  blockKeys: ReadonlySet<string>,
): number {
  if (gap > 0 && gap < list.length && blockKeys.has(keyOf(list[gap])) && blockKeys.has(keyOf(list[gap - 1]))) return gap;
  let best = -1;
  let bestDistance = Infinity;
  for (let i = 0; i <= list.length; i++) {
    if (i < list.length && !isHead(list[i])) continue;
    const distance = Math.abs(i - gap);
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  }
  return best < 0 ? gap : best;
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
 * those; the built report leaves them out until it has). A section with
 * nothing in it is left out, the Team section included.
 */
export function reportOutline(items: readonly PlaylistItem[], eventByKey: ReadonlyMap<string, PlayByPlayEvent>): OutlineRow[] {
  const team: OutlineRow = { id: "team", label: "Team", clips: 0, note: false, stats: false };
  const rows: OutlineRow[] = [];
  let current = team;
  let teamHasContent = false;
  for (const item of items) {
    if (isPlayerCard(item)) {
      const { player, note, stats } = item.player;
      current = {
        id: `p${rows.length + 1}`,
        label: player.number ? `#${player.number} ${player.name}` : player.name,
        clips: 0,
        note: note.trim().length > 0,
        stats: stats !== null,
      };
      rows.push(current);
      continue;
    }
    const counted = isClipItem(item) ? eventByKey.has(itemKey(item)) : item.card ? true : item.text.trim().length > 0;
    if (!counted) continue;
    if (isClipItem(item)) current.clips++;
    if (current === team) teamHasContent = true;
  }
  return teamHasContent ? [team, ...rows] : rows;
}
