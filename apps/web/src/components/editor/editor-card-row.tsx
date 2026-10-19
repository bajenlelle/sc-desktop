"use client";

import * as React from "react";
import { BarChart3, Pencil, Play, Trash2, Type } from "lucide-react";
import type { GroupRunInfo } from "@scoutable/shared/lib/clip-groups";
import { cardContent, opponentLabel, type StatsCardSpec } from "@scoutable/shared/lib/stats-card";
import type { PlaylistTextCard } from "@scoutable/shared/types/match";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Stepper } from "@/components/ui/stepper";
import { cn } from "@/lib/utils";
import { MenuSections } from "./editor-clip-row";
import { ActiveRowPill, DragGrip, FocusRing, GroupPill, REVEAL, RowLead, RowMenu, rowClasses, type RowDragProps } from "./row-parts";

/** The card's text is saved this long after the last keystroke (and on blur). */
const SAVE_MS = 600;

/** "Alva Berg · 24 PTS · 10 REB" over "vs AIK · Game stats", as the desktop's card rows read. */
export function statsSummary(card: StatsCardSpec): { title: string; detail: string } {
  const content = cardContent(card);
  const numbers = content.cells.map((c) => `${c.value} ${c.label}`).join(" · ");
  return {
    title: numbers ? `${content.heading} · ${numbers}` : content.heading,
    detail: card.scope === "game" ? `${opponentLabel(card.game)} · Game stats` : `${card.season.label} · Season averages`,
  };
}

/**
 * A text field that grows with its lines and saves itself: what is typed
 * shows at once, the write follows a moment after the last keystroke, on
 * blur, and when the field goes. Return commits; Shift+Return starts a line.
 */
