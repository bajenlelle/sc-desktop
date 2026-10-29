import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { FileText, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/search-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { GroupedList } from "@/components/ui/group";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/empty-state";
import { Page, PageContent } from "@/components/shell/page";
import { Toolbar } from "@/components/shell/toolbar";
import { useAuth } from "@/lib/auth-context";
import { trackEvent } from "@/lib/analytics";
import { relativeTime } from "@/lib/format-date";
import { reportBaseUrl } from "@/lib/scouting-report";
import { revokeScoutingReport } from "@/lib/scouting-reports-db";
import { useReportList } from "@/lib/use-report-list";
import { cn } from "@/lib/utils";
import { APP_OPEN_HASH, openedLabel, scoutingReportUrl } from "@scoutable/shared/lib/scouting-reports-db";
import {
  filterReportList,
  reportStatusLabel,
  type ReportListFilter,
  type ReportListItem,
} from "@scoutable/shared/lib/scouting-report-list";

type RowAction = "open" | "copy" | "browser" | "stop" | "share_again" | "show_clips";

/** A row's menu, the same in the ⋯ button and on right-click: what can be done depends on where the report stands. */
function rowActions(item: ReportListItem): (RowAction | "-")[] {
  switch (item.status) {
    case "live":
      return ["open", "copy", "browser", "-", "show_clips", "-", "stop"];
    case "expired":
    case "stopped":
      return ["open", "share_again", "-", "show_clips"];
    case "draft":
      return ["open", "show_clips"];
  }
}

const ACTION_LABEL: Record<RowAction, string> = {
  open: "Open report",
  copy: "Copy link",
  browser: "Open in browser",
  stop: "Stop sharing…",
  share_again: "Share again…",
  show_clips: "Show clips",
};

/**
 * Every scouting report the coach has in this space, shared or still a draft
 * (lib/scouting-report-list.ts). A row opens its playlist's Report view; its
 * menu copies or opens the link, stops it, or shares an ended one again.
 */
export function ReportsPage() {
  const { activeOrgId, activeOrgRole, activeOrgIsPersonal, profileLoading } = useAuth();
  const navigate = useNavigate();
  const canAccess = activeOrgIsPersonal || activeOrgRole === "coach" || activeOrgRole === "admin";
  const { state, reload } = useReportList();
  const [filter, setFilter] = useState<ReportListFilter>("all");
  const [search, setSearch] = useState("");
  const [stopTarget, setStopTarget] = useState<ReportListItem | null>(null);
  const [stopping, setStopping] = useState(false);

  useEffect(() => {
    if (profileLoading) return;
    if (activeOrgId && !canAccess) navigate("/my-playlists", { replace: true });
  }, [activeOrgId, canAccess, profileLoading, navigate]);

  const items = state.kind === "ready" ? state.items : [];
  const counts = useMemo(
    () => ({
      all: items.length,
      shared: items.filter((i) => i.status !== "draft").length,
      drafts: items.filter((i) => i.status === "draft").length,
    }),
    [items],
  );
  const visible = useMemo(() => filterReportList(items, filter, search), [items, filter, search]);

  if (!profileLoading && !canAccess) return null;

  function act(item: ReportListItem, action: RowAction) {
    if (action !== "stop") trackEvent("scouting_report_list_action", { action, status: item.status });
    const url = item.reportId ? scoutingReportUrl(reportBaseUrl(), item.reportId) : null;
    switch (action) {
      case "open":
        navigate("/playlists", { state: { restore: { playlistId: item.playlistId }, view: "report" } });
        break;
      case "share_again":
        navigate("/playlists", { state: { restore: { playlistId: item.playlistId }, view: "report", share: true } });
        break;
      case "show_clips":
        navigate("/playlists", { state: { restore: { playlistId: item.playlistId } } });
        break;
      case "copy":
        if (url) void navigator.clipboard.writeText(url).then(() => toast("Link copied"));
        break;
      case "browser":
        if (url) void openUrl(`${url}${APP_OPEN_HASH}`);
        break;
      case "stop":
        setStopTarget(item);
        break;
    }
  }

  async function confirmStop() {
    if (!stopTarget?.reportId) return;
    setStopping(true);
    try {
      await revokeScoutingReport(stopTarget.reportId);
      trackEvent("scouting_report_list_action", { action: "stop", status: stopTarget.status });
      trackEvent("scouting_report_revoked", { via: "list" });
      toast("Report is no longer shared");
      setStopTarget(null);
      reload();
    } catch {
      toast.error("Couldn’t stop sharing. Try again.");
    } finally {
      setStopping(false);
    }
  }

  const goToPlaylists = (
    <Button size="sm" variant="outline" onClick={() => navigate("/playlists")}>
      Go to Playlists
    </Button>
  );

  return (
    <Page>
      <Toolbar
        title="Reports"
        subtitle={counts.all > 0 ? `${counts.all} ${counts.all === 1 ? "report" : "reports"}` : undefined}
        principal={
          counts.all > 0 ? (
            <SegmentedControl
              aria-label="Show"
              value={filter}
              onValueChange={setFilter}
              options={[
                { value: "all", label: <>All <span className="opacity-60 nums">{counts.all}</span></> },
                { value: "shared", label: <>Shared <span className="opacity-60 nums">{counts.shared}</span></> },
                { value: "drafts", label: <>Drafts <span className="opacity-60 nums">{counts.drafts}</span></> },
              ]}
            />
          ) : undefined
        }
        search={
          counts.all > 0 ? (
            <SearchField
              placeholder="Search reports"
              aria-label="Search reports"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          ) : undefined
        }
      />
      <PageContent width="medium">
        {state.kind === "loading" ? (
          <GroupedList>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex min-h-14 items-center gap-3 px-4 py-2">
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-1/3 animate-pulse rounded bg-fill-3" />
                  <div className="h-2.5 w-1/2 animate-pulse rounded bg-fill-2" />
                </div>
              </div>
            ))}
          </GroupedList>
        ) : state.kind === "error" ? (
          <EmptyState
            title="Couldn’t load your reports"
            body="Check your connection and try again."
            action={
              <Button size="sm" variant="outline" onClick={reload}>
                Try again
              </Button>
            }
          />
        ) : counts.all === 0 ? (
          <EmptyState
            icon={<FileText />}
            title="No reports yet"
            body={
              activeOrgIsPersonal
                ? "Open a playlist and switch to Report to build one."
                : "Your reports from this club’s playlists show up here. Open a playlist and switch to Report to build one."
            }
            action={goToPlaylists}
          />
        ) : visible.length === 0 ? (
          <EmptyState
            title="No reports match"
            body={search.trim() ? "Try a different title or playlist name." : "Nothing here with this filter."}
            action={
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setFilter("all");
                  setSearch("");
                }}
              >
                Show all reports
              </Button>
            }
          />
        ) : (
          <GroupedList>
            {visible.map((item) => (
              <ReportRow key={item.playlistId} item={item} onAction={(a) => act(item, a)} />
            ))}
          </GroupedList>
        )}
      </PageContent>

      <Dialog open={!!stopTarget} onOpenChange={(o) => !o && !stopping && setStopTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Stop sharing “{stopTarget?.title}”?</DialogTitle>
            <DialogDescription>The link stops working right away. You can share again with a new link.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" disabled={stopping} onClick={() => setStopTarget(null)}>
              Keep sharing
            </Button>
            <Button variant="destructive" size="sm" disabled={stopping} onClick={() => void confirmStop()}>
              {stopping ? "Stopping…" : "Stop sharing"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  );
}

