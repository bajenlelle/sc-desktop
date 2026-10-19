import { useState } from "react";
import { motion } from "framer-motion";
import { Link2, MessageSquare, Play, Tag, Trash2, Type, X } from "lucide-react";
import type { Label, LabelColor } from "@scoutable/shared/types/labels";
import { eventColors, eventLabel, formatGameClock, playerName } from "@scoutable/shared/lib/events";
import type { GroupRunInfo } from "@scoutable/shared/lib/clip-groups";
import type { PlayByPlayEvent, PlaylistTextCard } from "@/types/match";
import { LabelChip } from "@/components/labels/LabelChip";
import { LabelPickerPopover, type LabelTriState } from "@/components/labels/LabelPickerPopover";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Stepper } from "@/components/ui/stepper";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { springs } from "@/lib/motion";
import { cn } from "@/lib/utils";

export interface LabelRowControls {
  labels: Label[];
  assignedIds: Set<string>;
  onToggle: (labelId: string, state: LabelTriState) => Promise<void> | void;
  onCreate: (name: string, color: LabelColor) => Promise<Label>;
  onRename: (id: string, name: string) => Promise<void>;
  onRecolor: (id: string, color: LabelColor) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onSeedDefaults?: () => Promise<void>;
  scopeTitle?: string;
  scopeHint?: string;
}

/**
 * What a row needs to be lifted by the pointer engine (use-list-drag.ts):
 * its key, written to the DOM so the engine can find and measure it, and
 * the press that may become a drag. Shifts and the lifted card are the
 * engine's, applied straight to the elements.
 */
export interface RowDragProps {
  rowKey: string;
  onPointerDown: (e: React.PointerEvent) => void;
}

/**
 * The one highlight that follows the playing item: a single element that
 * springs from row to row rather than a class that appears and vanishes.
 */
export function ActiveRowPill() {
  return (
    <motion.div
      layoutId="active-row"
      transition={springs.standard}
      aria-hidden
      className="pointer-events-none absolute inset-y-0.5 inset-x-1 rounded-md bg-primary/12"
    />
  );
}

/**
 * Where the keys act while the list is driven from the keyboard: an inset
 * ring with the active pill's shape. Pointer users never see it.
 */
function FocusRing({ onSelection }: { onSelection: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-y-0.5 inset-x-1 z-20 rounded-md ring-2",
        onSelection ? "ring-selection-foreground/70" : "ring-selection",
      )}
    />
  );
}

/** Hover-only row buttons also show for the focused row and for keyboard focus. */
const REVEAL = "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 group-data-[focused]:opacity-100";

function GroupRail({ pos }: { pos: GroupRunInfo["pos"] }) {
  return (
    <span
      aria-hidden
      className={cn(
        "absolute left-1 w-[2px] rounded-full bg-primary/50",
        pos === "first" || pos === "only" ? "top-1.5" : "top-0",
        pos === "last" || pos === "only" ? "bottom-1.5" : "bottom-0",
      )}
    />
  );
}

function GroupPill({ size, onUngroup }: { size?: number; onUngroup?: () => void }) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-caption text-primary"
      title={`${size} items move together`}
    >
      <Link2 className="size-2.5" />
      {size}
      {onUngroup && (
        <button
          type="button"
          className="ml-0.5 rounded-full hover:bg-primary/20"
          title="Ungroup"
          onClick={(e) => {
            e.stopPropagation();
            onUngroup();
          }}
        >
          <X className="size-2.5" />
        </button>
      )}
    </span>
  );
}

