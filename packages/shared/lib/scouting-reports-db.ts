/**
 * Scouting reports in the database (20261024100000): publishing a playlist's
 * report, switching it off, the owner's view of it, and the anonymous read the
 * public page uses. Isomorphic: callers pass their platform Supabase client.
 * The report itself is built by lib/scouting-report.ts.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseScoutingReport, type ScoutingReport } from "./scouting-report";
import { formatCardDate } from "./stats-card";

/** What the public page gets back: the report, or why there isn't one. */
export type ScoutingReportPage =
  | { valid: true; title: string; updatedAt: string; expiresAt: string; report: ScoutingReport }
  | { valid: false; reason: "not_found" | "expired" | "revoked" };

/** The page's one anonymous read (get_scouting_report). Throws only on a transport error. */
export async function getScoutingReport(supabase: SupabaseClient, id: string): Promise<ScoutingReportPage> {
  const { data, error } = await supabase.rpc("get_scouting_report", { p_id: id });
  if (error) throw new Error(`Failed to load scouting report: ${error.message}`);
  const r = data as { valid?: boolean; reason?: string; title?: string; updated_at?: string; expires_at?: string; content?: unknown } | null;
  if (!r?.valid) {
    const reason = r?.reason === "expired" || r?.reason === "revoked" ? r.reason : "not_found";
    return { valid: false, reason };
  }
  const report = parseScoutingReport(r.content);
  // A row this build can't read is as good as none to the person who opened it.
  if (!report) return { valid: false, reason: "not_found" };
  return { valid: true, title: r.title ?? report.header.title, updatedAt: r.updated_at ?? "", expiresAt: r.expires_at ?? "", report };
}

/**
 * The tokens publish_scouting_report and revoke_scouting_report raise.
 * `report_limit_reached` is what publish raises when a free plan already has
 * another live report; it replaced `upgrade_required`, which stays in the list
 * because an older database may still raise it, and the desktop falls back to
 * the upgrade dialog for it.
 */
export type ScoutingReportErrorCode =
  | "upgrade_required"
  | "report_limit_reached"
  | "license_locked"
  | "not_owner"
  | "not_found"
  | "not_authenticated"
  | "invalid_content"
  | "unknown";

const CODES: readonly ScoutingReportErrorCode[] = [
  "upgrade_required",
  "report_limit_reached",
  "license_locked",
  "not_owner",
  "not_found",
  "not_authenticated",
  "invalid_content",
];

/** A live report as the limit names it: which one stands in the way of publishing another. */
export interface LiveReportRef {
  id: string;
  playlistId: string;
  title: string;
  expiresAt: string;
}

/** A report ref from the database's JSON (a string or an already-parsed object), or null when it isn't one. */
function parseLiveReportRef(v: unknown): LiveReportRef | null {
  let o: unknown = v;
  if (typeof v === "string") {
    try {
      o = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!o || typeof o !== "object") return null;
  const r = o as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.playlist_id !== "string" || typeof r.title !== "string" || typeof r.expires_at !== "string") return null;
  return { id: r.id, playlistId: r.playlist_id, title: r.title, expiresAt: r.expires_at };
}

/**
 * What the report functions raise. `blockedBy` is set only on
 * `report_limit_reached`, and only when the database named the live report
 * (null otherwise).
 */
export class ScoutingReportError extends Error {
  constructor(
    readonly code: ScoutingReportErrorCode,
    message: string,
    readonly blockedBy: LiveReportRef | null = null,
  ) {
    super(message);
    this.name = "ScoutingReportError";
  }
}

/** The raised token inside a PostgREST error message, else "unknown". */
export function scoutingReportErrorCode(message: string | undefined): ScoutingReportErrorCode {
  return CODES.find((c) => message?.includes(c)) ?? "unknown";
}

export interface PublishedReport {
  id: string;
  /** Null for a kept report (Scoutable's own sample), which never expires. */
  expiresAt: string | null;
  /** False when an existing live report of the playlist was updated in place (same link). */
  created: boolean;
}

/**
 * The database writes a kept report's expiry as the timestamp `infinity`
 * (20261103100000), which Postgres hands to clients as that word: no expiry.
 */
function reportExpiry(raw: string): string | null {
  return raw === "infinity" ? null : raw;
}

/**
 * Publishes the playlist's report, or updates its live one in place (the same
 * link, a fresh 30 days). Throws a ScoutingReportError: `report_limit_reached`
 * when a free plan already has another live report (`blockedBy` names it; it
 * replaced `upgrade_required` here), `license_locked`, `not_owner`,
 * `invalid_content`.
 */