function CardTextField({
  value,
  onSave,
  autoFocus,
  isSelected,
}: {
  value: string;
  onSave: (text: string) => void;
  autoFocus?: boolean;
  isSelected: boolean;
}) {
  const [draft, setDraft] = React.useState(value);
  const ref = React.useRef<HTMLTextAreaElement | null>(null);
  const timer = React.useRef<number | null>(null);
  const draftRef = React.useRef(draft);
  const savedRef = React.useRef(value);
  const onSaveRef = React.useRef(onSave);
  React.useLayoutEffect(() => {
    draftRef.current = draft;
    onSaveRef.current = onSave;
  });

  // Another device's edit arrives: take it unless this one is mid-typing.
  React.useEffect(() => {
    if (value !== savedRef.current && timer.current === null) {
      savedRef.current = value;
      setDraft(value);
    }
  }, [value]);

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  const flush = React.useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    if (draftRef.current === savedRef.current) return;
    savedRef.current = draftRef.current;
    onSaveRef.current(draftRef.current);
  }, []);

  React.useEffect(() => flush, [flush]);

  function change(next: string) {
    setDraft(next);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, SAVE_MS);
  }

  return (
    <textarea
      ref={ref}
      rows={1}
      value={draft}
      autoFocus={autoFocus}
      placeholder="Text card…"
      aria-label="Text card"
      data-no-drag
      className={cn(
        "min-w-0 flex-1 resize-none overflow-hidden bg-transparent py-0.5 text-sm outline-none placeholder:text-muted-foreground/50",
        isSelected ? "text-selection-foreground placeholder:text-selection-foreground/60" : "text-foreground",
      )}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onChange={(e) => change(e.target.value)}
      onBlur={flush}
      onKeyDown={(e) => {
        // The editor's keys stay out of a field; Return commits, Esc too.
        e.stopPropagation();
        if ((e.key === "Enter" && !e.shiftKey) || e.key === "Escape") {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
    />
  );
}

/**
 * A text or stats card in the list. Cards share a neutral look with an icon
 * (colour is kept for plays). A text card is edited right in its row; a
 * stats card shows its line and opens the inspector to change it (Edit, its
 * menu, a double-click, or Return on the focused row). How long a card
 * shows is one press away either way.
 */
export function EditorCardRow({
  domId,
  card,
  index,
  isActive,
  focused,
  isSelected,
  anySelected,
  menuOpen,
  onMenuOpenChange,
  onSelect,
  onClick,
  drag,
  onTextSave,
  onDurationChange,
  onInsertTextCardAbove,
  onInsertStatsCardAbove,
  onEditStats,
  onUngroup,
  onRemove,
  autoFocusText,
  groupPos,
  groupSize,
}: {
  domId: string;
  card: PlaylistTextCard;
  index: number;
  isActive: boolean;
  focused: boolean;
  isSelected: boolean;
  anySelected: boolean;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  onSelect: (e: React.MouseEvent) => void;
  onClick: (e: React.MouseEvent) => void;
  drag: RowDragProps;
  onTextSave: (text: string) => void;
  onDurationChange: (seconds: number) => void;
  onInsertTextCardAbove: () => void;
  /** Absent when no game in the playlist has stats. */
  onInsertStatsCardAbove?: () => void;
  /** A stats card's inspector. */
  onEditStats?: () => void;
  /** Present on a grouped row. */
  onUngroup?: () => void;
  onRemove: () => void;
  /** A card just added: its text field takes focus. */
  autoFocusText?: boolean;
  groupPos?: GroupRunInfo["pos"];
  groupSize?: number;
}) {
  const secondary = isSelected ? "text-selection-foreground/80" : "text-muted-foreground";
  const stats = card.card ? statsSummary(card.card) : null;
  const Icon = stats ? BarChart3 : Type;
  const edit = stats ? onEditStats : undefined;

  return (
    <div
      id={domId}
      role="row"
      data-row-key={drag.rowKey}
      data-row-index={index}
      data-focused={focused || undefined}
      aria-selected={isSelected}
      className={rowClasses({ isSelected })}
      onClick={onClick}
      onDoubleClick={
        edit &&
        ((e) => {
          if (e.shiftKey || e.metaKey || e.ctrlKey) return;
          edit();
        })
      }
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
      <div className="relative z-10 w-[3px] shrink-0 self-stretch" aria-hidden />
      <RowLead groupPos={groupPos} isSelected={isSelected} showCheckbox={anySelected} onSelect={onSelect} />

      <div role="gridcell" className="relative z-10 flex min-w-0 flex-1 items-center gap-2 py-1.5">
        {(groupPos === "first" || groupPos === "only") && groupSize && <GroupPill size={groupSize} isSelected={isSelected} onUngroup={onUngroup} />}
        <span aria-hidden className={cn("flex size-6 shrink-0 items-center justify-center rounded-md", isSelected ? "bg-white/20" : "bg-fill-2")}>
          <Icon className={cn("size-3.5", secondary)} />
        </span>
        {stats ? (
          <div className="flex min-w-0 flex-1 flex-col justify-center">
            <span className="truncate text-sm font-medium nums">{stats.title}</span>
            <span className={cn("truncate text-subheadline", secondary)}>{stats.detail}</span>
          </div>
        ) : (
          <CardTextField value={card.text} onSave={onTextSave} autoFocus={autoFocusText} isSelected={isSelected} />
        )}
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              data-no-drag
              className={cn(
                "inline-flex shrink-0 items-center rounded-full px-2 py-px text-[11px] font-medium nums outline-none transition-[background-color,transform] duration-100 active:scale-95 focus-visible:ring-2 focus-visible:ring-selection pointer-coarse:py-1 pointer-coarse:text-xs",
                isSelected ? "bg-white/20 text-selection-foreground" : "bg-fill-2 text-muted-foreground hover:bg-fill-3",
              )}
              title="How long the card shows"
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
            >
              {card.durationSeconds} s
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-56 space-y-2" onClick={(e) => e.stopPropagation()}>
            <p className="text-headline">Duration</p>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-muted-foreground">Seconds on screen</span>
              <Stepper label="Duration" value={card.durationSeconds} min={1} max={30} onChange={onDurationChange} format={(v) => `${v} s`} />
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <div className="relative z-10 flex shrink-0 items-center gap-0.5" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        {isActive && <Play className={cn("mr-1 size-3.5 fill-current", isSelected ? "text-selection-foreground" : "text-primary")} />}
        {edit && (
          <button
            type="button"
            className={cn(
              "flex size-6 items-center justify-center rounded-md outline-none transition-[opacity,background-color,transform] duration-100 active:scale-95 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-selection pointer-coarse:size-8",
              isSelected ? "hover:bg-white/15" : "hover:bg-fill-2",
              REVEAL,
            )}
            onClick={edit}
            aria-label="Edit stats card"
            title="Edit stats card"
          >
            <Pencil className="size-3.5" />
          </button>
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
        <RowMenu open={menuOpen} onOpenChange={onMenuOpenChange} isSelected={isSelected}>
          <MenuSections
            sections={[
              [
                edit && (
                  <DropdownMenuItem key="edit" onSelect={edit}>
                    Edit stats card…
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
