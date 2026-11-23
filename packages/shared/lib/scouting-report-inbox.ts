/**
 * Scouting reports on players' phones: the reports a person was sent, as the
 * app lists and reads them (docs/scouting-reports.md, "On players' phones").
 * Pure: which ones lead (the game still to come), which one the playlist feed
 * shows on top, how far the reader has watched, the clips a section plays, and
 * the coach's view of who read it. The database side is
 * scouting-report-inbox-db.ts.
 *
 * Watched clips are counted by clip KEY (the file), not by the page's c1, c2
 * ids: an update renumbers the ids but keeps the files.
 */
import type { ReportClip, ReportSection, ScoutingReport } from "./scouting-report";
import type { WatchDrawing, WatchSlow } from "./watch-queue";

/** A report that reached the caller, as get_my_scouting_reports lists it. */
export interface InboxReport {
  id: string;
  title: string;
  /** The team it scouts; null when the coach named none. */
  opponent: string | null;
  /** The game it prepares for, when it has one. */
  game: { at: string; home: boolean } | null;
  players: number;
  /** Its clip files. */
  clips: number;
  sentAt: string;
  updatedAt: string;
  /** Null for a report that never expires. */
  expiresAt: string | null;
  senderName: string | null;
  /** The team it came through; null when it was sent to the person directly. */
  teamName: string | null;
  /** When the caller first opened it; null while unread. */
  openedAt: string | null;
  /** The report's clip files the caller has watched. */
  watchedKeys: string[];
}

/** What a report is called in a list and a push: the team it scouts, else its title. */
export function inboxReportName(r: Pick<InboxReport, "opponent" | "title">): string {
  return r.opponent?.trim() || r.title.trim() || "Scouting report";
}

/** A game counts as still to come until this long after tip-off. */
const GAME_GRACE_MS = 3 * 60 * 60 * 1000;
/** A report without a game leads for this long after it was sent. */
const NO_GAME_LEAD_MS = 7 * 24 * 60 * 60 * 1000;

function gameTime(r: Pick<InboxReport, "game">): number | null {
  const t = r.game ? Date.parse(r.game.at) : NaN;
  return Number.isNaN(t) ? null : t;
}

/**
 * Whether a report is for what's next: its game hasn't been played (until
 * three hours after tip-off), or, without a game, it was sent this week.
 */
export function isUpcomingReport(r: Pick<InboxReport, "game" | "sentAt">, now: number = Date.now()): boolean {
  const at = gameTime(r);
  if (at !== null) return at + GAME_GRACE_MS > now;
  const sent = Date.parse(r.sentAt);
  return !Number.isNaN(sent) && sent + NO_GAME_LEAD_MS > now;
}

/**
 * The Scouting reports page's two groups: Upcoming, the next game first (a
 * report without a game after those with one, newest sent first); Earlier,
 * newest game or send first.
 */
export function groupInbox<T extends InboxReport>(rows: readonly T[], now: number = Date.now()): { upcoming: T[]; earlier: T[] } {
  const upcoming: T[] = [];
  const earlier: T[] = [];
  for (const r of rows) (isUpcomingReport(r, now) ? upcoming : earlier).push(r);
  const sent = (r: T) => Date.parse(r.sentAt) || 0;
  upcoming.sort((a, b) => {
    const ga = gameTime(a);
    const gb = gameTime(b);
    if (ga !== null && gb !== null) return ga - gb;
    if (ga !== null) return -1;
    if (gb !== null) return 1;
    return sent(b) - sent(a);
  });
  const when = (r: T) => gameTime(r) ?? sent(r);
  earlier.sort((a, b) => when(b) - when(a));
  return { upcoming, earlier };
}

/**
 * The report My playlists shows on top: the one for the next game, else the
 * newest one not opened yet. Null when none is either (the card goes once the
 * game is played and the report is read).
 */
export function featuredReport<T extends InboxReport>(rows: readonly T[], now: number = Date.now()): T | null {
  const { upcoming } = groupInbox(rows, now);
  const nextGame = upcoming.find((r) => gameTime(r) !== null);
  if (nextGame) return nextGame;
  const unread = rows.filter((r) => !r.openedAt).sort((a, b) => (Date.parse(b.sentAt) || 0) - (Date.parse(a.sentAt) || 0));
  return unread[0] ?? upcoming[0] ?? null;
}

/** The sidebar's count and the app badge's share: live reports not opened yet. */
export function unreadReportCount(rows: readonly Pick<InboxReport, "openedAt">[]): number {
  return rows.filter((r) => !r.openedAt).length;
}

/** How far the caller has watched a listed report. */
export function inboxProgress(r: Pick<InboxReport, "clips" | "watchedKeys">): { watched: number; total: number } {
  return { watched: Math.min(r.watchedKeys.length, r.clips), total: r.clips };
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];

function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * When a report's game is, in the device's time: "Today, 15:00",
 * "Tomorrow, 15:00", "Sat 28 Nov, 15:00". Spelled out rather than through
 * toLocaleString, whose output differs between iOS and Android
 * (apps/mobile/src/lib/format.ts).
 */
