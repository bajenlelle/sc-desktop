import { useCallback, useEffect, useMemo } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { FileText } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { ReportView } from "@/components/report/report-view";
import { Page } from "@/components/shell/page";
import { Toolbar } from "@/components/shell/toolbar";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { recentOpensScope, rememberOpened } from "@/lib/recent-opens";
import { useBack, usePageTitle } from "@/lib/nav-history";
import { useLeagues } from "@/lib/use-leagues";
import { useReportWorkspace } from "@/lib/use-report-workspace";
import { deleteReport } from "@/lib/team-report";
import { isReportClips } from "@/types/match";
import { isLiveReport } from "@scoutable/shared/lib/scouting-reports-db";
import { toast } from "sonner";

/** What a link to a report may carry. Back is the page before (lib/nav-history.ts), else the Reports list. */
export interface ReportPageState {
  /** Share again from the Reports list: the share sheet opens once the report is read. */
  share?: boolean;
}

/** Where a report goes back to when nothing was before it. */
const REPORTS_FALLBACK = { label: "Reports", path: "/reports" };

/** The link to a report. */
export function reportPath(playlistId: string): string {
  return `/reports/${playlistId}`;
}

/**
 * A scouting report on its own page (docs/scouting-reports.md, "The report
 * page"): the report is a document of its own, reached from a team, the
 * Reports list, the search and its playlist, and Back returns there. The page
 * reads its playlist, plays and labels itself (use-report-workspace.ts); the
 * report that owns its clips edits them here (Add clips, Edit clip); one made
 * on a playlist the coach keeps has that playlist one click away (Edit clips).
 */
export function ReportPage() {
  const { playlistId = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state ?? {}) as ReportPageState;
  const leagues = useLeagues();
  const ws = useReportWorkspace(playlistId);
  const { user, activeOrgId } = useAuth();
  // The search's Recent list: this report was opened last.
  const opened = ws.status === "ready";
  useEffect(() => {
    if (opened) rememberOpened(recentOpensScope(user?.id, activeOrgId), "report", playlistId);
  }, [opened, user?.id, activeOrgId, playlistId]);

  const back = useBack(REPORTS_FALLBACK);
  const goBack = useCallback(() => back?.go(), [back]);
  usePageTitle(ws.playlist?.name);
  const editClips = useCallback(
    (reveal?: string) => navigate("/playlists", { state: { restore: { playlistId }, ...(reveal ? { reveal } : {}) } }),
    [navigate, playlistId],
  );
  // Add clips from the report itself: the sheet adds to the report's playlist through the page.
  const { addClips: add, removeClips, ensureLabels, labelHandlers } = ws;
  const addClips = useMemo(() => ({ add, remove: removeClips, ensureLabels, labelHandlers }), [add, removeClips, ensureLabels, labelHandlers]);
  // Delete report, from the toolbar's ⋯: then on to Reports, where it no longer is.
  const myReport = ws.myReport;
  const deleteThis = useCallback(async () => {
    const pl = ws.playlist;
    if (!pl) return;
    await deleteReport({ playlistId: pl.id, ownClips: isReportClips(pl), liveReportId: isLiveReport(myReport) ? myReport!.id : null });
    toast("Report deleted");
    navigate("/reports", { replace: true });
  }, [ws.playlist, myReport, navigate]);
  // Read once: a reload or Back to this page doesn't open the share sheet again.
  const clearShare = useCallback(() => navigate(location.pathname, { replace: true, state: { ...state, share: false } }), [navigate, location.pathname, state]);

  if (ws.status !== "ready" || !ws.playlist) {
    return (
      <Page>
        <Toolbar back={REPORTS_FALLBACK} title={ws.status === "loading" ? "" : "Report"} />
        {ws.status === "missing" ? (
          <EmptyState icon={<FileText />} title="This report isn’t here" body="Its playlist was deleted, or it belongs to another space." action={<Button size="sm" variant="outline" onClick={() => navigate("/reports")}>Go to Reports</Button>} />
        ) : ws.status === "failed" ? (
          <EmptyState
            title="Couldn’t open the report"
            body="Check your connection and try again."
            action={
              <Button size="sm" variant="outline" onClick={ws.retry}>
                Try again
              </Button>
            }
          />
        ) : (
          <div className="flex flex-1" aria-busy>
            <div className="w-[288px] shrink-0 border-r border-separator" />
            <div className="mx-auto w-full max-w-[680px] space-y-4 px-8 py-10" aria-hidden>
              <div className="h-7 w-2/3 animate-pulse rounded bg-fill-2" />
              <div className="h-4 w-1/3 animate-pulse rounded bg-fill-1" />
              <div className="h-32 animate-pulse rounded-window bg-fill-1" />
            </div>
          </div>
        )}
      </Page>
    );
  }

  return (
    <Page>
      <ReportView
        key={ws.playlist.id}
        toolbarSlot={null}
        back={REPORTS_FALLBACK}
        onEditClips={() => editClips()}
        playlist={ws.playlist}
        eventByKey={ws.eventByKey}
        matchLookup={ws.matchLookup}
        leagues={leagues}
        isMultiMatch={ws.isMultiMatch}
        labels={ws.labels}
        clipAssignments={ws.clipAssignments}
        labelNamesByClip={ws.labelNamesByClip}
        myReport={ws.myReport}
        onRefreshReport={ws.refreshReport}
        onOtherReportStopped={() => {}}
        plan={ws.plan}
        onUpgrade={ws.goPro}
        shareDisabledReason={ws.shareDisabledReason}
        runReport={ws.run}
        onBack={goBack}
        onOpenClip={(key) => editClips(key)}
        preRoll={ws.preRoll}
        postRoll={ws.postRoll}
        localVideoPath={ws.localVideoPath}
        autoOpenShare={!!state.share}
        onAutoShared={clearShare}
        addClips={addClips}
        patchClip={isReportClips(ws.playlist) ? ws.patchClip : undefined}
        onDeleteReport={deleteThis}
      />
    </Page>
  );
}
