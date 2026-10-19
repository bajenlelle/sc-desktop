"use client";

import * as React from "react";
import Link from "next/link";
import { MessageSquare, Play, Trash2 } from "lucide-react";
import type { GroupRunInfo } from "@scoutable/shared/lib/clip-groups";
import { eventColors, eventLabel, formatGameClock, periodLabel, playerName } from "@scoutable/shared/lib/events";
import type { Label } from "@scoutable/shared/types/labels";
import type { PlaylistClipItem } from "@scoutable/shared/types/match";
import { LabelChips } from "@/components/labels/label-chip";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { availabilityNotice, type EditorRow } from "./editor-rows";
import { ActiveRowPill, DragGrip, FocusRing, GroupPill, REVEAL, RowLead, RowMenu, rowClasses, type RowDragProps, type RowPopover } from "./row-parts";

/** The menu's sections, each a list of items or nothing, with a line between the ones that have any. */
export function MenuSections({ sections }: { sections: React.ReactNode[][] }) {
  const shown = sections.map((items) => items.filter(Boolean)).filter((items) => items.length > 0);
  return (
    <>
      {shown.map((items, i) => (
        <React.Fragment key={i}>
          {i > 0 && <DropdownMenuSeparator />}
          {items}
        </React.Fragment>
      ))}
    </>
  );
}

/**
 * One clip in the editor's list: the event and player with the clip's
 * labels beside them, then period, clock, team and (in multi-game
 * playlists) the game; a ± mark when its ends were trimmed, a glyph when it
 * carries a note; Remove on hover and a ⋯ menu that a right-click opens too.
 * A group's first row carries the group's pill. A clip that can't play (its
 * game has no cloud copy yet) sits greyed with the reason and the way to fix
 * it.
 */
