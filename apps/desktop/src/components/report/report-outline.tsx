import { useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { ChevronRight, EyeOff, ListPlus, Loader2, MoreHorizontal, Plus, StickyNote } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useListDrag } from "@/components/editor/use-list-drag";
import { PLAYS_DRAG_TYPE, readPlaysDrag } from "@/components/editor/clip-browser-panel";
import { AddSectionItems } from "@/components/report/add-section-items";
import { cn } from "@/lib/utils";
import { eventColors, eventLabel, formatGameClock, periodLabel, playerName } from "@scoutable/shared/lib/events";
import { clickSelection, extendSelection } from "@scoutable/shared/lib/list-selection";
import { LEFT_OUT, canRemoveBlock, type Placement, type ReportBlock, type ReportBlockKind, type ReportDraft, type ReportLayout } from "@scoutable/shared/lib/report-draft";
import {
  blockDropBefore,
  blockGap,
  clipDrop,
  outlineRows,
  sectionDropIndex,
  sectionGap,
  sectionRowKey,
  snapClipGap,
  type OutlineRowRef,
} from "@scoutable/shared/lib/report-outline";
import type { PlayByPlayEvent, PlaylistClipItem } from "@/types/match";

export interface OutlineSectionInfo {
  /** "Alva Berg", "Team", "Keys", "Not in report". */
  label: string;
  number: string | null;
  statsLoading: boolean;
  /** A section that isn't a player's, in a report of sections: hidden, moved and taken out from its row. */
  block?: ReportBlock;
}

export interface OutlineClipInfo {
  item: PlaylistClipItem;
  event: PlayByPlayEvent;
  /** The play's player's family name where the section doesn't already say who (the team, another player's play). */
  actor: string | null;
  /** The game's title, for the hover. */
  game: string | null;
  labels: readonly string[];
}

export type MoveVia = "drag" | "keys" | "menu" | "add_clips";

export interface ReportOutlineProps {
  layout: ReportLayout;
  sectionInfo: ReadonlyMap<Placement, OutlineSectionInfo>;
  clipInfo: ReadonlyMap<string, OutlineClipInfo>;
  collapsed: ReadonlySet<Placement>;
  /** `all`: ⌥-click folds or unfolds every section, as on the Mac. */
  onToggleCollapsed: (id: Placement, all: boolean) => void;
  /** The section the document is scrolled to. */
  activeId: Placement | null;
  selected: ReadonlySet<string>;
  anchor: string | null;
  onSelectionChange: (selected: Set<string>, anchor: string | null) => void;
  reducedMotion: boolean;
  onShowSection: (id: Placement) => void;
  /** Scrolls to the clip's tile (the row's "Show in report"). */
  onShowClip: (key: string) => void;
  /** Scrolls to the clip's tile and plays it there (a plain click, Return). */
  onPlayClip: (key: string) => void;
  /** `toIndex` counts player sections only. */
  onMoveSection: (id: string, toIndex: number) => void;
  onRemoveSection: (id: string) => void;
  onMoveClips: (keys: string[], to: Placement, before: string | null, via: MoveVia) => void;
  onNudgeClips: (keys: string[], dir: -1 | 1) => void;
  onIncludeClips: (keys: string[], via: MoveVia) => void;
  /** Edit clip: the clip in the Clips view. */
  onOpenClip: (key: string) => void;
  onAddPlayers: () => void;
  onBlockHidden: (id: string, hidden: boolean) => void;
  /** One place up (-1) or down (1) among the sections. */
  onMoveBlock: (id: string, dir: -1 | 1) => void;
  /** A section dragged to just before another (by block id), or last (null). */
  onMoveBlockTo: (id: string, before: string | null) => void;
  onRemoveBlock: (id: string) => void;
  /** The header's +: the sections the report can still add. */
  draft: ReportDraft;
  onAddBlock: (kind: ReportBlockKind) => void;
  /** + Add clips on a section's row (absent where the report can't add clips). */
  onAddClips?: (id: Placement) => void;
  /** The section the docked plays add to, marked on its row; null when they aren't docked or sort by player. */
  addingTo?: Placement | null;
  /** Plays dragged from the docked panel and dropped on a section's row. */
  onDropPlays?: (id: Placement, keys: string[]) => void;
  /** A section of the coach's own: its name, edited in the document. */
  onRename?: (id: string) => void;
}
const clock = (e: PlayByPlayEvent) => `${periodLabel(e.period)} ${formatGameClock(e.gameClockTime).replace(/^0/, "")}`;
const clipsNoun = (n: number) => (n === 1 ? "clip" : `${n} clips`);

