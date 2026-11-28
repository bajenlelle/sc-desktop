import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { NewReportPopover } from "@/components/report/new-report-popover";
import { reportPath, type ReportPageState } from "@/pages/report";
import { Page, PageContent } from "@/components/shell/page";
import { Toolbar } from "@/components/shell/toolbar";
import { useAuth } from "@/lib/auth-context";
import { trackEvent } from "@/lib/analytics";
import { relativeTime } from "@/lib/format-date";
import { reportBaseUrl } from "@/lib/scouting-report";
import { revokeScoutingReport } from "@/lib/scouting-reports-db";
import { deleteReport, renameReport } from "@/lib/team-report";
import { DeleteReportDialog } from "@/components/report/delete-report-dialog";
import { useReportList } from "@/lib/use-report-list";
import { cn } from "@/lib/utils";
import { APP_OPEN_HASH, openedLabel, scoutingReportUrl } from "@scoutable/shared/lib/scouting-reports-db";
import { REPORT_TITLE_MAX } from "@scoutable/shared/lib/report-draft";
import { listMyReportReach } from "@/lib/scouting-report-inbox-db";
import {
  filterReportList,
  reportStatusLabel,
  type ReportListFilter,
  type ReportListItem,
} from "@scoutable/shared/lib/scouting-report-list";

type RowAction = "open" | "rename" | "copy" | "browser" | "stop" | "share_again" | "show_clips" | "delete";

/**
 * A row's menu, the same in the ⋯ button and on right-click: what can be done depends on where the report
 * stands. A report that owns its clips has no playlist to show (its clips are in the report); one made on a
 * playlist the coach keeps shows it.
 */
function rowActions(item: ReportListItem): (RowAction | "-")[] {
  const clips: (RowAction | "-")[] = item.ownClips ? [] : ["-", "show_clips"];
  switch (item.status) {
    case "live":
      return ["open", "rename", "copy", "browser", ...clips, "-", "stop", "delete"];
    case "expired":
    case "stopped":
      return ["open", "rename", "share_again", ...clips, "-", "delete"];
    case "draft":
      return ["open", "rename", ...clips, "-", "delete"];
  }
}

const ACTION_LABEL: Record<RowAction, string> = {
  open: "Open report",
  rename: "Rename…",
  copy: "Copy link",
  browser: "Open in browser",
  stop: "Stop sharing…",
  share_again: "Share again…",
  show_clips: "Show clips",
  delete: "Delete report…",
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
  const [deleteTarget, setDeleteTarget] = useState<ReportListItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  // The row whose name is being typed, and names saved here before the list is read again.
  const [renaming, setRenaming] = useState<string | null>(null);
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());

  useEffect(() => {
    if (profileLoading) return;
    if (activeOrgId && !canAccess) navigate("/my-playlists", { replace: true });
  }, [activeOrgId, canAccess, profileLoading, navigate]);

  const items = state.kind === "ready" ? state.items : [];
  // Reports sent to players' phones say how many of those they reach opened them.
  const [reach, setReach] = useState<Map<string, { reached: number; opened: number }>>(new Map());
  useEffect(() => {
    if (state.kind !== "ready") return;
    let current = true;
    listMyReportReach()
      .then((m) => current && setReach(m))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [state]);
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
    if (action !== "stop" && action !== "delete") trackEvent("scouting_report_list_action", { action, status: item.status });
    const url = item.reportId ? scoutingReportUrl(reportBaseUrl(), item.reportId) : null;
    switch (action) {
      case "open":
        navigate(reportPath(item.playlistId), { state: {} satisfies ReportPageState });
        break;
      case "share_again":
        navigate(reportPath(item.playlistId), { state: { share: true } satisfies ReportPageState });
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
      case "delete":
        setDeleteTarget(item);
        break;
      case "rename":
        setRenaming(item.playlistId);
        break;
    }
  }

  // A report has one name (lib/team-report.ts, renameReport): the row shows it at once, and goes back if the write fails.
  function rename(item: ReportListItem, typed: string) {
    setRenaming(null);
    const name = typed.trim();
    if (!name || name === (names.get(item.playlistId) ?? item.title)) return;
    setNames((m) => new Map(m).set(item.playlistId, name));
    renameReport({ id: item.playlistId, kind: item.ownClips ? "report" : undefined }, name)
      .then(reload)
      .catch((e) => {
        console.error("[reports] couldn't rename the report:", e);
        setNames((m) => {
          const next = new Map(m);
          next.delete(item.playlistId);
          return next;
        });
        toast.error("Couldn’t rename the report. Check your connection and try again.");
      });
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteReport({
        playlistId: deleteTarget.playlistId,
        ownClips: deleteTarget.ownClips,
        liveReportId: deleteTarget.status === "live" ? deleteTarget.reportId : null,
      });
      trackEvent("scouting_report_list_action", { action: "delete", status: deleteTarget.status });
      toast("Report deleted");
      setDeleteTarget(null);
      reload();
    } catch {
      toast.error("Couldn’t delete the report. Try again.");
    } finally {
      setDeleting(false);
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


  return (
    <Page>
      <Toolbar
        title="Reports"
        subtitle={counts.all > 0 ? `${counts.all} ${counts.all === 1 ? "report" : "reports"}` : undefined}
        actions={counts.all > 0 ? <NewReportPopover /> : undefined}
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
                ? "Start one for your next opponent, with their players and what stands out filled in, or a blank one."
                : "Your reports from this club’s playlists show up here. Start one for your next opponent, with their players and what stands out filled in, or a blank one."
            }
            action={<NewReportPopover variant="default" />}
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
              <ReportRow
                key={item.playlistId}
                item={names.has(item.playlistId) ? { ...item, title: names.get(item.playlistId)! } : item}
                reach={item.reportId ? reach.get(item.reportId) : undefined}
                renaming={renaming === item.playlistId}
                onRename={(name) => (name === null ? setRenaming(null) : rename(item, name))}
                onAction={(a) => act(item, a)}
              />
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

      <DeleteReportDialog target={deleteTarget} deleting={deleting} onCancel={() => setDeleteTarget(null)} onConfirm={() => void confirmDelete()} />
    </Page>
  );
}

