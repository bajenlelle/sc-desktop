import { useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { ChevronRight, Loader2, Plus, StickyNote, X } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";
import { eventColors, eventLabel, formatGameClock, periodLabel, playerName } from "@scoutable/shared/lib/events";
import { clickSelection, extendSelection } from "@scoutable/shared/lib/list-selection";
import { LEFT_OUT, TEAM_SECTION, type Placement, type ReportLayout } from "@scoutable/shared/lib/report-draft";
import { clipDrop, outlineRows, sectionDropIndex, sectionGap, sectionRowKey, snapClipGap, type OutlineRowRef } from "@scoutable/shared/lib/report-outline";
import type { PlayByPlayEvent, PlaylistClipItem } from "@/types/match";

export interface OutlineSectionInfo {
  /** "Alva Berg", "Team", "Not in report". */
  label: string;
  number: string | null;
  statsLoading: boolean;
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

export type MoveVia = "drag" | "keys" | "menu";

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
}

const isPlayer = (id: Placement) => id !== TEAM_SECTION && id !== LEFT_OUT;
const clock = (e: PlayByPlayEvent) => `${periodLabel(e.period)} ${formatGameClock(e.gameClockTime).replace(/^0/, "")}`;
const clipsNoun = (n: number) => (n === 1 ? "clip" : `${n} clips`);

/**
 * The report at a glance: each section's header with its clips under it,
 * Team first (always, so there is somewhere to drop a clip) and the clips
 * left out of the report last. A clip is a line with its play's colour, the
 * play and the time; hovering tells the rest.
 *
 * Dragging a clip (or the selection it is in) reorders it or moves it under
 * another player, into the team or out of the report; dragging a player's
 * header moves the player with their clips. The keys do the same: ⌥↑/⌥↓
 * moves the focused row, ⌫ leaves clips out (or removes a player), ←/→ fold
 * and unfold. ⌘-click and ⇧-click select clips, as in the playlist; a plain
 * click or Return plays the clip in its tile. Where a drop lands is worked
 * out in lib/report-outline.ts.
 */
export function ReportOutline(props: ReportOutlineProps) {
  const { layout, sectionInfo, clipInfo, collapsed, selected, anchor, activeId } = props;
  const listRef = useRef<HTMLDivElement | null>(null);
  const noSidebar = useRef<HTMLElement | null>(null);
  const [current, setCurrent] = useState<string | null>(null);

  const rows = useMemo(() => outlineRows(layout, collapsed), [layout, collapsed]);
  const rowByKey = useMemo(() => new Map(rows.map((r) => [r.key, r])), [rows]);
  const clipOrder = useMemo(() => rows.filter((r) => r.kind === "clip").map((r) => r.key), [rows]);
  const players = useMemo(() => layout.sections.filter((s) => s.section).map((s) => s.id), [layout]);
  const counts = useMemo(() => {
    const m = new Map<Placement, number>(layout.sections.map((s) => [s.id, s.clips.length]));
    m.set(LEFT_OUT, layout.leftOut.length);
    return m;
  }, [layout]);
  const targets = useMemo(() => layout.sections.map((s) => ({ id: s.id, label: labelOf(s.id) })), [layout, sectionInfo]);

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
      return !!row && (row.kind === "clip" || isPlayer(row.id));
    },
    blockFor: (key) => {
      const row = rowByKey.get(key)!;
      if (row.kind === "section") return [key, ...rows.filter((r) => r.kind === "clip" && r.id === row.id).map((r) => r.key)];
      return actionKeys(key);
    },
    badgeCount: (keys) => (rowByKey.get(keys[0])?.kind === "section" ? 1 : keys.length),
    snapGap: (gap, keys) => (rowByKey.get(keys[0])?.kind === "section" ? sectionGap(rows, gap) : snapClipGap(gap)),
    onTarget: () => {},
    onDrop: ({ gap, blockKeys }) => {
      const first = rowByKey.get(blockKeys[0]);
      if (first?.kind === "section") {
        props.onMoveSection(first.id, sectionDropIndex(rows, blockKeys, gap));
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
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const dir = e.key === "ArrowDown" ? 1 : -1;
      if (e.altKey) {
        if (row.kind === "clip") props.onNudgeClips(actionKeys(row.key), dir);
        else if (isPlayer(row.id)) props.onMoveSection(row.id, players.indexOf(row.id) + dir);
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
        if (!isPlayer(row.id)) return;
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

  function onClipClick(e: MouseEvent, row: OutlineRowRef) {
    const shift = e.shiftKey;
    const toggle = e.metaKey || e.ctrlKey;
    const next = clickSelection({ order: clipOrder, selected, anchor, focus: current, key: row.key, shift, toggle });
    props.onSelectionChange(next.selected, next.anchor);
    setCurrent(row.key);
    if (!shift && !toggle && row.id !== LEFT_OUT) props.onPlayClip(row.key);
  }

  return (
    <nav aria-label="Report outline" className="flex h-full w-[288px] shrink-0 flex-col border-r border-separator">
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
        className="flex min-h-0 flex-1 flex-col overflow-y-auto p-2"
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
              onPointerDown={(e) => drag.onRowPointerDown(e, row.key)}
              onClick={() => {
                setCurrent(row.key);
                if (row.id === LEFT_OUT) props.onToggleCollapsed(LEFT_OUT, false);
                else props.onShowSection(row.id);
              }}
              onToggle={(all) => props.onToggleCollapsed(row.id, all)}
              onMove={(to) => props.onMoveSection(row.id, to)}
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
      <div className="border-t border-separator p-2">
        <Button variant="outline" size="sm" className="w-full" onClick={props.onAddPlayers}>
          <Plus />
          Add players
        </Button>
      </div>
    </nav>
  );
}

function SectionRow({
  row,
  info,
  count,
  open,
  active,
  tabStop,
  index,
  playerCount,
  onPointerDown,
  onClick,
  onToggle,
  onMove,
  onRemove,
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
  onPointerDown: (e: PointerEvent) => void;
  onClick: () => void;
  onToggle: (all: boolean) => void;
  onMove: (toIndex: number) => void;
  onRemove: () => void;
}) {
  const player = isPlayer(row.id);
  const leftOut = row.id === LEFT_OUT;
  const label = info?.label ?? "";
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          data-row-key={row.key}
          role="treeitem"
          aria-level={1}
          aria-expanded={open}
          aria-current={active ? "location" : undefined}
          aria-label={`${info?.number ? `#${info.number} ` : ""}${label}, ${clipsNoun(count)}`}
          tabIndex={tabStop ? 0 : -1}
          onPointerDown={onPointerDown}
          onClick={onClick}
          className={cn(
            "group relative mt-0.5 flex h-8 shrink-0 select-none items-center gap-1 rounded-md pr-1 text-sm outline-none transition-colors duration-100 focus-visible:ring-2 focus-visible:ring-selection first:mt-0",
            leftOut ? "mt-2 text-muted-foreground" : "text-foreground",
            active ? "bg-fill-2" : "hover:bg-fill-1",
            player && "cursor-grab active:cursor-grabbing",
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
          <span className={cn("min-w-0 flex-1 truncate", player && "pl-1", !leftOut && "font-medium")}>{label}</span>
          {info?.statsLoading ? (
            <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" aria-label="Reading the stats" />
          ) : (
            <span className={cn("shrink-0 px-1 text-caption text-muted-foreground nums", player && "group-hover:hidden group-focus-within:hidden")}>{count}</span>
          )}
          {player && (
            <button
              type="button"
              tabIndex={-1}
              aria-label={`Remove ${label}`}
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
              className="hidden size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-fill-3 hover:text-foreground group-hover:flex group-focus-within:flex"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {player && (
          <>
            <ContextMenuItem disabled={index <= 0} onSelect={() => onMove(index - 1)}>
              Move up
            </ContextMenuItem>
            <ContextMenuItem disabled={index >= playerCount - 1} onSelect={() => onMove(index + 1)}>
              Move down
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        <ContextMenuItem onSelect={() => onToggle(false)}>{open ? "Collapse" : "Expand"}</ContextMenuItem>
        {player && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem className="text-destructive focus:text-destructive" onSelect={onRemove}>
              Remove from report
            </ContextMenuItem>
          </>
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
                selected ? "bg-selection text-selection-foreground" : "hover:bg-fill-1",
                leftOut && !selected && "text-muted-foreground",
              )}
            >
              <span aria-hidden className={cn("h-3.5 w-[3px] shrink-0 rounded-full", eventColors(event).strip, leftOut && "opacity-50")} />
              <span className="min-w-0 flex-1 truncate">
                {info.actor && <span className={selected ? "text-selection-foreground/80" : "text-muted-foreground"}>{info.actor} · </span>}
                {eventLabel(event)}
              </span>
              {note && <StickyNote aria-hidden className={cn("size-3 shrink-0", selected ? "text-selection-foreground/80" : "text-muted-foreground")} />}
              <span className={cn("shrink-0 text-caption nums", selected ? "text-selection-foreground/80" : "text-muted-foreground")}>{clock(event)}</span>
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