/**
 * The report at a glance: each section's header with its clips under it,
 * Team first (always, so there is somewhere to drop a clip) and the clips
 * left out of the report last. A clip is a line with its play's colour, the
 * play and the time; hovering tells the rest.
 *
 * Dragging a clip (or the selection it is in) reorders it or moves it under
 * another player, into the team or out of the report; dragging a section's
 * header moves it with its clips (a player among the players, any other
 * section between sections). The keys do the same: ⌥↑/⌥↓ moves the focused
 * row, ⌫ leaves clips out (or removes a player), ←/→ fold and unfold, A adds
 * clips to the focused section. ⌘-click and ⇧-click select clips, as in the
 * playlist; a plain click or Return plays the clip in its tile. Where a drop
 * lands is worked out in lib/report-outline.ts.
 *
 * A section's row shows + (Add clips) and ⋯ (its menu, as a right-click) on
 * hover, takes plays dropped from the docked panel, and marks the section the
 * panel adds to. The header's + adds players or a section.
 */
export function ReportOutline(props: ReportOutlineProps) {
  const { layout, sectionInfo, clipInfo, collapsed, selected, anchor, activeId } = props;
  const listRef = useRef<HTMLDivElement | null>(null);
  const noSidebar = useRef<HTMLElement | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  // The section a play from the docked panel is dragged over.
  const [playsOver, setPlaysOver] = useState<Placement | null>(null);

  const rows = useMemo(() => outlineRows(layout, collapsed), [layout, collapsed]);
  const rowByKey = useMemo(() => new Map(rows.map((r) => [r.key, r])), [rows]);
  const clipOrder = useMemo(() => rows.filter((r) => r.kind === "clip").map((r) => r.key), [rows]);
  const players = useMemo(() => layout.sections.filter((s) => s.section).map((s) => s.id), [layout]);
  const counts = useMemo(() => {
    const m = new Map<Placement, number>(layout.sections.map((s) => [s.id, s.clips.length]));
    m.set(LEFT_OUT, layout.leftOut.length);
    return m;
  }, [layout]);
  const targets = useMemo(() => layout.sections.filter((s) => s.accepts).map((s) => ({ id: s.id, label: labelOf(s.id) })), [layout, sectionInfo]);

  function labelOf(id: Placement): string {
    const info = sectionInfo.get(id);
    if (!info) return "";
    return info.number ? `#${info.number} ${info.label}` : info.label;
  }

  /** What an action on a clip row acts on: the selection when the row is in it, else the row. */
  const actionKeys = (key: string) => (selected.size > 1 && selected.has(key) ? clipOrder.filter((k) => selected.has(k)) : [key]);

  const drag = useListDrag({
    listRef,
    sidebarRef: noSidebar,
    reducedMotion: props.reducedMotion,
    canStart: (key) => {
      const row = rowByKey.get(key);
      return !!row && row.id !== LEFT_OUT;
    },
    blockFor: (key) => {
      const row = rowByKey.get(key)!;
      if (row.kind === "section") return [key, ...rows.filter((r) => r.kind === "clip" && r.id === row.id).map((r) => r.key)];
      return actionKeys(key);
    },
    badgeCount: (keys) => (rowByKey.get(keys[0])?.kind === "section" ? 1 : keys.length),
    snapGap: (gap, keys) => {
      const first = rowByKey.get(keys[0]);
      if (first?.kind !== "section") return snapClipGap(gap);
      return first.player ? sectionGap(rows, gap) : blockGap(rows, gap);
    },
    onTarget: () => {},
    onDrop: ({ gap, blockKeys }) => {
      const first = rowByKey.get(blockKeys[0]);
      if (first?.kind === "section") {
        if (first.player) props.onMoveSection(first.id, sectionDropIndex(rows, blockKeys, gap));
        else props.onMoveBlockTo(first.block ?? first.id, blockDropBefore(rows, blockKeys, gap));
        return;
      }
      const { to, before } = clipDrop(rows, blockKeys, gap);
      props.onMoveClips(blockKeys, to, before, "drag");
    },
    onDropOnPlaylist: () => {},
    onEnd: () => {},
  });

  const focusRow = (key: string | undefined) => {
    if (key === undefined) return;
    setCurrent(key);
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(key)}"]`)?.focus());
  };
  // One row is in the tab order: the current one, else the active section's, else the first.
  const activeKey = activeId === null ? null : sectionRowKey(activeId);
  const tabStop = current !== null && rowByKey.has(current) ? current : activeKey !== null && rowByKey.has(activeKey) ? activeKey : rows[0]?.key;

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const key = (e.target as HTMLElement).closest<HTMLElement>("[data-row-key]")?.dataset.rowKey;
    const row = key === undefined ? undefined : rowByKey.get(key);
    if (!row) return;
    const at = rows.indexOf(row);

    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "a") {
      e.preventDefault();
      props.onSelectionChange(new Set(clipOrder), clipOrder[0] ?? null);
      return;
    }
    // A: add clips to the focused section, as A adds in the game view and the plays.
    if (!e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "a" && row.kind === "section") {
      if (row.accepts && row.id !== LEFT_OUT && props.onAddClips) {
        e.preventDefault();
        props.onAddClips(row.id);
      }
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const dir = e.key === "ArrowDown" ? 1 : -1;
      if (e.altKey) {
        if (row.kind === "clip") props.onNudgeClips(actionKeys(row.key), dir);
        else if (row.player) props.onMoveSection(row.id, players.indexOf(row.id) + dir);
        else if (sectionInfo.get(row.id)?.block) props.onMoveBlock(row.id, dir);
        focusRow(row.key);
        return;
      }
      if (e.shiftKey) {
        // The selection grows over clips; headers are stepped over.
        let j = at + dir;
        while (rows[j] && rows[j].kind !== "clip") j += dir;
        const next = rows[j];
        if (!next) return;
        const from = anchor !== null && clipOrder.includes(anchor) ? anchor : row.kind === "clip" ? row.key : next.key;
        const grown = extendSelection({ order: clipOrder, selected, anchor: from, previousFocus: row.kind === "clip" ? row.key : null, focus: next.key });
        props.onSelectionChange(grown, from);
        focusRow(next.key);
        return;
      }
      focusRow(rows[Math.max(0, Math.min(rows.length - 1, at + dir))]?.key);
      return;
    }
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const open = !collapsed.has(row.id);
      if (row.kind === "clip") {
        if (e.key === "ArrowLeft") focusRow(sectionRowKey(row.id));
      } else if (e.key === "ArrowLeft") {
        if (open) props.onToggleCollapsed(row.id, e.altKey);
      } else if (!open) {
        props.onToggleCollapsed(row.id, e.altKey);
      } else if (rows[at + 1]?.kind === "clip") {
        focusRow(rows[at + 1].key);
      }
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (row.kind === "section") {
        if (row.id === LEFT_OUT) props.onToggleCollapsed(LEFT_OUT, false);
        else props.onShowSection(row.id);
      } else if (row.id !== LEFT_OUT) {
        props.onPlayClip(row.key);
      }
      return;
    }
    if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      if (row.kind === "section") {
        const block = sectionInfo.get(row.id)?.block;
        if (block) {
          if (canRemoveBlock(block.kind)) props.onRemoveBlock(row.id);
          return;
        }
        if (!row.player) return;
        props.onRemoveSection(row.id);
        focusRow(rows.slice(at + 1).find((r) => r.kind === "section")?.key ?? rows[at - 1]?.key);
        return;
      }
      if (row.id === LEFT_OUT) return;
      const keys = actionKeys(row.key);
      const gone = new Set(keys);
      // The row that takes the first one's place, else the one above.
      const next = rows.slice(at + 1).find((r) => !gone.has(r.key)) ?? rows.slice(0, at).reverse().find((r) => !gone.has(r.key));
      props.onMoveClips(keys, LEFT_OUT, null, "keys");
      focusRow(next?.key);
    }
  }

  /** Plays from the docked panel can land on a section that takes clips. */
  const takesPlays = (e: DragEvent, row: OutlineRowRef) =>
    !!props.onDropPlays && row.kind === "section" && !!row.accepts && row.id !== LEFT_OUT && e.dataTransfer.types.includes(PLAYS_DRAG_TYPE);
  const playsDrop = (row: OutlineRowRef) => ({
    onDragOver: (e: DragEvent) => {
      if (!takesPlays(e, row)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      if (playsOver !== row.id) setPlaysOver(row.id);
    },
    onDragLeave: (e: DragEvent) => {
      // Leaving for a child is not leaving.
      if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
      setPlaysOver((at) => (at === row.id ? null : at));
    },
    onDrop: (e: DragEvent) => {
      setPlaysOver(null);
      if (!takesPlays(e, row)) return;
      e.preventDefault();
      const keys = readPlaysDrag(e.dataTransfer);
      if (keys.length > 0) props.onDropPlays?.(row.id, keys);
    },
  });

  function onClipClick(e: MouseEvent, row: OutlineRowRef) {
    const shift = e.shiftKey;
    const toggle = e.metaKey || e.ctrlKey;
    const next = clickSelection({ order: clipOrder, selected, anchor, focus: current, key: row.key, shift, toggle });
    props.onSelectionChange(next.selected, next.anchor);
    setCurrent(row.key);
    if (!shift && !toggle && row.id !== LEFT_OUT) props.onPlayClip(row.key);
  }

  return (
    <nav aria-label="Sections" className="flex h-full w-full flex-col">
      {/* As a Finder sidebar's group: a quiet name, and + for what can be added. */}
      <div className="flex h-9 shrink-0 items-center justify-between pr-2 pl-4">
        <h2 className="text-caption font-semibold text-muted-foreground">Sections</h2>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Add players or a section"
              title="Add players or a section"
              className="flex size-6 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors duration-100 hover:bg-fill-1 hover:text-foreground focus-visible:ring-2 focus-visible:ring-selection data-[state=open]:bg-fill-1 data-[state=open]:text-foreground"
            >
              <Plus className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <AddSectionItems draft={props.draft} onAddBlock={props.onAddBlock} onAddPlayers={props.onAddPlayers} />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div
        ref={listRef}
        role="tree"
        aria-label="Sections and clips"
        aria-multiselectable
        onKeyDown={onKeyDown}
        onClick={(e) => {
          // A click on the list's empty space lets go of the selection, as in the playlist.
          if (e.target === e.currentTarget && selected.size > 0) props.onSelectionChange(new Set(), null);
        }}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain p-2"
      >
        {rows.map((row) =>
          row.kind === "section" ? (
            <SectionRow
              key={row.key}
              row={row}
              info={sectionInfo.get(row.id)}
              count={counts.get(row.id) ?? 0}
              open={!collapsed.has(row.id)}
              active={row.id === activeId}
              tabStop={row.key === tabStop}
              index={players.indexOf(row.id)}
              playerCount={players.length}
              adding={props.addingTo === row.id}
              playsOver={playsOver === row.id}
              dropHandlers={playsDrop(row)}
              onAddClips={props.onAddClips && row.accepts && row.id !== LEFT_OUT ? () => props.onAddClips?.(row.id) : undefined}
              onRename={props.onRename && sectionInfo.get(row.id)?.block?.kind === "custom" ? () => props.onRename?.(row.id) : undefined}
              onPointerDown={(e) => drag.onRowPointerDown(e, row.key)}
              onClick={() => {
                setCurrent(row.key);
                if (row.id === LEFT_OUT) props.onToggleCollapsed(LEFT_OUT, false);
                else props.onShowSection(row.id);
              }}
              onToggle={(all) => props.onToggleCollapsed(row.id, all)}
              onMove={(to) => props.onMoveSection(row.id, to)}
              onBlockHidden={(hidden) => props.onBlockHidden(row.id, hidden)}
              onMoveBlock={(dir) => props.onMoveBlock(row.id, dir)}
              onRemoveBlock={() => props.onRemoveBlock(row.id)}
              onRemove={() => {
                const at = rows.indexOf(row);
                props.onRemoveSection(row.id);
                if (listRef.current?.contains(document.activeElement)) {
                  focusRow(rows.slice(at + 1).find((r) => r.kind === "section")?.key ?? rows[at - 1]?.key);
                }
              }}
            />
          ) : (
            <ClipRow
              key={row.key}
              row={row}
              info={clipInfo.get(row.key)}
              selected={selected.has(row.key)}
              tabStop={row.key === tabStop}
              keys={actionKeys(row.key)}
              targets={targets}
              onPointerDown={(e) => drag.onRowPointerDown(e, row.key)}
              onClick={(e) => onClipClick(e, row)}
              onContextMenu={() => setCurrent(row.key)}
              onMoveTo={(keys, to) => props.onMoveClips(keys, to, null, "menu")}
              onInclude={(keys) => props.onIncludeClips(keys, "menu")}
              onShow={() => props.onShowClip(row.key)}
              onOpen={() => props.onOpenClip(row.key)}
            />
          ),
        )}
      </div>
    </nav>
  );
}

