/**
 * Desktop wrapper — binds the platform Supabase client to the shared
 * scouting reports lib (@scoutable/shared/lib/scouting-reports-db).
 */
import { createClient } from "@/lib/supabase/client";
import * as db from "@scoutable/shared/lib/scouting-reports-db";
import type { ScoutingReport } from "@scoutable/shared/lib/scouting-report";

const c = () => createClient();

export type { LiveReportRef, MyScoutingReport, PublishedReport, ScoutingReportErrorCode, ShareLimit } from "@scoutable/shared/lib/scouting-reports-db";
export { ScoutingReportError } from "@scoutable/shared/lib/scouting-reports-db";

export const publishScoutingReport = (args: { playlistId: string; title: string; report: ScoutingReport; contentKey: string }) =>
  db.publishScoutingReport(c(), args);
export const revokeScoutingReport = (id: string) => db.revokeScoutingReport(c(), id);
export const getMyScoutingReport = (playlistId: string) => db.getMyScoutingReport(c(), playlistId);
export const getScoutingReportShareLimit = (playlistId: string) => db.getScoutingReportShareLimit(c(), playlistId);
