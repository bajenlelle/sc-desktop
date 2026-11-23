/**
 * Scouting reports on players' phones in the database
 * (20261124100000_scouting_report_recipients): the coach sends a live club
 * report to teams and people and sees who read it; a player lists what reached
 * them and records what they read. Isomorphic: callers pass their platform
 * Supabase client. The pure side is scouting-report-inbox.ts.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { InboxReport, ReportDelivery, ReportReader, ReportTarget } from "./scouting-report-inbox";

/** The tokens the send functions raise. */
export type ReportSendErrorCode =
  | "not_owner"
  | "not_authenticated"
  | "report_not_live"
  | "report_not_in_club"
  | "license_locked"
  | "team_not_in_report_org"
  | "recipient_not_in_org"
  | "no_recipients"
  | "too_many_recipients"
  | "not_recipient"
  | "unknown";

const SEND_CODES: readonly ReportSendErrorCode[] = [
  "not_owner",
  "not_authenticated",
  "report_not_live",
  "report_not_in_club",
  "license_locked",
  "team_not_in_report_org",
  "recipient_not_in_org",
  "no_recipients",
  "too_many_recipients",
  "not_recipient",
];

export function reportSendErrorCode(message: string): ReportSendErrorCode {
  return SEND_CODES.find((c) => message.includes(c)) ?? "unknown";
}

export class ReportSendError extends Error {
  constructor(
    readonly code: ReportSendErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ReportSendError";
  }
}

function fail(what: string, message: string): never {
  throw new ReportSendError(reportSendErrorCode(message), `${what}: ${message}`);
}

/** A stored "never" ('infinity') is null; anything else is passed on. */
function expiry(v: string | null | undefined): string | null {
  return !v || v === "infinity" || Number.isNaN(Date.parse(v)) ? null : v;
}

function gameOf(v: unknown): InboxReport["game"] {
  if (!v || typeof v !== "object") return null;
  const g = v as { at?: unknown; home?: unknown };
  return typeof g.at === "string" && !Number.isNaN(Date.parse(g.at)) ? { at: g.at, home: g.home === true } : null;
}

// ---------------------------------------------------------------------------
// The player
// ---------------------------------------------------------------------------

/** The live reports that reached the caller, newest sent first. Throws when the read fails. */
export async function listMyInboxReports(supabase: SupabaseClient): Promise<InboxReport[]> {
  const { data, error } = await supabase.rpc("get_my_scouting_reports");
  if (error) throw new Error(`Failed to load scouting reports: ${error.message}`);
  type Row = {
    id: string;
    title: string;
    opponent: string | null;
    game: unknown;
    players: number | null;
    clips: number | null;
    sent_at: string;
    updated_at: string;
    expires_at: string | null;
    sender_name: string | null;
    team_name: string | null;
    opened_at: string | null;
    watched_keys: string[] | null;
  };
  return ((data ?? []) as Row[]).map((r) => ({
    id: r.id,
    title: r.title ?? "",
    opponent: r.opponent ?? null,
    game: gameOf(r.game),
    players: r.players ?? 0,
    clips: r.clips ?? 0,
    sentAt: r.sent_at,
    updatedAt: r.updated_at,
    expiresAt: expiry(r.expires_at),
    senderName: r.sender_name ?? null,
    teamName: r.team_name ?? null,
    openedAt: r.opened_at ?? null,
    watchedKeys: r.watched_keys ?? [],
  }));
}

/** Records that the caller opened a report (no clip), or watched one of its clips. */
export async function recordReportRead(supabase: SupabaseClient, reportId: string, clipKey: string | null = null): Promise<void> {
  const { error } = await supabase.rpc("record_scouting_report_read", { p_report: reportId, p_clip_key: clipKey });
  if (error) fail("Failed to record reading", error.message);
}

// ---------------------------------------------------------------------------
// The coach
// ---------------------------------------------------------------------------

/** Sends a live club report to teams and people of its club. Sending to a target twice changes nothing. */
export async function sendReport(
  supabase: SupabaseClient,
  reportId: string,
  to: { teamIds?: readonly string[]; userIds?: readonly string[] },
): Promise<{ reached: number; notified: number }> {
  const { data, error } = await supabase.rpc("send_scouting_report", {
    p_report: reportId,
    p_team_ids: [...(to.teamIds ?? [])],
    p_user_ids: [...(to.userIds ?? [])],
  });
  if (error) fail("Failed to send the report", error.message);
  const r = (data ?? {}) as { reached?: number; notified?: number };
  return { reached: r.reached ?? 0, notified: r.notified ?? 0 };
}

/** Takes a team or a person off a report. */
export async function unsendReport(supabase: SupabaseClient, reportId: string, target: { teamId: string } | { userId: string }): Promise<void> {
  const { error } = await supabase.rpc("unsend_scouting_report", {
    p_report: reportId,
    p_team_id: "teamId" in target ? target.teamId : null,
    p_user_id: "userId" in target ? target.userId : null,
  });
  if (error) fail("Failed to remove", error.message);
}

/** One push about an update to everyone the report reaches; returns how many. */
export async function notifyReportUpdate(supabase: SupabaseClient, reportId: string): Promise<number> {
  const { data, error } = await supabase.rpc("notify_scouting_report_update", { p_report: reportId });
  if (error) fail("Failed to tell players", error.message);
  return typeof data === "number" ? data : 0;
}

/** Who a report was sent to and who read how much of it. Owner only; throws otherwise. */
export async function getReportDelivery(supabase: SupabaseClient, reportId: string): Promise<ReportDelivery> {
  const { data, error } = await supabase.rpc("get_scouting_report_delivery", { p_report: reportId });
  if (error) fail("Failed to load who read the report", error.message);
  const d = (data ?? {}) as { clips?: number; targets?: ReportTarget[]; readers?: ReportReader[] };
  return {
    clips: d.clips ?? 0,
    targets: (d.targets ?? []).map((t) => ({ teamId: t.teamId ?? null, userId: t.userId ?? null, name: t.name, sentAt: t.sentAt })),
    readers: (d.readers ?? []).map((r) => ({
      userId: r.userId,
      name: r.name,
      role: r.role,
      teamName: r.teamName ?? null,
      openedAt: r.openedAt ?? null,
      lastOpenedAt: r.lastOpenedAt ?? null,
      watched: r.watched ?? 0,
    })),
  };
}

/** For the Reports page: per sent live report of the caller's, how many it reaches and how many opened it. */
export async function listMyReportReach(supabase: SupabaseClient): Promise<Map<string, { reached: number; opened: number }>> {
  const { data, error } = await supabase.rpc("get_my_scouting_report_reach");
  if (error) throw new Error(`Failed to load report reach: ${error.message}`);
  const out = new Map<string, { reached: number; opened: number }>();
  for (const r of (data ?? []) as { report_id: string; reached: number; opened: number }[]) {
    out.set(r.report_id, { reached: r.reached ?? 0, opened: r.opened ?? 0 });
  }
  return out;
}