function ReportRow({ item, onAction }: { item: ReportListItem; onAction: (a: RowAction) => void }) {
  // What the report holds goes in the meta line; the trailing column is only
  // ever how often it was opened, so it reads the same on every row.
  const players =
    item.players > 0
      ? `${item.players} ${item.players === 1 ? "player" : "players"}`
      : item.status === "draft"
        ? "no players yet"
        : null;
  const meta = [
    reportStatusLabel(item),
    item.status === "draft" ? `edited ${relativeTime(item.changedAt)}` : null,
    players,
    item.playlistName !== item.title ? item.playlistName : null,
  ]
    .filter(Boolean)
    .join(" · ");
  // A draft has no link yet, so nothing to have been opened.
  const trailing = item.status === "draft" ? null : openedLabel(item.opens);
  const actions = rowActions(item);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="flex min-h-14 items-center gap-3 py-2 pr-3 pl-4">
          <button
            type="button"
            onClick={() => onAction("open")}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-selection"
          >
            <span
              aria-hidden
              className={cn(
                "size-2 shrink-0 rounded-full",
                item.status === "live" ? "bg-success" : item.status === "draft" ? "border border-separator" : "bg-fill-3",
              )}
            />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium">{item.title}</span>
              <span className="truncate text-callout text-muted-foreground nums">{meta}</span>
            </span>
            {trailing && <span className="shrink-0 text-callout text-muted-foreground nums">{trailing}</span>}
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-xs" variant="ghost" aria-label={`More for ${item.title}`} className="shrink-0">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {actions.map((a, i) =>
                a === "-" ? (
                  <DropdownMenuSeparator key={i} />
                ) : (
                  <DropdownMenuItem key={a} className={a === "stop" ? "text-destructive focus:text-destructive" : undefined} onSelect={() => onAction(a)}>
                    {ACTION_LABEL[a]}
                  </DropdownMenuItem>
                ),
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {actions.map((a, i) =>
          a === "-" ? (
            <ContextMenuSeparator key={i} />
          ) : (
            <ContextMenuItem key={a} className={a === "stop" ? "text-destructive focus:text-destructive" : undefined} onSelect={() => onAction(a)}>
              {ACTION_LABEL[a]}
            </ContextMenuItem>
          ),
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
