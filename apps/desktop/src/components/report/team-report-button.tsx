import { FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToolbarAction } from "@/components/shell/toolbar";
import type { TeamReportControl } from "@/lib/use-team-report";

const NEW_HINT = "Start a scouting report with their players and what stands out";

/**
 * New report / Open report for a team, in its page's toolbar: a quiet button
 * (no fill at rest) that keeps its label while the bar has room. While the
 * report is being made it shows a spinner and ignores presses.
 */
export function TeamReportToolbarButton({ control }: { control: TeamReportControl }) {
  const label = control.playlistId ? "Open report" : "New report";
  return (
    <ToolbarAction label={label}>
      {(compact) => (
        <Button
          variant="ghost"
          size={compact ? "icon-sm" : "sm"}
          onClick={control.openOrStart}
          disabled={control.busy || !control.ready}
          aria-label={compact ? label : undefined}
          title={compact || control.playlistId ? undefined : NEW_HINT}
        >
          {control.busy ? <Loader2 className="animate-spin" /> : <FileText />}
          {!compact && label}
        </Button>
      )}
    </ToolbarAction>
  );
}

/** The same, beside Teams' "Your next game". */
export function TeamReportButton({ control, className }: { control: TeamReportControl; className?: string }) {
  const label = control.playlistId ? "Open report" : "New report";
  return (
    <Button
      variant="ghost"
      size="sm"
      className={className}
      onClick={control.openOrStart}
      disabled={control.busy || !control.ready}
      title={control.playlistId ? undefined : NEW_HINT}
    >
      {control.busy ? <Loader2 className="animate-spin" /> : <FileText />}
      {label}
    </Button>
  );
}