function RowLead({
  groupPos,
  isSelected,
  showCheckbox,
  onSelect,
}: {
  groupPos?: GroupRunInfo["pos"];
  isSelected: boolean;
  showCheckbox: boolean;
  onSelect: (e: React.MouseEvent) => void;
}) {
  return (
    <div className="relative z-10 flex w-7 shrink-0 items-center justify-center" onClick={(e) => e.stopPropagation()}>
      {groupPos && <GroupRail pos={groupPos} />}
      <input
        type="checkbox"
        checked={isSelected}
        onChange={() => {}}
        onClick={onSelect}
        aria-label="Select"
        className={cn(
          "size-3.5 rounded accent-primary transition-opacity duration-100",
          showCheckbox || isSelected ? "opacity-100" : REVEAL,
        )}
      />
    </div>
  );
}

// The engine moves rows with transforms, so a row's own transition must
// leave `transform` alone (colors only).
const rowBase =
  "group relative flex min-h-11 cursor-default select-none items-stretch gap-1.5 pr-2 outline-none transition-colors duration-100";

function rowClasses({ isSelected }: { isSelected: boolean }) {
  return cn(rowBase, isSelected ? "bg-selection text-selection-foreground" : "hover:bg-fill-1 active:bg-fill-2");
}

export function ClipRow({
  domId,
  event,
  index,
  isActive,
  focused,
  isMultiMatch,
  matchTitle,
  preOffset,
  postOffset,
  note,
  isSelected,
  anySelected,
  onSelect,
  onClick,
  drag,
  onInsertTextCardAbove,
  onTrim,
  onRemove,
  labelControls,
  groupPos,
  groupSize,
  onUngroup,
  canGroupSelection,
  selectionCount,
  onGroupSelected,
}: {
  /** The row's id, for the grid's aria-activedescendant. */
  domId: string;
  event: PlayByPlayEvent;
  index: number;
  isActive: boolean;
  /** Keyboard focus is on this row and the ring is showing. */
  focused: boolean;
  isMultiMatch: boolean;
  matchTitle?: string;
  preOffset: number;
  postOffset: number;
  note?: string;
  isSelected: boolean;
  anySelected: boolean;
  onSelect: (e: React.MouseEvent) => void;
  onClick: (e: React.MouseEvent) => void;
  drag: RowDragProps;
  onInsertTextCardAbove: () => void;
  /** Opens the clip for trimming; absent when it can't play (no sync point). */
  onTrim?: () => void;
  onRemove: () => void;
  labelControls?: LabelRowControls;
  groupPos?: GroupRunInfo["pos"];
  groupSize?: number;
  onUngroup?: () => void;
  canGroupSelection?: boolean;
  selectionCount?: number;
  onGroupSelected?: () => void;
}) {
  const colors = eventColors(event);
  const assigned = labelControls ? labelControls.labels.filter((l) => labelControls.assignedIds.has(l.id)) : [];
  const visibleLabels = assigned.slice(0, 2);
  const overflow = assigned.slice(2);
  const secondary = isSelected ? "text-selection-foreground/80" : "text-muted-foreground";

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          id={domId}
          role="row"
          data-row-key={drag.rowKey}
          data-row-index={index}
          data-focused={focused || undefined}
          aria-selected={isSelected}
          className={rowClasses({ isSelected })}
          onClick={onClick}
          onMouseDown={(e) => {
            if (e.shiftKey) e.preventDefault();
          }}
          onPointerDown={drag.onPointerDown}
        >
          {isActive && !isSelected && <ActiveRowPill />}
          {focused && <FocusRing onSelection={isSelected} />}
          <div className={cn("relative z-10 w-[3px] shrink-0 self-stretch", colors.strip)} aria-hidden />
          <RowLead groupPos={groupPos} isSelected={isSelected} showCheckbox={anySelected} onSelect={onSelect} />

          <div role="gridcell" className="relative z-10 flex min-w-0 flex-1 flex-col justify-center py-1.5">
            <div className="flex min-w-0 items-center gap-1.5">
              {(groupPos === "first" || groupPos === "only") && <GroupPill size={groupSize} onUngroup={onUngroup} />}
              <span className={cn("inline-flex shrink-0 items-center rounded-full px-2 py-px text-[11px] font-medium", colors.badge)}>
                {eventLabel(event)}
              </span>
              <span className="truncate text-sm font-medium">{playerName(event)}</span>
              {visibleLabels.map((l) => (
                <LabelChip key={l.id} label={l} className="shrink-0 whitespace-nowrap" />
              ))}
              {overflow.length > 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className={cn("text-xs", secondary)}>+{overflow.length}</span>
                  </TooltipTrigger>
                  <TooltipContent>{overflow.map((l) => l.name).join(", ")}</TooltipContent>
                </Tooltip>
              )}
            </div>
            <div className={cn("flex min-w-0 items-center gap-1 text-subheadline nums", secondary)}>
              <span className="shrink-0">Q{event.period}</span>
              <span aria-hidden>·</span>
              <span className="shrink-0">{formatGameClock(event.gameClockTime)}</span>
              {event.eventTeam?.teamName && (
                <>
                  <span aria-hidden>·</span>
                  <span className="truncate">{event.eventTeam.teamName}</span>
                </>
              )}
              {isMultiMatch && matchTitle && (
                <>
                  <span aria-hidden>·</span>
                  <span className="truncate">{matchTitle}</span>
                </>
              )}
            </div>
          </div>

          <div className="relative z-10 flex shrink-0 items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
            {isActive && <Play className={cn("mr-1 size-3.5 fill-current", isSelected ? "text-selection-foreground" : "text-primary")} />}
            {(preOffset !== 0 || postOffset !== 0) && (
              <span
                className="text-caption text-orange-400"
                title={`Pre ${preOffset >= 0 ? "+" : ""}${preOffset}s / Post ${postOffset >= 0 ? "+" : ""}${postOffset}s`}
              >
                ±
              </span>
            )}
            {note && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <MessageSquare className={cn("size-3 shrink-0", isSelected ? "text-selection-foreground/80" : "text-primary/60")} />
                </TooltipTrigger>
                <TooltipContent className="max-w-56 whitespace-pre-wrap">{note}</TooltipContent>
              </Tooltip>
            )}
            {labelControls && (
              <LabelPickerPopover
                trigger={
                  <button
                    type="button"
                    className={cn(
                      "flex size-6 items-center justify-center rounded-md transition-[opacity,background-color] duration-100 hover:bg-primary/10 hover:text-primary active:scale-95 data-[state=open]:opacity-100",
                      REVEAL,
                    )}
                    title={labelControls.scopeTitle ?? "Labels"}
                  >
                    <Tag className="size-3.5" />
                  </button>
                }
                labels={labelControls.labels}
                assignedAllIds={labelControls.assignedIds}
                onToggle={labelControls.onToggle}
                onCreate={labelControls.onCreate}
                onRename={labelControls.onRename}
                onRecolor={labelControls.onRecolor}
                onDelete={labelControls.onDelete}
                onSeedDefaults={labelControls.onSeedDefaults}
                scopeTitle={labelControls.scopeTitle}
                scopeHint={labelControls.scopeHint}
              />
            )}
            <button
              type="button"
              className={cn(
                "flex size-6 items-center justify-center rounded-md transition-[opacity,background-color] duration-100 hover:bg-destructive/10 hover:text-destructive active:scale-95",
                REVEAL,
              )}
              onClick={onRemove}
              title="Remove from playlist"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {onTrim && <ContextMenuItem onSelect={onTrim}>Trim clip…</ContextMenuItem>}
        <ContextMenuItem onSelect={onInsertTextCardAbove}>Insert text card above</ContextMenuItem>
        {canGroupSelection && isSelected && onGroupSelected && (
          <ContextMenuItem onSelect={onGroupSelected}>Group {selectionCount} selected items</ContextMenuItem>
        )}
        {groupPos && onUngroup && <ContextMenuItem onSelect={onUngroup}>Ungroup ({groupSize} items)</ContextMenuItem>}
        <ContextMenuItem onSelect={onRemove} className="text-destructive focus:bg-destructive focus:text-white">
          Remove from playlist
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function TextCardRow({
  domId,
  card,
  index,
  isActive,
  focused,
  isSelected,
  anySelected,
  onSelect,
  drag,
  onTextChange,
  onTextSave,
  onDurationChange,
  onClick,
  onRemove,
  groupPos,
  groupSize,
  onUngroup,
}: {
  domId: string;
  card: PlaylistTextCard;
  index: number;
  isActive: boolean;
  focused: boolean;
  isSelected: boolean;
  anySelected: boolean;
  onSelect: (e: React.MouseEvent) => void;
  drag: RowDragProps;
  onTextChange: (id: string, text: string) => void;
  onTextSave: (id: string, text: string) => void;
  onDurationChange: (id: string, duration: number) => void;
  onClick: (e: React.MouseEvent) => void;
  onRemove: () => void;
  groupPos?: GroupRunInfo["pos"];
  groupSize?: number;
  onUngroup?: () => void;
}) {
  const [durationOpen, setDurationOpen] = useState(false);
  const [draftDuration, setDraftDuration] = useState(card.durationSeconds);

  return (
    <div
      id={domId}
      role="row"
      data-row-key={drag.rowKey}
      data-row-index={index}
      data-focused={focused || undefined}
      aria-selected={isSelected}
      className={cn(rowClasses({ isSelected }), !isSelected && "bg-amber-500/6 hover:bg-amber-500/12")}
      onClick={onClick}
      onMouseDown={(e) => {
        if (e.shiftKey) e.preventDefault();
      }}
      onPointerDown={drag.onPointerDown}
    >
      {isActive && !isSelected && <ActiveRowPill />}
      {focused && <FocusRing onSelection={isSelected} />}
      <div className="relative z-10 w-[3px] shrink-0 self-stretch bg-amber-400" aria-hidden />
      <RowLead groupPos={groupPos} isSelected={isSelected} showCheckbox={anySelected} onSelect={onSelect} />

      <div role="gridcell" className="relative z-10 flex min-w-0 flex-1 items-center gap-2 py-1.5">
        {(groupPos === "first" || groupPos === "only") && <GroupPill size={groupSize} onUngroup={onUngroup} />}
        <Type className="size-3.5 shrink-0 text-amber-500" />
        <input
          type="text"
          value={card.text}
          placeholder="Text card…"
          aria-label="Text card"
          className={cn(
            "min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50",
            isSelected ? "text-selection-foreground placeholder:text-selection-foreground/60" : "text-foreground",
          )}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onTextChange(card.id, e.target.value)}
          onBlur={(e) => onTextSave(card.id, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
        <Popover
          open={durationOpen}
          onOpenChange={(open) => {
            setDurationOpen(open);
            if (open) setDraftDuration(card.durationSeconds);
          }}
        >
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(
                "inline-flex shrink-0 items-center rounded-full px-2 py-px text-[11px] font-medium nums transition-[background-color,transform] duration-100 active:scale-95",
                isSelected ? "bg-white/20 text-selection-foreground" : "bg-amber-500/15 text-amber-700 hover:bg-amber-500/25 dark:text-amber-300",
              )}
              onClick={(e) => e.stopPropagation()}
            >
              {card.durationSeconds} s
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-52 space-y-2" onClick={(e) => e.stopPropagation()}>
            <p className="text-headline">Duration</p>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-muted-foreground">Seconds</span>
              <Stepper
                label="Duration"
                value={draftDuration}
                min={1}
                max={120}
                onChange={(n) => {
                  setDraftDuration(n);
                  onDurationChange(card.id, n);
                }}
              />
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <div className="relative z-10 flex shrink-0 items-center" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className={cn(
            "flex size-6 items-center justify-center rounded-md transition-[opacity,background-color] duration-100 hover:bg-destructive/10 hover:text-destructive active:scale-95",
            REVEAL,
          )}
          onClick={onRemove}
          title="Remove from playlist"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