function ReportRow({
  item,
  reach,
  renaming,
  onRename,
  onAction,
}: {
  item: ReportListItem;
  /** The title is a field: Enter or leaving it saves, Esc puts it back (null). */
  renaming: boolean;
  onRename: (name: string | null) => void;
  /** For a report sent to players' phones: how many it reaches, and how many of them opened it. */
  reach?: { reached: number; opened: number };
  onAction: (a: RowAction) => void;
}) {
  // What the report holds goes in the meta line; the trailing column is only
  // ever how it was read (players who opened it, else opens of the link), so
  // it reads the same on every row.
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
  const trailing =
    item.status === "draft" ? null : reach && reach.reached > 0 ? `Seen by ${reach.opened} of ${reach.reached}` : openedLabel(item.opens);
  const actions = rowActions(item);
  // Rename… opens the name field once the menu has let go of the keyboard (a menu keeps focus inside it while
  // open), and the menu doesn't hand the keyboard back to its trigger.
  const toField = useRef(false);
  const choose = (a: RowAction) => {
    if (a === "rename") toField.current = true;
    else onAction(a);
  };
  const keepField = (e: Event) => {
    if (!toField.current) return;
    toField.current = false;
    e.preventDefault();
    onAction("rename");
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="flex min-h-14 items-center gap-3 py-2 pr-3 pl-4">
          <RowBody
            renaming={renaming}
            onOpen={() => onAction("open")}
          >
            <span
              aria-hidden
              className={cn(
                "size-2 shrink-0 rounded-full",
                item.status === "live" ? "bg-success" : item.status === "draft" ? "border border-separator" : "bg-fill-3",
              )}
            />
            <span className="flex min-w-0 flex-1 flex-col">
              {renaming ? <RenameField name={item.title} onDone={onRename} /> : <span className="truncate text-sm font-medium">{item.title}</span>}
              <span className="truncate text-callout text-muted-foreground nums">{meta}</span>
            </span>
            {trailing && <span className="shrink-0 text-callout text-muted-foreground nums">{trailing}</span>}
          </RowBody>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-xs" variant="ghost" aria-label={`More for ${item.title}`} className="shrink-0">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onCloseAutoFocus={keepField}>
              {actions.map((a, i) =>
                a === "-" ? (
                  <DropdownMenuSeparator key={i} />
                ) : (
                  <DropdownMenuItem key={a} className={a === "stop" || a === "delete" ? "text-destructive focus:text-destructive" : undefined} onSelect={() => choose(a)}>
                    {ACTION_LABEL[a]}
                  </DropdownMenuItem>
                ),
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent onCloseAutoFocus={keepField}>
        {actions.map((a, i) =>
          a === "-" ? (
            <ContextMenuSeparator key={i} />
          ) : (
            <ContextMenuItem key={a} className={a === "stop" || a === "delete" ? "text-destructive focus:text-destructive" : undefined} onSelect={() => choose(a)}>
              {ACTION_LABEL[a]}
            </ContextMenuItem>
          ),
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** A row's body: a button that opens the report, or, while its name is typed, a plain row (a field can't sit in a button). */
function RowBody({ renaming, onOpen, children }: { renaming: boolean; onOpen: () => void; children: ReactNode }) {
  const className = "flex min-w-0 flex-1 items-center gap-3 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-selection";
  if (renaming) return <div className={className}>{children}</div>;
  return (
    <button type="button" onClick={onOpen} className={className}>
      {children}
    </button>
  );
}

/** The row's name as a field, its text selected: Enter or leaving it saves, Esc puts it back. */
function RenameField({ name, onDone }: { name: string; onDone: (name: string | null) => void }) {
  const [value, setValue] = useState(name);
  const done = useRef(false);
  const finish = (v: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(v);
  };
  return (
    <input
      autoFocus
      aria-label="Report name"
      value={value}
      maxLength={REPORT_TITLE_MAX}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(value);
        if (e.key === "Escape") {
          e.stopPropagation();
          finish(null);
        }
      }}
      className="-mx-1 h-6 rounded-md bg-card px-1 text-sm font-medium text-foreground ring-2 ring-selection outline-none"
    />
  );
}
