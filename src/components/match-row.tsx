import { Link } from "react-router-dom";
import { Trash2, ChevronRight } from "lucide-react";
import { DeleteMatchDialog } from "@/components/delete-match-dialog";
import type { StoredMatch } from "@/types/match";

export function MatchRow({ match, onDelete }: { match: StoredMatch; onDelete?: () => void }) {
  return (
    <Link
      to={`/matches/${match.id}`}
      className="group flex items-center gap-4 px-4 py-3 transition-colors hover:bg-muted/50"
    >
      {/* Vertical team color accent */}
      <div className="flex w-1 shrink-0 flex-col gap-0.5 self-stretch overflow-hidden rounded-full">
        <div className="flex-1" style={{ backgroundColor: match.homeTeam.color }} />
        <div className="flex-1" style={{ backgroundColor: match.awayTeam.color }} />
      </div>

      {/* Title */}
      <div className="min-w-0 flex-1">
        <span className="truncate font-display text-sm font-bold tracking-wide">
          {match.title}
        </span>
      </div>

      {/* Teams */}
      <div className="hidden items-center gap-1.5 text-sm text-muted-foreground sm:flex shrink-0">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: match.homeTeam.color }} />
        <span className="font-display text-xs font-semibold text-foreground/70">{match.homeTeam.name}</span>
        <span className="text-xs text-muted-foreground/50">–</span>
        <span className="font-display text-xs font-semibold text-foreground/70">{match.awayTeam.name}</span>
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: match.awayTeam.color }} />
      </div>

      {/* Date */}
      <span className="hidden shrink-0 text-xs text-muted-foreground tabular-nums md:block">
        {new Date(match.date).toLocaleDateString("sv-SE", {
          year: "numeric",
          month: "short",
          day: "numeric",
        })}
      </span>

      {/* Clip count */}
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
        {match.events.length} clips
      </span>

      {/* Sync indicator */}
      {match.syncPoint && (
        <span className="flex shrink-0 items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Synced
        </span>
      )}

      {/* Delete — hover-reveal, stops navigation */}
      {onDelete && (
        <DeleteMatchDialog
          matchId={match.id}
          matchTitle={match.title}
          trigger={
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
              className="opacity-0 group-hover:opacity-100 transition-opacity rounded-md p-1.5 text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950"
              title="Delete game"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          }
          onDeleted={onDelete}
        />
      )}

      {/* Chevron — navigational affordance */}
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-muted-foreground" />
    </Link>
  );
}