/** One entry of a section's menu, drawn both as its right-click menu and behind its ⋯. */
type SectionAction = { label: string; onSelect: () => void; disabled?: boolean; destructive?: boolean } | "separator";

function SectionRow({
  row,
  info,
  count,
  open,
  active,
  tabStop,
  index,
  playerCount,
  adding,
  playsOver,
  dropHandlers,
  onAddClips,
  onRename,
  onPointerDown,
  onClick,
  onToggle,
  onMove,
  onRemove,
  onBlockHidden,
  onMoveBlock,
  onRemoveBlock,
}: {
  row: OutlineRowRef;
  info: OutlineSectionInfo | undefined;
  count: number;
  open: boolean;
  active: boolean;
  tabStop: boolean;
  /** Among the players; -1 for the team and the left-out group. */
  index: number;
  playerCount: number;
  /** The docked plays add here. */
  adding: boolean;
  /** A play from the docked panel is dragged over the row. */
  playsOver: boolean;
  dropHandlers: { onDragOver: (e: DragEvent) => void; onDragLeave: (e: DragEvent) => void; onDrop: (e: DragEvent) => void };
  onAddClips?: () => void;
  onRename?: () => void;
  onPointerDown: (e: PointerEvent) => void;
  onClick: () => void;
  onToggle: (all: boolean) => void;
  onMove: (toIndex: number) => void;
  onRemove: () => void;
  onBlockHidden: (hidden: boolean) => void;
  onMoveBlock: (dir: -1 | 1) => void;
  onRemoveBlock: () => void;
}) {
  const player = !!row.player;
  const leftOut = row.id === LEFT_OUT;
  const block = info?.block;
  // A hidden section shrinks to a thin, dimmed row, as a skipped slide does in Keynote.
  const hidden = !!row.hidden && !player;
  const label = info?.label ?? "";
  const name = `${info?.number ? `#${info.number} ` : ""}${label}`;

  const actions: SectionAction[] = [];
  if (onAddClips) actions.push({ label: "Add clips…", onSelect: onAddClips }, "separator");
  if (player) {
    actions.push({ label: "Move up", onSelect: () => onMove(index - 1), disabled: index <= 0 });
    actions.push({ label: "Move down", onSelect: () => onMove(index + 1), disabled: index >= playerCount - 1 }, "separator");
  }
  if (block) {
    if (onRename) actions.push({ label: "Rename", onSelect: onRename });
    actions.push({ label: block.hidden ? "Show to players" : "Hide from players", onSelect: () => onBlockHidden(!block.hidden) });
    actions.push({ label: "Move up", onSelect: () => onMoveBlock(-1) }, { label: "Move down", onSelect: () => onMoveBlock(1) }, "separator");
  }
  actions.push({ label: open ? "Collapse" : "Expand", onSelect: () => onToggle(false) });
  if (block && canRemoveBlock(block.kind)) actions.push("separator", { label: "Remove section", onSelect: onRemoveBlock, destructive: true });
  if (player) actions.push("separator", { label: "Remove from report", onSelect: onRemove, destructive: true });

  // The row's own buttons don't start a drag, select it or scroll the document.
  const own = { onPointerDown: (e: PointerEvent) => e.stopPropagation(), onClick: (e: MouseEvent) => e.stopPropagation() };
  const quiet =
    "hidden size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-fill-3 hover:text-foreground group-hover:flex group-focus-within:flex group-has-[[data-state=open]]:flex data-[state=open]:bg-fill-3 data-[state=open]:text-foreground";
  const withButtons = !leftOut;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          data-row-key={row.key}
          role="treeitem"
          aria-level={1}
          aria-expanded={open}
          aria-current={active ? "location" : undefined}
          aria-label={`${name}, ${clipsNoun(count)}${adding ? ", plays are added here" : ""}`}
          tabIndex={tabStop ? 0 : -1}
          onPointerDown={onPointerDown}
          onClick={onClick}
          {...dropHandlers}
          className={cn(
            "group relative mt-0.5 flex shrink-0 select-none items-center gap-1 rounded-md pr-1 text-sm outline-none transition-[background-color,height,opacity] duration-150 focus-visible:ring-2 focus-visible:ring-selection first:mt-0",
            hidden ? "h-6 text-caption opacity-55" : "h-8",
            leftOut ? "mt-2 text-muted-foreground" : "text-foreground cursor-grab active:cursor-grabbing",
            active ? "bg-fill-2" : "hover:bg-fill-1",
            playsOver && "ring-2 ring-selection",
          )}
        >
          <button
            type="button"
            tabIndex={-1}
            aria-label={open ? `Collapse ${label}` : `Expand ${label}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggle(e.altKey);
            }}
            className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground outline-none hover:text-foreground"
          >
            <ChevronRight className={cn("size-3.5 transition-transform duration-150 motion-reduce:transition-none", open && "rotate-90")} />
          </button>
          {player && <span className="w-6 shrink-0 text-right text-caption text-muted-foreground nums">{info?.number ? `#${info.number}` : ""}</span>}
          <span className={cn("min-w-0 flex-1 truncate", player && "pl-1", !leftOut && !hidden && "font-medium")}>{label}</span>
          {hidden && <EyeOff className="size-3 shrink-0 text-muted-foreground" aria-label="Hidden from players" />}
          {adding && (
            <Tooltip>
              <TooltipTrigger asChild>
                <ListPlus aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent side="right">Plays are added here</TooltipContent>
            </Tooltip>
          )}
          {info?.statsLoading ? (
            <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" aria-label="Reading the stats" />
          ) : (
            <span
              className={cn(
                "shrink-0 px-1 text-caption text-muted-foreground nums",
                withButtons && "group-hover:hidden group-focus-within:hidden group-has-[[data-state=open]]:hidden",
              )}
            >
              {count}
            </span>
          )}
          {withButtons && onAddClips && (
            <button type="button" tabIndex={-1} aria-label={`Add clips to ${name}`} title={`Add clips to ${name}`} {...own} onClick={(e) => (e.stopPropagation(), onAddClips())} className={quiet}>
              <Plus className="size-3.5" />
            </button>
          )}
          {withButtons && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" tabIndex={-1} aria-label={`${name} options`} {...own} className={quiet}>
                  <MoreHorizontal className="size-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="right" onClick={(e) => e.stopPropagation()}>
                {actions.map((a, i) =>
                  a === "separator" ? (
                    <DropdownMenuSeparator key={`s${i}`} />
                  ) : (
                    <DropdownMenuItem key={a.label} disabled={a.disabled} onSelect={a.onSelect} className={a.destructive ? "text-destructive focus:text-destructive" : undefined}>
                      {a.label}
                    </DropdownMenuItem>
                  ),
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {actions.map((a, i) =>
          a === "separator" ? (
            <ContextMenuSeparator key={`s${i}`} />
          ) : (
            <ContextMenuItem key={a.label} disabled={a.disabled} onSelect={a.onSelect} className={a.destructive ? "text-destructive focus:text-destructive" : undefined}>
              {a.label}
            </ContextMenuItem>
          ),
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

function ClipRow({
  row,
  info,
  selected,
  tabStop,
  keys,
  targets,
  onPointerDown,
  onClick,
  onContextMenu,
  onMoveTo,
  onInclude,
  onShow,
  onOpen,
}: {
  row: OutlineRowRef;
  info: OutlineClipInfo | undefined;
  selected: boolean;
  tabStop: boolean;
  /** What the row's menu acts on. */
  keys: string[];
  targets: { id: Placement; label: string }[];
  onPointerDown: (e: PointerEvent) => void;
  onClick: (e: MouseEvent) => void;
  onContextMenu: () => void;
  onMoveTo: (keys: string[], to: Placement) => void;
  onInclude: (keys: string[]) => void;
  onShow: () => void;
  onOpen: () => void;
}) {
  if (!info) return null;
  const { event, item } = info;
  const leftOut = row.id === LEFT_OUT;
  const note = item.note?.trim();
  const n = keys.length;
  const who = event.player ? playerName(event) : (event.eventTeam?.teamName ?? null);
  return (
    <ContextMenu>
      <Tooltip delayDuration={700}>
        <ContextMenuTrigger asChild>
          <TooltipTrigger asChild onFocus={(e) => e.preventDefault()}>
            <div
              data-row-key={row.key}
              role="treeitem"
              aria-level={2}
              aria-selected={selected}
              aria-label={`${eventLabel(event)}${info.actor ? `, ${info.actor}` : ""}, ${clock(event)}${note ? ", has a note" : ""}`}
              tabIndex={tabStop ? 0 : -1}
              onPointerDown={onPointerDown}
              onClick={onClick}
              onContextMenu={onContextMenu}
              onMouseDown={(e) => {
                if (e.shiftKey) e.preventDefault();
              }}
              className={cn(
                "group relative flex h-7 shrink-0 cursor-default select-none items-center gap-2 rounded-md pr-2 pl-7 text-callout outline-none transition-colors duration-100 focus-visible:ring-2 focus-visible:ring-selection",
                selected ? "bg-row-selected text-foreground" : "hover:bg-fill-1",
                leftOut && !selected && "text-muted-foreground",
              )}
            >
              <span aria-hidden className={cn("h-3.5 w-[3px] shrink-0 rounded-full", eventColors(event).strip, leftOut && "opacity-50")} />
              <span className="min-w-0 flex-1 truncate">
                {info.actor && <span className={"text-muted-foreground"}>{info.actor} · </span>}
                {eventLabel(event)}
              </span>
              {note && <StickyNote aria-hidden className={cn("size-3 shrink-0", "text-muted-foreground")} />}
              <span className={cn("shrink-0 text-caption nums", "text-muted-foreground")}>{clock(event)}</span>
            </div>
          </TooltipTrigger>
        </ContextMenuTrigger>
        <TooltipContent side="right" align="start" className="flex max-w-72 flex-col gap-0.5">
          <span className="font-medium">
            {eventLabel(event)}
            {who ? ` · ${who}` : ""}
          </span>
          <span className="nums">
            {clock(event)}
            {info.game ? ` · ${info.game}` : ""}
          </span>
          {info.labels.length > 0 && <span>{info.labels.join(", ")}</span>}
          {note && <span className="line-clamp-4 whitespace-pre-line">{note}</span>}
        </TooltipContent>
      </Tooltip>
      <ContextMenuContent>
        <ContextMenuSub>
          <ContextMenuSubTrigger>{n === 1 ? "Move to" : `Move ${n} clips to`}</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {targets.map((t) => (
              <ContextMenuItem key={t.id} disabled={n === 1 && t.id === row.id} onSelect={() => onMoveTo(keys, t.id)}>
                {t.label}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
        {leftOut ? (
          <ContextMenuItem onSelect={() => onInclude(keys)}>{n === 1 ? "Put back in report" : `Put ${n} clips back in report`}</ContextMenuItem>
        ) : (
          <ContextMenuItem onSelect={() => onMoveTo(keys, LEFT_OUT)}>{n === 1 ? "Leave out of report" : `Leave ${n} clips out of report`}</ContextMenuItem>
        )}
        <ContextMenuSeparator />
        {!leftOut && <ContextMenuItem onSelect={onShow}>Show in report</ContextMenuItem>}
        <ContextMenuItem onSelect={onOpen}>Edit clip</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
