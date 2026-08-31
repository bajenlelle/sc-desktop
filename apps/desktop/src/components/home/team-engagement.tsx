/**
 * Home-page roll-up of the Shared-by-me dashboard: the coach's standing
 * question ("who's behind?") answered without leaving Home. Same three-card
 * strip as SharedByMe.tsx; the full dashboard is the coach's default tab on
 * /my-playlists.
 */
import { Link } from "react-router-dom";
import { Loader2, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { DashboardSummary } from "@scoutable/shared/lib/shared-by-me";

export function TeamEngagement({
  summary,
  onRemindAll,
  remindingAll,
}: {
  summary: DashboardSummary;
  onRemindAll: () => void;
  remindingAll: boolean;
}) {
  if (summary.playlists === 0) return null;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">Team engagement</h2>
        <Link to="/my-playlists">
          <Button variant="ghost" size="sm" className="text-primary">
            Open dashboard
          </Button>
        </Link>
      </div>
      <div className="flex items-stretch gap-2">
        <div className="flex flex-1 flex-col justify-center rounded-lg border border-border bg-card px-3 py-2">
          <span className="text-lg font-semibold tabular-nums text-foreground">
            {summary.playlists}
          </span>
          <span className="text-xs text-muted-foreground">
            playlist{summary.playlists === 1 ? "" : "s"} shared
          </span>
        </div>
        <div className="flex flex-1 flex-col justify-center rounded-lg border border-border bg-card px-3 py-2">
          <span className="text-lg font-semibold tabular-nums text-foreground">
            {summary.recipients}
          </span>
          <span className="text-xs text-muted-foreground">
            player{summary.recipients === 1 ? "" : "s"} reached
          </span>
        </div>
        <div
          className={cn(
            "flex flex-1 items-center justify-between gap-2 rounded-lg border px-3 py-2",
            summary.behind > 0 ? "border-amber-500/40 bg-amber-500/5" : "border-border bg-card"
          )}
        >
          <div className="flex min-w-0 flex-col">
            <span
              className={cn(
                "text-lg font-semibold tabular-nums",
                summary.behind > 0 ? "text-amber-600 dark:text-amber-400" : "text-foreground"
              )}
            >
              {summary.behind}
            </span>
            <span className="text-xs text-muted-foreground">
              {summary.behind === 1 ? "player hasn't finished" : "players haven't finished"}
            </span>
          </div>
          {summary.behind > 0 && (
            <button
              type="button"
              onClick={onRemindAll}
              disabled={remindingAll}
              className="inline-flex min-h-[32px] shrink-0 items-center gap-1.5 rounded-md bg-amber-500/15 px-2.5 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-500/25 disabled:opacity-60 dark:text-amber-400"
            >
              {remindingAll ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
              Remind all
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
