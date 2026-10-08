import { Link } from "react-router-dom";
import { Trash2, ChevronRight, VideoOff } from "lucide-react";
import { DeleteMatchDialog } from "@/components/delete-match-dialog";
import type { VideoFileStatus } from "@/lib/video-probe";
import type { StoredMatch } from "@/types/match";

/**
 * One game in a grouped list: title on the first line, teams, date and clip
 * count on the second, the team colours as a thin bar. Fills on hover,
 * presses on pointer-down, focusable from the keyboard.
 */
export function MatchRow({
  match,
  onDelete,
  videoStatus,
}: {
  match: StoredMatch;
  onDelete?: () => void;
  /** From probeMatches — undefined while probing (no badge until known). */
  videoStatus?: VideoFileStatus;
}) {
  const date = new Date(match.date).toLocaleDateString("sv-SE", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  return (
    <Link
      to={`/matches/${match.id}`}
      className="group flex min-h-11 items-center gap-3 px-4 py-2 outline-none transition-colors duration-100 hover:bg-fill-1 active:bg-fill-2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-selection"
    >
      {/* Team colours */}
      <div className="flex w-[3px] shrink-0 flex-col gap-px self-stretch overflow-hidden rounded-full">
        <div className="flex-1" style={{ backgroundColor: match.homeTeam.color }} />
        <div className="flex-1" style={{ backgroundColor: match.awayTeam.color }} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{match.title}</span>
          {match.isDemo && (
            <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-px text-caption text-primary">
              Sample game
            </span>
          )}
        </div>
        <div className="truncate text-subheadline nums text-muted-foreground">
          {match.homeTeam.name} – {match.awayTeam.name} · {date} · {match.events.length} clips
        </div>
      </div>

      {/* Missing-video indicator (moved/renamed file, or a machine switch) */}
      {videoStatus && videoStatus !== "ok" && (
        <span
          className="flex shrink-0 items-center gap-1 text-callout text-amber-600 dark:text-amber-400"
          title={
            videoStatus === "unreadable"
              ? "Scoutable doesn't have permission to read this video — pick it again to grant access"
              : "The video file may have been moved or renamed, or it's on another computer — open the game to locate it"
          }
        >
          <VideoOff className="size-3.5" />
          Video file not found
        </span>
      )}

      {match.syncPoint && (
        <span className="flex shrink-0 items-center gap-1.5 text-callout text-muted-foreground">
          <span className="size-1.5 rounded-full bg-emerald-500" />
          Synced
        </span>
      )}

      {/* Delete — hover-reveal, stops navigation */}
      {onDelete && (
        <div onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
          <DeleteMatchDialog
            matchId={match.id}
            matchTitle={match.title}
            isDemo={match.isDemo}
            trigger={
              <button
                type="button"
                className="flex size-7 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-[opacity,background-color,color] duration-100 group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 active:scale-95"
                title="Delete game"
              >
                <Trash2 className="size-4" />
              </button>
            }
            onDeleted={onDelete}
          />
        </div>
      )}

      <ChevronRight className="size-4 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-muted-foreground" />
    </Link>
  );
}
