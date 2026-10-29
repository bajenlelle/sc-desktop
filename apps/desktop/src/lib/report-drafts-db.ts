/**
 * Desktop wrapper — binds the platform Supabase client to the shared
 * scouting report drafts lib (@scoutable/shared/lib/report-drafts-db).
 */
import { createClient } from "@/lib/supabase/client";
import * as db from "@scoutable/shared/lib/report-drafts-db";
import type { ReportDraft } from "@scoutable/shared/lib/report-draft";

const c = () => createClient();

export type { StoredReportDraft } from "@scoutable/shared/lib/report-drafts-db";

export const getReportDraft = (playlistId: string) => db.getReportDraft(c(), playlistId);
export const saveReportDraft = (playlistId: string, draft: ReportDraft) => db.saveReportDraft(c(), playlistId, draft);
export const deleteReportDraft = (playlistId: string) => db.deleteReportDraft(c(), playlistId);
export const listReportDraftPlaylistIds = () => db.listReportDraftPlaylistIds(c());
export const listReportDrafts = () => db.listReportDrafts(c());