export async function publishScoutingReport(
  supabase: SupabaseClient,
  args: { playlistId: string; title: string; report: ScoutingReport; contentKey: string },
): Promise<PublishedReport> {
  const { data, error } = await supabase.rpc("publish_scouting_report", {
    p_playlist_id: args.playlistId,
    p_title: args.title,
    p_content: args.report,
    p_content_key: args.contentKey,
  });
  if (error) {
    const code = scoutingReportErrorCode(error.message);
    // The database names the live report in the error's details.
    const blockedBy = code === "report_limit_reached" ? parseLiveReportRef(error.details) : null;
    throw new ScoutingReportError(code, `Failed to publish scouting report: ${error.message}`, blockedBy);
  }
  const r = data as { id: string; expires_at: string; created: boolean };
  return { id: r.id, expiresAt: reportExpiry(r.expires_at), created: r.created };
}

/** Whether a playlist's plan limits sharing, and which live report (if any) is in the way. */
export interface ShareLimit {
  /** True on a plan that shares one live report at a time. */
  limited: boolean;
  /** The caller's other live report that would have to be switched off first; null when nothing blocks. */
  blockedBy: LiveReportRef | null;
}

/**
 * What the share sheet asks before it offers to publish. Null when the check
 * itself failed: the caller then tries to publish and handles `report_limit_reached`.
 */
export async function getScoutingReportShareLimit(supabase: SupabaseClient, playlistId: string): Promise<ShareLimit | null> {
  try {
    const { data, error } = await supabase.rpc("scouting_report_share_limit", { p_playlist_id: playlistId });
    if (error) return null;
    const r = data as { limited?: unknown; blocked_by?: unknown } | null;
    if (!r || typeof r.limited !== "boolean") return null;
    return { limited: r.limited, blockedBy: parseLiveReportRef(r.blocked_by) };
  } catch {
    return null;
  }
}

/**
 * Counts one reader's open of a live report (record_scouting_report_open). A
 * best-effort side effect of showing the page: never throws, and an expired,
 * stopped or unknown id changes nothing.
 */
export async function recordScoutingReportOpen(supabase: SupabaseClient, id: string): Promise<void> {
  try {
    await supabase.rpc("record_scouting_report_open", { p_id: id });
  } catch {
    // Counting must never get in the reader's way.
  }
}

/** The share sheet's line for how often the link was opened. */
export function openedLabel(opens: number): string {
  if (opens <= 0) return "Not opened yet";
  if (opens === 1) return "Opened once";
  return `Opened ${opens} times`;
}

/** The hash the desktop app opens a report's link with, so the coach's own look isn't counted as a reader. */
export const APP_OPEN_HASH = "#app";

/** The hash the desktop app opens the report with to print it on arrival. */
const PRINT_OPEN_HASH = "#print";

/**
 * Whether opening the page at this location hash is a reader's open. The coach
 * opening their own link from the app (or to print it) is not.
 */
export function countsAsReaderOpen(hash: string): boolean {
  return hash !== APP_OPEN_HASH && hash !== PRINT_OPEN_HASH;
}

/** Switches a report off: the page, stats and notes are wiped at once. Switching off twice is fine. */
export async function revokeScoutingReport(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.rpc("revoke_scouting_report", { p_id: id });
  if (error) throw new ScoutingReportError(scoutingReportErrorCode(error.message), `Failed to stop sharing: ${error.message}`);
}

/** The owner's view of a playlist's live report (no content): what the share sheet shows. */
export interface MyScoutingReport {
  id: string;
  title: string;
  contentKey: string;
  createdAt: string;
  updatedAt: string;
  /** Null for a kept report, which never expires. */
  expiresAt: string | null;
  /** How many times readers opened the link (0 for a report never opened). */
  opens: number;
}

/** Live: there is a report, and it is kept (no expiry) or not yet past its expiry. */
export function isLiveReport(r: MyScoutingReport | null): r is MyScoutingReport {
  return !!r && (r.expiresAt === null || new Date(r.expiresAt).getTime() > Date.now());
}

/** The toolbar's word on a live report: "Shared · expires 26 Nov 2026", or never, for a kept one. */
export function sharedStatusLabel(r: MyScoutingReport): string {
  return r.expiresAt === null ? "Shared · never expires" : `Shared · expires ${formatCardDate(r.expiresAt)}`;
}

/** The playlist's report that is not switched off, or null. It may be past its expiry: isLiveReport tells (a kept report never is). */
export async function getMyScoutingReport(supabase: SupabaseClient, playlistId: string): Promise<MyScoutingReport | null> {
  const { data, error } = await supabase
    .from("scouting_reports")
    .select("id, title, content_key, created_at, updated_at, expires_at, open_count")
    .eq("playlist_id", playlistId)
    .is("revoked_at", null)
    .maybeSingle();
  if (error || !data) return null;
  const r = data as { id: string; title: string; content_key: string; created_at: string; updated_at: string; expires_at: string; open_count?: number | null };
  return {
    id: r.id,
    title: r.title,
    contentKey: r.content_key,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    expiresAt: reportExpiry(r.expires_at),
    opens: r.open_count ?? 0,
  };
}

/** The address a report opens at, under the web app's base ("https://app.scoutable.se"). */
export function scoutingReportUrl(webBase: string, id: string): string {
  return `${webBase.replace(/\/+$/, "")}/r/${id}`;
}
