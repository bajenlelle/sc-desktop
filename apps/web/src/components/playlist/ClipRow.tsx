"use client";

import { motion } from "framer-motion";
import { Check, MessageSquare, Play, Type } from "lucide-react";
import { eventColors, eventLabel, formatGameClock, playerName } from "@scoutable/shared/lib/events";
import type { PlayByPlayEvent, PlaylistTextCard } from "@scoutable/shared/types/match";
import { pressable } from "@/lib/pressable";
import { springs } from "@/lib/motion";
import { cn } from "@/lib/utils";

const rowClass =
  "group relative flex min-h-11 w-full cursor-default select-none items-stretch gap-2 pr-3 text-left outline-none transition-colors duration-100 hover:bg-fill-1 active:bg-fill-2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-selection pointer-coarse:min-h-14";

/**
 * The one highlight that follows the playing item: a single element that
 * springs from row to row rather than a class that appears and vanishes.
 */
function ActiveRowPill() {
  return (
    <motion.div
      layoutId="active-row"
      transition={springs.standard}
      aria-hidden
      className="pointer-events-none absolute inset-y-0.5 inset-x-1 rounded-md bg-primary/12"
    />
  );
}

// Rows are pressable divs, not <button>s, so long names truncate (see
// pressable.ts). Space stays play/pause; Return plays the row.

/**
 * One clip in a recipient's playlist: the event and player, then period,
 * clock, team and (in multi-game playlists) the game; whether it has been
 * watched, and the coach's note. The playing row carries the springing
 * highlight. Stacked under the player (narrower than the watch view's
 * side-by-side width) the row is what says what's playing, so it shows the
 * note in full; side by side, the note shows under the player and the row
 * only marks that there is one.
 */
export function WatchClipRow({
  rowKey,
  event,
  matchTitle,
  note,
  watched,
  active,
  onPlay,
}: {
  rowKey: string;
  event: PlayByPlayEvent;
  /** Shown in multi-game playlists only. */
  matchTitle?: string;
  note?: string;
  watched: boolean;
  active: boolean;
  onPlay: () => void;
}) {
  const colors = eventColors(event);
  return (
    <div {...pressable(onPlay, { space: false })} data-row-key={rowKey} aria-current={active || undefined} className={rowClass}>
      {active && <ActiveRowPill />}
      <span className={cn("relative z-10 w-[3px] shrink-0 self-stretch", colors.strip)} aria-hidden />
      <span className="relative z-10 flex min-w-0 flex-1 flex-col justify-center py-1.5 pl-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className={cn("inline-flex shrink-0 items-center rounded-full px-2 py-px text-[11px] font-medium pointer-coarse:text-xs", colors.badge)}>
            {eventLabel(event)}
          </span>
          <span className="truncate text-sm font-medium">{playerName(event)}</span>
        </span>
        <span className="flex min-w-0 items-center gap-1 text-subheadline text-muted-foreground nums">
          <span className="shrink-0">Q{event.period}</span>
          <span aria-hidden>·</span>
          <span className="shrink-0">{formatGameClock(event.gameClockTime)}</span>
          {event.eventTeam?.teamName && (
            <>
              <span aria-hidden>·</span>
              <span className="truncate">{event.eventTeam.teamName}</span>
            </>
          )}
          {matchTitle && (
            <>
              <span aria-hidden>·</span>
              <span className="truncate">{matchTitle}</span>
            </>
          )}
        </span>
        {note && (
          <span className="mt-1 flex min-w-0 items-start gap-1.5 text-subheadline text-foreground/80 @min-[860px]/watch:hidden">
            <MessageSquare aria-hidden className="mt-[3px] size-3.5 shrink-0 text-primary/70" />
            <span className="sr-only">Note from your coach:</span>
            <span className="min-w-0 whitespace-pre-wrap break-words">{note}</span>
          </span>
        )}
      </span>
      <span className="relative z-10 flex shrink-0 items-center gap-1.5">
        {note && (
          <MessageSquare aria-label="Note from your coach" className="hidden size-3.5 text-primary/70 @min-[860px]/watch:block" />
        )}
        {active ? (
          <Play aria-label="Playing" className="size-3.5 fill-current text-primary" />
        ) : watched ? (
          <Check aria-label="Watched" className="size-3.5 text-muted-foreground" />
        ) : (
          <span className="size-3.5" aria-hidden />
        )}
      </span>
    </div>
  );
}

export function WatchTextCardRow({
  rowKey,
  card,
  active,
  onPlay,
}: {
  rowKey: string;
  card: PlaylistTextCard;
  active: boolean;
  onPlay: () => void;
}) {
  return (
    <div {...pressable(onPlay, { space: false })} data-row-key={rowKey} aria-current={active || undefined} className={rowClass}>
      {active && <ActiveRowPill />}
      <span className="relative z-10 w-[3px] shrink-0 self-stretch bg-fill-3" aria-hidden />
      <span className="relative z-10 flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-1">
        <Type className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate text-sm italic text-muted-foreground">{card.text || "Text card"}</span>
      </span>
      {active && (
        <span className="relative z-10 flex shrink-0 items-center">
          <Play aria-label="Showing" className="size-3.5 fill-current text-primary" />
        </span>
      )}
    </div>
  );
}
