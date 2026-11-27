/**
 * The Reports list: every scouting report a coach has in a space, shared or
 * still a draft, one row per playlist. Pure: the desktop reads the rows
 * (lib/scouting-reports-db.ts, lib/report-drafts-db.ts) and the space's
 * playlists, and this merges them.
 */
import { foldForSearch } from "./league-teams";
import { formatCardDate } from "./stats-card";
import type { ReportGame, ReportTeam } from "./report-draft";

/** A published report as the list reads it (`scouting_reports`, owner only). */
export interface ReportRow {
  id: string;
  /** Null once the playlist was deleted. */
  playlistId: string | null;
  title: string;
  updatedAt: string;
  /** Null for a kept report, which never expires. */
  expiresAt: string | null;
  revokedAt: string | null;
  opens: number;
}

/** A playlist's draft as the list reads it (`scouting_report_drafts`). */
export interface ReportDraftRow {
  playlistId: string;
  updatedAt: string;
  /** Null: the playlist's name. */
  title: string | null;
  players: number;
  /** The league team the report was started for (lib/report-draft.ts); absent where it wasn't read. */
  team?: ReportTeam | null;
  /** The game it prepares for. */
  game?: ReportGame | null;
}

export type ReportListStatus = "live" | "expired" | "stopped" | "draft";

export interface ReportListItem {
  playlistId: string;
  playlistName: string;
  /** Null for a draft never shared. */
  reportId: string | null;
  title: string;
  status: ReportListStatus;
  /** Null for a kept report and for a draft. */
  expiresAt: string | null;
  /** When an expired or stopped report ended. */
  endedAt: string | null;
  opens: number;
  players: number;
  /** The later of the report's and the draft's last change: the list's order. */
  changedAt: string;
  /**
   * The report owns its clips (its playlist is `kind = 'report'`, never listed
   * as a playlist); false for a report made on a playlist the coach keeps.
   */
  ownClips: boolean;
}

/** A playlist as the list reads it: its name, and for a report's own clips their kind and when they were made. */
export interface ReportListPlaylist {
  id: string;
  name: string;
  kind?: "report";
  createdAt?: string | null;
}

export type ReportListFilter = "all" | "shared" | "drafts";

const time = (iso: string) => new Date(iso).getTime();

/**
 * One item per playlist in `playlists` (the space's): its report that is not
 * switched off, else its latest stopped one, else its draft. Reports and
 * drafts of other playlists (another space, or deleted) are left out. Most
 * recently changed first.
 */
export function mergeReportList(
  reports: ReportRow[],
  drafts: ReportDraftRow[],
  playlists: ReportListPlaylist[],
  now: Date,
): ReportListItem[] {
  const names = new Map(playlists.map((p) => [p.id, p.name]));
  const byId = new Map(playlists.map((p) => [p.id, p]));

  const latest = new Map<string, ReportRow>();
  for (const r of reports) {
    if (!r.playlistId || !names.has(r.playlistId)) continue;
    const seen = latest.get(r.playlistId);
    if (!seen || beats(r, seen)) latest.set(r.playlistId, r);
  }
  const draftFor = new Map(drafts.filter((d) => names.has(d.playlistId)).map((d) => [d.playlistId, d]));

  const items: ReportListItem[] = [];
  // A report's own clips are a report from the start, before its first edit writes a draft.
  const ownReports = playlists.filter((p) => p.kind === "report").map((p) => p.id);
  for (const playlistId of new Set([...latest.keys(), ...draftFor.keys(), ...ownReports])) {
    const playlistName = names.get(playlistId)!;
    const r = latest.get(playlistId);
    const d = draftFor.get(playlistId);
    const ownClips = byId.get(playlistId)?.kind === "report";
    const changedAt =
      [r?.updatedAt, d?.updatedAt].filter((t): t is string => !!t).sort((a, b) => time(b) - time(a))[0] ??
      byId.get(playlistId)?.createdAt ??
      now.toISOString();
    if (r) {
      const status: ReportListStatus = r.revokedAt
        ? "stopped"
        : r.expiresAt !== null && time(r.expiresAt) <= now.getTime()
          ? "expired"
          : "live";
      items.push({
        playlistId,
        playlistName,
        reportId: r.id,
        title: r.title,
        status,
        expiresAt: r.expiresAt,
        endedAt: status === "stopped" ? r.revokedAt : status === "expired" ? r.expiresAt : null,
        opens: r.opens,
        players: d?.players ?? 0,
        changedAt,
        ownClips,
      });
    } else {
      items.push({
        playlistId,
        playlistName,
        reportId: null,
        title: d?.title ?? playlistName,
        status: "draft",
        expiresAt: null,
        endedAt: null,
        opens: 0,
        players: d?.players ?? 0,
        changedAt,
        ownClips,
      });
    }
  }
  return items.sort((a, b) => time(b.changedAt) - time(a.changedAt));
}

/** A playlist has at most one report not switched off; it wins, else the latest change. */
function beats(a: ReportRow, b: ReportRow): boolean {
  if (!a.revokedAt !== !b.revokedAt) return !a.revokedAt;
  return time(a.updatedAt) > time(b.updatedAt);
}

/** The list under its filter and search (every word in the title or playlist name, case and accents ignored). */
export function filterReportList(items: ReportListItem[], filter: ReportListFilter, query: string): ReportListItem[] {
  const words = foldForSearch(query).split(" ").filter(Boolean);
  return items.filter((i) => {
    if (filter === "shared" && i.status === "draft") return false;
    if (filter === "drafts" && i.status !== "draft") return false;
    const text = foldForSearch(`${i.title} ${i.playlistName}`);
    return words.every((w) => text.includes(w));
  });
}

/** The row's status line: "Shared · expires 26 Nov 2026", "Expired 5 Nov 2026", "Stopped 3 Nov 2026", "Draft". */
export function reportStatusLabel(item: ReportListItem): string {
  switch (item.status) {
    case "live":
      return item.expiresAt === null ? "Shared · never expires" : `Shared · expires ${formatCardDate(item.expiresAt)}`;
    case "expired":
      return `Expired ${formatCardDate(item.endedAt ?? "")}`;
    case "stopped":
      return `Stopped ${formatCardDate(item.endedAt ?? "")}`;
    case "draft":
      return "Draft";
  }
}
