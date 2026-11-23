import { useState } from "react";
import { BarChart3, Link2, MessageSquare, Trash2, Type, X } from "lucide-react";
import type { Label, LabelColor } from "@scoutable/shared/types/labels";
import type { GroupRunInfo } from "@scoutable/shared/lib/clip-groups";
import { cardContent, opponentLabel } from "@scoutable/shared/lib/stats-card";
import type { PlayByPlayEvent, PlaylistTextCard } from "@/types/match";
import { LabelPickerPopover, type LabelTriState } from "@/components/labels/LabelPickerPopover";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Stepper } from "@/components/ui/stepper";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ActiveRowPill, PlayRowCells, playRowClass, REVEAL, RowLabelButton } from "@/components/plays/play-row";

export interface LabelRowControls {
  labels: Label[];
  /** The row's own labels: its chips. */
  assignedIds: Set<string>;
  onToggle: (labelId: string, state: LabelTriState) => Promise<void> | void;
  /**
   * The row is one of several selected clips: its picker edits all of them
   * (Finder's rule: an action on a selected item acts on the selection).
   */
  selection?: {
    count: number;
    allIds: Set<string>;
    someIds: Set<string>;
    onToggle: (labelId: string, state: LabelTriState) => Promise<void> | void;
  };
  onCreate: (name: string, color: LabelColor) => Promise<Label>;
  onRename: (id: string, name: string) => Promise<void>;
  onRecolor: (id: string, color: LabelColor) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  /** Gives a label its key (1–9), or takes it away (null). */
  onSetKey?: (id: string, slot: number | null) => Promise<void>;
  onSeedDefaults?: () => Promise<void>;
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

export { ActiveRowPill };

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
        onSelection ? "ring-selection" : "ring-selection",
      )}
    />
  );
}


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
    <div className="relative z-10 flex w-7 shrink-0 items-center justify-center self-stretch" onClick={(e) => e.stopPropagation()}>
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
  return cn(rowBase, isSelected ? "bg-row-checked text-foreground" : "hover:bg-fill-1 active:bg-fill-2");
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
  onInsertStatsCardAbove,
  onTrim,
  onFixSync,
  onShowInGame,
  onRemove,
  removeCount = 1,
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
  /** Absent while filters are on (a filtered list can't place it). */
  onInsertTextCardAbove?: () => void;
  /** Absent when this clip's game has no stats. */
  onInsertStatsCardAbove?: () => void;
  /** Absent when this clip has no player, or filters are on. */
  /** Opens the clip for trimming; absent when it can't play (no sync point). */
  onTrim?: () => void;
  /** Find where the play really happens and move the game's sync (or this clip) to it. */
  onFixSync?: () => void;
  /** The clip in its game at this play (Final Cut's Reveal Source); absent for a game the coach can't open. */
  onShowInGame?: () => void;
  onRemove: () => void;
  /** What Remove takes: more than 1 when the row is one of several selected items, which all go. */
  removeCount?: number;
  labelControls?: LabelRowControls;
  groupPos?: GroupRunInfo["pos"];
  groupSize?: number;
  onUngroup?: () => void;
  canGroupSelection?: boolean;
  selectionCount?: number;
  onGroupSelected?: () => void;
  /** Sits under a player card: indented, with the rail. */
}) {
  const assigned = labelControls ? labelControls.labels.filter((l) => labelControls.assignedIds.has(l.id)) : [];

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
          className={cn(playRowClass({ selected: isSelected }), "pl-0")}
          onClick={onClick}
          onMouseDown={(e) => {
            if (e.shiftKey) e.preventDefault();
          }}
          onPointerDown={drag.onPointerDown}
        >
          {isActive && !isSelected && <ActiveRowPill />}
          {focused && <FocusRing onSelection={isSelected} />}
          <RowLead groupPos={groupPos} isSelected={isSelected} showCheckbox={anySelected} onSelect={onSelect} />
          {/* The editor is a grid: the play's cells are its row's one cell, as a text card's are. */}
          <div role="gridcell" className="relative z-10 flex h-full min-w-0 flex-1 items-center gap-1.5">
            <PlayRowCells
              event={event}
              clock="with-period"
              now={isActive}
              strong={isActive}
              team={null}
              labels={assigned}
              context={isMultiMatch && matchTitle ? matchTitle : undefined}
              pill={groupPos === "first" || groupPos === "only" ? <GroupPill size={groupSize} onUngroup={onUngroup} /> : undefined}
              marks={
                preOffset !== 0 || postOffset !== 0 || note ? (
                  <>
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
                          <MessageSquare className={cn("size-3 shrink-0", "text-primary/60")} />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-56 whitespace-pre-wrap">{note}</TooltipContent>
                      </Tooltip>
                    )}
                  </>
                ) : undefined
              }
              actions={
                <>
                  {labelControls && (
                    <LabelPickerPopover
                      trigger={
                        <RowLabelButton
                          title={labelControls.selection ? `Labels for the ${labelControls.selection.count} selected clips` : "Labels"}
                          aria-label={labelControls.selection ? `Labels for the ${labelControls.selection.count} selected clips` : "Labels"}
                        />
                      }
                      labels={labelControls.labels}
                      assignedAllIds={labelControls.selection?.allIds ?? labelControls.assignedIds}
                      assignedSomeIds={labelControls.selection?.someIds}
                      onToggle={labelControls.selection?.onToggle ?? labelControls.onToggle}
                      onCreate={labelControls.onCreate}
                      onRename={labelControls.onRename}
                      onRecolor={labelControls.onRecolor}
                      onDelete={labelControls.onDelete}
                      onSetKey={labelControls.onSetKey}
                      onSeedDefaults={labelControls.onSeedDefaults}
                    />
                  )}
                  <button
                    type="button"
                    className={cn(
                      "flex size-6 items-center justify-center rounded-md text-muted-foreground transition-[opacity,background-color] duration-100 hover:bg-destructive/10 hover:text-destructive active:scale-95",
                      REVEAL,
                    )}
                    onClick={onRemove}
                    title={removeCount > 1 ? `Remove the ${removeCount} selected items` : "Remove from playlist"}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </>
              }
            />
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {onShowInGame && (
          <>
            <ContextMenuItem onSelect={onShowInGame}>Show in game</ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        {onTrim && <ContextMenuItem onSelect={onTrim}>Trim clip…</ContextMenuItem>}
        {onFixSync && <ContextMenuItem onSelect={onFixSync}>Fix sync…</ContextMenuItem>}
        {onInsertTextCardAbove && <ContextMenuItem onSelect={onInsertTextCardAbove}>Insert text card above</ContextMenuItem>}
        {onInsertStatsCardAbove && <ContextMenuItem onSelect={onInsertStatsCardAbove}>Insert stats card above</ContextMenuItem>}
        {canGroupSelection && isSelected && onGroupSelected && (
          <ContextMenuItem onSelect={onGroupSelected}>Group {selectionCount} selected items</ContextMenuItem>
        )}
        {groupPos && onUngroup && <ContextMenuItem onSelect={onUngroup}>Ungroup ({groupSize} items)</ContextMenuItem>}
        <ContextMenuItem onSelect={onRemove} className="text-destructive focus:bg-destructive/10 focus:text-destructive">
          {removeCount > 1 ? `Remove ${removeCount} items` : "Remove from playlist"}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** "24 PTS · 10 REB · 5 AST" over "vs AIK · Game stats". */
function statsSummary(card: NonNullable<PlaylistTextCard["card"]>): { title: string; detail: string } {
  const content = cardContent(card);
  const numbers = content.cells.map((c) => `${c.value} ${c.label}`).join(" · ");
  return {
    title: numbers ? `${content.heading} · ${numbers}` : content.heading,
    detail: card.scope === "game" ? `${opponentLabel(card.game)} · Game stats` : `${card.season.label} · Season averages`,
  };
}

/**
 * A text or stats card in the list. Cards share one neutral look with an
 * icon (amber is kept for warnings): a text card is edited right in its
 * row, a stats card is summarised here and edited under the player.
 */
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
  removeCount = 1,
  onInsertTextCardAbove,
  onInsertStatsCardAbove,
  autoFocusText,
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
  /** What Remove takes: more than 1 when the row is one of several selected items, which all go. */
  removeCount?: number;
  /** Absent while filters are on (a filtered list can't place it). */
  onInsertTextCardAbove?: () => void;
  /** Absent when no game in the playlist has stats. */
  onInsertStatsCardAbove?: () => void;
  /** A text card just added: its text field takes focus. */
  autoFocusText?: boolean;
  groupPos?: GroupRunInfo["pos"];
  groupSize?: number;
  onUngroup?: () => void;
  /** Sits under a player card: indented, with the rail. */
}) {
  const [durationOpen, setDurationOpen] = useState(false);
  const [draftDuration, setDraftDuration] = useState(card.durationSeconds);
  const stats = card.card ? statsSummary(card.card) : null;
  const Icon = stats ? BarChart3 : Type;
  const secondary = "text-muted-foreground";

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
          <div className="relative z-10 w-[3px] shrink-0 self-stretch" aria-hidden />
          <RowLead groupPos={groupPos} isSelected={isSelected} showCheckbox={anySelected} onSelect={onSelect} />

          <div role="gridcell" className="relative z-10 flex min-w-0 flex-1 items-center gap-2 py-1.5">
            {(groupPos === "first" || groupPos === "only") && <GroupPill size={groupSize} onUngroup={onUngroup} />}
            <span
              aria-hidden
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-md",
                isSelected ? "bg-fill-4" : "bg-fill-2",
              )}
            >
              <Icon className={cn("size-3.5", secondary)} />
            </span>
            {stats ? (
              <div className="flex min-w-0 flex-1 flex-col justify-center">
                <span className="truncate text-sm font-medium nums">{stats.title}</span>
                <span className={cn("truncate text-subheadline", secondary)}>{stats.detail}</span>
              </div>
            ) : (
              <input
                type="text"
                value={card.text}
                autoFocus={autoFocusText}
                placeholder="Text card…"
                aria-label="Text card"
                className={cn(
                  "min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50",
                  "text-foreground",
                )}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => onTextChange(card.id, e.target.value)}
                onBlur={(e) => onTextSave(card.id, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
              />
            )}
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
                    isSelected ? "bg-fill-4 text-muted-foreground" : "bg-fill-2 text-muted-foreground hover:bg-fill-3",
                  )}
                  title="How long the card shows"
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
              title={removeCount > 1 ? `Remove the ${removeCount} selected items` : "Remove from playlist"}
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {onInsertTextCardAbove && <ContextMenuItem onSelect={onInsertTextCardAbove}>Insert text card above</ContextMenuItem>}
        {onInsertStatsCardAbove && <ContextMenuItem onSelect={onInsertStatsCardAbove}>Insert stats card above</ContextMenuItem>}
        {groupPos && onUngroup && <ContextMenuItem onSelect={onUngroup}>Ungroup ({groupSize} items)</ContextMenuItem>}
        <ContextMenuItem onSelect={onRemove} className="text-destructive focus:bg-destructive/10 focus:text-destructive">
          {removeCount > 1 ? `Remove ${removeCount} items` : "Remove from playlist"}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

