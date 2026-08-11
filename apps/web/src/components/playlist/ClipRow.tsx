import { Check, MessageSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  eventColors,
  eventLabel,
  formatGameClock,
  periodLabel,
  playerName,
} from "@scoutable/shared/lib/events";
import type { PlayByPlayEvent } from "@scoutable/shared/types/match";

export interface ClipRowProps {
  event: PlayByPlayEvent;
  /** Opponent / match title, shown so multi-game playlists stay legible. */
  matchTitle?: string;
  matchDate?: string;
  /** The coach's note on this clip — the actual coaching, so it leads. */
  note?: string;
  /** False when the clip has no exported file and can't play on web. */
  playable: boolean;
  watched: boolean;
  active: boolean;
  onSelect: () => void;
}

/**
 * One clip in a player's playlist.
 *
 * Shared by /my-playlists and /view/[playlistId] — those two previously held
 * near-identical copies of this markup, so keeping one component is what
 * stops them drifting apart again.
 */
export function ClipRow({
  event,
  matchTitle,
  matchDate,
  note,
  playable,
  watched,
  active,
  onSelect,
}: ClipRowProps) {
  const colors = eventColors(event);

  const context = [
    event.period ? periodLabel(event.period) : null,
    formatGameClock(event.gameClockTime),
    matchTitle,
    matchDate ? new Date(matchDate).toLocaleDateString("sv-SE") : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <button
      type="button"
      onClick={playable ? onSelect : undefined}
      disabled={!playable}
      className={cn(
        // 56px floor keeps this a comfortable touch target on a phone.
        "flex w-full min-h-[56px] items-stretch gap-0 text-left transition-colors",
        playable ? "active:bg-muted/70 lg:hover:bg-muted/50" : "opacity-50 cursor-not-allowed",
        active && "bg-primary/10",
      )}
    >
      {/* Event colour rail — makes a long list scannable at a glance. */}
      <span className={cn("w-1 shrink-0", colors.strip)} aria-hidden />

      <span className="flex flex-1 flex-col gap-1 min-w-0 px-3 py-2.5">
        <span className="flex items-center gap-2 min-w-0">
          {watched ? (
            <Check className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Watched" />
          ) : (
            <span className="w-3.5 shrink-0" aria-hidden />
          )}
          <span
            className={cn(
              "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium",
              colors.badge,
            )}
          >
            {eventLabel(event)}
          </span>
          <span className="truncate text-sm text-foreground">{playerName(event)}</span>
        </span>

        {context && (
          <span className="pl-[22px] text-xs text-muted-foreground truncate">{context}</span>
        )}

        {note && (
          <span className="flex items-start gap-1.5 pl-[22px] text-xs text-foreground/80">
            <MessageSquare className="mt-0.5 h-3 w-3 shrink-0 text-primary/70" aria-hidden />
            <span className="line-clamp-2">{note}</span>
          </span>
        )}
      </span>

      {!playable && (
        <span className="flex items-center pr-3">
          <Badge variant="outline" className="text-xs shrink-0">Not on web</Badge>
        </span>
      )}
    </button>
  );
}