export function reportGameLabel(at: string, now: number = Date.now()): string | null {
  const t = Date.parse(at);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const days = Math.round((startOfDay(t) - startOfDay(now)) / 86_400_000);
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Tomorrow, ${time}`;
  if (days === -1) return `Yesterday, ${time}`;
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}, ${time}`;
}

// ---------------------------------------------------------------------------
// Reading a report
// ---------------------------------------------------------------------------

/** A section's clips, in page order. */
export function sectionClips(section: Pick<ReportSection, "blocks">): ReportClip[] {
  return section.blocks.filter((b): b is ReportClip => b.kind === "clip");
}

/** How many of a set of clips the reader has watched, each file once. */
export function clipsProgress(clips: readonly Pick<ReportClip, "clipKey">[], watched: ReadonlySet<string>): { watched: number; total: number } {
  const keys = new Set(clips.map((c) => c.clipKey));
  let n = 0;
  for (const k of keys) if (watched.has(k)) n++;
  return { watched: n, total: keys.size };
}

/** How far the reader is through the whole report. */
export function reportProgress(report: Pick<ScoutingReport, "sections">, watched: ReadonlySet<string>): { watched: number; total: number } {
  return clipsProgress(report.sections.flatMap(sectionClips), watched);
}

/**
 * One clip of a report as the app's clip queue plays it: the same shape as a
 * playlist's WatchItem clip where the queue looks (key, file, effects), plus the
 * report's own clip for its row and the watched record.
 */
export interface ReportQueueClip {
  kind: "clip";
  /** The page's clip id (c1, c2, …): unique within the report. */
  key: string;
  r2Url: string;
  drawings?: WatchDrawing[];
  slowMotion?: WatchSlow[];
  clip: ReportClip;
}

/** A section's clips as queue items, each file under the media host. */
export function reportQueueClips(section: Pick<ReportSection, "blocks">, mediaBase: string): ReportQueueClip[] {
  const base = mediaBase.replace(/\/+$/, "");
  return sectionClips(section).map((clip) => ({
    kind: "clip",
    key: clip.id,
    r2Url: `${base}/${clip.clipKey}`,
    ...(clip.drawings?.length ? { drawings: clip.drawings } : {}),
    ...(clip.slowMotion?.length ? { slowMotion: clip.slowMotion } : {}),
    clip,
  }));
}

/** Where Play all starts: the first clip not watched yet, else the first. Null for a section without clips. */
export function firstUnwatchedClip(clips: readonly ReportClip[], watched: ReadonlySet<string>): string | null {
  return (clips.find((c) => !watched.has(c.clipKey)) ?? clips[0])?.id ?? null;
}

/** A clip's line: "3PT Made · Q2 4:31", the game too when the report spans several. */
export function reportClipLine(clip: Pick<ReportClip, "label" | "period" | "clock" | "game">): string {
  return [clip.label, [clip.period, clip.clock].filter(Boolean).join(" "), clip.game].filter(Boolean).join(" · ");
}

// ---------------------------------------------------------------------------
// The coach's view
// ---------------------------------------------------------------------------

/** A team or a person a report was sent to. */
export interface ReportTarget {
  teamId: string | null;
  userId: string | null;
  name: string;
  sentAt: string;
}

/** Someone a report reaches, and how far they read it. */
export interface ReportReader {
  userId: string;
  name: string;
  /** Their role in the club: player, coach or admin. */
  role: string;
  /** The team it reached them through; null for a direct send. */
  teamName: string | null;
  openedAt: string | null;
  lastOpenedAt: string | null;
  /** Clips of the report they have watched. */
  watched: number;
}

export interface ReportDelivery {
  clips: number;
  targets: ReportTarget[];
  readers: ReportReader[];
}

/** A reader's line in Seen by: "16 of 16", "Opened", "Not yet". */
export function readerStatus(r: Pick<ReportReader, "openedAt" | "watched">, clips: number): string {
  if (!r.openedAt) return "Not yet";
  if (r.watched > 0 && clips > 0) return `${Math.min(r.watched, clips)} of ${clips}`;
  return "Opened";
}

/** Seen by's order: those furthest through first, then those who opened it, then the rest; by name within each. */
export function sortReaders<T extends Pick<ReportReader, "name" | "openedAt" | "watched">>(readers: readonly T[]): T[] {
  const rank = (r: T) => (r.openedAt ? (r.watched > 0 ? 0 : 1) : 2);
  return [...readers].sort((a, b) => rank(a) - rank(b) || b.watched - a.watched || a.name.localeCompare(b.name));
}

/** "Seen by 9 of 12": how many of those it reaches opened it. */
export function seenByCount(readers: readonly Pick<ReportReader, "openedAt">[]): { seen: number; total: number } {
  return { seen: readers.filter((r) => !!r.openedAt).length, total: readers.length };
}
