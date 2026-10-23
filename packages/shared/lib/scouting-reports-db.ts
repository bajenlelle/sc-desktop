/**
 * Scouting reports in the database (20261024100000): publishing a playlist's
 * report, switching it off, the owner's view of it, and the anonymous read the
 * public page uses. Isomorphic: callers pass their platform Supabase client.
 * The report itself is built by lib/scouting-report.ts.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseScoutingReport, type ScoutingReport } from "./scouting-report";

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

/** The tokens publish_scouting_report and revoke_scouting_report raise. */
export type ScoutingReportErrorCode =
  | "upgrade_required"
  | "license_locked"
  | "not_owner"
  | "not_found"
  | "not_authenticated"
  | "invalid_content"
  | "unknown";

const CODES: readonly ScoutingReportErrorCode[] = [
  "upgrade_required",
  "license_locked",
  "not_owner",
  "not_found",
  "not_authenticated",
  "invalid_content",
];

export class ScoutingReportError extends Error {
  constructor(
    readonly code: ScoutingReportErrorCode,
    message: string,
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
  expiresAt: string;
  /** False when an existing live report of the playlist was updated in place (same link). */
  created: boolean;
}

/**
 * Publishes the playlist's report, or updates its live one in place (the same
 * link, a fresh 30 days). Throws a ScoutingReportError: `upgrade_required` on
 * the free plan, `license_locked`, `not_owner`, `invalid_content`.
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
  if (error) throw new ScoutingReportError(scoutingReportErrorCode(error.message), `Failed to publish scouting report: ${error.message}`);
  const r = data as { id: string; expires_at: string; created: boolean };
  return { id: r.id, expiresAt: r.expires_at, created: r.created };
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
  expiresAt: string;
}

/** The playlist's report that is not switched off, or null. It may be past its expiry: the caller compares expiresAt. */
export async function getMyScoutingReport(supabase: SupabaseClient, playlistId: string): Promise<MyScoutingReport | null> {
  const { data, error } = await supabase
    .from("scouting_reports")
    .select("id, title, content_key, created_at, updated_at, expires_at")
    .eq("playlist_id", playlistId)
    .is("revoked_at", null)
    .maybeSingle();
  if (error || !data) return null;
  const r = data as { id: string; title: string; content_key: string; created_at: string; updated_at: string; expires_at: string };
  return {
    id: r.id,
    title: r.title,
    contentKey: r.content_key,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    expiresAt: r.expires_at,
  };
}

/** The address a report opens at, under the web app's base ("https://app.scoutable.se"). */
export function scoutingReportUrl(webBase: string, id: string): string {
  return `${webBase.replace(/\/+$/, "")}/r/${id}`;
}
