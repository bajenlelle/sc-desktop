"use client";

import * as React from "react";
import { Check, Play } from "lucide-react";
import { eventColors, eventLabel, formatGameClock, periodLabel, playerName } from "@scoutable/shared/lib/events";
import type { PlayByPlayEvent } from "@scoutable/shared/types/match";
import { cn } from "@/lib/utils";

/**
 * One play in the add-clips picker: a tick box, the event badge and player,
 * then period, clock and team. A plain click plays it on the preview; ⌘ and
 * Shift tick it. A play already in the playlist shows a check and can't be
 * ticked again.
 */
export function AddClipsRow({
  rowKey,
  event,
  isSelected,
  alreadyIn,
  isActive,
  onToggle,
  onClick,
}: {
  rowKey: string;
  event: PlayByPlayEvent;
  isSelected: boolean;
  alreadyIn: boolean;
  isActive: boolean;
  /** The checkbox: a tick, or with Shift the range from the anchor. */
  onToggle: (e: React.MouseEvent) => void;
  /** The row: plain plays it, ⌘ ticks it, Shift ticks the range. */
  onClick: (e: React.MouseEvent) => void;
}) {
  const colors = eventColors(event);
  return (
    <div
      role="row"
      data-row-key={rowKey}
      aria-selected={isSelected}
      onClick={onClick}
      onMouseDown={(e) => {
        if (e.shiftKey) e.preventDefault();
      }}
      className={cn(
        "group relative flex min-h-10 cursor-default select-none items-stretch gap-1.5 pr-3 outline-none transition-colors duration-100 pointer-coarse:min-h-12",
        isActive ? "bg-primary/12" : isSelected ? "bg-primary/6 hover:bg-primary/10" : "hover:bg-fill-1 active:bg-fill-2",
        alreadyIn && "opacity-40",
      )}
    >
      <div className={cn("w-[3px] shrink-0 self-stretch", colors.strip)} aria-hidden />
      <div className="flex w-8 shrink-0 items-center justify-center pointer-coarse:w-10" onClick={(e) => e.stopPropagation()}>
        {alreadyIn ? (
          <Check className="size-3.5 text-muted-foreground" aria-label="Already in this playlist" />
        ) : (
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => {}}
            // No focus on press: a focused checkbox counts as a text field
            // for the panel's keys, and they would stop after a tick.
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation();
              onToggle(e);
            }}
            aria-label="Select"
            className="size-3.5 rounded accent-primary pointer-coarse:size-4"
          />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center py-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className={cn("inline-flex shrink-0 items-center rounded-full px-2 py-px text-[11px] font-medium pointer-coarse:text-xs", colors.badge)}>
            {eventLabel(event)}
          </span>
          <span className="truncate text-sm font-medium">{playerName(event)}</span>
        </div>
        <div className="flex min-w-0 items-center gap-1 text-subheadline text-muted-foreground nums">
          <span className="shrink-0">{periodLabel(event.period)}</span>
          <span aria-hidden>·</span>
          <span className="shrink-0">{formatGameClock(event.gameClockTime)}</span>
          {event.eventTeam?.teamName && (
            <>
              <span aria-hidden>·</span>
              <span className="truncate">{event.eventTeam.teamName}</span>
            </>
          )}
        </div>
      </div>
      {isActive && (
        <div className="flex shrink-0 items-center">
          <Play className="size-3.5 fill-current text-primary" aria-label="Playing" />
        </div>
      )}
    </div>
  );
}
