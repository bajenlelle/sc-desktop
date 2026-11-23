/**
 * Desktop wrapper — binds the platform Supabase client to the shared lib for
 * reports on players' phones (@scoutable/shared/lib/scouting-report-inbox-db).
 */
import { createClient } from "@/lib/supabase/client";
import * as db from "@scoutable/shared/lib/scouting-report-inbox-db";

const c = () => createClient();

export { ReportSendError, type ReportSendErrorCode } from "@scoutable/shared/lib/scouting-report-inbox-db";

export const sendReport = (reportId: string, to: { teamIds?: readonly string[]; userIds?: readonly string[] }) => db.sendReport(c(), reportId, to);
export const unsendReport = (reportId: string, target: { teamId: string } | { userId: string }) => db.unsendReport(c(), reportId, target);
export const notifyReportUpdate = (reportId: string) => db.notifyReportUpdate(c(), reportId);
export const getReportDelivery = (reportId: string) => db.getReportDelivery(c(), reportId);
export const listMyReportReach = () => db.listMyReportReach(c());