export function EditorClipRow({
  domId,
  row,
  index,
  isActive,
  focused,
  isMultiMatch,
  isSelected,
  anySelected,
  menuOpen,
  onMenuOpenChange,
  menuPopover,
  onSelect,
  onClick,
  drag,
  onTrim,
  onFixSync,
  onInsertTextCardAbove,
  onInsertStatsCardAbove,
  onLabels,
  onAddTo,
  onGroupSelection,
  selectionCount = 0,
  onUngroup,
  onRemove,
  labels,
  groupPos,
  groupSize,
}: {
  /** The row's id, for the grid's aria-activedescendant. */
  domId: string;
  row: EditorRow & { item: PlaylistClipItem };
  index: number;
  isActive: boolean;
  /** Keyboard focus is on this row and the ring is showing. */
  focused: boolean;
  isMultiMatch: boolean;
  isSelected: boolean;
  anySelected: boolean;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  /** The labels picker or Add to, opened from the menu, anchored to its button. */
  menuPopover?: RowPopover;
  /** The checkbox: a tick, or with Shift the range from the anchor. */
  onSelect: (e: React.MouseEvent) => void;
  /** The row: plain plays it, ⌘ ticks it, Shift ticks the range. */
  onClick: (e: React.MouseEvent) => void;
  drag: RowDragProps;
  /** Opens the clip for trimming; absent when it can't play. */
  onTrim?: () => void;
  /** Finds where the play really is and moves the game's sync to it; absent without a ready copy. */
  onFixSync?: () => void;
  onInsertTextCardAbove: () => void;
  /** Absent when the clip's game has no stats or its play no player. */
  onInsertStatsCardAbove?: () => void;
  /** Opens the labels picker on this clip. */
  onLabels?: () => void;
  /** Opens "Add to playlist" for this clip. */
  onAddTo?: () => void;
  /** Present while this row is in a selection that can be grouped. */
  onGroupSelection?: () => void;
  selectionCount?: number;
  /** Present on a grouped row. */
  onUngroup?: () => void;
  onRemove: () => void;
  /** The clip's labels in this playlist. */
  labels?: readonly Label[];
  groupPos?: GroupRunInfo["pos"];
  groupSize?: number;
}) {
  const { item, event, availability } = row;
  const colors = event ? eventColors(event) : null;
  const preOffset = item.preRollOffset ?? 0;
  const postOffset = item.postRollOffset ?? 0;
  const secondary = isSelected ? "text-selection-foreground/80" : "text-muted-foreground";
  const notice = availabilityNotice(availability, item.matchId);
  const dimmed = availability !== "ready";

  return (
    <div
      id={domId}
      role="row"
      data-row-key={drag.rowKey}
      data-row-index={index}
      data-focused={focused || undefined}
      aria-selected={isSelected}
      className={rowClasses({ isSelected, dimmed })}
      onClick={onClick}
      onMouseDown={(e) => {
        if (e.shiftKey) e.preventDefault();
      }}
      onPointerDown={drag.onPointerDown}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenuOpenChange(true);
      }}
    >
      {isActive && !isSelected && <ActiveRowPill />}
      {focused && <FocusRing onSelection={isSelected} />}
      <div className={cn("relative z-10 w-[3px] shrink-0 self-stretch", colors?.strip ?? "bg-fill-3", dimmed && "opacity-60")} aria-hidden />
      <RowLead groupPos={groupPos} isSelected={isSelected} showCheckbox={anySelected} onSelect={onSelect} />

      <div role="gridcell" className={cn("relative z-10 flex min-w-0 flex-1 flex-col justify-center py-1.5", dimmed && "opacity-70")}>
        <div className="flex min-w-0 items-center gap-1.5">
          {(groupPos === "first" || groupPos === "only") && groupSize && <GroupPill size={groupSize} isSelected={isSelected} onUngroup={onUngroup} />}
          {event ? (
            <>
              <span className={cn("inline-flex shrink-0 items-center rounded-full px-2 py-px text-[11px] font-medium pointer-coarse:text-xs", colors?.badge)}>
                {eventLabel(event)}
              </span>
              <span className={cn("truncate text-sm font-medium", labels && labels.length > 0 && "@min-[26rem]:min-w-16")}>{playerName(event)}</span>
            </>
          ) : (
            <span className={cn("truncate text-sm", secondary)}>Play #{item.eventId}</span>
          )}
          {/* Beside the name when the list is wide (the desktop's place); on the line below in a narrow one. */}
          {labels && labels.length > 0 && (
            <span className="hidden min-w-0 items-center gap-1.5 @min-[26rem]:flex">
              <LabelChips labels={labels} overflowClassName={secondary} />
            </span>
          )}
        </div>
        <div className={cn("flex min-w-0 items-center gap-1 text-subheadline nums", secondary)}>
          {event && (
            <>
              <span className="shrink-0">{periodLabel(event.period)}</span>
              <span aria-hidden>·</span>
              <span className="shrink-0">{formatGameClock(event.gameClockTime)}</span>
              {event.eventTeam?.teamName && (
                <>
                  <span aria-hidden>·</span>
                  <span className="truncate">{event.eventTeam.teamName}</span>
                </>
              )}
            </>
          )}
          {(isMultiMatch || !event) && row.matchTitle && (
            <>
              {event && <span aria-hidden>·</span>}
              <span className="truncate">{row.matchTitle}</span>
            </>
          )}
          {labels && labels.length > 0 && (
            <span className="ml-1 flex min-w-0 items-center gap-1 @min-[26rem]:hidden">
              <LabelChips labels={labels} max={1} overflowClassName={secondary} />
            </span>
          )}
        </div>
        {notice && (
          <div className={cn("mt-0.5 flex min-w-0 items-center gap-1 text-subheadline", isSelected ? "text-selection-foreground/80" : "text-warning")}>
            <span className="truncate">{notice.text}</span>
            {notice.action && (
              <>
                <span aria-hidden>·</span>
                <Link
                  href={notice.action.href}
                  data-no-drag
                  onClick={(e) => e.stopPropagation()}
                  className="shrink-0 font-medium underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-selection"
                >
                  {notice.action.label}
                </Link>
              </>
            )}
          </div>
        )}
      </div>

      <div className="relative z-10 flex shrink-0 items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
        {isActive && <Play className={cn("mr-1 size-3.5 fill-current", isSelected ? "text-selection-foreground" : "text-primary")} />}
        {(preOffset !== 0 || postOffset !== 0) && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className={cn("text-caption", isSelected ? "text-selection-foreground/80" : "text-orange-400")} aria-label="Trimmed">
                ±
              </span>
            </TooltipTrigger>
            <TooltipContent>
              Trimmed: {preOffset >= 0 ? "+" : ""}
              {preOffset} s before, {postOffset >= 0 ? "+" : ""}
              {postOffset} s after
            </TooltipContent>
          </Tooltip>
        )}
        {item.note && (
          <Tooltip>
            <TooltipTrigger asChild>
              <MessageSquare className={cn("size-3 shrink-0", isSelected ? "text-selection-foreground/80" : "text-primary/60")} aria-label="Has a note" />
            </TooltipTrigger>
            <TooltipContent className="max-w-56 whitespace-pre-wrap">{item.note}</TooltipContent>
          </Tooltip>
        )}
        <button
          type="button"
          className={cn(
            "flex size-6 items-center justify-center rounded-md outline-none transition-[opacity,background-color,transform] duration-100 active:scale-95 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-selection pointer-coarse:hidden",
            isSelected ? "hover:bg-white/15" : "hover:bg-destructive/10 hover:text-destructive",
            REVEAL,
          )}
          onClick={onRemove}
          aria-label="Remove from playlist"
          title="Remove from playlist"
        >
          <Trash2 className="size-3.5" />
        </button>
        <RowMenu open={menuOpen} onOpenChange={onMenuOpenChange} isSelected={isSelected} popover={menuPopover}>
          <MenuSections
            sections={[
              [
                onTrim && (
                  <DropdownMenuItem key="trim" onSelect={onTrim}>
                    Trim clip…
                  </DropdownMenuItem>
                ),
                onFixSync && (
                  <DropdownMenuItem key="sync" onSelect={onFixSync}>
                    Fix sync…
                  </DropdownMenuItem>
                ),
              ],
              [
                onLabels && (
                  <DropdownMenuItem key="labels" onSelect={onLabels}>
                    Labels…
                  </DropdownMenuItem>
                ),
                onAddTo && (
                  <DropdownMenuItem key="add-to" onSelect={onAddTo}>
                    Add to playlist…
                  </DropdownMenuItem>
                ),
              ],
              [
                <DropdownMenuItem key="text" onSelect={onInsertTextCardAbove}>
                  Insert text card above
                </DropdownMenuItem>,
                onInsertStatsCardAbove && (
                  <DropdownMenuItem key="stats" onSelect={onInsertStatsCardAbove}>
                    Insert stats card above
                  </DropdownMenuItem>
                ),
              ],
              [
                onGroupSelection && (
                  <DropdownMenuItem key="group" onSelect={onGroupSelection}>
                    Group {selectionCount} selected items
                  </DropdownMenuItem>
                ),
                onUngroup && groupSize && (
                  <DropdownMenuItem key="ungroup" onSelect={onUngroup}>
                    Ungroup ({groupSize} items)
                  </DropdownMenuItem>
                ),
              ],
              [
                <DropdownMenuItem key="remove" onSelect={onRemove} className="text-destructive focus:bg-destructive focus:text-white">
                  <Trash2 />
                  Remove from playlist
                </DropdownMenuItem>,
              ],
            ]}
          />
        </RowMenu>
        <DragGrip isSelected={isSelected} />
      </div>
    </div>
  );
}
